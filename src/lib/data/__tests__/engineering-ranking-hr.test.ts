import { describe, expect, it } from "vitest";
import {
  buildHrEvidencePack,
  classifyHrVerdict,
  formatOrdinal,
  HR_BOTTOM_N_DEFAULT,
  HR_FIRST_YEAR_DAYS,
  HR_MAX_CI_WIDTH,
  HR_MIN_PRESENT_METHODS,
  HR_SHORT_TENURE_DAYS,
  HR_SUSTAINED_PERCENTILE,
  type HrVerdictInputs,
} from "../engineering-ranking-hr";
import type {
  AttributionBundle,
  CompositeBundle,
  ConfidenceBundle,
  EligibilityEntry,
  EngineerAttribution,
  EngineerCompositeEntry,
  EngineerConfidence,
  EngineeringRankingSnapshot,
  MoversBundle,
  PerEngineerSignalRow,
} from "../engineering-ranking";

function verdictInputs(
  overrides: Partial<HrVerdictInputs> = {},
): HrVerdictInputs {
  return {
    cohortDominanceBlocked: false,
    hasPriorSnapshot: true,
    priorWasBottom15: true,
    tenureDays: 800,
    ciWidth: 10,
    presentMethodCount: 5,
    inTieGroupWithOutsideBottom: false,
    hasGithubLogin: true,
    hasImpactModelRow: true,
    qualityIsDominantNegative: false,
    ...overrides,
  };
}

describe("classifyHrVerdict", () => {
  it("returns insufficient_history when there is no prior snapshot", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ hasPriorSnapshot: false }),
    );
    expect(verdict).toBe("insufficient_history");
    expect(reason).toMatch(/no comparable prior snapshot/i);
  });

  it("returns activity_only when the cohort is dominance-blocked", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ cohortDominanceBlocked: true }),
    );
    expect(verdict).toBe("activity_only");
    expect(reason).toMatch(/dominance-blocked/i);
  });

  it("insufficient_history takes precedence over dominance-blocked", () => {
    const { verdict } = classifyHrVerdict(
      verdictInputs({
        hasPriorSnapshot: false,
        cohortDominanceBlocked: true,
      }),
    );
    expect(verdict).toBe("insufficient_history");
  });

  it("returns confounded when tenure is below the short-tenure threshold", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ tenureDays: HR_SHORT_TENURE_DAYS - 1 }),
    );
    expect(verdict).toBe("confounded");
    expect(reason).toMatch(/tenure .* below the/i);
  });

  it("returns confounded when CI width exceeds the defensibility ceiling", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ ciWidth: HR_MAX_CI_WIDTH + 0.1 }),
    );
    expect(verdict).toBe("confounded");
    expect(reason).toMatch(/confidence band width/i);
  });

  it("returns confounded when fewer than the minimum methods are present", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ presentMethodCount: HR_MIN_PRESENT_METHODS - 1 }),
    );
    expect(verdict).toBe("confounded");
    expect(reason).toMatch(/composite methods present/i);
  });

  it("returns confounded when tie-group includes a rank-neighbour outside the bottom decile", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ inTieGroupWithOutsideBottom: true }),
    );
    expect(verdict).toBe("confounded");
    expect(reason).toMatch(/statistical tie group/i);
  });

  it("returns confounded when there is no GitHub login", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ hasGithubLogin: false }),
    );
    expect(verdict).toBe("confounded");
    expect(reason).toMatch(/no github mapping/i);
  });

  it("returns confounded for first-year hires without an impact-model row", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({
        hasImpactModelRow: false,
        tenureDays: HR_FIRST_YEAR_DAYS - 1,
      }),
    );
    expect(verdict).toBe("confounded");
    expect(reason).toMatch(/first-year hire/i);
  });

  it("does not flag missing impact-model row alone beyond the first year", () => {
    // Tenured hire without an impact-model row is not a confounder on its
    // own — the SHAP lens is genuinely silent and we should still be able to
    // read a rank position against the remaining methods.
    const { verdict } = classifyHrVerdict(
      verdictInputs({
        hasImpactModelRow: false,
        tenureDays: HR_FIRST_YEAR_DAYS + 30,
      }),
    );
    expect(verdict).not.toBe("confounded");
  });

  it("returns single_cycle_only when prior rank was above bottom 15", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({ priorWasBottom15: false }),
    );
    expect(verdict).toBe("single_cycle_only");
    expect(reason).toMatch(/above the bottom 15th percentile/i);
  });

  it("returns quality_concern when prior bottom-15 and lens D dominates", () => {
    const { verdict, reason } = classifyHrVerdict(
      verdictInputs({
        priorWasBottom15: true,
        qualityIsDominantNegative: true,
      }),
    );
    expect(verdict).toBe("quality_concern");
    expect(reason).toMatch(/code-quality lens/i);
  });

  it("returns sustained_concern for prior bottom-15, clean confounders, non-quality drivers", () => {
    const { verdict, reason } = classifyHrVerdict(verdictInputs());
    expect(verdict).toBe("sustained_concern");
    expect(reason).toMatch(/calibration conversation/i);
  });

  it("confounded wins over quality_concern when both would apply", () => {
    const { verdict } = classifyHrVerdict(
      verdictInputs({
        tenureDays: 30,
        qualityIsDominantNegative: true,
      }),
    );
    expect(verdict).toBe("confounded");
  });

  it("activity_only wins over confounded when the cohort is dominance-blocked", () => {
    const { verdict } = classifyHrVerdict(
      verdictInputs({
        cohortDominanceBlocked: true,
        tenureDays: 30,
      }),
    );
    expect(verdict).toBe("activity_only");
  });
});

