import { db } from "@/lib/db";
import {
  githubPrs,
  githubCommits,
  githubEmployeeMap,
  okrUpdates,
} from "@/lib/db/schema";
import { eq, gte, and, sql, desc } from "drizzle-orm";
import { getActiveEmployees, type Person } from "./people";
import { groupLatestOkrRows, type OkrSummary } from "./okrs";
import { getPerformanceData, type PerformanceRating } from "./performance";
import type { PeriodDays } from "./engineering";
import {
  aggregateLatestMonthByUser,
  getAiUsageData,
  getUserTrend,
  type AiUsageData,
} from "./ai-usage";

export interface EngineerProfile {
  login: string;
  avatarUrl: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  jobTitle: string | null;
  level: string | null;
  squad: string | null;
  pillar: string | null;
  tenureMonths: number | null;
  startDate: string | null;
}

export interface EngineerTimeSeries {
  prSeries: { date: string; value: number }[];
  commitSeries: { date: string; value: number }[];
  additionsSeries: { date: string; value: number }[];
  deletionsSeries: { date: string; value: number }[];
}

/**
 * Get an engineer's profile by GitHub login.
 */
export async function getEngineerProfile(
  login: string
): Promise<EngineerProfile | null> {
  const [[mapRow], [prRow]] = await Promise.all([
    db
      .select()
      .from(githubEmployeeMap)
      .where(eq(githubEmployeeMap.githubLogin, login))
      .limit(1),
    db
      .select({ avatarUrl: githubPrs.authorAvatarUrl })
      .from(githubPrs)
      .where(eq(githubPrs.authorLogin, login))
      .orderBy(desc(githubPrs.mergedAt))
      .limit(1),
  ]);

  // Unknown login — no employee mapping and no PRs
  if (!mapRow && !prRow) return null;

  // Look up person metadata from Mode/HiBob
  let person: Person | undefined;
  if (mapRow?.employeeEmail) {
    try {
      const { employees, unassigned } = await getActiveEmployees();
      person = [...employees, ...unassigned].find(
        (p) => p.email?.toLowerCase() === mapRow.employeeEmail?.toLowerCase()
      );
    } catch {
      // Mode data unavailable
    }
  }

  return {
    login,
    avatarUrl: prRow?.avatarUrl ?? null,
    employeeName: mapRow?.employeeName ?? null,
    employeeEmail: mapRow?.employeeEmail ?? null,
    jobTitle: person?.jobTitle ?? null,
    level: person?.level ?? null,
    squad: person?.squad ?? null,
    pillar: person?.pillar ?? null,
    tenureMonths: person?.tenureMonths ?? null,
    startDate: person?.startDate ?? null,
  };
}

/**
 * Get weekly time-series data for an engineer.
 */
export async function getEngineerTimeSeries(
  login: string,
  days: PeriodDays
): Promise<EngineerTimeSeries> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  const [prWeekly, commitWeekly] = await Promise.all([
    db
      .select({
        week: sql<string>`date_trunc('week', ${githubPrs.mergedAt})::date::text`.as(
          "week"
        ),
        prs: sql<number>`COUNT(*)`.as("prs"),
        additions: sql<number>`COALESCE(SUM(${githubPrs.additions}), 0)`.as(
          "additions"
        ),
        deletions: sql<number>`COALESCE(SUM(${githubPrs.deletions}), 0)`.as(
          "deletions"
        ),
      })
      .from(githubPrs)
      .where(
        and(
          eq(githubPrs.authorLogin, login),
          gte(githubPrs.mergedAt, since)
        )
      )
      .groupBy(sql`date_trunc('week', ${githubPrs.mergedAt})`)
      .orderBy(sql`date_trunc('week', ${githubPrs.mergedAt})`),

    db
      .select({
        week: sql<string>`date_trunc('week', ${githubCommits.committedAt})::date::text`.as(
          "week"
        ),
        commits: sql<number>`COUNT(*)`.as("commits"),
      })
      .from(githubCommits)
      .where(
        and(
          eq(githubCommits.authorLogin, login),
          gte(githubCommits.committedAt, since)
        )
      )
      .groupBy(sql`date_trunc('week', ${githubCommits.committedAt})`)
      .orderBy(sql`date_trunc('week', ${githubCommits.committedAt})`),
  ]);

  // Fill missing weeks with zeroes
  const allWeeks = generateWeekBuckets(since, new Date());
  const prMap = new Map(prWeekly.map((r) => [r.week, r]));
  const commitMap = new Map(commitWeekly.map((r) => [r.week, r]));

  return {
    prSeries: allWeeks.map((w) => ({
      date: w,
      value: Number(prMap.get(w)?.prs ?? 0),
    })),
    commitSeries: allWeeks.map((w) => ({
      date: w,
      value: Number(commitMap.get(w)?.commits ?? 0),
    })),
    additionsSeries: allWeeks.map((w) => ({
      date: w,
      value: Number(prMap.get(w)?.additions ?? 0),
    })),
    deletionsSeries: allWeeks.map((w) => ({
      date: w,
      value: Number(prMap.get(w)?.deletions ?? 0),
    })),
  };
}

/**
 * Get OKRs for a specific squad.
 */
