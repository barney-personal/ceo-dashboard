import { beforeEach, describe, expect, it, vi } from "vitest";
import { SQL, StringChunk } from "drizzle-orm";

/**
 * Flatten a Drizzle SQL expression into a single string of literal text. We
 * only need enough fidelity to check for the `excluded.<column>` reference, so
 * walking `StringChunk`s is sufficient — any nested SQL or identifier chunks
 * recursively surface their literal text.
 */
function flattenSqlLiteralText(node: unknown): string {
  if (node instanceof SQL) {
    return node.queryChunks.map((chunk) => flattenSqlLiteralText(chunk)).join("");
  }
  if (node instanceof StringChunk) {
    return node.value.join("");
  }
  if (typeof node === "string") return node;
  return "";
}

vi.mock("@/lib/db", () => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
  const mockDb: Record<string, unknown> = {
    insert,
    delete: deleteFn,
    select: vi.fn(),
  };
  // The live code wraps persist writes in `db.transaction(async (tx) => ...)`;
  // forward the callback to `mockDb` itself so the same `insert` / `delete`
  // spies capture the calls that happen inside the transaction.
  mockDb.transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(mockDb),
  );
  return {
    db: mockDb,
    __mocks: { insert, values, onConflictDoUpdate, delete: deleteFn, deleteWhere },
  };
});

import { db } from "@/lib/db";
import {
  fetchPriorSnapshotRowsForMovers,
  persistRankingSnapshot,
} from "../engineering-ranking.server";
import {
  buildMovers,
  buildRankingSnapshot,
  hashEmailForRanking,
  RANKING_METHODOLOGY_VERSION,
  RANKING_MOVERS_MIN_GAP_DAYS,
  type EligibilityEntry,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilityImpactModelView,
  type PerEngineerSignalRow,
  type RankingSnapshotRow,
} from "../engineering-ranking";

function competitiveEntry(
  index: number,
  overrides: Partial<EligibilityEntry> = {},
): EligibilityEntry {
  const email = `eng${index}@meetcleo.com`;
  return {
    emailHash: hashEmailForRanking(email),
    displayName: `Engineer ${index}`,
    email,
    githubLogin: `eng${index}`,
    discipline: "BE",
    levelLabel: "L4",
    squad: index % 2 === 0 ? "Platform" : "Risk",
    pillar: "Core",
    canonicalSquad: null,
    manager: "Boss",
    startDate: "2023-01-01",
    tenureDays: 800,
    isLeaverOrInactive: false,
    hasImpactModelRow: true,
    eligibility: "competitive",
    reason: "Eligible",
    ...overrides,
  };
}

function signalRow(
  index: number,
  overrides: Partial<PerEngineerSignalRow> = {},
): PerEngineerSignalRow {
  return {
    emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
    prCount: 30 + index,
    commitCount: 60 + index * 2,
    additions: index * 100,
    deletions: index * 10,
    shapPredicted: index * 50,
    shapActual: index * 60,
    shapResidual: index * 10,
    aiTokens: index * 1_000,
    aiSpend: index * 5,
    squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
    squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
    squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
    squadPrsInProgress: index % 2 === 0 ? 6 : 9,
    ...overrides,
  };
}

function buildFixtureSnapshot() {
  const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
  const signals = entries.map((_, i) => signalRow(i + 1));
  const headcountRows: EligibilityHeadcountRow[] = entries.map((e) => ({
    email: e.email,
    preferred_name: e.displayName,
    rp_specialisation: "Backend Eng",
    hb_function: "Engineering",
    hb_level: e.levelLabel,
    job_title: e.levelLabel,
    hb_squad: e.squad ?? null,
    line_manager_email: "boss@meetcleo.com",
    manager: e.manager,
    start_date: e.startDate,
  }));
  const githubMap: EligibilityGithubMapRow[] = entries
    .filter((e): e is EligibilityEntry & { githubLogin: string } =>
      Boolean(e.githubLogin),
    )
    .map((e) => ({
      githubLogin: e.githubLogin,
      employeeEmail: e.email,
      isBot: false,
    }));
  const impactModel: EligibilityImpactModelView = {
    engineers: entries.map((e) => ({
      email: e.email,
      predicted: 1,
      actual: 1,
    })),
  };
  const snapshot = buildRankingSnapshot({
    headcountRows,
    githubMap,
    impactModel,
    signals,
    now: new Date("2026-04-24T12:34:56Z"),
    reviewSignalsPersisted: false,
  });
  return { snapshot, signals };
}