function eligibility(
  overrides: Partial<EligibilityEntry> = {},
): EligibilityEntry {
  return {
    emailHash: "hash-a",
    displayName: "Alex Engineer",
    email: "alex@meetcleo.com",
    githubLogin: "alex-eng",
    discipline: "BE",
    levelLabel: "EG3",
    squad: "Platform",
    pillar: "Engineering",
    canonicalSquad: null,
    manager: "Manager Name",
    startDate: "2023-01-01",
    tenureDays: 900,
    isLeaverOrInactive: false,
    hasImpactModelRow: true,
    eligibility: "competitive",
    reason: "",
    ...overrides,
  };
}

function compositeEntry(
  overrides: Partial<EngineerCompositeEntry> = {},
): EngineerCompositeEntry {
  return {
    emailHash: "hash-a",
    displayName: "Alex Engineer",
    discipline: "BE",
    levelLabel: "EG3",
    squad: "Platform",
    pillar: "Engineering",
    output: 12,
    impact: 18,
    delivery: 25,
    quality: 22,
    adjusted: 14,
    presentMethodCount: 5,
    composite: 18,
    compositePercentile: 18,
    rank: 10,
    methodsSummary: "median of 5 methods",
    ...overrides,
  };
}

function attribution(
  overrides: Partial<EngineerAttribution> = {},
): EngineerAttribution {
  return {
    emailHash: "hash-a",
    displayName: "Alex Engineer",
    discipline: "BE",
    levelLabel: "EG3",
    eligibility: "competitive",
    rank: 10,
    compositeScore: 18,
    compositePercentile: 18,
    presentMethodCount: 5,
    methods: [
      {
        method: "output",
        label: "A — Individual output",
        score: 12,
        present: true,
        presentReason: "",
        components: [],
      },
      {
        method: "impact",
        label: "B — SHAP impact",
        score: 18,
        present: true,
        presentReason: "",
        components: [],
      },
      {
        method: "delivery",
        label: "C — Squad delivery context",
        score: 25,
        present: true,
        presentReason: "",
        components: [],
      },
      {
        method: "quality",
        label: "D — Code quality (per-PR rubric)",
        score: 22,
        present: true,
        presentReason: "",
        components: [],
      },
      {
        method: "adjusted",
        label: "Tenure/role-adjusted percentile",
        score: 14,
        present: true,
        presentReason: "",
        components: [],
      },
    ],
    topPositiveDrivers: [],
    topNegativeDrivers: [],
    absentSignals: [],
    reconciliation: {
      methodScores: [],
      recomputedComposite: 18,
      delta: 0,
      matches: true,
    },
    peerComparison: {
      discipline: "BE",
      disciplineCohort: null,
      rawPercentile: 18,
      adjustedPercentile: 14,
      adjustmentLift: -4,
    },
    evidence: {
      githubLogin: "alex-eng",
      githubPrSearchUrl: "https://github.com/search?q=pr",
      impactModelPresent: true,
      squadContextPresent: true,
      notes: [],
    },
    context: {
      manager: "Manager Name",
      rawSquad: "Platform",
      pillar: "Engineering",
      canonicalSquad: null,
      directReportCount: 0,
      directReportHashes: [],
    },
    calibration: {
      status: "not_requested",
      note: "",
      managerEmailHash: null,
    },
    ...overrides,
  };
}