export async function getSquadOkrs(
  squadName: string
): Promise<OkrSummary[]> {
  const rows = await db
    .select()
    .from(okrUpdates)
    .where(eq(okrUpdates.squadName, squadName))
    .orderBy(desc(okrUpdates.postedAt));

  const grouped = groupLatestOkrRows(rows);
  return [...grouped.values()].flat();
}

export interface EngineerPerformance {
  ratings: PerformanceRating[];
  reviewCycles: string[];
}

/**
 * Get an engineer's historical performance ratings by employee email.
 * Returns null if email is missing, ratings data is unavailable, or the
 * engineer has no matching record.
 */
export async function getEngineerPerformanceRatings(
  email: string | null
): Promise<EngineerPerformance | null> {
  if (!email) return null;
  try {
    const { people, reviewCycles } = await getPerformanceData();
    const person = people.find(
      (p) => p.email.toLowerCase() === email.toLowerCase()
    );
    if (!person || person.ratings.length === 0) return null;
    return { ratings: person.ratings, reviewCycles };
  } catch {
    // Mode data unavailable — render page without the performance section
    return null;
  }
}

export interface EngineerAiUsage {
  latestMonthStart: string;
  latestMonthCost: number;
  latestMonthTokens: number;
  nDays: number;
  byCategory: Array<{ category: string; cost: number; tokens: number }>;
  monthlyTrend: Array<{ monthStart: string; totalCost: number; totalTokens: number }>;
  costSeries: Array<{ date: string; value: number }>;
  tokenSeries: Array<{ date: string; value: number }>;
  /** Company-wide median cost for the latest month (from Mode). */
  peerMedianCost: number;
  /** Company-wide average cost for the latest month (from Mode). */
  peerAvgCost: number;
  /** All peers' latest-month spend (one entry per user, incl. this user)
   *  for a distribution strip plot. */
  peerSpend: number[];
}

/**
 * Load the AI Model Usage rollup for a single engineer by email.
 * Returns null when no AI usage rows exist for this user.
 */
export async function getEngineerAiUsage(
  email: string | null,
): Promise<EngineerAiUsage | null> {
  if (!email) return null;
  let data: AiUsageData;
  try {
    data = await getAiUsageData();
  } catch {
    return null;
  }

  const normalizedEmail = email.toLowerCase();
  const userRows = data.monthlyByUser.filter(
    (r) => r.userEmail === normalizedEmail,
  );
  if (userRows.length === 0) return null;

  const trend = getUserTrend(data, normalizedEmail);
  const latestMonth = trend.at(-1);
  if (!latestMonth) return null;

  const latestRows = userRows.filter(
    (r) => r.monthStart === latestMonth.monthStart,
  );
  const nDays = Math.max(...latestRows.map((r) => r.nDays), 0);
  const peerMedianCost = latestRows[0]?.medianCost ?? 0;
  const peerAvgCost = latestRows[0]?.avgCostPerPerson ?? 0;
  const peerSpend = [...aggregateLatestMonthByUser(data).values()]
    .map((u) => u.totalCost)
    .filter((v) => Number.isFinite(v));

  return {
    latestMonthStart: latestMonth.monthStart,
    latestMonthCost: latestMonth.totalCost,
    latestMonthTokens: latestMonth.totalTokens,
    nDays,
    byCategory: latestMonth.byCategory,
    monthlyTrend: trend.map((t) => ({
      monthStart: t.monthStart,
      totalCost: t.totalCost,
      totalTokens: t.totalTokens,
    })),
    costSeries: trend.map((t) => ({
      date: t.monthStart,
      value: t.totalCost,
    })),
    tokenSeries: trend.map((t) => ({
      date: t.monthStart,
      value: t.totalTokens,
    })),
    peerMedianCost,
    peerAvgCost,
    peerSpend,
  };
}

export interface EmployeeOption {
  name: string;
  email: string;
  jobTitle: string | null;
  squad: string | null;
  pillar: string | null;
}

/**
 * Fetch all active employees, formatted for the mapping picker.
 * Sorted alphabetically by name. Empty emails are filtered out (they can't
 * be used as a stable mapping key).
 */
export async function getEmployeeOptions(): Promise<EmployeeOption[]> {
  try {
    const { employees, unassigned, partTimeChampions, contractors } =
      await getActiveEmployees();
    return [...employees, ...unassigned, ...partTimeChampions, ...contractors]
      .filter((p) => p.email)
      .map((p) => ({
        name: p.name,
        email: p.email,
        jobTitle: p.jobTitle || null,
        squad: p.squad || null,
        pillar: p.pillar || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    // Surface the failure in Sentry/Render logs so "no employees to pick"
    // isn't silently attributed to HiBob not being synced.
    console.error("[getEmployeeOptions] failed to load employee directory", error);
    return [];
  }
}

/**
 * Generate ISO week start dates between two dates.
 */
function generateWeekBuckets(start: Date, end: Date): string[] {
  const weeks: string[] = [];
  const current = new Date(start);
  // Align to Monday (ISO week start)
  const dayOfWeek = current.getUTCDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  current.setUTCDate(current.getUTCDate() + diff);

  while (current <= end) {
    weeks.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 7);
  }

  return weeks;
}
