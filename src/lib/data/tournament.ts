import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  engineerMatchJudgments,
  engineerMatches,
  engineerRatings,
  engineerTournamentRuns,
  githubEmployeeMap,
} from "@/lib/db/schema";

export type ConfidenceBand = "low" | "medium" | "high";

export interface TournamentRunSummaryRow {
  id: number;
  status: string;
  windowStart: Date;
  windowEnd: Date;
  matchTarget: number;
  matchesCompleted: number;
  judgmentsCompleted: number;
  startedAt: Date;
  completedAt: Date | null;
  triggeredBy: string;
  notes: string | null;
  errorMessage: string | null;
  totalCostUsd: number;
}

export interface RankingRow {
  rank: number;
  engineerEmail: string;
  displayName: string;
  rating: number;
  delta: number;
  wins: number;
  losses: number;
  draws: number;
  judgmentsPlayed: number;
  confidence: ConfidenceBand;
}

export interface TournamentRunDetail {
  run: TournamentRunSummaryRow;
  rankings: RankingRow[];
  judgmentsByProvider: Record<string, number>;
  meanLatencyMs: number | null;
  agreementRate: number | null;
}

const STARTING_RATING = 1500;

export async function getRecentTournamentRuns(
  limit: number = 10,
): Promise<TournamentRunSummaryRow[]> {
  const rows = await db
    .select({
      id: engineerTournamentRuns.id,
      status: engineerTournamentRuns.status,
      windowStart: engineerTournamentRuns.windowStart,
      windowEnd: engineerTournamentRuns.windowEnd,
      matchTarget: engineerTournamentRuns.matchTarget,
      matchesCompleted: engineerTournamentRuns.matchesCompleted,
      judgmentsCompleted: engineerTournamentRuns.judgmentsCompleted,
      startedAt: engineerTournamentRuns.startedAt,
      completedAt: engineerTournamentRuns.completedAt,
      triggeredBy: engineerTournamentRuns.triggeredBy,
      notes: engineerTournamentRuns.notes,
      errorMessage: engineerTournamentRuns.errorMessage,
      totalCostUsd: sql<number>`coalesce((
        SELECT sum(j.cost_usd)
        FROM engineer_match_judgments j
        JOIN engineer_matches m ON m.id = j.match_id
        WHERE m.run_id = engineer_tournament_runs.id
      ), 0)::float`,
    })
    .from(engineerTournamentRuns)
    .orderBy(desc(engineerTournamentRuns.startedAt))
    .limit(limit);
  return rows;
}

export async function getLatestTournamentRunDetail(): Promise<TournamentRunDetail | null> {
  const [latest] = await db
    .select()
    .from(engineerTournamentRuns)
    .orderBy(desc(engineerTournamentRuns.startedAt))
    .limit(1);
  if (!latest) return null;
  return getTournamentRunDetail(latest.id);
}

