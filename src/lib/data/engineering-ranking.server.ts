/**
 * Server-side loader for the engineer ranking page.
 *
 * Fetches the spine inputs (Mode Headcount SSoT + `githubEmployeeMap` + the
 * committed impact model) and delegates to the pure `buildRankingSnapshot`
 * helper. Fetch failures degrade to the stub `getEngineeringRanking()`
 * snapshot so the page still renders with an explicit coverage-unavailable
 * state instead of crashing.
 */

import { db } from "@/lib/db";
import {
  engineeringRankingSnapshots,
  githubCommits,
  githubEmployeeMap,
  githubPrs,
  squads,
} from "@/lib/db/schema";
import { and, asc, count, desc, eq, gte, sum } from "drizzle-orm";
import { getReportData } from "@/lib/data/mode";
import { getImpactModel } from "@/lib/data/impact-model";
import {
  aggregateLatestMonthByUser,
  getAiUsageData,
  type AiUsageUserSummary,
} from "@/lib/data/ai-usage";
import {
  getSquadPillarMetrics,
  normalizeTeamName,
  type TeamSwarmiaMetrics,
} from "@/lib/data/swarmia";
import {
  RANKING_SIGNAL_WINDOW_DAYS,
  buildEligibleRoster,
  buildRankingSnapshot,
  buildRankingSnapshotRows,
  getEngineeringRanking,
  toSnapshotDate,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilitySquadsRegistryRow,
  type EngineeringRankingSnapshot,
  type PerEngineerSignalRow,
  type RankingSnapshotRow,
  type RankingSnapshotRowMetadata,
} from "@/lib/data/engineering-ranking";

async function fetchHeadcountRows(): Promise<EligibilityHeadcountRow[]> {
  const headcountData = await getReportData("people", "headcount", [
    "headcount",
  ]);
  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");
  if (!headcountQuery) return [];
  return headcountQuery.rows as EligibilityHeadcountRow[];
}

async function fetchGithubMap(): Promise<EligibilityGithubMapRow[]> {
  const rows = await db
    .select({
      githubLogin: githubEmployeeMap.githubLogin,
      employeeEmail: githubEmployeeMap.employeeEmail,
      isBot: githubEmployeeMap.isBot,
    })
    .from(githubEmployeeMap)
    .where(eq(githubEmployeeMap.isBot, false));

  return rows.map((r) => ({
    githubLogin: r.githubLogin,
    employeeEmail: r.employeeEmail,
    isBot: r.isBot,
  }));
}

async function fetchSquadsRegistry(): Promise<EligibilitySquadsRegistryRow[]> {
  const rows = await db
    .select({
      name: squads.name,
      pillar: squads.pillar,
      pmName: squads.pmName,
      channelId: squads.channelId,
      isActive: squads.isActive,
    })
    .from(squads)
    .where(eq(squads.isActive, true));

  return rows.map((r) => ({
    name: r.name,
    pillar: r.pillar,
    pmName: r.pmName,
    channelId: r.channelId,
    isActive: r.isActive,
  }));
}

async function fetchGithubActivityByLogin(windowStart: Date): Promise<
  Map<
    string,
    {
      prCount: number;
      commitCount: number;
      additions: number;
      deletions: number;
    }
  >
> {
  const [prRows, commitRows] = await Promise.all([
    db
      .select({
        login: githubPrs.authorLogin,
        prCount: count().as("pr_count"),
        additions: sum(githubPrs.additions).mapWith(Number).as("additions"),
        deletions: sum(githubPrs.deletions).mapWith(Number).as("deletions"),
      })
      .from(githubPrs)
      .where(gte(githubPrs.mergedAt, windowStart))
      .groupBy(githubPrs.authorLogin),
    db
      .select({
        login: githubCommits.authorLogin,
        commitCount: count().as("commit_count"),
      })
      .from(githubCommits)
      .where(gte(githubCommits.committedAt, windowStart))
      .groupBy(githubCommits.authorLogin),
  ]);

  const byLogin = new Map<
    string,
    {
      prCount: number;
      commitCount: number;
      additions: number;
      deletions: number;
    }
  >();

  for (const row of prRows) {
    byLogin.set(row.login, {
      prCount: Number(row.prCount) || 0,
      commitCount: 0,
      additions: Number(row.additions) || 0,
      deletions: Number(row.deletions) || 0,
    });
  }

  for (const row of commitRows) {
    const existing = byLogin.get(row.login) ?? {
      prCount: 0,
      commitCount: 0,
      additions: 0,
      deletions: 0,
    };
    existing.commitCount = Number(row.commitCount) || 0;
    byLogin.set(row.login, existing);
  }

  return byLogin;
}

