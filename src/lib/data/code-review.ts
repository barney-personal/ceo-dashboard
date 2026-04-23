import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubEmployeeMap, prReviewAnalyses } from "@/lib/db/schema";
import {
  RUBRIC_VERSION,
  type AnalysisCategory,
  type AnalysisStandout,
} from "@/lib/integrations/code-review-analyser";
import { CODE_REVIEW_WINDOW_DAYS } from "@/lib/sync/code-review";

export interface PrReviewEntry {
  repo: string;
  prNumber: number;
  mergedAt: Date;
  complexity: number;
  quality: number;
  category: AnalysisCategory;
  summary: string;
  caveats: string[];
  standout: AnalysisStandout | null;
  githubUrl: string;
}

export type DiagnosticFlag =
  | "high_volume_low_quality"
  | "low_volume_high_complexity"
  | "quality_variance_high"
  | "all_tiny_prs"
  | "low_evidence"
  | "has_concerning_pr";

export interface EngineerRollup {
  authorLogin: string;
  employeeName: string | null;
  employeeEmail: string | null;
  isBot: boolean;
  prCount: number;
  distinctRepos: number;
  medianComplexity: number;
  medianQuality: number;
  maxComplexity: number;
  /** Composite ranking input. Sum of complexity × quality across this
   * engineer's PRs — rewards both volume and per-PR weight. A flood of
   * trivial PRs can't outrank a few hard ones. */
  compositeScore: number;
  categoryCounts: Record<AnalysisCategory, number>;
  flags: DiagnosticFlag[];
  /** Present for the drawer. Sorted by merged_at desc. */
  prs: PrReviewEntry[];
  /** Delta vs the previous `windowDays` window (Phase 2). `null` when no
   * prior data — don't show a misleading "+100%" for first-ever analyses. */
  prevPrCount: number | null;
  prevCompositeScore: number | null;
  /** Weekly composite buckets across the current window, oldest→newest.
   * Used for the trend sparkline in the drawer. */
  weeklyComposite: number[];
}

