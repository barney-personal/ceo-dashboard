import { db } from "@/lib/db";
import { githubPrMetrics, githubEmployeeMap } from "@/lib/db/schema";
import { and, gte, lte, desc, eq, max } from "drizzle-orm";

export interface EngineerRanking {
  login: string;
  avatarUrl: string | null;
  prsCount: number;
  additions: number;
  deletions: number;
  netLines: number;
  changedFiles: number;
  repos: string[];
  employeeName: string | null;
  employeeEmail: string | null;
  isBot: boolean;
}

export async function getEngineeringRankings(
  periodStart: Date,
  periodEnd: Date
): Promise<EngineerRanking[]> {
  // Subquery: get the latest periodEnd per engineer within the range
  const latestSnapshot = db
    .select({
      login: githubPrMetrics.login,
      maxPeriodEnd: max(githubPrMetrics.periodEnd).as("max_period_end"),
    })
    .from(githubPrMetrics)
    .where(
      and(
        gte(githubPrMetrics.periodStart, periodStart),
        lte(githubPrMetrics.periodEnd, periodEnd)
      )
    )
    .groupBy(githubPrMetrics.login)
    .as("latest_snapshot");

  // Join back to get full rows for only the latest snapshot per engineer,
  // plus the employee mapping
  const rows = await db
    .select({
      login: githubPrMetrics.login,
      avatarUrl: githubPrMetrics.avatarUrl,
      prsCount: githubPrMetrics.prsCount,
      additions: githubPrMetrics.additions,
      deletions: githubPrMetrics.deletions,
      changedFiles: githubPrMetrics.changedFiles,
      repos: githubPrMetrics.repos,
      employeeName: githubEmployeeMap.employeeName,
      employeeEmail: githubEmployeeMap.employeeEmail,
      isBot: githubEmployeeMap.isBot,
    })
    .from(githubPrMetrics)
    .innerJoin(
      latestSnapshot,
      and(
        eq(githubPrMetrics.login, latestSnapshot.login),
        eq(githubPrMetrics.periodEnd, latestSnapshot.maxPeriodEnd)
      )
    )
    .leftJoin(
      githubEmployeeMap,
      eq(githubPrMetrics.login, githubEmployeeMap.githubLogin)
    )
    .where(
      and(
        gte(githubPrMetrics.periodStart, periodStart),
        lte(githubPrMetrics.periodEnd, periodEnd)
      )
    )
    .orderBy(desc(githubPrMetrics.prsCount));

  return rows.map((row) => ({
    login: row.login,
    avatarUrl: row.avatarUrl,
    prsCount: row.prsCount,
    additions: row.additions,
    deletions: row.deletions,
    netLines: row.additions - row.deletions,
    changedFiles: row.changedFiles,
    repos: Array.isArray(row.repos) ? (row.repos as string[]) : [],
    employeeName: row.employeeName,
    employeeEmail: row.employeeEmail,
    isBot: row.isBot ?? false,
  }));
}

export function getDefaultPeriod(days: number = 30): { start: Date; end: Date } {
  // Use UTC bounds to match how the sync writes periodStart/periodEnd.
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}