describe("persistRankingSnapshot (M17 persistence correctness)", () => {
  beforeEach(() => {
    vi.mocked(db.insert).mockClear();
    vi.mocked(db.delete).mockClear();
    // Re-wire the fluent chain each test so captured calls stay isolated.
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    vi.mocked(db.insert).mockReturnValue({
      values,
    } as unknown as ReturnType<typeof db.insert>);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({
      where: deleteWhere,
    } as unknown as ReturnType<typeof db.delete>);
  });

  it("populates a non-null input_hash in the persisted values when signals are supplied", async () => {
    const { snapshot, signals } = buildFixtureSnapshot();
    await persistRankingSnapshot(snapshot, { signals });

    const insertCall = vi.mocked(db.insert).mock.results[0];
    const valuesFn = (insertCall.value as { values: ReturnType<typeof vi.fn> })
      .values;
    const writtenValues = valuesFn.mock.calls[0][0] as Array<{
      inputHash: string | null;
    }>;

    // The live POST path used to call persistRankingSnapshot without signals,
    // which nulled every row's input_hash. The fix routes the signals through
    // the API and populates the per-engineer hash here.
    expect(Array.isArray(writtenValues)).toBe(true);
    expect(writtenValues.length).toBeGreaterThan(0);
    const hashes = writtenValues.map((row) => row.inputHash);
    expect(hashes.every((hash) => hash !== null && typeof hash === "string")).toBe(
      true,
    );
    // Distinct signals must produce distinct hashes so movers can
    // distinguish input drift from methodology drift.
    expect(new Set(hashes).size).toBeGreaterThan(1);
  });

  it("ON CONFLICT DO UPDATE set values pull from PostgreSQL EXCLUDED, not the existing row", async () => {
    const { snapshot, signals } = buildFixtureSnapshot();
    await persistRankingSnapshot(snapshot, { signals });

    const insertCall = vi.mocked(db.insert).mock.results[0];
    const valuesFn = (insertCall.value as { values: ReturnType<typeof vi.fn> })
      .values;
    const valuesResult = valuesFn.mock.results[0].value as {
      onConflictDoUpdate: ReturnType<typeof vi.fn>;
    };
    const onConflictArg = valuesResult.onConflictDoUpdate.mock.calls[0][0] as {
      set: Record<string, unknown>;
    };
    const setClause = onConflictArg.set;

    // Every refreshable column must be an SQL instance referencing the
    // EXCLUDED pseudo-row. The previous bug assigned Drizzle column objects
    // (engineeringRankingSnapshots.<col>), which PostgreSQL evaluates as
    // "target_table.<col>" — a no-op on same-day refresh.
    const refreshableColumns = [
      "signalWindowStart",
      "signalWindowEnd",
      "eligibilityStatus",
      "rank",
      "compositeScore",
      "adjustedPercentile",
      "rawPercentile",
      "methodA",
      "methodB",
      "methodC",
      "confidenceLow",
      "confidenceHigh",
      "inputHash",
      "metadata",
      "generatedAt",
    ] as const;

    for (const column of refreshableColumns) {
      const value = setClause[column];
      expect(
        value instanceof SQL,
        `set.${column} must be an sql\`excluded.<column>\` expression`,
      ).toBe(true);
      // The SQL fragment must literally reference excluded.<snake_case>.
      const fragment = flattenSqlLiteralText(value).toLowerCase();
      expect(fragment).toContain("excluded.");
    }
  });

  it("deletes stale rows from the same slice whose email_hash is no longer in the incoming set", async () => {
    // A same-day re-POST whose competitive cohort shrinks must drop rows
    // for engineers who fell out of the set — otherwise the stale hashes
    // linger at the (snapshot_date, methodology_version) slice and poison
    // subsequent movers / stability reads.
    const { snapshot, signals } = buildFixtureSnapshot();
    await persistRankingSnapshot(snapshot, { signals });

    expect(vi.mocked(db.delete)).toHaveBeenCalledOnce();
    expect(vi.mocked(db.delete).mock.calls[0][0]).toBeDefined();
    const deleteResult = vi.mocked(db.delete).mock.results[0].value as {
      where: ReturnType<typeof vi.fn>;
    };
    expect(deleteResult.where).toHaveBeenCalledOnce();
  });

  it("emits no database write when the snapshot has no composite entries", async () => {
    // Empty snapshot — no headcount, no signals, no composite entries. A bare
    // no-op insert with zero rows is a legitimate same-day refresh when the
    // methodology surfaces the empty-eligibility stub, but the DB must not be
    // asked to upsert anything.
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });

    await persistRankingSnapshot(snapshot, { signals: [] });
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });
});

