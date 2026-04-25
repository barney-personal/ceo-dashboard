import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  engineerMatchJudgments,
  engineerMatches,
  engineerRatings,
  engineerTournamentRuns,
  githubEmployeeMap,
  githubPrs,
} from "@/lib/db/schema";
import { getEngineeringRankings } from "@/lib/data/engineering";

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
  avatarUrl: string | null;
  githubLogin: string | null;
  jobTitle: string | null;
  level: string | null;
  tenureMonths: number | null;
  squad: string | null;
  pillar: string | null;
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

  // Enrich with SSoT-backed engineering profile data so the leaderboard can
  // show avatar, level, tenure, role — same source as the engineers page.
  const profilesByEmail = await loadEngineerProfiles();

  const rankings: RankingRow[] = ratingRows
    .filter((row) => row.judgmentsPlayed > 0)
    .map((row, index) => {
      const email = row.engineerEmail.toLowerCase();
      const profile = profilesByEmail.get(email);
      return {
        rank: index + 1,
        engineerEmail: row.engineerEmail,
        displayName:
          profile?.employeeName ||
          nameByEmail.get(email) ||
          displayFromEmail(row.engineerEmail),
        rating: row.rating,
        delta: row.rating - STARTING_RATING,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        judgmentsPlayed: row.judgmentsPlayed,
        confidence: confidenceFor(row.judgmentsPlayed),
        avatarUrl: profile?.avatarUrl ?? null,
        githubLogin: profile?.login ?? null,
        jobTitle: profile?.jobTitle ?? null,
        level: profile?.level ?? null,
        tenureMonths: profile?.tenureMonths ?? null,
        squad: profile?.squad ?? null,
        pillar: profile?.pillar ?? null,
      };
    });

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

  // Track verdict count per match (not just unique values) — we need ≥ 2
  // judgments to call it agreement. A single judgment trivially has
  // verdicts.size === 1 but isn't agreement.
  const verdictsByMatch = new Map<number, string[]>();
  for (const row of rows) {
    const list = verdictsByMatch.get(row.matchId) ?? [];
    list.push(row.verdict);
    verdictsByMatch.set(row.matchId, list);
  }

  let multiJudgeMatches = 0;
  let agreed = 0;
  for (const verdicts of verdictsByMatch.values()) {
    if (verdicts.length < 2) continue;
    multiJudgeMatches++;
    if (new Set(verdicts).size === 1) agreed++;
  }
  return multiJudgeMatches > 0 ? agreed / multiJudgeMatches : null;
}

export interface JudgmentEntry {
  matchId: number;
  matchCreatedAt: Date;
  selfLabel: "A" | "B"; // Which side this engineer was in the dossier
  opponentEmail: string;
  opponentDisplayName: string;
  opponentAvatarUrl: string | null;
  opponentRating: number | null;
  judgeProvider: string;
  judgeModel: string;
  verdict: "win" | "loss" | "draw";
  rawVerdict: "A" | "B" | "draw";
  confidencePct: number | null;
  reasoning: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  createdAt: Date;
}

export interface EngineerTournamentDetail {
  engineerEmail: string;
  displayName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  level: string | null;
  tenureMonths: number | null;
  githubLogin: string | null;
  squad: string | null;
  pillar: string | null;
  ranking: RankingRow | null;
  runId: number;
  judgments: JudgmentEntry[];
}

/** Per-engineer drill-down for the most recent run. Returns the engineer's
 *  ranking + every judgment they were part of, with the LLM's full reasoning
 *  and which way the verdict went for them. Tighter than getTournamentRunDetail —
 *  only loads the engineer's own row, their judgments, and opponent metadata
 *  needed for rendering. Avoids the expensive full-pool getEngineeringRankings
 *  call by querying github_employee_map directly for opponent names. */