function confidenceEntry(
  overrides: Partial<EngineerConfidence> = {},
): EngineerConfidence {
  return {
    emailHash: "hash-a",
    displayName: "Alex Engineer",
    rank: 10,
    composite: 18,
    sigma: 4,
    ciLow: 12,
    ciHigh: 24,
    ciWidth: 12,
    ciRankLow: 9,
    ciRankHigh: 11,
    uncertaintyFactors: [],
    inTieGroup: false,
    tieGroupId: null,
    ...overrides,
  };
}

function emptyBundles(): {
  composite: CompositeBundle;
  confidence: ConfidenceBundle;
  attribution: AttributionBundle;
  movers: MoversBundle;
} {
  const composite: CompositeBundle = {
    contract: "",
    methods: ["output", "impact", "delivery", "quality", "adjusted"],
    minPresentMethods: 2,
    maxSingleSignalEffectiveWeight: 0.3,
    dominanceCorrelationThreshold: 0.95,
    entries: [],
    ranked: [],
    effectiveSignalWeights: [],
    leaveOneOut: [],
    finalRankCorrelations: [],
    dominanceWarnings: [],
    dominanceBlocked: false,
    limitations: [],
  };
  const confidence: ConfidenceBundle = {
    contract: "",
    bootstrapIterations: 0,
    ciCoverage: 0.8,
    dominanceWidening: 1.5,
    globalDominanceApplied: false,
    entries: [],
    tieGroups: [],
    limitations: [],
  };
  const attribution: AttributionBundle = {
    contract: "",
    tolerance: 0.05,
    totalMethods: 5,
    entries: [],
    limitations: [],
  };
  const movers: MoversBundle = {
    status: "ok",
    contract: "",
    currentSnapshot: { snapshotDate: "2026-04-24", methodologyVersion: "1.0.0-methodology" },
    priorSnapshot: { snapshotDate: "2026-01-24", methodologyVersion: "1.0.0-methodology" },
    priorSnapshotGapDays: 90,
    minGapDays: 30,
    topN: 10,
    methodologyChanged: false,
    risers: [],
    fallers: [],
    newEntrants: [],
    cohortExits: [],
    notes: [],
    limitations: [],
  };
  return { composite, confidence, attribution, movers };
}

/**
 * Build a minimal `EngineeringRankingSnapshot` fixture. Only the bundles the
 * HR pack actually reads (`composite`, `confidence`, `attribution`, `movers`,
 * `eligibility`) are populated from real types; everything else is stubbed
 * because the HR pack never touches it — this keeps the fixture resilient to
 * shape changes in unrelated bundles.
 */
