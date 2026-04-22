/**
 * Engineering impact analytics — data loader.
 *
 * Provides a single rich analysis object consumed by the
 * /dashboard/engineering/impact page. Combines:
 *   - active engineers from Mode's `headcount` query (richer than the
 *     Current FTEs feed - includes hb_level, rp_specialisation,
 *     rp_department_name, job_title)
 *   - GitHub PR history joined via github_employee_map / employee_email
 *   - Per-engineer tenure-month buckets (30-day windows from start_date),
 *     flagged inWindow when fully inside the reliable data window
 *
 * Impact formula mirrors src/components/dashboard/engineering-table.tsx:
 *   impact = round( prs * log2( 1 + (additions + deletions) / prs ) )
 *
 * Reliable data window is auto-detected: scan per-calendar-month PR
 * volumes and cut off anything with fewer than 40% of the median month's
 * volume (catches backfill sparsity from early in the sync's life).
 */

import { db } from "@/lib/db";
import { githubPrs, githubEmployeeMap } from "@/lib/db/schema";
import { gte, eq, sql, and, inArray } from "drizzle-orm";
import { getReportData } from "@/lib/data/mode";
import {
  aggregateLatestMonthByUser,
  getAiUsageData,
} from "@/lib/data/ai-usage";

const MS_PER_DAY = 86_400_000;
export const BUCKET_DAYS = 30;

export type LevelTrack = "IC" | "EM" | "QA" | "Other" | "unknown";
export type Discipline = "BE" | "FE" | "EM" | "QA" | "ML" | "Ops" | "Other";

export interface ImpactEngineer {
  email: string;
  name: string;
  githubLogin: string | null;
  isMatched: boolean;
  discipline: Discipline;
  levelRaw: string | null;
  levelNum: number | null;
  levelTrack: LevelTrack;
  levelLabel: string;
  squad: string | null;
  pillar: string;
  jobTitle: string | null;
  startDate: string;
  tenureMonthsNow: number;
  location: string | null;
  totalPrs: number;
  totalAdditions: number;
  totalDeletions: number;
  totalImpact: number;
  impact30d: number;
  impact90d: number;
  impact180d: number;
  impact360d: number;
  prs30d: number;
  prs90d: number;
  prs180d: number;
  /** AI tooling spend (Claude + Cursor, USD) for the latest month in the
   *  AI Model Usage Mode dashboard. Null when no AI data has been recorded
   *  for this engineer's email — distinguish from $0 (no usage), since the
   *  AI dataset only began on 2026-03-23 and many engineers may not be
   *  matched yet. */
  aiSpend: number | null;
  /** Total AI tokens used in the latest month, sums Claude + Cursor.
   *  Same null semantics as `aiSpend`. */
  aiTokens: number | null;
  /** ISO date (YYYY-MM-DD) of the AI usage month represented above. */
  aiMonthStart: string | null;
}

export interface ImpactTenureBucket {
  email: string;
  tenureMonth: number;
  bucketStart: string;
  prs: number;
  additions: number;
  deletions: number;
  impact: number;
  inWindow: boolean;
}

export interface ImpactMetadata {
  generatedAt: string;
  dataStart: string;
  dataEnd: string;
  rawDataStart: string;
  dataWindowDays: number;
  totalActiveEngineers: number;
  matchedEngineers: number;
  unmatchedEngineers: number;
  totalPrsInWindow: number;
  bucketDays: number;
  impactFormula: string;
  modeLastSync: string | null;
  dataQualityNote: string;
  /** Number of engineers with AI usage data for the latest month — used in
   *  the page header strip so readers know how broad the AI cohort is. */
  aiMatchedEngineers: number;
  /** ISO date for the AI usage month being shown. */
  aiMonthStart: string | null;
  /** ISO date when the AI data collection became reliable. */
  aiDataStart: string;
}

export interface ImpactAnalysis {
  metadata: ImpactMetadata;
  engineers: ImpactEngineer[];
  tenureBuckets: ImpactTenureBucket[];
}

function impactScore(prs: number, additions: number, deletions: number): number {
  if (!prs) return 0;
  return Math.round(prs * Math.log2(1 + (additions + deletions) / prs));
}