export async function getEngineerTournamentDetail(
  engineerEmail: string,
  runId?: number,
): Promise<EngineerTournamentDetail | null> {
  const lcEmail = engineerEmail.toLowerCase();
  const targetRunId =
    runId ??
    (
      await db
        .select({ id: engineerTournamentRuns.id })
        .from(engineerTournamentRuns)
        .orderBy(desc(engineerTournamentRuns.startedAt))
        .limit(1)
    )[0]?.id;
  if (!targetRunId) return null;

  // Pull all ratings for the run in one go — needed for rank computation +
  // opponent rating lookup. ~129 rows of cheap scalar columns, no joins.
  const allRatings = await db
    .select({
      engineerEmail: engineerRatings.engineerEmail,
      rating: sql<number>`${engineerRatings.rating}::float`,
      wins: engineerRatings.wins,
      losses: engineerRatings.losses,
      draws: engineerRatings.draws,
      judgmentsPlayed: engineerRatings.judgmentsPlayed,
    })
    .from(engineerRatings)
    .where(eq(engineerRatings.runId, targetRunId))
    .orderBy(desc(engineerRatings.rating));

  const rankingByEmail = new Map<
    string,
    { rating: number; rank: number; wins: number; losses: number; draws: number; judgmentsPlayed: number }
  >();
  let rankCursor = 0;
  for (const row of allRatings) {
    if (row.judgmentsPlayed > 0) {
      rankCursor++;
      rankingByEmail.set(row.engineerEmail.toLowerCase(), {
        rating: row.rating,
        rank: rankCursor,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        judgmentsPlayed: row.judgmentsPlayed,
      });
    }
  }

  const selfRating = rankingByEmail.get(lcEmail) ?? null;

  // Resolve display names (deduped across multiple GitHub logins per engineer).
  const nameByEmail = await resolveDisplayNames(
    [...rankingByEmail.keys(), lcEmail],
  );

  // Avatars + GitHub login: pull the FIRST github_employee_map row per email.
  const avatarByEmail = await resolveAvatarsAndLogins(
    [...rankingByEmail.keys(), lcEmail],
  );

  // Profile metadata for the focal engineer (level/tenure/role) — only one
  // person to look up, so we pull from active employees and filter in memory
  // rather than the heavyweight getEngineeringRankings.
  const selfProfile = await loadSinglePersonProfile(lcEmail);

  const matchRows = await db
    .select({
      matchId: engineerMatches.id,
      engineerAEmail: engineerMatches.engineerAEmail,
      engineerBEmail: engineerMatches.engineerBEmail,
      matchCreatedAt: engineerMatches.createdAt,
      judgmentId: engineerMatchJudgments.id,
      judgeProvider: engineerMatchJudgments.judgeProvider,
      judgeModel: engineerMatchJudgments.judgeModel,
      verdict: engineerMatchJudgments.verdict,
      confidencePct: engineerMatchJudgments.confidencePct,
      reasoning: engineerMatchJudgments.reasoning,
      latencyMs: engineerMatchJudgments.latencyMs,
      costUsd: sql<number | null>`${engineerMatchJudgments.costUsd}::float`,
      createdAt: engineerMatchJudgments.createdAt,
    })
    .from(engineerMatchJudgments)
    .innerJoin(
      engineerMatches,
      eq(engineerMatches.id, engineerMatchJudgments.matchId),
    )
    .where(
      and(
        eq(engineerMatches.runId, targetRunId),
        or(
          eq(sql`lower(${engineerMatches.engineerAEmail})`, lcEmail),
          eq(sql`lower(${engineerMatches.engineerBEmail})`, lcEmail),
        ),
      ),
    )
    .orderBy(desc(engineerMatchJudgments.createdAt));

  const judgments: JudgmentEntry[] = matchRows.map((row) => {
    const isA = row.engineerAEmail.toLowerCase() === lcEmail;
    const opponentEmail = isA ? row.engineerBEmail : row.engineerAEmail;
    const opponentLc = opponentEmail.toLowerCase();
    const opponentRating = rankingByEmail.get(opponentLc)?.rating ?? null;
    const rawVerdict = row.verdict as "A" | "B" | "draw";
    const selfLabel = isA ? "A" : "B";
    const verdict: "win" | "loss" | "draw" =
      rawVerdict === "draw"
        ? "draw"
        : rawVerdict === selfLabel
        ? "win"
        : "loss";
    return {
      matchId: row.matchId,
      matchCreatedAt: row.matchCreatedAt,
      selfLabel,
      opponentEmail,
      opponentDisplayName:
        nameByEmail.get(opponentLc) ?? displayFromEmail(opponentEmail),
      opponentAvatarUrl: avatarByEmail.get(opponentLc)?.avatarUrl ?? null,
      opponentRating,
      judgeProvider: row.judgeProvider,
      judgeModel: row.judgeModel,
      verdict,
      rawVerdict,
      confidencePct: row.confidencePct,
      reasoning: row.reasoning,
      latencyMs: row.latencyMs,
      costUsd: row.costUsd,
      createdAt: row.createdAt,
    };
  });

  const selfDisplayName =
    selfProfile?.employeeName ??
    nameByEmail.get(lcEmail) ??
    displayFromEmail(engineerEmail);

  const ranking: RankingRow | null = selfRating
    ? {
        rank: selfRating.rank,
        engineerEmail,
        displayName: selfDisplayName,
        rating: selfRating.rating,
        delta: selfRating.rating - STARTING_RATING,
        wins: selfRating.wins,
        losses: selfRating.losses,
        draws: selfRating.draws,
        judgmentsPlayed: selfRating.judgmentsPlayed,
        confidence: confidenceFor(selfRating.judgmentsPlayed),
        avatarUrl: avatarByEmail.get(lcEmail)?.avatarUrl ?? null,
        githubLogin: avatarByEmail.get(lcEmail)?.githubLogin ?? null,
        jobTitle: selfProfile?.jobTitle ?? null,
        level: selfProfile?.level ?? null,
        tenureMonths: selfProfile?.tenureMonths ?? null,
        squad: selfProfile?.squad ?? null,
        pillar: selfProfile?.pillar ?? null,
      }
    : null;

  return {
    engineerEmail,
    displayName: selfDisplayName,
    avatarUrl: avatarByEmail.get(lcEmail)?.avatarUrl ?? null,
    jobTitle: selfProfile?.jobTitle ?? null,
    level: selfProfile?.level ?? null,
    tenureMonths: selfProfile?.tenureMonths ?? null,
    githubLogin: avatarByEmail.get(lcEmail)?.githubLogin ?? null,
    squad: selfProfile?.squad ?? null,
    pillar: selfProfile?.pillar ?? null,
    ranking,
    runId: targetRunId,
    judgments,
  };
}