export interface CodeReviewView {
  windowDays: number;
  rubricVersion: string;
  analysedAtLatest: Date | null;
  engineers: EngineerRollup[];
  /** Engineers with <3 PRs in the window — separated from the main ranking
   * to avoid ordinal rankings with almost no evidence behind them. */
  lowEvidenceEngineers: EngineerRollup[];
  totalPrs: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Bucket PRs into weekly composite totals, oldest→newest, across the window.
 * `windowDays=30` yields 5 buckets (`ceil(30/7) = 5`) each covering ~6 days
 * so every day in the window maps to exactly one bucket. */
function bucketWeekly(prs: PrReviewEntry[], windowDays: number): number[] {
  const buckets = Math.max(1, Math.ceil(windowDays / 7));
  const totals = new Array<number>(buckets).fill(0);
  const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const bucketMs = (windowDays * 24 * 60 * 60 * 1000) / buckets;
  for (const pr of prs) {
    const offset = pr.mergedAt.getTime() - windowStart;
    let idx = Math.floor(offset / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= buckets) idx = buckets - 1;
    totals[idx] += pr.complexity * pr.quality;
  }
  return totals;
}

function emptyCategoryCounts(): Record<AnalysisCategory, number> {
  return {
    bug_fix: 0,
    feature: 0,
    refactor: 0,
    infra: 0,
    test: 0,
    docs: 0,
    chore: 0,
  };
}

function computeFlags(rows: PrReviewEntry[]): DiagnosticFlag[] {
  const flags: DiagnosticFlag[] = [];
  if (rows.length === 0) return flags;
  const qualities = rows.map((r) => r.quality);
  const complexities = rows.map((r) => r.complexity);
  const medQ = median(qualities);
  const medC = median(complexities);

  // Thresholds are intentionally conservative — we flag *signal*, not noise.
  if (rows.length >= 8 && medQ <= 2) flags.push("high_volume_low_quality");
  if (rows.length <= 4 && medC >= 4) flags.push("low_volume_high_complexity");
  if (qualities.length >= 5 && stdev(qualities) >= 1.2) {
    flags.push("quality_variance_high");
  }
  if (rows.length >= 5 && rows.every((r) => r.complexity <= 2)) {
    flags.push("all_tiny_prs");
  }
  if (rows.length < 3) flags.push("low_evidence");
  if (rows.some((r) => r.standout === "concerning")) {
    flags.push("has_concerning_pr");
  }
  return flags;
}

interface RollupOptions {
  windowDays?: number;
  /** If true, also compute previous-window metrics for delta display. */
  includePrevious?: boolean;
}

/**
 * Roll up cached PR analyses into per-engineer rows. Hits the DB once (plus
 * one extra query for the previous window if delta is requested), then does
 * all aggregation in memory — the dataset is small (< few thousand rows)
 * so this is fine.
 */
export async function getCodeReviewView(
  opts: RollupOptions = {},
): Promise<CodeReviewView> {
  const windowDays = opts.windowDays ?? CODE_REVIEW_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [rows, employeeMap] = await Promise.all([
    db
      .select()
      .from(prReviewAnalyses)
      .where(
        and(
          eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
          gte(prReviewAnalyses.mergedAt, since),
        ),
      )
      .orderBy(desc(prReviewAnalyses.mergedAt)),
    db.select().from(githubEmployeeMap),
  ]);

  const employeeByLogin = new Map(
    employeeMap.map((m) => [m.githubLogin.toLowerCase(), m]),
  );

  // Previous window (Phase 2 delta). Only the shape we need for comparison —
  // skip loading full PR bodies, just the inputs for composite/count.
  let prevRows: typeof rows = [];
  if (opts.includePrevious) {
    const prevStart = new Date(
      Date.now() - 2 * windowDays * 24 * 60 * 60 * 1000,
    );
    const prevEnd = since;
    prevRows = await db
      .select()
      .from(prReviewAnalyses)
      .where(
        and(
          eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
          gte(prReviewAnalyses.mergedAt, prevStart),
          lt(prReviewAnalyses.mergedAt, prevEnd),
        ),
      );
  }

  const rollupByAuthor = new Map<
    string,
    {
      prs: PrReviewEntry[];
      repos: Set<string>;
      categoryCounts: Record<AnalysisCategory, number>;
    }
  >();

  for (const row of rows) {
    const key = row.authorLogin.toLowerCase();
    let bucket = rollupByAuthor.get(key);
    if (!bucket) {
      bucket = {
        prs: [],
        repos: new Set(),
        categoryCounts: emptyCategoryCounts(),
      };
      rollupByAuthor.set(key, bucket);
    }
    const entry: PrReviewEntry = {
      repo: row.repo,
      prNumber: row.prNumber,
      mergedAt: row.mergedAt,
      complexity: row.complexity,
      quality: row.quality,
      category: row.category as AnalysisCategory,
      summary: row.summary,
      caveats: (row.caveats as string[] | null) ?? [],
      standout: (row.standout as AnalysisStandout | null) ?? null,
      // Stored repo may be a bare name (matches githubPrs schema); prepend
      // the org so the link actually resolves. GITHUB_ORG is a required
      // Doppler secret — we'd rather a visibly broken link than a
      // hardcoded fallback that silently points at the wrong GitHub org.
      githubUrl: row.repo.includes("/")
        ? `https://github.com/${row.repo}/pull/${row.prNumber}`
        : `https://github.com/${process.env.GITHUB_ORG ?? ""}/${row.repo}/pull/${row.prNumber}`,
    };
    bucket.prs.push(entry);
    bucket.repos.add(row.repo);
    bucket.categoryCounts[entry.category] =
      (bucket.categoryCounts[entry.category] ?? 0) + 1;
  }

  const prevByAuthor = new Map<string, number[]>();
  const prevCountByAuthor = new Map<string, number>();
  for (const row of prevRows) {
    const key = row.authorLogin.toLowerCase();
    const arr = prevByAuthor.get(key) ?? [];
    arr.push(row.complexity * row.quality);
    prevByAuthor.set(key, arr);
    prevCountByAuthor.set(key, (prevCountByAuthor.get(key) ?? 0) + 1);
  }

  const all: EngineerRollup[] = [];
  for (const [key, bucket] of rollupByAuthor) {
    const emp = employeeByLogin.get(key);
    if (emp?.isBot) continue;
    const prs = bucket.prs;
    const complexities = prs.map((p) => p.complexity);
    const qualities = prs.map((p) => p.quality);
    const composite = prs.reduce(
      (s, p) => s + p.complexity * p.quality,
      0,
    );
    const flags = computeFlags(prs);
    const prevComposite = prevByAuthor.get(key)?.reduce((s, v) => s + v, 0);
    const weeklyComposite = bucketWeekly(prs, windowDays);
    all.push({
      authorLogin: prs[0] ? rowsLoginFor(rows, key) : key,
      employeeName: emp?.employeeName ?? null,
      employeeEmail: emp?.employeeEmail ?? null,
      isBot: emp?.isBot ?? false,
      prCount: prs.length,
      distinctRepos: bucket.repos.size,
      medianComplexity: median(complexities),
      medianQuality: median(qualities),
      maxComplexity: Math.max(...complexities),
      compositeScore: composite,
      categoryCounts: bucket.categoryCounts,
      flags,
      prs,
      prevPrCount: opts.includePrevious
        ? prevCountByAuthor.get(key) ?? 0
        : null,
      prevCompositeScore: opts.includePrevious ? prevComposite ?? 0 : null,
      weeklyComposite,
    });
  }

  all.sort((a, b) => b.compositeScore - a.compositeScore);

  const engineers = all.filter((e) => !e.flags.includes("low_evidence"));
  const lowEvidenceEngineers = all.filter((e) =>
    e.flags.includes("low_evidence"),
  );

  // rows is sorted by mergedAt desc — not the same thing as "most recently
  // analysed". Walk the set to find the true max analysedAt so the page
  // header accurately reflects when the last LLM call completed.
  let analysedAtLatest: Date | null = null;
  for (const r of rows) {
    if (!analysedAtLatest || r.analysedAt > analysedAtLatest) {
      analysedAtLatest = r.analysedAt;
    }
  }

  return {
    windowDays,
    rubricVersion: RUBRIC_VERSION,
    analysedAtLatest,
    engineers,
    lowEvidenceEngineers,
    totalPrs: rows.length,
  };
}

// Find the canonical-case login for this lower-cased key. The aggregation map
// is keyed case-insensitively (GitHub logins are case-insensitive for
// comparison) but we want to show the original casing.
function rowsLoginFor(
  rows: Array<{ authorLogin: string }>,
  key: string,
): string {
  for (const r of rows) {
    if (r.authorLogin.toLowerCase() === key) return r.authorLogin;
  }
  return key;
}