async function fetchAiUsageByEmail(): Promise<Map<string, AiUsageUserSummary>> {
  try {
    return aggregateLatestMonthByUser(await getAiUsageData());
  } catch (err) {
    console.warn("[engineering-ranking] AI usage fetch failed:", err);
    return new Map();
  }
}

async function fetchSquadDeliveryContext(): Promise<
  Map<string, TeamSwarmiaMetrics>
> {
  const result = await getSquadPillarMetrics("last_180_days");
  if (result.status !== "ok" || !result.data) return new Map();
  return new Map(Object.entries(result.data.squads));
}

function buildSignalRows({
  headcountRows,
  githubMap,
  squadsRegistry,
  githubActivityByLogin,
  aiUsageByEmail,
  squadDeliveryByName,
  now,
}: {
  headcountRows: EligibilityHeadcountRow[];
  githubMap: EligibilityGithubMapRow[];
  squadsRegistry: EligibilitySquadsRegistryRow[];
  githubActivityByLogin: Map<
    string,
    {
      prCount: number;
      commitCount: number;
      additions: number;
      deletions: number;
    }
  >;
  aiUsageByEmail: Map<string, AiUsageUserSummary>;
  squadDeliveryByName: Map<string, TeamSwarmiaMetrics>;
  now: Date;
}): PerEngineerSignalRow[] {
  const impactByHash = new Map(
    getImpactModel().engineers.map((engineer) => [
      engineer.email_hash,
      engineer,
    ]),
  );

  const { entries } = buildEligibleRoster({
    headcountRows,
    githubMap,
    impactModel: getImpactModel(),
    squads: squadsRegistry,
    now,
    windowDays: RANKING_SIGNAL_WINDOW_DAYS,
  });

  return entries.map((entry) => {
    const githubActivity = entry.githubLogin
      ? (githubActivityByLogin.get(entry.githubLogin) ?? {
          prCount: 0,
          commitCount: 0,
          additions: 0,
          deletions: 0,
        })
      : null;
    const modelRow = impactByHash.get(entry.emailHash);
    const aiUsage = aiUsageByEmail.get(entry.email.toLowerCase()) ?? null;
    const squadKey = normalizeTeamName(
      entry.canonicalSquad?.name ?? entry.squad,
    );
    const squadDelivery =
      squadKey === "" ? null : (squadDeliveryByName.get(squadKey) ?? null);

    return {
      emailHash: entry.emailHash,
      prCount: githubActivity?.prCount ?? null,
      commitCount: githubActivity?.commitCount ?? null,
      additions: githubActivity?.additions ?? null,
      deletions: githubActivity?.deletions ?? null,
      shapPredicted: modelRow?.predicted ?? null,
      shapActual: modelRow?.actual ?? null,
      shapResidual: modelRow?.residual ?? null,
      aiTokens: aiUsage?.totalTokens ?? null,
      aiSpend: aiUsage?.totalCost ?? null,
      squadCycleTimeHours: squadDelivery?.cycleTimeHours ?? null,
      squadReviewRatePercent: squadDelivery?.reviewRatePercent ?? null,
      squadTimeToFirstReviewHours:
        squadDelivery?.timeToFirstReviewHours ?? null,
      squadPrsInProgress: squadDelivery?.prsInProgress ?? null,
    };
  });
}

/**
 * Build a real ranking snapshot from live data. If any fetch fails, fall
 * back to the empty-eligibility stub — the page still renders and the
 * coverage section makes the degraded state visible.
 */