async function resolveAvatarsAndLogins(
  emails: string[],
): Promise<Map<string, { avatarUrl: string | null; githubLogin: string }>> {
  if (emails.length === 0) return new Map();
  const lc = emails.map((e) => e.toLowerCase());

  const mapRows = await db
    .select({
      email: githubEmployeeMap.employeeEmail,
      login: githubEmployeeMap.githubLogin,
    })
    .from(githubEmployeeMap)
    .where(inArray(sql`lower(${githubEmployeeMap.employeeEmail})`, lc));

  const out = new Map<
    string,
    { avatarUrl: string | null; githubLogin: string }
  >();
  for (const row of mapRows) {
    if (!row.email) continue;
    const key = row.email.toLowerCase();
    // Keep the first login per email (stable across multiple-account engineers).
    if (!out.has(key)) {
      out.set(key, { avatarUrl: null, githubLogin: row.login });
    }
  }

  // Avatars come from githubPrs (via authorAvatarUrl). Pull recent PRs for
  // each login and take the latest avatar — most-recent merged PR has the
  // freshest avatar a GitHub user has uploaded.
  const logins = [...out.values()].map((v) => v.githubLogin);
  if (logins.length === 0) return out;
  const lcLogins = logins.map((l) => l.toLowerCase());

  const avatarRows = await db
    .select({
      login: githubPrs.authorLogin,
      avatarUrl: githubPrs.authorAvatarUrl,
    })
    .from(githubPrs)
    .where(inArray(sql`lower(${githubPrs.authorLogin})`, lcLogins))
    .orderBy(desc(githubPrs.mergedAt));

  const avatarByLogin = new Map<string, string | null>();
  for (const row of avatarRows) {
    const key = row.login.toLowerCase();
    if (!avatarByLogin.has(key)) avatarByLogin.set(key, row.avatarUrl);
  }

  for (const [email, info] of out) {
    out.set(email, {
      ...info,
      avatarUrl: avatarByLogin.get(info.githubLogin.toLowerCase()) ?? null,
    });
  }
  return out;
}

interface SinglePersonProfile {
  employeeName: string | null;
  jobTitle: string | null;
  level: string | null;
  tenureMonths: number | null;
  squad: string | null;
  pillar: string | null;
}

async function loadSinglePersonProfile(
  email: string,
): Promise<SinglePersonProfile | null> {
  try {
    const { getActiveEmployees } = await import("@/lib/data/people");
    const { employees, unassigned } = await getActiveEmployees();
    const all = [...employees, ...unassigned];
    const match = all.find((p) => p.email.toLowerCase() === email);
    if (!match) return null;
    return {
      employeeName: match.name,
      jobTitle: match.jobTitle,
      level: match.level,
      tenureMonths: match.tenureMonths,
      squad: match.squad,
      pillar: match.pillar,
    };
  } catch {
    return null;
  }
}

interface ProfileSummary {
  employeeName: string | null;
  employeeEmail: string;
  login: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  level: string | null;
  squad: string | null;
  pillar: string | null;
  tenureMonths: number | null;
}

async function loadEngineerProfiles(): Promise<Map<string, ProfileSummary>> {
  try {
    const rankings = await getEngineeringRankings(90);
    const out = new Map<string, ProfileSummary>();
    for (const r of rankings) {
      if (!r.employeeEmail) continue;
      out.set(r.employeeEmail.toLowerCase(), {
        employeeName: r.employeeName,
        employeeEmail: r.employeeEmail,
        login: r.login,
        avatarUrl: r.avatarUrl,
        jobTitle: r.jobTitle,
        level: r.level,
        squad: r.squad,
        pillar: r.pillar,
        tenureMonths: r.tenureMonths,
      });
    }
    return out;
  } catch {
    return new Map();
  }
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