/**
 * Build a thenable fluent stub that satisfies the Drizzle call chain used by
 * `fetchPriorSnapshotRowsForMovers`. Every chain node forwards to itself and
 * resolves to `result` when awaited at any depth.
 */
function chainFor(result: unknown) {
  const node = {} as Record<string, unknown>;
  const pass = () => node;
  node.from = pass;
  node.where = pass;
  node.orderBy = pass;
  node.limit = pass;
  node.then = (onFulfilled: unknown, onRejected: unknown) =>
    Promise.resolve(result).then(
      onFulfilled as Parameters<typeof Promise.prototype.then>[0],
      onRejected as Parameters<typeof Promise.prototype.then>[1],
    );
  return node;
}

/**
 * Build a persisted snapshot row shape — only the fields the movers diff
 * actually reads. `input_hash` is a stable synthetic value so hash diffing
 * is deterministic across the test.
 */
function persistedRow(
  index: number,
  overrides: Partial<RankingSnapshotRow> = {},
): RankingSnapshotRow {
  const emailHash = hashEmailForRanking(`eng${index}@meetcleo.com`);
  return {
    snapshotDate: "2026-04-22",
    methodologyVersion: RANKING_METHODOLOGY_VERSION,
    signalWindowStart: new Date("2025-10-24T00:00:00.000Z"),
    signalWindowEnd: new Date("2026-04-22T00:00:00.000Z"),
    emailHash,
    eligibilityStatus: "competitive",
    rank: index,
    compositeScore: 60 + index,
    adjustedPercentile: 55 + index,
    rawPercentile: 50 + index,
    methodA: 50,
    methodB: 60,
    methodC: 70,
    methodD: 65,
    confidenceLow: 45 + index,
    confidenceHigh: 75 + index,
    inputHash: `persisted-input-${index}`,
    metadata: {
      presentMethodCount: 4,
      dominanceBlocked: false,
      dominanceRiskApplied: false,
      confidenceWidth: 30,
      inTieGroup: false,
    },
    ...overrides,
  };
}

describe("fetchPriorSnapshotRowsForMovers (M19 too-recent slice surfacing)", () => {
  beforeEach(() => {
    vi.mocked(db.select).mockReset();
  });

  it("returns a too-recent prior slice when no slice is old enough, so the live page can render insufficient_gap", async () => {
    // Three selector queries (same methodology + old, any methodology + old,
    // any methodology + any age) followed by the readRankingSnapshot load.
    const currentSnapshotDate = "2026-04-24";
    const tooRecentSlice = {
      snapshotDate: "2026-04-23",
      methodologyVersion: RANKING_METHODOLOGY_VERSION,
    };
    const priorRows = [persistedRow(1), persistedRow(2)];
    const selectResults: unknown[] = [
      [], // sameMethodologySlice — none old enough
      [], // anyMethodologySlice — none old enough
      [tooRecentSlice], // tooRecentSlice — the M19 fallback
      priorRows, // readRankingSnapshot loads the row content
    ];
    vi.mocked(db.select).mockImplementation(
      () => chainFor(selectResults.shift() ?? []) as unknown as ReturnType<typeof db.select>,
    );

    const rows = await fetchPriorSnapshotRowsForMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    // Pre-M19, the selector returned [] here and the page degraded to
    // `no_prior_snapshot`. With the fallback, we surface the too-recent slice
    // so the page can render `insufficient_gap` with the real gap.
    expect(rows).toHaveLength(priorRows.length);
    expect(rows[0]?.snapshotDate).toBe("2026-04-22");

    // All four select calls must have fired — the fallback only runs when the
    // first two return empty.
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(4);
  });

  it("feeds the too-recent slice into buildMovers and produces status === insufficient_gap with the actual gap", async () => {
    const currentSnapshotDate = "2026-04-24";
    const tooRecentSlice = {
      snapshotDate: "2026-04-23",
      methodologyVersion: RANKING_METHODOLOGY_VERSION,
    };
    const priorRows = [persistedRow(1), persistedRow(2)];
    const selectResults: unknown[] = [
      [],
      [],
      [tooRecentSlice],
      priorRows,
    ];
    vi.mocked(db.select).mockImplementation(
      () => chainFor(selectResults.shift() ?? []) as unknown as ReturnType<typeof db.select>,
    );

    const fetched = await fetchPriorSnapshotRowsForMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    const movers = buildMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite: {
        contract: "",
        methods: [],
        minPresentMethods: 2,
        maxSingleSignalEffectiveWeight: 0.3,
        dominanceCorrelationThreshold: 0.75,
        entries: [],
        ranked: [],
        effectiveSignalWeights: [],
        leaveOneOut: [],
        finalRankCorrelations: [],
        dominanceWarnings: [],
        dominanceBlocked: false,
        limitations: [],
      },
      confidence: {
        contract: "",
        bootstrapIterations: 0,
        ciCoverage: 0.8,
        dominanceWidening: 1.5,
        globalDominanceApplied: false,
        entries: [],
        tieGroups: [],
        limitations: [],
      },
      eligibilityEntries: [],
      priorRows: fetched,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    expect(movers.status).toBe("insufficient_gap");
    expect(movers.priorSnapshot?.snapshotDate).toBe("2026-04-22");
    expect(movers.priorSnapshotGapDays).toBe(2);
    expect(movers.minGapDays).toBe(RANKING_MOVERS_MIN_GAP_DAYS);
  });

  it("does not fall through to the too-recent query when an old-enough same-methodology slice exists", async () => {
    const currentSnapshotDate = "2026-04-24";
    const oldEnoughSlice = {
      snapshotDate: "2026-04-01",
      methodologyVersion: RANKING_METHODOLOGY_VERSION,
    };
    const priorRows = [persistedRow(1, { snapshotDate: "2026-04-01" })];
    const selectResults: unknown[] = [
      [oldEnoughSlice],
      priorRows,
    ];
    vi.mocked(db.select).mockImplementation(
      () => chainFor(selectResults.shift() ?? []) as unknown as ReturnType<typeof db.select>,
    );

    const rows = await fetchPriorSnapshotRowsForMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    // Only the same-methodology selector + readRankingSnapshot run.
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2);
    expect(rows[0]?.snapshotDate).toBe("2026-04-01");
  });

  it("returns an empty array when no prior slice exists at all", async () => {
    const selectResults: unknown[] = [[], [], []];
    vi.mocked(db.select).mockImplementation(
      () => chainFor(selectResults.shift() ?? []) as unknown as ReturnType<typeof db.select>,
    );

    const rows = await fetchPriorSnapshotRowsForMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    expect(rows).toEqual([]);
    // Three probes, no readRankingSnapshot call.
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(3);
  });
});