export async function getEngineeringRankingSnapshot(): Promise<EngineeringRankingSnapshot> {
  try {
    const now = new Date();
    const windowStart = new Date(
      now.getTime() - RANKING_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const [
      headcountRows,
      githubMap,
      squadsRegistry,
      githubActivityByLogin,
      aiUsageByEmail,
      squadDeliveryByName,
    ] = await Promise.all([
      fetchHeadcountRows(),
      fetchGithubMap(),
      fetchSquadsRegistry(),
      fetchGithubActivityByLogin(windowStart),
      fetchAiUsageByEmail(),
      fetchSquadDeliveryContext(),
    ]);
    const signals = buildSignalRows({
      headcountRows,
      githubMap,
      squadsRegistry,
      githubActivityByLogin,
      aiUsageByEmail,
      squadDeliveryByName,
      now,
    });

    return buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: getImpactModel(),
      squads: squadsRegistry,
      signals,
      reviewSignalsPersisted: false,
      now,
      windowDays: RANKING_SIGNAL_WINDOW_DAYS,
      githubOrg: process.env.GITHUB_ORG ?? null,
    });
  } catch (err) {
    console.warn(
      "[engineering-ranking] preflight fetch failed, serving stub:",
      err,
    );
    return getEngineeringRanking();
  }
}

function numericString(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return value.toString();
}

function parseNumeric(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Persist a ranking snapshot. Idempotent for a given `(snapshotDate,
 * methodologyVersion, emailHash)` triple — re-running on the same UTC day
 * under the same methodology version replaces the prior values for that
 * engineer without duplicating rows. Methodology version bumps produce a
 * parallel snapshot slice; M17 movers compare like-for-like snapshots only.
 *
 * Rows never contain display name, email, resolved GitHub login, manager
 * name, or canonical squad name — `buildRankingSnapshotRows` enforces the
 * privacy shape and this helper only widens it to the Drizzle column set.
 */
export async function persistRankingSnapshot(
  snapshot: EngineeringRankingSnapshot,
  options?: {
    snapshotDate?: string;
    signals?: readonly PerEngineerSignalRow[];
  },
): Promise<{ rowsWritten: number; snapshotDate: string }> {
  const signalsByHash = options?.signals
    ? new Map(options.signals.map((s) => [s.emailHash, s]))
    : undefined;
  const rows = buildRankingSnapshotRows(snapshot, {
    snapshotDate: options?.snapshotDate,
    signalsByHash,
  });
  if (rows.length === 0) {
    return {
      rowsWritten: 0,
      snapshotDate:
        options?.snapshotDate ?? toSnapshotDate(new Date(snapshot.generatedAt)),
    };
  }

  const values = rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    methodologyVersion: row.methodologyVersion,
    signalWindowStart: row.signalWindowStart,
    signalWindowEnd: row.signalWindowEnd,
    emailHash: row.emailHash,
    eligibilityStatus: row.eligibilityStatus,
    rank: row.rank,
    compositeScore: numericString(row.compositeScore),
    adjustedPercentile: numericString(row.adjustedPercentile),
    rawPercentile: numericString(row.rawPercentile),
    methodA: numericString(row.methodA),
    methodB: numericString(row.methodB),
    methodC: numericString(row.methodC),
    confidenceLow: numericString(row.confidenceLow),
    confidenceHigh: numericString(row.confidenceHigh),
    inputHash: row.inputHash,
    metadata: row.metadata,
  }));

  await db
    .insert(engineeringRankingSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [
        engineeringRankingSnapshots.snapshotDate,
        engineeringRankingSnapshots.methodologyVersion,
        engineeringRankingSnapshots.emailHash,
      ],
      set: {
        signalWindowStart: engineeringRankingSnapshots.signalWindowStart,
        signalWindowEnd: engineeringRankingSnapshots.signalWindowEnd,
        eligibilityStatus: engineeringRankingSnapshots.eligibilityStatus,
        rank: engineeringRankingSnapshots.rank,
        compositeScore: engineeringRankingSnapshots.compositeScore,
        adjustedPercentile: engineeringRankingSnapshots.adjustedPercentile,
        rawPercentile: engineeringRankingSnapshots.rawPercentile,
        methodA: engineeringRankingSnapshots.methodA,
        methodB: engineeringRankingSnapshots.methodB,
        methodC: engineeringRankingSnapshots.methodC,
        confidenceLow: engineeringRankingSnapshots.confidenceLow,
        confidenceHigh: engineeringRankingSnapshots.confidenceHigh,
        inputHash: engineeringRankingSnapshots.inputHash,
        metadata: engineeringRankingSnapshots.metadata,
        generatedAt: engineeringRankingSnapshots.generatedAt,
      },
    });

  return { rowsWritten: rows.length, snapshotDate: rows[0].snapshotDate };
}