export async function getTournamentRunDetail(
  runId: number,
): Promise<TournamentRunDetail | null> {
  const [run] = await db
    .select()
    .from(engineerTournamentRuns)
    .where(eq(engineerTournamentRuns.id, runId));
  if (!run) return null;

  const ratingRows = await db
    .select({
      engineerEmail: engineerRatings.engineerEmail,
      rating: sql<number>`${engineerRatings.rating}::float`,
      wins: engineerRatings.wins,
      losses: engineerRatings.losses,
      draws: engineerRatings.draws,
      judgmentsPlayed: engineerRatings.judgmentsPlayed,
    })
    .from(engineerRatings)
    .where(eq(engineerRatings.runId, runId))
    .orderBy(desc(engineerRatings.rating));

  // Resolve display names separately to avoid LEFT JOIN row-multiplication
  // when an engineer has multiple `github_employee_map` rows (multiple
  // GitHub accounts mapped to the same email).
  const nameByEmail = await resolveDisplayNames(
    ratingRows.map((r) => r.engineerEmail),
  );

  const rankings: RankingRow[] = ratingRows
    .filter((row) => row.judgmentsPlayed > 0)
    .map((row, index) => ({
      rank: index + 1,
      engineerEmail: row.engineerEmail,
      displayName:
        nameByEmail.get(row.engineerEmail.toLowerCase()) ||
        displayFromEmail(row.engineerEmail),
      rating: row.rating,
      delta: row.rating - STARTING_RATING,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      judgmentsPlayed: row.judgmentsPlayed,
      confidence: confidenceFor(row.judgmentsPlayed),
    }));

  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      meanLatency: sql<number | null>`avg(${engineerMatchJudgments.latencyMs})::float`,
      totalCost: sql<number>`coalesce(sum(${engineerMatchJudgments.costUsd}), 0)::float`,
    })
    .from(engineerMatchJudgments)
    .innerJoin(
      engineerMatches,
      eq(engineerMatches.id, engineerMatchJudgments.matchId),
    )
    .where(eq(engineerMatches.runId, runId));

  const providerBreakdown = await db
    .select({
      provider: engineerMatchJudgments.judgeProvider,
      count: sql<number>`count(*)::int`,
    })
    .from(engineerMatchJudgments)
    .innerJoin(
      engineerMatches,
      eq(engineerMatches.id, engineerMatchJudgments.matchId),
    )
    .where(eq(engineerMatches.runId, runId))
    .groupBy(engineerMatchJudgments.judgeProvider);

  const judgmentsByProvider: Record<string, number> = {};
  for (const row of providerBreakdown) {
    judgmentsByProvider[row.provider] = row.count;
  }

  return {
    run: {
      id: run.id,
      status: run.status,
      windowStart: run.windowStart,
      windowEnd: run.windowEnd,
      matchTarget: run.matchTarget,
      matchesCompleted: run.matchesCompleted,
      judgmentsCompleted: run.judgmentsCompleted,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      triggeredBy: run.triggeredBy,
      notes: run.notes,
      errorMessage: run.errorMessage,
      totalCostUsd: stats?.totalCost ?? 0,
    },
    rankings,
    judgmentsByProvider,
    meanLatencyMs: stats?.meanLatency ?? null,
    agreementRate: await computeAgreementRate(runId),
  };
}

async function computeAgreementRate(runId: number): Promise<number | null> {
  const rows = await db
    .select({
      matchId: engineerMatchJudgments.matchId,
      verdict: engineerMatchJudgments.verdict,
    })
    .from(engineerMatchJudgments)
    .innerJoin(
      engineerMatches,
      eq(engineerMatches.id, engineerMatchJudgments.matchId),
    )
    .where(eq(engineerMatches.runId, runId));

  const byMatch = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!byMatch.has(row.matchId)) byMatch.set(row.matchId, new Set());
    byMatch.get(row.matchId)!.add(row.verdict);
  }

  let multiJudgeMatches = 0;
  let agreed = 0;
  for (const verdicts of byMatch.values()) {
    if (verdicts.size === 0) continue;
    multiJudgeMatches++;
    if (verdicts.size === 1) agreed++;
  }
  return multiJudgeMatches > 0 ? agreed / multiJudgeMatches : null;
}

async function resolveDisplayNames(
  emails: string[],
): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();
  const lc = emails.map((e) => e.toLowerCase());
  const rows = await db
    .select({
      email: githubEmployeeMap.employeeEmail,
      name: githubEmployeeMap.employeeName,
    })
    .from(githubEmployeeMap)
    .where(
      inArray(sql`lower(${githubEmployeeMap.employeeEmail})`, lc),
    );

  const out = new Map<string, string>();
  for (const row of rows) {
    if (!row.email || !row.name) continue;
    const key = row.email.toLowerCase();
    if (!out.has(key)) out.set(key, row.name);
  }
  return out;
}

function confidenceFor(judgmentsPlayed: number): ConfidenceBand {
  if (judgmentsPlayed >= 12) return "high";
  if (judgmentsPlayed >= 5) return "medium";
  return "low";
}

function displayFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
