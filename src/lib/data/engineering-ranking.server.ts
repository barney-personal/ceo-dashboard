/**
 * Server-side loader for the engineer ranking page.
 *
 * Fetches the spine inputs (Mode Headcount SSoT + `githubEmployeeMap` + the
 * committed impact model) and delegates to the pure `buildRankingSnapshot`
 * helper. Fetch failures degrade to the stub `getEngineeringRanking()`
 * snapshot so the page still renders with an explicit coverage-unavailable
 * state instead of crashing.
 *
 * Important: this loader stays inside the repo's synced-data contract.
 * It deliberately does NOT call Swarmia live; lens C only scores squad-
 * delivery context when a persisted source is wired into the snapshot build.
 */

import { db } from "@/lib/db";
import {
  engineeringRankingSnapshots,
  githubCommits,
  githubEmployeeMap,
  githubPrs,
  prReviewAnalyses,
  squads,
} from "@/lib/db/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  notInArray,
  sql,
  sum,
} from "drizzle-orm";
import { getReportData } from "@/lib/data/mode";
import { getImpactModel } from "@/lib/data/impact-model";
import {
  aggregateLatestMonthByUser,
  getAiUsageData,
  type AiUsageUserSummary,
} from "@/lib/data/ai-usage";
import { normalizeTeamName, type TeamSwarmiaMetrics } from "@/lib/data/swarmia";
import {
  RANKING_METHODOLOGY_VERSION,
  RANKING_MOVERS_MIN_GAP_DAYS,
  RANKING_QUALITY_RUBRIC_VERSION,
  RANKING_SIGNAL_WINDOW_DAYS,
  buildEligibleRoster,
  buildRankingSnapshot,
  buildRankingSnapshotRows,
  getEngineeringRanking,
  hashEmailForRanking,
  toSnapshotDate,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilitySquadsRegistryRow,
  type EngineeringRankingSnapshot,
  type PerEngineerSignalRow,
  type PrReviewAnalysisInput,
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

/**
 * Pull per-PR rubric rows (rubric version `RANKING_QUALITY_RUBRIC_VERSION`)
 * merged inside the signal window, joined through `githubEmployeeMap` so
 * every row resolves to an employee email → ranking email hash.
 *
 * The quality lens is strict about rubric-version mixing — only rows with
 * the current version are returned — and bots / unmapped GitHub logins are
 * filtered out so the lens doesn't reward activity we can't attribute.
 * Engineers with merged PRs outside the analysed set (e.g. repos excluded
 * via `CODE_REVIEW_EXCLUDED_REPOS`) will be under-represented here; this is
 * a known limitation surfaced on the methodology panel.
 */
async function fetchPrReviewAnalyses(
  windowStart: Date,
): Promise<PrReviewAnalysisInput[]> {
  const rows = await db
    .select({
      authorLogin: prReviewAnalyses.authorLogin,
      mergedAt: prReviewAnalyses.mergedAt,
      rubricVersion: prReviewAnalyses.rubricVersion,
      technicalDifficulty: prReviewAnalyses.technicalDifficulty,
      executionQuality: prReviewAnalyses.executionQuality,
      testAdequacy: prReviewAnalyses.testAdequacy,
      riskHandling: prReviewAnalyses.riskHandling,
      reviewability: prReviewAnalyses.reviewability,
      analysisConfidencePct: prReviewAnalyses.analysisConfidencePct,
      revertWithin14d: prReviewAnalyses.revertWithin14d,
      employeeEmail: githubEmployeeMap.employeeEmail,
      isBot: githubEmployeeMap.isBot,
    })
    .from(prReviewAnalyses)
    .leftJoin(
      githubEmployeeMap,
      eq(githubEmployeeMap.githubLogin, prReviewAnalyses.authorLogin),
    )
    .where(
      and(
        eq(prReviewAnalyses.rubricVersion, RANKING_QUALITY_RUBRIC_VERSION),
        gte(prReviewAnalyses.mergedAt, windowStart),
      ),
    );

  const out: PrReviewAnalysisInput[] = [];
  for (const row of rows) {
    if (!row.employeeEmail) continue; // unmapped author
    if (row.isBot) continue;
    out.push({
      emailHash: hashEmailForRanking(row.employeeEmail),
      mergedAt: row.mergedAt.toISOString(),
      rubricVersion: row.rubricVersion,
      technicalDifficulty: row.technicalDifficulty,
      executionQuality: row.executionQuality,
      testAdequacy: row.testAdequacy,
      riskHandling: row.riskHandling,
      reviewability: row.reviewability,
      analysisConfidencePct: row.analysisConfidencePct,
      revertWithin14d: row.revertWithin14d ?? false,
    });
  }
  return out;
}

/**
 * Fetch the most recent prior snapshot slice to diff against for the M18
 * movers view. Preference order:
 *
 *   1. Most recent slice at least `minGapDays` old, same methodology.
 *   2. Most recent slice at least `minGapDays` old, any methodology.
 *   3. Most recent slice on or before the current snapshot date (regardless
 *      of gap), preferring the current methodology when multiple slices
 *      share the winning date. Snapshot keys are date-granular, so this
 *      fallback surfaces same-day same-methodology and same-day
 *      different-methodology slices as well as strictly older ones — in
 *      every case `buildMovers` emits `insufficient_gap` with the real
 *      `priorSnapshotGapDays` (including 0-day gaps for same-day slices)
 *      rather than degrading to `no_prior_snapshot`.
 *
 * Returns an empty array only when no prior slice exists at all.
 */
export async function fetchPriorSnapshotRowsForMovers(params: {
  currentSnapshotDate: string;
  currentMethodologyVersion: string;
  minGapDays: number;
}): Promise<RankingSnapshotRow[]> {
  const cutoffDate = new Date(`${params.currentSnapshotDate}T00:00:00Z`);
  if (Number.isNaN(cutoffDate.getTime())) return [];
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - params.minGapDays);
  const cutoffIso = toSnapshotDate(cutoffDate);

  const sameMethodologySlice = await db
    .select({
      snapshotDate: engineeringRankingSnapshots.snapshotDate,
      methodologyVersion: engineeringRankingSnapshots.methodologyVersion,
    })
    .from(engineeringRankingSnapshots)
    .where(
      and(
        eq(
          engineeringRankingSnapshots.methodologyVersion,
          params.currentMethodologyVersion,
        ),
        lte(engineeringRankingSnapshots.snapshotDate, cutoffIso),
      ),
    )
    .orderBy(desc(engineeringRankingSnapshots.snapshotDate))
    .limit(1);

  let priorSlice = sameMethodologySlice[0] ?? null;
  if (!priorSlice) {
    const anyMethodologySlice = await db
      .select({
        snapshotDate: engineeringRankingSnapshots.snapshotDate,
        methodologyVersion: engineeringRankingSnapshots.methodologyVersion,
      })
      .from(engineeringRankingSnapshots)
      .where(lte(engineeringRankingSnapshots.snapshotDate, cutoffIso))
      .orderBy(
        desc(engineeringRankingSnapshots.snapshotDate),
        desc(engineeringRankingSnapshots.methodologyVersion),
      )
      .limit(1);
    priorSlice = anyMethodologySlice[0] ?? null;
  }

  // Fallback: no slice is old enough, but a too-recent prior slice may
  // still exist — including same-day slices (snapshot keys are date-
  // granular, so a previous POST today with either methodology version
  // shows up here). Surface it so `buildMovers` renders `insufficient_gap`
  // with the actual gap (including 0-day) instead of the stronger
  // `no_prior_snapshot` empty state.
  //
  // Ordering: most recent date first, breaking date ties by preferring the
  // current methodology version. This keeps same-day same-methodology
  // refreshes ahead of same-day other-methodology rows without disturbing
  // the "most recent wins" rule when dates differ.
  if (!priorSlice) {
    const tooRecentSlice = await db
      .select({
        snapshotDate: engineeringRankingSnapshots.snapshotDate,
        methodologyVersion: engineeringRankingSnapshots.methodologyVersion,
      })
      .from(engineeringRankingSnapshots)
      .where(
        lte(
          engineeringRankingSnapshots.snapshotDate,
          params.currentSnapshotDate,
        ),
      )
      .orderBy(
        desc(engineeringRankingSnapshots.snapshotDate),
        sql`CASE WHEN ${engineeringRankingSnapshots.methodologyVersion} = ${params.currentMethodologyVersion} THEN 0 ELSE 1 END`,
        desc(engineeringRankingSnapshots.methodologyVersion),
      )
      .limit(1);
    priorSlice = tooRecentSlice[0] ?? null;
  }

  if (!priorSlice) return [];
  return readRankingSnapshot({
    snapshotDate: priorSlice.snapshotDate,
    methodologyVersion: priorSlice.methodologyVersion,
  });
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
  const impactByEmail = new Map(
    getImpactModel().engineers.map((engineer) => [
      (engineer.email ?? "").toLowerCase(),
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
    const modelRow = impactByEmail.get(entry.email.toLowerCase());
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
 * Build a real ranking snapshot from live data AND return the same
 * `PerEngineerSignalRow[]` the snapshot was built from. Callers that need to
 * persist an `input_hash` alongside each row (M16/M17) must use this helper so
 * the persisted hash aligns with the signals that produced the rank.
 *
 * If any fetch fails, returns the empty-eligibility stub and an empty signal
 * array — the page still renders and the coverage section makes the degraded
 * state visible, and the POST persistence path writes zero rows rather than
 * persisting stale identities.
 */
export async function getEngineeringRankingSnapshotWithSignals(): Promise<{
  snapshot: EngineeringRankingSnapshot;
  signals: PerEngineerSignalRow[];
}> {
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
      qualityAnalyses,
      priorSnapshotRows,
    ] = await Promise.all([
      fetchHeadcountRows(),
      fetchGithubMap(),
      fetchSquadsRegistry(),
      fetchGithubActivityByLogin(windowStart),
      fetchAiUsageByEmail(),
      fetchPrReviewAnalyses(windowStart).catch((err) => {
        console.warn(
          "[engineering-ranking] pr-review analyses fetch failed, code-quality lens will render as unavailable:",
          err,
        );
        return [] as PrReviewAnalysisInput[];
      }),
      fetchPriorSnapshotRowsForMovers({
        currentSnapshotDate: toSnapshotDate(now),
        currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
        minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
      }).catch((err) => {
        console.warn(
          "[engineering-ranking] prior snapshot fetch failed, movers will render empty state:",
          err,
        );
        return [] as RankingSnapshotRow[];
      }),
    ]);
    // The ranking path intentionally does not call Swarmia live. Until a
    // persisted squad-delivery source exists, lens C stays unavailable and
    // the snapshot surfaces that explicitly via audit/planned-signals/freshness.
    const squadDeliveryByName = new Map<string, TeamSwarmiaMetrics>();
    const signals = buildSignalRows({
      headcountRows,
      githubMap,
      squadsRegistry,
      githubActivityByLogin,
      aiUsageByEmail,
      squadDeliveryByName,
      now,
    });

    // The AI usage latest-month marker is the same for every user in the map
    // (the rollup is per-month); picking the first entry with a non-null
    // `latestMonthStart` is enough to drive the freshness badge.
    let aiUsageLatestMonth: string | null = null;
    for (const summary of aiUsageByEmail.values()) {
      if (summary.latestMonthStart) {
        aiUsageLatestMonth = summary.latestMonthStart;
        break;
      }
    }
    const snapshot = buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: getImpactModel(),
      squads: squadsRegistry,
      signals,
      qualityAnalyses,
      reviewSignalsPersisted: false,
      now,
      windowDays: RANKING_SIGNAL_WINDOW_DAYS,
      githubOrg: process.env.GITHUB_ORG ?? null,
      priorSnapshotRows,
      aiUsageLatestMonth,
    });

    return { snapshot, signals };
  } catch (err) {
    console.warn(
      "[engineering-ranking] preflight fetch failed, serving stub:",
      err,
    );
    return { snapshot: await getEngineeringRanking(), signals: [] };
  }
}

