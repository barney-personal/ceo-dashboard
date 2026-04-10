import { db } from "@/lib/db";
import { githubPrMetrics } from "@/lib/db/schema";
import { and, gte, lte, desc } from "drizzle-orm";

export interface EngineerRanking {
  login: string;
  avatarUrl: string | null;
  prsCount: number;
  additions: number;
  deletions: number;
  netLines: number;
  changedFiles: number;
  repos: string[];
}

export async function getEngineeringRankings(
  periodStart: Date,
  periodEnd: Date
): Promise<EngineerRanking[]> {
  const rows = await db
    .select()
    .from(githubPrMetrics)
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
  }));
}

export function getDefaultPeriod(days: number = 30): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