function baseSnapshot(): EngineeringRankingSnapshot {
  const { composite, confidence, attribution, movers } = emptyBundles();
  const stub = {
    status: "methodology_pending" as const,
    methodologyVersion: "1.0.0-methodology",
    generatedAt: "2026-04-24T00:00:00Z",
    signalWindow: { start: "2025-10-25", end: "2026-04-24" },
    engineers: [],
    eligibility: {
      entries: [],
      coverage: {
        totalEngineers: 0,
        competitive: 0,
        rampUp: 0,
        insufficientMapping: 0,
        inactiveOrLeaver: 0,
        missingRequiredData: 0,
        mappedToGitHub: 0,
        presentInImpactModel: 0,
        excludedFutureStart: 0,
        squadRegistryUnmatched: 0,
        rampUpThresholdDays: 90,
        squadsRegistryPresent: false,
        nonRankableRole: 0,
      },
      sourceNotes: [],
    },
    audit: undefined,
    lenses: undefined,
    normalisation: undefined,
    composite,
    confidence,
    attribution,
    movers,
    stability: undefined,
    methodology: undefined,
    knownLimitations: [],
    plannedSignals: [],
  };
  return stub as unknown as EngineeringRankingSnapshot;
}

describe("buildHrEvidencePack", () => {
  it("returns an empty pack with cohort notes when no engineers are scored", () => {
    const snapshot = baseSnapshot();
    const pack = buildHrEvidencePack(snapshot);
    expect(pack.engineers).toEqual([]);
    expect(pack.bottomN).toBe(HR_BOTTOM_N_DEFAULT);
    expect(pack.totalScored).toBe(0);
    expect(pack.cohortNotes.some((n) => n.includes("empty by construction"))).toBe(true);
    expect(pack.verdictCounts).toEqual({
      insufficient_history: 0,
      activity_only: 0,
      confounded: 0,
      quality_concern: 0,
      sustained_concern: 0,
      single_cycle_only: 0,
    });
  });

  it("surfaces a dominance-blocked cohort note when cohort is blocked", () => {
    const snapshot = baseSnapshot();
    snapshot.composite.dominanceBlocked = true;
    const pack = buildHrEvidencePack(snapshot);
    expect(pack.cohortDominanceBlocked).toBe(true);
    expect(
      pack.cohortNotes.some((n) => n.toLowerCase().includes("dominance-blocked")),
    ).toBe(true);
  });

  it("tags every engineer activity_only when cohort is dominance-blocked", () => {
    const snapshot = baseSnapshot();
    snapshot.composite.dominanceBlocked = true;

    // One competitive engineer who would otherwise be sustained_concern.
    const hash = "hash-a";
    const elig = eligibility({ emailHash: hash });
    const compEntry = compositeEntry({ emailHash: hash, rank: 1 });
    const attr = attribution({ emailHash: hash });
    const conf = confidenceEntry({ emailHash: hash });

    snapshot.eligibility.entries = [elig];
    snapshot.composite.entries = [compEntry];
    snapshot.composite.ranked = [compEntry];
    snapshot.attribution.entries = [attr];
    snapshot.confidence.entries = [conf];
    snapshot.movers.fallers = [
      {
        emailHash: hash,
        displayName: elig.displayName,
        priorRank: 1,
        currentRank: 1,
        rankDelta: 0,
        priorCompositePercentile: 10,
        currentCompositePercentile: 18,
        percentileDelta: 8,
        priorConfidenceWidth: 12,
        currentConfidenceWidth: 12,
        confidenceWidthDelta: 0,
        category: "faller",
        causeKind: "ambiguous_context",
        likelyCause: "Ambiguous",
        inputHashChanged: null,
        methodologyChanged: false,
      },
    ];

    const pack = buildHrEvidencePack(snapshot);
    expect(pack.engineers).toHaveLength(1);
    expect(pack.engineers[0].verdict).toBe("activity_only");
  });

  it("orders engineers lowest-rank first and handles fewer than bottomN scored", () => {
    const snapshot = baseSnapshot();
    const mk = (i: number) => {
      const h = `hash-${i}`;
      const elig = eligibility({ emailHash: h, email: `eng${i}@meetcleo.com`, displayName: `Eng ${i}` });
      const comp = compositeEntry({
        emailHash: h,
        displayName: `Eng ${i}`,
        rank: i,
        composite: 50 - i,
        compositePercentile: 50 - i,
      });
      const attr = attribution({ emailHash: h, displayName: `Eng ${i}`, rank: i });
      const conf = confidenceEntry({ emailHash: h, rank: i });
      return { elig, comp, attr, conf };
    };
    const ranks = [1, 2, 3];
    const all = ranks.map(mk);
    snapshot.eligibility.entries = all.map((x) => x.elig);
    snapshot.composite.entries = all.map((x) => x.comp);
    snapshot.composite.ranked = all.map((x) => x.comp);
    snapshot.attribution.entries = all.map((x) => x.attr);
    snapshot.confidence.entries = all.map((x) => x.conf);

    const pack = buildHrEvidencePack(snapshot, { bottomN: 10 });
    expect(pack.engineers).toHaveLength(3);
    // Lowest-rank first — rank 3 is the bottom-most, so displayed first.
    expect(pack.engineers.map((e) => e.rank)).toEqual([3, 2, 1]);
    expect(pack.totalScored).toBe(3);
  });

  it("slices to the configured bottomN", () => {
    const snapshot = baseSnapshot();
    const mk = (i: number) => {
      const h = `hash-${i}`;
      const elig = eligibility({ emailHash: h, email: `eng${i}@meetcleo.com`, displayName: `Eng ${i}` });
      const comp = compositeEntry({
        emailHash: h,
        displayName: `Eng ${i}`,
        rank: i,
        composite: 100 - i,
        compositePercentile: 100 - i,
      });
      const attr = attribution({ emailHash: h, displayName: `Eng ${i}`, rank: i });
      const conf = confidenceEntry({ emailHash: h, rank: i });
      return { elig, comp, attr, conf };
    };
    const ranks = Array.from({ length: 20 }, (_, idx) => idx + 1);
    const all = ranks.map(mk);
    snapshot.eligibility.entries = all.map((x) => x.elig);
    snapshot.composite.entries = all.map((x) => x.comp);
    snapshot.composite.ranked = all.map((x) => x.comp);
    snapshot.attribution.entries = all.map((x) => x.attr);
    snapshot.confidence.entries = all.map((x) => x.conf);

    const pack = buildHrEvidencePack(snapshot, { bottomN: 5 });
    expect(pack.engineers).toHaveLength(5);
    expect(pack.engineers.map((e) => e.rank)).toEqual([20, 19, 18, 17, 16]);
  });

  it("verdict counts sum to engineers.length", () => {
    const snapshot = baseSnapshot();
    const h = "hash-a";
    snapshot.eligibility.entries = [eligibility({ emailHash: h })];
    const comp = compositeEntry({ emailHash: h, rank: 1 });
    snapshot.composite.entries = [comp];
    snapshot.composite.ranked = [comp];
    snapshot.attribution.entries = [attribution({ emailHash: h })];
    snapshot.confidence.entries = [confidenceEntry({ emailHash: h })];

    const pack = buildHrEvidencePack(snapshot);
    const total = Object.values(pack.verdictCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(pack.engineers.length);
  });

  it("emits insufficient_history when movers.status is not ok", () => {
    const snapshot = baseSnapshot();
    snapshot.movers.status = "no_prior_snapshot";
    snapshot.movers.priorSnapshot = null;
    snapshot.movers.priorSnapshotGapDays = null;

    const h = "hash-a";
    snapshot.eligibility.entries = [eligibility({ emailHash: h })];
    const comp = compositeEntry({ emailHash: h, rank: 1 });
    snapshot.composite.entries = [comp];
    snapshot.composite.ranked = [comp];
    snapshot.attribution.entries = [attribution({ emailHash: h })];
    snapshot.confidence.entries = [confidenceEntry({ emailHash: h })];

    const pack = buildHrEvidencePack(snapshot);
    expect(pack.engineers).toHaveLength(1);
    expect(pack.engineers[0].verdict).toBe("insufficient_history");
    expect(pack.verdictCounts.insufficient_history).toBe(1);
    expect(
      pack.cohortNotes.some((n) => n.toLowerCase().includes("no comparable prior snapshot")),
    ).toBe(true);
  });

  it("pulls prior rank + narrative through into historical block", () => {
    const snapshot = baseSnapshot();
    const h = "hash-a";
    snapshot.eligibility.entries = [eligibility({ emailHash: h })];
    const comp = compositeEntry({ emailHash: h, rank: 1 });
    snapshot.composite.entries = [comp];
    snapshot.composite.ranked = [comp];
    snapshot.attribution.entries = [attribution({ emailHash: h })];
    snapshot.confidence.entries = [confidenceEntry({ emailHash: h })];
    snapshot.movers.fallers = [
      {
        emailHash: h,
        displayName: "Alex Engineer",
        priorRank: 3,
        currentRank: 1,
        rankDelta: -2,
        priorCompositePercentile: 10,
        currentCompositePercentile: 18,
        percentileDelta: 8,
        priorConfidenceWidth: 12,
        currentConfidenceWidth: 12,
        confidenceWidthDelta: 0,
        category: "faller",
        causeKind: "input_drift",
        likelyCause: "Inputs drifted.",
        inputHashChanged: true,
        methodologyChanged: false,
      },
    ];

    const pack = buildHrEvidencePack(snapshot);
    const historical = pack.engineers[0].historical;
    expect(historical.hasPriorSnapshot).toBe(true);
    expect(historical.priorRank).toBe(3);
    expect(historical.priorCompositePercentile).toBe(10);
    expect(historical.priorWasBottom15).toBe(true);
    expect(historical.moverCauseKind).toBe("input_drift");
    expect(historical.priorSnapshotDate).toBe("2026-01-24");
  });

  it("emits HR_SUSTAINED_PERCENTILE = 15 as the sustained-low threshold", () => {
    // Lock the documented threshold so a silent change is visible in the
    // diff — tribunal defensibility depends on this number matching the pack
    // spec referenced elsewhere.
    expect(HR_SUSTAINED_PERCENTILE).toBe(15);
  });
});

function signalRow(
  overrides: Partial<PerEngineerSignalRow> = {},
): PerEngineerSignalRow {
  return {
    emailHash: "hash-a",
    prCount: null,
    commitCount: null,
    additions: null,
    deletions: null,
    shapPredicted: null,
    shapActual: null,
    shapResidual: null,
    aiTokens: null,
    aiSpend: null,
    squadCycleTimeHours: null,
    squadReviewRatePercent: null,
    squadTimeToFirstReviewHours: null,
    squadPrsInProgress: null,
    ...overrides,
  };
}

describe("buildHrEvidencePack contrast rows", () => {
  function buildContrastScenario() {
    // 10 competitive engineers on rank 1..10 (rank 1 is top).
    // Rank 10 is the HR candidate — 4 PRs in the window vs cohort median ~23
    // and top-decile (rank 1) of 60 PRs.
    const snapshot = baseSnapshot();
    const prCounts = [60, 50, 45, 40, 35, 30, 25, 18, 10, 4];
    const commitCounts = [120, 100, 90, 80, 70, 60, 50, 40, 20, 8];
    const additions = [5000, 4000, 3800, 3500, 3000, 2500, 2000, 1500, 800, 200];
    const deletions = [1000, 800, 750, 700, 600, 500, 400, 300, 200, 50];

    const eligEntries = prCounts.map((_, idx) => {
      const i = idx + 1;
      return eligibility({
        emailHash: `hash-${i}`,
        email: `eng${i}@meetcleo.com`,
        displayName: `Eng ${i}`,
        githubLogin: `eng${i}`,
        discipline: "BE",
      });
    });
    const compositeEntries = prCounts.map((_, idx) => {
      const i = idx + 1;
      return compositeEntry({
        emailHash: `hash-${i}`,
        displayName: `Eng ${i}`,
        rank: i,
        composite: 100 - i * 5,
        compositePercentile: 100 - i * 5,
      });
    });
    const attributionEntries = prCounts.map((_, idx) => {
      const i = idx + 1;
      return attribution({
        emailHash: `hash-${i}`,
        displayName: `Eng ${i}`,
        rank: i,
      });
    });
    const confidenceEntries = prCounts.map((_, idx) => {
      const i = idx + 1;
      return confidenceEntry({ emailHash: `hash-${i}`, rank: i });
    });
    const signals = prCounts.map((pr, idx) => {
      const i = idx + 1;
      return signalRow({
        emailHash: `hash-${i}`,
        prCount: pr,
        commitCount: commitCounts[idx],
        additions: additions[idx],
        deletions: deletions[idx],
      });
    });

    snapshot.eligibility.entries = eligEntries;
    snapshot.composite.entries = compositeEntries;
    snapshot.composite.ranked = compositeEntries;
    snapshot.attribution.entries = attributionEntries;
    snapshot.confidence.entries = confidenceEntries;
    // Populate movers so the bottom engineer has a prior snapshot that also
    // puts them in the bottom — so the verdict doesn't short-circuit to
    // insufficient_history.
    snapshot.movers.fallers = eligEntries.map((e, idx) => {
      const i = idx + 1;
      return {
        emailHash: e.emailHash,
        displayName: e.displayName,
        priorRank: i,
        currentRank: i,
        rankDelta: 0,
        priorCompositePercentile: 100 - i * 5,
        currentCompositePercentile: 100 - i * 5,
        percentileDelta: 0,
        priorConfidenceWidth: 12,
        currentConfidenceWidth: 12,
        confidenceWidthDelta: 0,
        category: "faller" as const,
        causeKind: "ambiguous_context" as const,
        likelyCause: "Stable",
        inputHashChanged: null,
        methodologyChanged: false,
      };
    });

    return { snapshot, signals };
  }

  it("builds cohort stats + per-engineer contrast rows from the signal array", () => {
    const { snapshot, signals } = buildContrastScenario();
    const pack = buildHrEvidencePack(snapshot, { bottomN: 1, signals });

    expect(pack.engineers).toHaveLength(1);
    const eng = pack.engineers[0];
    expect(eng.rank).toBe(10);
    expect(eng.contrasts.length).toBeGreaterThan(0);

    const prRow = eng.contrasts.find((c) => c.signal === "pr_count");
    expect(prRow).toBeDefined();
    expect(prRow!.engineerValue).toBe(4);
    expect(prRow!.cohort.cohortSize).toBe(10);
    // Median of [4,10,18,25,30,35,40,45,50,60] = (30+35)/2 = 32.5
    expect(prRow!.cohort.median).toBeCloseTo(32.5, 5);
    // Top-decile mean with n=10, top-decile count = ceil(10*0.1) = 1, so just 60.
    expect(prRow!.cohort.topDecileMean).toBeCloseTo(60, 5);
    // Engineer's PR count is 4, median 32.5 → fractionOfMedian = 4/32.5 ≈ 0.1231
    expect(prRow!.fractionOfMedian).toBeCloseTo(4 / 32.5, 3);
    // 4 / 60 ≈ 0.067
    expect(prRow!.fractionOfTopDecile).toBeCloseTo(4 / 60, 3);
  });

  it("summarises breadth of the gap in a scannable headline + highlights", () => {
    const { snapshot, signals } = buildContrastScenario();
    const pack = buildHrEvidencePack(snapshot, { bottomN: 1, signals });
    const eng = pack.engineers[0];
    // Structured summary, not a prose paragraph.
    expect(eng.contrastSummary.totalSignals).toBeGreaterThan(0);
    expect(eng.contrastSummary.belowMedianCount).toBeGreaterThan(0);
    expect(eng.contrastSummary.bottomDecileCount).toBeGreaterThan(0);
    // Headline should name the breadth of the gap.
    expect(eng.contrastSummary.headline.toLowerCase()).toContain(
      "below cohort median",
    );
    // Highlights list the most severe signals first.
    expect(eng.contrastSummary.highlights.length).toBeGreaterThan(0);
    const first = eng.contrastSummary.highlights[0];
    expect(first.label.length).toBeGreaterThan(0);
    // Ordinals render correctly — never "1th".
    if (first.percentileOrdinalDisplay) {
      expect(first.percentileOrdinalDisplay).not.toMatch(/\d+th\b.*(1|2|3)th/);
      expect(first.percentileOrdinalDisplay).not.toBe("1th percentile");
    }
  });

  it("drops signals whose cohort is below the minCohortSize", () => {
    const snapshot = baseSnapshot();
    // Only 3 signal rows — well below the PR count minCohortSize of 5.
    const threeRanks = [1, 2, 3];
    const eligEntries = threeRanks.map((i) =>
      eligibility({ emailHash: `hash-${i}`, email: `e${i}@x.com`, displayName: `E${i}` }),
    );
    const compEntries = threeRanks.map((i) =>
      compositeEntry({ emailHash: `hash-${i}`, rank: i, composite: 100 - i * 10 }),
    );
    snapshot.eligibility.entries = eligEntries;
    snapshot.composite.entries = compEntries;
    snapshot.composite.ranked = compEntries;
    snapshot.attribution.entries = threeRanks.map((i) =>
      attribution({ emailHash: `hash-${i}`, rank: i }),
    );
    snapshot.confidence.entries = threeRanks.map((i) =>
      confidenceEntry({ emailHash: `hash-${i}`, rank: i }),
    );
    const signals = threeRanks.map((i) =>
      signalRow({ emailHash: `hash-${i}`, prCount: i * 10 }),
    );
    const pack = buildHrEvidencePack(snapshot, { bottomN: 1, signals });
    const eng = pack.engineers[0];
    expect(eng.contrasts).toEqual([]);
    expect(eng.contrastSummary.totalSignals).toBe(0);
    expect(eng.contrastSummary.headline.toLowerCase()).toContain("too small");
    expect(eng.contrastSummary.highlights).toEqual([]);
  });

  it("uses competitive engineers only for the cohort (excludes ramp-up / leavers)", () => {
    const { snapshot, signals } = buildContrastScenario();
    // Mark rank 1 (the highest performer) as ramp-up — they should NOT
    // feed the cohort median any more, pushing the median DOWN.
    snapshot.eligibility.entries = snapshot.eligibility.entries.map((e) =>
      e.emailHash === "hash-1"
        ? { ...e, eligibility: "ramp_up" as const }
        : e,
    );
    const pack = buildHrEvidencePack(snapshot, { bottomN: 1, signals });
    const prRow = pack.engineers[0].contrasts.find((c) => c.signal === "pr_count");
    // Now cohort size drops from 10 to 9; top-decile count = ceil(9*0.1) = 1
    // → top-decile mean = 50 (rank 2's PR count), not 60.
    expect(prRow!.cohort.cohortSize).toBe(9);
    expect(prRow!.cohort.topDecileMean).toBeCloseTo(50, 5);
  });
});

describe("formatOrdinal", () => {
  it("handles single digits correctly", () => {
    expect(formatOrdinal(1)).toBe("1st");
    expect(formatOrdinal(2)).toBe("2nd");
    expect(formatOrdinal(3)).toBe("3rd");
    expect(formatOrdinal(4)).toBe("4th");
    expect(formatOrdinal(5)).toBe("5th");
    expect(formatOrdinal(0)).toBe("0th");
  });

  it("handles teens as th (11th/12th/13th, not 11st/12nd/13rd)", () => {
    expect(formatOrdinal(11)).toBe("11th");
    expect(formatOrdinal(12)).toBe("12th");
    expect(formatOrdinal(13)).toBe("13th");
  });

  it("handles higher numbers with the right suffix", () => {
    expect(formatOrdinal(21)).toBe("21st");
    expect(formatOrdinal(22)).toBe("22nd");
    expect(formatOrdinal(23)).toBe("23rd");
    expect(formatOrdinal(100)).toBe("100th");
    expect(formatOrdinal(101)).toBe("101st");
    expect(formatOrdinal(111)).toBe("111th");
  });

  it("rounds floats before suffixing", () => {
    expect(formatOrdinal(1.4)).toBe("1st");
    expect(formatOrdinal(2.6)).toBe("3rd");
  });
});

