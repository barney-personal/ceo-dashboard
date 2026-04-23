import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  githubEmployeeMap,
  githubPrs,
  prReviewAnalyses,
} from "@/lib/db/schema";
import {
  RUBRIC_VERSION,
  analysePR,
  type CodeReviewAnalysis,
} from "@/lib/integrations/code-review-analyser";
import { fetchPRAnalysisPayload } from "@/lib/integrations/github";

/**
 * How far back the page looks. 30 days is the calibration window; widening
 * gives more signal but dilutes the "what did they do this month" framing.
 */
export const CODE_REVIEW_WINDOW_DAYS = 30;

/**
 * Repos we'll never run Claude against — sensitive, infra-only, or where LLM
 * judgement adds little. Empty by default; set CODE_REVIEW_EXCLUDED_REPOS
 * in Doppler to override (comma-separated `owner/repo` list).
 */
export function getExcludedRepos(): Set<string> {
  const raw = process.env.CODE_REVIEW_EXCLUDED_REPOS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isBotAuthor(login: string): boolean {
  const l = login.toLowerCase();
  return (
    l.endsWith("[bot]") ||
    l.endsWith("-bot") ||
    l === "dependabot" ||
    l === "renovate" ||
    l === "github-actions"
  );
}

export interface AnalyseRunResult {
  candidatesConsidered: number;
  cached: number;
  analysed: number;
  failed: Array<{ repo: string; prNumber: number; reason: string }>;
  skipped: Array<{ repo: string; prNumber: number; reason: string }>;
  durationMs: number;
}

export interface AnalyseRunOptions {
  /** Override the 30d default window (for cron / backfills / tests). */
  windowDays?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Max PRs to analyse per call (keeps a manual trigger bounded). */
  limit?: number;
  /** Re-analyse already-cached rows (use sparingly — blows cost). */
  force?: boolean;
}

/**
 * Analyse every merged PR in the window that doesn't yet have a cached
 * analysis for the current RUBRIC_VERSION. Idempotent — safe to re-run.
 *
 * Designed to be called from:
 *   - The CEO-only manual trigger (`POST /api/sync/code-review`)
 *   - The weekly cron (`GET /api/cron`)
 *   - Backfills (scripted; pass a larger windowDays)
 */
export async function runCodeReviewAnalysis(
  opts: AnalyseRunOptions = {},
): Promise<AnalyseRunResult> {
  const start = Date.now();
  const windowDays = opts.windowDays ?? CODE_REVIEW_WINDOW_DAYS;
  const limit = opts.limit ?? 500;
  const excluded = getExcludedRepos();

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({
      repo: githubPrs.repo,
      prNumber: githubPrs.prNumber,
      authorLogin: githubPrs.authorLogin,
      mergedAt: githubPrs.mergedAt,
    })
    .from(githubPrs)
    .where(gte(githubPrs.mergedAt, since))
    .orderBy(desc(githubPrs.mergedAt));

  // Load DB-flagged bots once so we can filter them at sync time rather than
  // at display time. Without this, a bot with a clean-looking login (e.g. a
  // release bot named `acme-releaser`) has its PRs fetched + sent to Claude
  // + stored, only to be silently dropped on page load — wasted LLM budget.
  const botLogins = new Set(
    (
      await db
        .select({ githubLogin: githubEmployeeMap.githubLogin })
        .from(githubEmployeeMap)
        .where(eq(githubEmployeeMap.isBot, true))
    ).map((r) => r.githubLogin.toLowerCase()),
  );

  const skipped: AnalyseRunResult["skipped"] = [];
  const failed: AnalyseRunResult["failed"] = [];
  let cached = 0;
  let analysed = 0;

  // Find which (repo, prNumber) pairs already have a current-rubric analysis —
  // batch lookup so we don't N+1 select.
  const eligible = candidates.filter((c) => {
    if (isBotAuthor(c.authorLogin) || botLogins.has(c.authorLogin.toLowerCase())) {
      skipped.push({ repo: c.repo, prNumber: c.prNumber, reason: "bot author" });
      return false;
    }
    if (excluded.has(c.repo.toLowerCase())) {
      skipped.push({ repo: c.repo, prNumber: c.prNumber, reason: "repo excluded" });
      return false;
    }
    return true;
  });

  if (!opts.force && eligible.length > 0) {
    const existing = await db
      .select({
        repo: prReviewAnalyses.repo,
        prNumber: prReviewAnalyses.prNumber,
      })
      .from(prReviewAnalyses)
      .where(
        and(
          eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
          or(
            ...eligible.map((c) =>
              and(
                eq(prReviewAnalyses.repo, c.repo),
                eq(prReviewAnalyses.prNumber, c.prNumber),
              ),
            ),
          ),
        ),
      );
    const key = (r: { repo: string; prNumber: number }) => `${r.repo}#${r.prNumber}`;
    const existingSet = new Set(existing.map(key));
    for (let i = eligible.length - 1; i >= 0; i--) {
      if (existingSet.has(key(eligible[i]))) {
        cached++;
        eligible.splice(i, 1);
      }
    }
  }

  const toRun = eligible.slice(0, limit);
  // githubPrs.repo is the bare repo name (e.g. "mobile-app") — the GitHub
  // sync drops the org to match its per-repo metric schema. We need the
  // full "owner/repo" for the API, so prefix with GITHUB_ORG here. Throw
  // loudly if the env var is missing rather than producing "/reponame"
  // URLs that yield silent GitHub 404s per-PR.
  const org = process.env.GITHUB_ORG;
  if (!org && toRun.some((c) => !c.repo.includes("/"))) {
    throw new Error(
      "GITHUB_ORG is not set but one or more PRs store a bare repo name. " +
        "Set GITHUB_ORG in Doppler (dev + prd) to resolve repo full names.",
    );
  }
  function fullName(repo: string): string {
    return repo.includes("/") ? repo : `${org}/${repo}`;
  }
  // Sequential — tool-use + Opus bandwidth is fine for ≤500 PRs/run and
  // keeps memory footprint predictable. Parallelism can be added later if
  // the cron window bites.
  for (const c of toRun) {
    if (opts.signal?.aborted) break;
    try {
      const payload = await fetchPRAnalysisPayload(fullName(c.repo), c.prNumber, {
        signal: opts.signal,
      });
      const analysis = await analysePR(payload, { signal: opts.signal });
      await upsertAnalysis(c, payload.mergeSha, analysis);
      analysed++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ repo: c.repo, prNumber: c.prNumber, reason });
      Sentry.captureException(err, {
        tags: { feature: "code-review", repo: c.repo, pr: String(c.prNumber) },
      });
    }
  }

  return {
    candidatesConsidered: candidates.length,
    cached,
    analysed,
    failed,
    skipped,
    durationMs: Date.now() - start,
  };
}