function classifyLevel(raw: string | null): {
  track: LevelTrack;
  num: number | null;
  label: string;
} {
  if (!raw) return { track: "unknown", num: null, label: "unknown" };
  const r = raw.toUpperCase();
  const m = /^([A-Z]+)(\d+)$/.exec(r);
  if (!m) return { track: "Other", num: null, label: raw };
  const [, prefix, numStr] = m;
  const num = parseInt(numStr, 10);
  if (prefix === "EM") return { track: "EM", num, label: `EM${num}` };
  if (prefix === "QE") return { track: "QA", num, label: `QE${num}` };
  if (["EG", "DS", "EXEC"].includes(prefix)) {
    return { track: "Other", num, label: raw };
  }
  return { track: "IC", num, label: `L${num}` };
}

// `rp_specialisation` is the authoritative signal post-April-2026 standardisation.
// Values are canonical role names ("Backend Engineer", "Machine Learning Engineer",
// etc.) with no seniority prefix, so exact matches are cheap and reliable. The
// substring fallback catches anyone whose `rp_specialisation` is still blank
// during the HiBob rollout.
const DISCIPLINE_BY_SPECIALISATION: Record<string, Discipline> = {
  "backend engineer": "BE",
  "python engineer": "BE",
  "frontend engineer": "FE",
  "engineering manager": "EM",
  "qa engineer": "QA",
  "machine learning engineer": "ML",
  "ml ops engineer": "ML",
  "head of machine learning": "ML",
  "machine learning engineering manager": "ML",
  "technical operations": "Ops",
};

function classifyDiscipline(
  spec: string | null,
  jobTitle: string | null,
): Discipline {
  const s = (spec ?? "").trim().toLowerCase();
  const exact = DISCIPLINE_BY_SPECIALISATION[s];
  if (exact) return exact;

  const j = (jobTitle ?? "").toLowerCase();
  if (s.includes("backend") || j.includes("backend")) return "BE";
  if (s.includes("frontend") || j.includes("frontend")) return "FE";
  if (s.includes("engineering manager") || j.includes("engineering manager")) {
    return "EM";
  }
  if (s.includes("qa") || j.includes("qa")) return "QA";
  if (s.includes("machine learning") || s.includes("ml ") || j.includes("ml ")) {
    return "ML";
  }
  if (s.includes("python")) return "BE";
  if (s.includes("technical operations")) return "Ops";
  return "Other";
}

function cleanPillar(deptName: string | null): string {
  if (!deptName) return "Unknown";
  return deptName.replace(/\s+Pillar$/i, "").trim();
}

