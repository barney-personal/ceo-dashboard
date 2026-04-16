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
    const { employees, unassigned, partTimeChampions } =
      await getActiveEmployees();
    return [...employees, ...unassigned, ...partTimeChampions]
      .filter((p) => p.email)
      .map((p) => ({
        name: p.name,
        email: p.email,
        jobTitle: p.jobTitle || null,
        squad: p.squad || null,
        pillar: p.pillar || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
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