async function upsertAnalysis(
  pr: {
    repo: string;
    prNumber: number;
    authorLogin: string;
    mergedAt: Date;
  },
  mergeSha: string | null,
  analysis: CodeReviewAnalysis,
): Promise<void> {
  await db
    .insert(prReviewAnalyses)
    .values({
      repo: pr.repo,
      prNumber: pr.prNumber,
      mergeSha: mergeSha ?? null,
      authorLogin: pr.authorLogin,
      mergedAt: pr.mergedAt,
      complexity: analysis.complexity,
      quality: analysis.quality,
      category: analysis.category,
      summary: analysis.summary,
      caveats: analysis.caveats,
      standout: analysis.standout,
      rubricVersion: RUBRIC_VERSION,
      rawJson: analysis as unknown as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [
        prReviewAnalyses.repo,
        prReviewAnalyses.prNumber,
        prReviewAnalyses.rubricVersion,
      ],
      set: {
        mergeSha: mergeSha ?? null,
        authorLogin: pr.authorLogin,
        mergedAt: pr.mergedAt,
        complexity: analysis.complexity,
        quality: analysis.quality,
        category: analysis.category,
        summary: analysis.summary,
        caveats: analysis.caveats,
        standout: analysis.standout,
        rawJson: analysis as unknown as Record<string, unknown>,
        analysedAt: sql`now()`,
      },
    });
}

/**
 * Prune analyses older than the window that the UI cares about. Keeps the
 * table bounded even if retention/cron are misconfigured. No-op when the
 * window hasn't moved.
 */
export async function pruneOldAnalyses(windowDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const res = await db
    .delete(prReviewAnalyses)
    .where(lt(prReviewAnalyses.mergedAt, cutoff))
    .returning({ id: prReviewAnalyses.id });
  return res.length;
}

/** Milliseconds since the most-recent analysis row was written. Used by the
 * cron gate to skip code-review on 2-hour ticks — we only want a weekly run. */
export async function msSinceLastAnalysis(): Promise<number | null> {
  const row = await db
    .select({ analysedAt: prReviewAnalyses.analysedAt })
    .from(prReviewAnalyses)
    .orderBy(desc(prReviewAnalyses.analysedAt))
    .limit(1);
  if (row.length === 0) return null;
  return Date.now() - row[0].analysedAt.getTime();
}

/** Minimum gap between cron-triggered runs. Manual triggers bypass this. */
export const CODE_REVIEW_CRON_COOLDOWN_MS = 6.5 * 24 * 60 * 60 * 1000;

/**
 * Cron-friendly wrapper. Skips when a run happened within the cooldown.
 * Returns `{ skippedBy: "cooldown" }` instead of a result object when
 * skipped so the caller can include it in the fan-out response without
 * blowing up on a non-result. On every non-skipped run it also prunes
 * old rows to keep the table bounded.
 */
export async function maybeRunCodeReviewFromCron(): Promise<
  | (AnalyseRunResult & { pruned?: number })
  | { skippedBy: "cooldown" }
> {
  const sinceLast = await msSinceLastAnalysis();
  if (sinceLast !== null && sinceLast < CODE_REVIEW_CRON_COOLDOWN_MS) {
    return { skippedBy: "cooldown" };
  }
  const result = await runCodeReviewAnalysis();
  // Prune before returning so the table doesn't grow indefinitely under
  // multi-rubric-version history. Errors here shouldn't fail the cron —
  // Sentry captures and we serve the run result anyway.
  let pruned: number | undefined;
  try {
    pruned = await pruneOldAnalyses();
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: "code-review", step: "prune" } });
  }
  return { ...result, pruned };
}

/** Surface reachable for tests without going through a cron handler. */
export async function getCachedAnalysisCount(
  repos: string[],
): Promise<number> {
  if (repos.length === 0) return 0;
  const res = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prReviewAnalyses)
    .where(
      and(
        eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
        inArray(prReviewAnalyses.repo, repos),
      ),
    );
  return res[0]?.count ?? 0;
}