/**
 * Read a persisted ranking snapshot slice. Returns rows ordered by rank
 * ascending (unscored engineers last), restricted to the given methodology
 * version so cross-methodology snapshots cannot accidentally be merged.
 */
export async function readRankingSnapshot(params: {
  snapshotDate: string;
  methodologyVersion: string;
}): Promise<RankingSnapshotRow[]> {
  const rows = await db
    .select()
    .from(engineeringRankingSnapshots)
    .where(
      and(
        eq(engineeringRankingSnapshots.snapshotDate, params.snapshotDate),
        eq(
          engineeringRankingSnapshots.methodologyVersion,
          params.methodologyVersion,
        ),
      ),
    )
    .orderBy(
      asc(engineeringRankingSnapshots.rank),
      asc(engineeringRankingSnapshots.emailHash),
    );

  return rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    methodologyVersion: row.methodologyVersion,
    signalWindowStart: row.signalWindowStart,
    signalWindowEnd: row.signalWindowEnd,
    emailHash: row.emailHash,
    eligibilityStatus: row.eligibilityStatus as RankingSnapshotRow["eligibilityStatus"],
    rank: row.rank,
    compositeScore: parseNumeric(row.compositeScore),
    adjustedPercentile: parseNumeric(row.adjustedPercentile),
    rawPercentile: parseNumeric(row.rawPercentile),
    methodA: parseNumeric(row.methodA),
    methodB: parseNumeric(row.methodB),
    methodC: parseNumeric(row.methodC),
    confidenceLow: parseNumeric(row.confidenceLow),
    confidenceHigh: parseNumeric(row.confidenceHigh),
    inputHash: row.inputHash,
    metadata: (row.metadata as RankingSnapshotRowMetadata | null) ?? {
      presentMethodCount: 0,
      dominanceBlocked: false,
      dominanceRiskApplied: false,
      confidenceWidth: null,
      inTieGroup: false,
    },
  }));
}

/**
 * List the distinct snapshot slices that have been persisted, ordered most
 * recent first. Useful for M17 movers which needs the two most recent
 * comparable snapshots (matching methodology version) at least N days
 * apart, and for the admin data-status view.
 */
export async function listRankingSnapshotSlices(params?: {
  methodologyVersion?: string;
  limit?: number;
}): Promise<
  Array<{ snapshotDate: string; methodologyVersion: string; rowCount: number }>
> {
  const limit = params?.limit ?? 60;
  const baseSelect = db
    .select({
      snapshotDate: engineeringRankingSnapshots.snapshotDate,
      methodologyVersion: engineeringRankingSnapshots.methodologyVersion,
      rowCount: count(engineeringRankingSnapshots.id),
    })
    .from(engineeringRankingSnapshots);

  const withFilter = params?.methodologyVersion
    ? baseSelect.where(
        eq(
          engineeringRankingSnapshots.methodologyVersion,
          params.methodologyVersion,
        ),
      )
    : baseSelect;

  const rows = await withFilter
    .groupBy(
      engineeringRankingSnapshots.snapshotDate,
      engineeringRankingSnapshots.methodologyVersion,
    )
    .orderBy(
      desc(engineeringRankingSnapshots.snapshotDate),
      desc(engineeringRankingSnapshots.methodologyVersion),
    )
    .limit(limit);

  return rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    methodologyVersion: row.methodologyVersion,
    rowCount: Number(row.rowCount) || 0,
  }));
}