describe("fetchPriorSnapshotRowsForMovers (M20 same-day slice surfacing)", () => {
  beforeEach(() => {
    vi.mocked(db.select).mockReset();
  });

  it("surfaces a same-day same-methodology slice as insufficient_gap with a 0-day gap", async () => {
    // Snapshot keys are (date, methodology, emailHash). A same-day re-POST
    // (or a late page load after an earlier POST today) persists rows whose
    // `snapshotDate` equals the live-built `currentSnapshotDate`. Pre-M20
    // the fallback used `lt(... < currentSnapshotDate)`, so these rows were
    // missed and the page rendered `no_prior_snapshot` instead of
    // `insufficient_gap` (0 days).
    const currentSnapshotDate = "2026-04-24";
    const sameDaySameMeth = {
      snapshotDate: currentSnapshotDate,
      methodologyVersion: RANKING_METHODOLOGY_VERSION,
    };
    const priorRows = [
      persistedRow(1, { snapshotDate: currentSnapshotDate }),
      persistedRow(2, { snapshotDate: currentSnapshotDate }),
    ];
    const selectResults: unknown[] = [
      [], // old-enough same methodology — none
      [], // old-enough any methodology — none
      [sameDaySameMeth], // M20 fallback: `lte(... <= currentSnapshotDate)`
      priorRows, // readRankingSnapshot loads the row content
    ];
    vi.mocked(db.select).mockImplementation(
      () =>
        chainFor(selectResults.shift() ?? []) as unknown as ReturnType<
          typeof db.select
        >,
    );

    const fetched = await fetchPriorSnapshotRowsForMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    expect(fetched).toHaveLength(priorRows.length);
    expect(fetched[0]?.snapshotDate).toBe(currentSnapshotDate);
    expect(fetched[0]?.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);

    const movers = buildMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite: {
        contract: "",
        methods: [],
        minPresentMethods: 2,
        maxSingleSignalEffectiveWeight: 0.3,
        dominanceCorrelationThreshold: 0.75,
        entries: [],
        ranked: [],
        effectiveSignalWeights: [],
        leaveOneOut: [],
        finalRankCorrelations: [],
        dominanceWarnings: [],
        dominanceBlocked: false,
        limitations: [],
      },
      confidence: {
        contract: "",
        bootstrapIterations: 0,
        ciCoverage: 0.8,
        dominanceWidening: 1.5,
        globalDominanceApplied: false,
        entries: [],
        tieGroups: [],
        limitations: [],
      },
      eligibilityEntries: [],
      priorRows: fetched,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    expect(movers.status).toBe("insufficient_gap");
    expect(movers.priorSnapshot?.snapshotDate).toBe(currentSnapshotDate);
    expect(movers.priorSnapshotGapDays).toBe(0);
    expect(movers.methodologyChanged).toBe(false);
    expect(movers.risers).toHaveLength(0);
    expect(movers.fallers).toHaveLength(0);
  });

  it("surfaces a same-day different-methodology slice as insufficient_gap with a 0-day gap", async () => {
    const currentSnapshotDate = "2026-04-24";
    const otherMethodology = "0.8.0-snapshots";
    expect(otherMethodology).not.toBe(RANKING_METHODOLOGY_VERSION);
    const sameDayOtherMeth = {
      snapshotDate: currentSnapshotDate,
      methodologyVersion: otherMethodology,
    };
    const priorRows = [
      persistedRow(1, {
        snapshotDate: currentSnapshotDate,
        methodologyVersion: otherMethodology,
      }),
    ];
    const selectResults: unknown[] = [
      [],
      [],
      [sameDayOtherMeth],
      priorRows,
    ];
    vi.mocked(db.select).mockImplementation(
      () =>
        chainFor(selectResults.shift() ?? []) as unknown as ReturnType<
          typeof db.select
        >,
    );

    const fetched = await fetchPriorSnapshotRowsForMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    expect(fetched).toHaveLength(priorRows.length);
    expect(fetched[0]?.methodologyVersion).toBe(otherMethodology);

    const movers = buildMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite: {
        contract: "",
        methods: [],
        minPresentMethods: 2,
        maxSingleSignalEffectiveWeight: 0.3,
        dominanceCorrelationThreshold: 0.75,
        entries: [],
        ranked: [],
        effectiveSignalWeights: [],
        leaveOneOut: [],
        finalRankCorrelations: [],
        dominanceWarnings: [],
        dominanceBlocked: false,
        limitations: [],
      },
      confidence: {
        contract: "",
        bootstrapIterations: 0,
        ciCoverage: 0.8,
        dominanceWidening: 1.5,
        globalDominanceApplied: false,
        entries: [],
        tieGroups: [],
        limitations: [],
      },
      eligibilityEntries: [],
      priorRows: fetched,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    // `insufficient_gap` takes precedence over `methodology_changed` because
    // gap < minGap is evaluated before the methodology status switch, so the
    // status stays `insufficient_gap` even though the methodology version
    // differs. `methodologyChanged` boolean still reflects the mismatch so
    // the page can surface the warning copy.
    expect(movers.status).toBe("insufficient_gap");
    expect(movers.priorSnapshot?.snapshotDate).toBe(currentSnapshotDate);
    expect(movers.priorSnapshot?.methodologyVersion).toBe(otherMethodology);
    expect(movers.priorSnapshotGapDays).toBe(0);
    expect(movers.methodologyChanged).toBe(true);
    expect(movers.risers).toHaveLength(0);
    expect(movers.fallers).toHaveLength(0);
  });

  it("still returns the strictly-older too-recent slice when no same-day slice exists (regression against the M19 fallback)", async () => {
    // Ensures the M20 `lte` fallback did not change the behaviour for the
    // M19 case (earlier-date too-recent slice with no same-day rows).
    const currentSnapshotDate = "2026-04-24";
    const olderTooRecentSlice = {
      snapshotDate: "2026-04-22",
      methodologyVersion: RANKING_METHODOLOGY_VERSION,
    };
    const priorRows = [persistedRow(1, { snapshotDate: "2026-04-22" })];
    const selectResults: unknown[] = [
      [],
      [],
      [olderTooRecentSlice],
      priorRows,
    ];
    vi.mocked(db.select).mockImplementation(
      () =>
        chainFor(selectResults.shift() ?? []) as unknown as ReturnType<
          typeof db.select
        >,
    );

    const rows = await fetchPriorSnapshotRowsForMovers({
      currentSnapshotDate,
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      minGapDays: RANKING_MOVERS_MIN_GAP_DAYS,
    });

    expect(rows).toHaveLength(priorRows.length);
    expect(rows[0]?.snapshotDate).toBe("2026-04-22");
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(4);
  });
});
