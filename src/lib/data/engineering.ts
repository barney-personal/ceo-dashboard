import { db } from "@/lib/db";
import { githubPrs, githubCommits, githubEmployeeMap } from "@/lib/db/schema";
import { gte, desc, eq, sql, count, sum } from "drizzle-orm";
import { getActiveEmployees, type Person } from "./people";

export interface EngineerRanking {
  login: string;
  avatarUrl: string | null;
  prsCount: number;
  commitsCount: number;
  additions: number;
  deletions: number;
  netLines: number;
  changedFiles: number;
  repos: string[];
  employeeName: string | null;
  employeeEmail: string | null;
  isBot: boolean;
  jobTitle: string | null;
  level: string | null;
  squad: string | null;
  pillar: string | null;
  tenureMonths: number | null;
}

export const PERIOD_OPTIONS = [
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "180 days", value: 180 },
  { label: "360 days", value: 360 },
] as const;

export type PeriodDays = (typeof PERIOD_OPTIONS)[number]["value"];

export async function getEngineeringRankings(
  days: PeriodDays = 30
): Promise<EngineerRanking[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  // Subquery: commit counts per author in the same window
  const commitCounts = db
    .select({
      login: githubCommits.authorLogin,
      commitsCount: count().as("commits_count"),
    })
    .from(githubCommits)
    .where(gte(githubCommits.committedAt, since))
    .groupBy(githubCommits.authorLogin)
    .as("commit_counts");

  // Fetch PR/commit metrics and employee metadata in parallel
  const [rows, employeeLookup] = await Promise.all([
    db
      .select({
        login: githubPrs.authorLogin,
        avatarUrl: sql<string | null>`MAX(${githubPrs.authorAvatarUrl})`.as(
          "avatar_url"
        ),
        prsCount: count().as("prs_count"),
        commitsCount:
          sql<number>`COALESCE(MAX(${commitCounts.commitsCount}), 0)`.as(
            "commits_count"
          ),
        additions: sum(githubPrs.additions).mapWith(Number).as("additions"),
        deletions: sum(githubPrs.deletions).mapWith(Number).as("deletions"),
        changedFiles: sum(githubPrs.changedFiles)
          .mapWith(Number)
          .as("changed_files"),
        repos:
          sql<string[]>`ARRAY_AGG(DISTINCT ${githubPrs.repo})`.as("repos"),
        employeeName: githubEmployeeMap.employeeName,
        employeeEmail: githubEmployeeMap.employeeEmail,
        isBot: githubEmployeeMap.isBot,
      })
      .from(githubPrs)
      .leftJoin(
        githubEmployeeMap,
        eq(githubPrs.authorLogin, githubEmployeeMap.githubLogin)
      )
      .leftJoin(commitCounts, eq(githubPrs.authorLogin, commitCounts.login))
      .where(gte(githubPrs.mergedAt, since))
      .groupBy(
        githubPrs.authorLogin,
        githubEmployeeMap.employeeName,
        githubEmployeeMap.employeeEmail,
        githubEmployeeMap.isBot
      )
      .orderBy(desc(sql`prs_count`)),
    buildEmployeeLookup(),
  ]);

  return rows.map((row) => {
    const person = row.employeeEmail
      ? employeeLookup.get(row.employeeEmail.toLowerCase())
      : undefined;
    return {
      login: row.login,
      avatarUrl: row.avatarUrl,
      prsCount: row.prsCount,
      commitsCount: Number(row.commitsCount) || 0,
      additions: row.additions ?? 0,
      deletions: row.deletions ?? 0,
      netLines: (row.additions ?? 0) - (row.deletions ?? 0),
      changedFiles: row.changedFiles ?? 0,
      repos: Array.isArray(row.repos) ? row.repos : [],
      employeeName: row.employeeName,
      employeeEmail: row.employeeEmail,
      isBot: row.isBot ?? false,
      jobTitle: person?.jobTitle ?? null,
      level: person?.level ?? null,
      squad: person?.squad ?? null,
      pillar: person?.pillar ?? null,
      tenureMonths: person?.tenureMonths ?? null,
    };
  });
}

async function buildEmployeeLookup(): Promise<Map<string, Person>> {
  try {
    const { employees, unassigned } = await getActiveEmployees();
    const lookup = new Map<string, Person>();
    for (const person of [...employees, ...unassigned]) {
      if (person.email) {
        lookup.set(person.email.toLowerCase(), person);
      }
    }
    return lookup;
  } catch {
    // Mode data unavailable — return empty lookup (metadata will be null)
    return new Map();
  }
}