export async function getImpactAnalysis(): Promise<ImpactAnalysis> {
  const headcountData = await getReportData("people", "headcount", [
    "headcount",
  ]);
  const headcountQuery = headcountData.find(
    (d) => d.queryName === "headcount",
  );
  if (!headcountQuery) {
    throw new Error(
      "headcount Mode query unavailable - cannot build impact analysis",
    );
  }

  type RawEmployee = {
    email?: string;
    preferred_name?: string;
    rp_full_name?: string;
    hb_function?: string;
    hb_level?: string;
    hb_squad?: string;
    job_title?: string;
    start_date?: string;
    termination_date?: string | null;
    rp_specialisation?: string;
    rp_department_name?: string;
    work_location?: string;
  };

  const activeEngineers = (headcountQuery.rows as RawEmployee[]).filter(
    (e) =>
      !e.termination_date &&
      (e.hb_function ?? "").toLowerCase().includes("engineer") &&
      e.start_date,
  );

  const mapRows = await db
    .select({
      githubLogin: githubEmployeeMap.githubLogin,
      employeeEmail: githubEmployeeMap.employeeEmail,
      isBot: githubEmployeeMap.isBot,
    })
    .from(githubEmployeeMap)
    .where(eq(githubEmployeeMap.isBot, false));

  const emailToLogin = new Map<string, string>();
  for (const m of mapRows) {
    if (m.employeeEmail) {
      emailToLogin.set(m.employeeEmail.toLowerCase(), m.githubLogin);
    }
  }

  const bounds = await db
    .select({
      start: sql<Date>`MIN(${githubPrs.mergedAt})`,
      end: sql<Date>`MAX(${githubPrs.mergedAt})`,
    })
    .from(githubPrs);
  const rawStart = bounds[0].start ? new Date(bounds[0].start) : new Date();
  const dataEnd = bounds[0].end ? new Date(bounds[0].end) : new Date();

  const monthlyCounts = await db
    .select({
      month: sql<Date>`date_trunc('month', ${githubPrs.mergedAt})::date`,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(githubPrs)
    .groupBy(sql`date_trunc('month', ${githubPrs.mergedAt})`)
    .orderBy(sql`date_trunc('month', ${githubPrs.mergedAt})`);

  const sortedCounts = monthlyCounts.map((r) => r.n).sort((a, b) => a - b);
  const mid = sortedCounts[Math.floor(sortedCounts.length / 2)] ?? 0;
  const reliableThreshold = mid * 0.4;
  let dataStart = rawStart;
  for (const row of monthlyCounts) {
    if (row.n >= reliableThreshold) {
      dataStart = new Date(row.month);
      break;
    }
  }

  const logins = [...emailToLogin.values()];
  const allPrs = logins.length
    ? await db
        .select({
          authorLogin: githubPrs.authorLogin,
          mergedAt: githubPrs.mergedAt,
          additions: githubPrs.additions,
          deletions: githubPrs.deletions,
        })
        .from(githubPrs)
        .where(
          and(
            inArray(githubPrs.authorLogin, logins),
            gte(githubPrs.mergedAt, dataStart),
          ),
        )
    : [];

  const prsByLogin = new Map<string, typeof allPrs>();
  for (const pr of allPrs) {
    const bucket = prsByLogin.get(pr.authorLogin) ?? [];
    bucket.push(pr);
    prsByLogin.set(pr.authorLogin, bucket);
  }

  // Join AI usage by lowercase email. Mode outages are degraded to "no
  // AI data" — the impact page is not gated on AI being available.
  let aiUsageByEmail = new Map<
    string,
    { totalCost: number; totalTokens: number; latestMonthStart: string }
  >();
  let aiMonthStartIso: string | null = null;
  try {
    const aiData = await getAiUsageData();
    aiUsageByEmail = new Map(
      [...aggregateLatestMonthByUser(aiData).entries()].map(([email, u]) => [
        email,
        {
          totalCost: u.totalCost,
          totalTokens: u.totalTokens,
          latestMonthStart: u.latestMonthStart,
        },
      ]),
    );
    // `aggregateLatestMonthByUser` pins every entry to the same
    // latestMonthStart by construction, so picking any value works.
    // If the map is empty (Mode returned data but no monthlyByUser
    // rows), `next().value` is undefined and we fall back to null.
    aiMonthStartIso =
      aiUsageByEmail.values().next().value?.latestMonthStart ?? null;
  } catch {
    // Mode unreachable / report missing → engineers get null AI fields.
  }

  const now = Date.now();
  const endMs = dataEnd.getTime();
  const startMsBounds = dataStart.getTime();

  const engineers: ImpactEngineer[] = [];
  const tenureBuckets: ImpactTenureBucket[] = [];

  for (const emp of activeEngineers) {
    const email = (emp.email ?? "").toLowerCase();
    const login = emailToLogin.get(email) ?? null;
    if (!emp.start_date) continue;
    const startMs = new Date(emp.start_date).getTime();
    const tenureDaysNow = (now - startMs) / MS_PER_DAY;
    const tenureMonthsNow = Math.floor(tenureDaysNow / 30.44);

    const levelInfo = classifyLevel(emp.hb_level ?? null);
    const discipline = classifyDiscipline(
      emp.rp_specialisation ?? null,
      emp.job_title ?? null,
    );
    const pillar = cleanPillar(emp.rp_department_name ?? null);

    const prs = login ? (prsByLogin.get(login) ?? []) : [];

    let totalPrs = 0;
    let totalAdd = 0;
    let totalDel = 0;
    const windows = {
      "30d": { cutoff: endMs - 30 * MS_PER_DAY, prs: 0, add: 0, del: 0 },
      "90d": { cutoff: endMs - 90 * MS_PER_DAY, prs: 0, add: 0, del: 0 },
      "180d": { cutoff: endMs - 180 * MS_PER_DAY, prs: 0, add: 0, del: 0 },
      "360d": { cutoff: endMs - 360 * MS_PER_DAY, prs: 0, add: 0, del: 0 },
    };
    for (const pr of prs) {
      const ts = new Date(pr.mergedAt).getTime();
      totalPrs += 1;
      totalAdd += pr.additions;
      totalDel += pr.deletions;
      for (const w of Object.values(windows)) {
        if (ts >= w.cutoff) {
          w.prs += 1;
          w.add += pr.additions;
          w.del += pr.deletions;
        }
      }
    }

    const perBucket = new Map<
      number,
      { prs: number; additions: number; deletions: number }
    >();
    for (const pr of prs) {
      const ts = new Date(pr.mergedAt).getTime();
      const daysSinceStart = (ts - startMs) / MS_PER_DAY;
      if (daysSinceStart < 0) continue;
      const m = Math.floor(daysSinceStart / BUCKET_DAYS);
      const b = perBucket.get(m) ?? { prs: 0, additions: 0, deletions: 0 };
      b.prs += 1;
      b.additions += pr.additions;
      b.deletions += pr.deletions;
      perBucket.set(m, b);
    }

    // Unmatched engineers have no PRs, so emitting zero-filled buckets
     // for them would depress cohort medians and skew ramp-up curves.
    if (login) {
      const maxBucketByTenure = Math.min(
        Math.floor(tenureDaysNow / BUCKET_DAYS),
        60,
      );
      for (let m = 0; m <= maxBucketByTenure; m++) {
        const bucketStart = startMs + m * BUCKET_DAYS * MS_PER_DAY;
        const bucketEnd = bucketStart + BUCKET_DAYS * MS_PER_DAY;
        const inWindow =
          bucketStart >= startMsBounds && bucketEnd <= endMs;
        const b = perBucket.get(m) ?? { prs: 0, additions: 0, deletions: 0 };
        tenureBuckets.push({
          email,
          tenureMonth: m,
          bucketStart: new Date(bucketStart).toISOString().slice(0, 10),
          prs: b.prs,
          additions: b.additions,
          deletions: b.deletions,
          impact: impactScore(b.prs, b.additions, b.deletions),
          inWindow,
        });
      }
    }

    const aiUsage = aiUsageByEmail.get(email);

    engineers.push({
      email,
      name: emp.preferred_name ?? emp.rp_full_name ?? email,
      githubLogin: login,
      isMatched: login !== null,
      discipline,
      levelRaw: emp.hb_level ?? null,
      levelNum: levelInfo.num,
      levelTrack: levelInfo.track,
      levelLabel: levelInfo.label,
      squad: emp.hb_squad ?? null,
      pillar,
      jobTitle: emp.job_title ?? null,
      startDate: emp.start_date.slice(0, 10),
      tenureMonthsNow,
      location: emp.work_location ?? null,
      totalPrs,
      totalAdditions: totalAdd,
      totalDeletions: totalDel,
      totalImpact: impactScore(totalPrs, totalAdd, totalDel),
      impact30d: impactScore(windows["30d"].prs, windows["30d"].add, windows["30d"].del),
      impact90d: impactScore(windows["90d"].prs, windows["90d"].add, windows["90d"].del),
      impact180d: impactScore(windows["180d"].prs, windows["180d"].add, windows["180d"].del),
      impact360d: impactScore(windows["360d"].prs, windows["360d"].add, windows["360d"].del),
      prs30d: windows["30d"].prs,
      prs90d: windows["90d"].prs,
      prs180d: windows["180d"].prs,
      aiSpend: aiUsage?.totalCost ?? null,
      aiTokens: aiUsage?.totalTokens ?? null,
      aiMonthStart: aiUsage?.latestMonthStart ?? null,
    });
  }

  const reliablePrs = allPrs.filter(
    (p) => new Date(p.mergedAt).getTime() >= startMsBounds,
  ).length;

  const metadata: ImpactMetadata = {
    generatedAt: new Date().toISOString(),
    dataStart: dataStart.toISOString().slice(0, 10),
    dataEnd: dataEnd.toISOString().slice(0, 10),
    rawDataStart: rawStart.toISOString().slice(0, 10),
    dataWindowDays: Math.round((endMs - startMsBounds) / MS_PER_DAY),
    totalActiveEngineers: activeEngineers.length,
    matchedEngineers: engineers.filter((e) => e.isMatched).length,
    unmatchedEngineers: engineers.filter((e) => !e.isMatched).length,
    totalPrsInWindow: reliablePrs,
    bucketDays: BUCKET_DAYS,
    impactFormula: "round(prs × log2(1 + (additions + deletions) / prs))",
    modeLastSync: headcountQuery.syncedAt
      ? new Date(headcountQuery.syncedAt).toISOString()
      : null,
    dataQualityNote: `GitHub sync coverage was incomplete before ${dataStart.toISOString().slice(0, 10)}. Monthly PR volumes below ${Math.round(reliableThreshold)} (40% of median) are treated as unreliable and excluded from tenure-windowed analysis.`,
    aiMatchedEngineers: engineers.filter((e) => e.aiSpend != null).length,
    aiMonthStart: aiMonthStartIso,
    // Per the source dashboard: Bedrock (Claude) data is reliable from
    // 23-Mar-2026; Cursor data goes back further. Use the conservative date.
    aiDataStart: "2026-03-23",
  };

  return { metadata, engineers, tenureBuckets };
}