/**
 * Convenience wrapper for callers (the ranking page server component) that
 * only need the snapshot. Delegates to
 * `getEngineeringRankingSnapshotWithSignals` so the snapshot and signals stay
 * in lockstep; persistence callers must use the `WithSignals` variant
 * directly so the per-engineer `input_hash` can be populated.
 */
export async function getEngineeringRankingSnapshot(): Promise<EngineeringRankingSnapshot> {
  const { snapshot } = await getEngineeringRankingSnapshotWithSignals();
  return snapshot;
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

  const generatedAt = new Date();
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
    methodD: numericString(row.methodD),
    confidenceLow: numericString(row.confidenceLow),
    confidenceHigh: numericString(row.confidenceHigh),
    inputHash: row.inputHash,
    metadata: row.metadata,
    generatedAt,
  }));

  const snapshotDate = rows[0].snapshotDate;
  const methodologyVersion = rows[0].methodologyVersion;
  const keptHashes = values.map((v) => v.emailHash);

  // Upsert the new rows AND drop any rows from the same
  // (snapshot_date, methodology_version) slice whose email_hash is not in
  // the incoming set. Same-day re-POSTs can shrink the competitive cohort
  // (e.g. an engineer drops out between runs); without the delete, stale
  // rows would linger and contaminate downstream movers / stability reads.
  //
  // ON CONFLICT DO UPDATE must pull from PostgreSQL's `EXCLUDED` pseudo-row
  // (the incoming values), not from the existing row in the target table,
  // so a same-day refresh replaces rank / scores / confidence / input_hash
  // / metadata / generated_at with the new values.
  await db.transaction(async (tx) => {
    await tx
      .insert(engineeringRankingSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [
          engineeringRankingSnapshots.snapshotDate,
          engineeringRankingSnapshots.methodologyVersion,
          engineeringRankingSnapshots.emailHash,
        ],
        set: {
          signalWindowStart: sql`excluded.signal_window_start`,
          signalWindowEnd: sql`excluded.signal_window_end`,
          eligibilityStatus: sql`excluded.eligibility_status`,
          rank: sql`excluded.rank`,
          compositeScore: sql`excluded.composite_score`,
          adjustedPercentile: sql`excluded.adjusted_percentile`,
          rawPercentile: sql`excluded.raw_percentile`,
          methodA: sql`excluded.method_a`,
          methodB: sql`excluded.method_b`,
          methodC: sql`excluded.method_c`,
          methodD: sql`excluded.method_d`,
          confidenceLow: sql`excluded.confidence_low`,
          confidenceHigh: sql`excluded.confidence_high`,
          inputHash: sql`excluded.input_hash`,
          metadata: sql`excluded.metadata`,
          generatedAt: sql`excluded.generated_at`,
        },
      });

    await tx
      .delete(engineeringRankingSnapshots)
      .where(
        and(
          eq(engineeringRankingSnapshots.snapshotDate, snapshotDate),
          eq(
            engineeringRankingSnapshots.methodologyVersion,
            methodologyVersion,
          ),
          notInArray(engineeringRankingSnapshots.emailHash, keptHashes),
        ),
      );
  });

  return { rowsWritten: rows.length, snapshotDate };
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
    methodD: parseNumeric(row.methodD),
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
