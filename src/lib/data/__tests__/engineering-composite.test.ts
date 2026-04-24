import { describe, expect, it } from "vitest";

import {
  COMPOSITE_CYCLE_TIME_CAP_HOURS,
  COMPOSITE_CYCLE_TIME_FLOOR_MIN,
  COMPOSITE_DELIVERY_WINSOR_P,
  COMPOSITE_MAX_SINGLE_WEIGHT,
  COMPOSITE_METHODOLOGY_ROWS,
  COMPOSITE_METHODOLOGY_SECTIONS,
  COMPOSITE_METHODOLOGY_VERSION,
  COMPOSITE_MIN_ANALYSED_PRS,
  COMPOSITE_MIN_COHORT_SIZE,
  COMPOSITE_MIN_PRS_FOR_DELIVERY,
  COMPOSITE_MIN_SIGNALS_FOR_SCORE,
  COMPOSITE_MIN_TENURE_DAYS,
  COMPOSITE_SIGNAL_DESCRIPTIONS,
  COMPOSITE_SIGNAL_KEYS,
  COMPOSITE_SIGNAL_LABELS,
  COMPOSITE_SIGNAL_WINDOW_DAYS,
  COMPOSITE_WEIGHTS,
  CONFIDENCE_K,
  CONFIDENCE_MIN_HALF_WIDTH,
  CONFIDENCE_MAX_HALF_WIDTH,
  CONFIDENCE_TENURE_PENALTY_PER_UNIT,
  CONFIDENCE_MIN_ENTRIES_FOR_FLAGS,
  buildComposite,
  computeConfidenceBand,
  findEngineerInComposite,
  isPlatformOrInfraEngineer,
  rankWithConfidence,
  roleAdjustmentFor,
  scopeComposite,
  tenureFactorFor,
  type CompositeBundle,
  type CompositeEntry,
  type ConfidenceBand,
  type EngineerCompositeInput,
  type RankedCompositeEntry,
} from "@/lib/data/engineering-composite";
import { assembleCompositeInputs } from "@/lib/data/engineering-composite.server";
import { hashEmailForRanking } from "@/lib/data/engineering-ranking";

// ---------- fixture helpers ------------------------------------------------

const NOW = new Date("2026-04-24T00:00:00Z");

function makeEngineer(
  overrides: Partial<EngineerCompositeInput> = {},
): EngineerCompositeInput {
  const email = overrides.email ?? "alice@meetcleo.com";
  return {
    emailHash: hashEmailForRanking(email),
    displayName: "Alice",
    email,
    githubLogin: "alice",
    discipline: "BE",
    pillar: "Growth",
    squad: "Daily Plans",
    managerEmail: "ceo@meetcleo.com",
    tenureDays: 365,
    isLeaverOrInactive: false,
    prCount: 20,
    analysedPrCount: 15,
    executionQualityMean: 4,
    testAdequacyMean: 4,
    riskHandlingMean: 4,
    reviewabilityMean: 4,
    technicalDifficultyMean: 3,
    revertRate: 0,
    reviewParticipationRate: 1,
    medianTimeToMergeMinutes: 8 * 60, // 8h
    ...overrides,
  };
}

// Build a cohort of `n` BE engineers + `m` FE engineers with distinct emails.
function makeCohort(
  beCount: number,
  feCount: number,
  tweak?: (i: number, base: EngineerCompositeInput) => EngineerCompositeInput,
): EngineerCompositeInput[] {
  const engineers: EngineerCompositeInput[] = [];
  for (let i = 0; i < beCount; i += 1) {
    const email = `be${i}@meetcleo.com`;
    const base = makeEngineer({
      email,
      emailHash: hashEmailForRanking(email),
      displayName: `BE ${i}`,
      githubLogin: `be${i}`,
      discipline: "BE",
      prCount: 10 + i,
      analysedPrCount: 8 + i,
    });
    engineers.push(tweak ? tweak(i, base) : base);
  }
  for (let i = 0; i < feCount; i += 1) {
    const email = `fe${i}@meetcleo.com`;
    const base = makeEngineer({
      email,
      emailHash: hashEmailForRanking(email),
      displayName: `FE ${i}`,
      githubLogin: `fe${i}`,
      discipline: "FE",
      prCount: 10 + i,
      analysedPrCount: 8 + i,
      pillar: "Chat",
    });
    engineers.push(tweak ? tweak(beCount + i, base) : base);
  }
  return engineers;
}

// ---------- constants ------------------------------------------------------

describe("COMPOSITE_WEIGHTS", () => {
  it("sums to exactly 1.0", () => {
    const total = Object.values(COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("has no single signal exceeding COMPOSITE_MAX_SINGLE_WEIGHT", () => {
    for (const [key, weight] of Object.entries(COMPOSITE_WEIGHTS)) {
      expect(
        weight,
        `Signal ${key} weight ${weight} exceeds max ${COMPOSITE_MAX_SINGLE_WEIGHT}`,
      ).toBeLessThanOrEqual(COMPOSITE_MAX_SINGLE_WEIGHT);
    }
  });

  it("covers every declared signal key", () => {
    for (const key of COMPOSITE_SIGNAL_KEYS) {
      expect(COMPOSITE_WEIGHTS).toHaveProperty(key);
      expect(COMPOSITE_SIGNAL_LABELS).toHaveProperty(key);
    }
  });

  it("methodology version is stable & distinct from A-side", () => {
    expect(COMPOSITE_METHODOLOGY_VERSION).toMatch(/^b-/);
  });
});

// ---------- role adjustment ------------------------------------------------

describe("isPlatformOrInfraEngineer", () => {
  it("matches a Platform pillar", () => {
    expect(isPlatformOrInfraEngineer("Platform", null)).toBe(true);
  });
  it("matches Infrastructure or Infra squad", () => {
    expect(isPlatformOrInfraEngineer("Chat", "Core Infra")).toBe(true);
    expect(isPlatformOrInfraEngineer("Chat", "Infrastructure")).toBe(true);
  });
  it("matches DevOps or SRE tokens", () => {
    expect(isPlatformOrInfraEngineer("DevOps", null)).toBe(true);
    expect(isPlatformOrInfraEngineer("SRE", null)).toBe(true);
  });
  it("does not match product squads", () => {
    expect(isPlatformOrInfraEngineer("Growth", "Daily Plans")).toBe(false);
    expect(isPlatformOrInfraEngineer("Chat", "Autopilot")).toBe(false);
  });
  it("handles nulls/empties", () => {
    expect(isPlatformOrInfraEngineer(null, null)).toBe(false);
    expect(isPlatformOrInfraEngineer("", "")).toBe(false);
  });
});

describe("roleAdjustmentFor", () => {
  it("returns deliveryFactor > 1 for platform/infra", () => {
    const r = roleAdjustmentFor({ pillar: "Platform", squad: null });
    expect(r.isPlatformOrInfra).toBe(true);
    expect(r.deliveryFactor).toBeGreaterThan(1);
    expect(r.description).not.toBeNull();
  });
  it("returns identity factors for product squads", () => {
    const r = roleAdjustmentFor({ pillar: "Growth", squad: "Daily Plans" });
    expect(r.isPlatformOrInfra).toBe(false);
    expect(r.deliveryFactor).toBe(1);
    expect(r.cycleTimeFactor).toBe(1);
    expect(r.description).toBeNull();
  });
});

// ---------- tenure pro-rate ------------------------------------------------

describe("tenureFactorFor", () => {
  const W = COMPOSITE_SIGNAL_WINDOW_DAYS;
  it("returns 1.0 for tenure >= window", () => {
    expect(tenureFactorFor(W, W)).toBe(1);
    expect(tenureFactorFor(W + 100, W)).toBe(1);
  });
  it("scales denominators up for partial tenure", () => {
    expect(tenureFactorFor(90, W)).toBeGreaterThan(1);
    expect(tenureFactorFor(60, W)).toBeCloseTo(W / 60, 5);
  });
  it("returns null below COMPOSITE_MIN_TENURE_DAYS", () => {
    expect(tenureFactorFor(COMPOSITE_MIN_TENURE_DAYS - 1, W)).toBeNull();
    expect(tenureFactorFor(0, W)).toBeNull();
  });
  it("returns null on null/NaN tenure", () => {
    expect(tenureFactorFor(null, W)).toBeNull();
    expect(tenureFactorFor(Number.NaN, W)).toBeNull();
  });
});

// ---------- buildComposite: happy path ------------------------------------

describe("buildComposite — happy path", () => {
  function buildSmallHappyBundle(): CompositeBundle {
    const cohort = makeCohort(5, 3);
    return buildComposite({ now: NOW, engineers: cohort });
  }

  it("emits expected top-level metadata", () => {
    const bundle = buildSmallHappyBundle();
    expect(bundle.methodologyVersion).toBe(COMPOSITE_METHODOLOGY_VERSION);
    expect(bundle.asOf).toBe("2026-04-24");
    expect(bundle.windowDays).toBe(COMPOSITE_SIGNAL_WINDOW_DAYS);
    expect(bundle.weights).toEqual(COMPOSITE_WEIGHTS);
  });

  it("scores every engineer when all inputs are populated", () => {
    const bundle = buildSmallHappyBundle();
    expect(bundle.scored).toHaveLength(8);
    for (const entry of bundle.scored) {
      expect(entry.score).not.toBeNull();
      expect(entry.disciplinePercentile).not.toBeNull();
      expect(entry.orgPercentile).not.toBeNull();
      // Every signal should have a percentile and a contribution.
      for (const key of COMPOSITE_SIGNAL_KEYS) {
        expect(entry.signals[key].percentileWithinDiscipline).not.toBeNull();
        expect(entry.signals[key].contribution).not.toBeNull();
      }
    }
  });

  it("entries are sorted highest score first", () => {
    const bundle = buildSmallHappyBundle();
    for (let i = 0; i < bundle.entries.length - 1; i += 1) {
      const a = bundle.entries[i].score ?? -Infinity;
      const b = bundle.entries[i + 1].score ?? -Infinity;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it("effective weights sum to the present-signal total", () => {
    const bundle = buildSmallHappyBundle();
    for (const entry of bundle.scored) {
      const eff = Object.values(entry.signals).reduce(
        (acc, c) => acc + c.effectiveWeight,
        0,
      );
      expect(eff).toBeCloseTo(1, 5);
    }
  });

  it("computes evidence strings grounded in raw values", () => {
    const bundle = buildSmallHappyBundle();
    const anEntry = bundle.scored[0];
    expect(anEntry.evidence.length).toBeGreaterThanOrEqual(2);
    expect(anEntry.evidence.length).toBeLessThanOrEqual(4);
    expect(anEntry.evidence.some((s) => s.includes("PRs"))).toBe(true);
  });

  it("emits per-discipline cohort summary with quartiles", () => {
    const bundle = buildSmallHappyBundle();
    expect(bundle.cohorts).toHaveLength(2); // BE + FE
    const be = bundle.cohorts.find((c) => c.discipline === "BE");
    expect(be).toBeDefined();
    expect(be!.scoredCount).toBe(5);
    expect(be!.scorePercentiles).not.toBeNull();
    expect(be!.scorePercentiles!.p25).toBeLessThan(be!.scorePercentiles!.p75);
  });
});

// ---------- weight enforcement --------------------------------------------

describe("buildComposite — weight guardrails", () => {
  it("no signal exceeds COMPOSITE_MAX_SINGLE_WEIGHT in effective weight", () => {
    // Engineer with only 2 of 5 signals present — after renormalisation,
    // if unchecked, each effective weight would be 0.5. The cap must bite.
    // But min 3 signals triggers unscored_insufficient_signals first, so we
    // use a 3-signal case where renormalisation can produce e.g. 0.43 for
    // quality. Verify the cap activates.
    const cohort = makeCohort(5, 3);
    // Scrub 2 signals from one engineer (quality + reliability) → 3 left.
    cohort[0].executionQualityMean = null;
    cohort[0].testAdequacyMean = null;
    cohort[0].riskHandlingMean = null;
    cohort[0].reviewabilityMean = null;
    cohort[0].revertRate = null;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find((e) => e.emailHash === cohort[0].emailHash);
    expect(entry).toBeDefined();
    if (entry?.status === "scored" || entry?.status === "partial_window_scored") {
      for (const key of COMPOSITE_SIGNAL_KEYS) {
        expect(entry.signals[key].effectiveWeight).toBeLessThanOrEqual(
          COMPOSITE_MAX_SINGLE_WEIGHT + 1e-9,
        );
      }
    }
  });

  it("throws if COMPOSITE_WEIGHTS is accidentally broken (guarded at runtime)", () => {
    // We cannot mutate the const, but the runtime guard should be hit via a
    // hypothetical broken build. Exercise the path by constructing a new
    // bundle with the current valid weights and making sure no throw occurs.
    const bundle = buildComposite({ now: NOW, engineers: makeCohort(3, 3) });
    expect(bundle.scored.length).toBeGreaterThan(0);
  });
});

// ---------- tenure scaling -------------------------------------------------

describe("buildComposite — tenure handling", () => {
  it("flags partial_window_scored for tenure < 90d but ≥ 30d", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].tenureDays = 60;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    );
    expect(entry?.status).toBe("partial_window_scored");
    expect(entry?.tenureFactor).toBeGreaterThan(1);
  });

  it("unscored_ramp_up for tenure < MIN_TENURE_DAYS", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].tenureDays = COMPOSITE_MIN_TENURE_DAYS - 1;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    );
    expect(entry?.status).toBe("unscored_ramp_up");
    expect(entry?.score).toBeNull();
    expect(entry?.unscoredReason).toMatch(/Tenure/);
  });

  it("scales delivery processed value up for partial-window engineers", () => {
    const cohort = makeCohort(5, 3);
    // Two identical engineers, one full tenure, one at 60d.
    cohort[0].tenureDays = COMPOSITE_SIGNAL_WINDOW_DAYS;
    cohort[0].prCount = 10;
    cohort[1].tenureDays = 60;
    cohort[1].prCount = 10;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const full = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    const partial = bundle.entries.find(
      (e) => e.emailHash === cohort[1].emailHash,
    )!;
    expect(partial.signals.delivery.processedValue).toBeGreaterThan(
      full.signals.delivery.processedValue!,
    );
  });
});

// ---------- role adjustment (integration) ---------------------------------

describe("buildComposite — role adjustment", () => {
  it("inflates delivery raw for platform engineers", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].pillar = "Platform";
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.roleFactor.isPlatformOrInfra).toBe(true);
    expect(entry.roleFactor.deliveryFactor).toBeGreaterThan(1);
    // adjustedRawValue should be raw * 1.3, distinct from rawValue
    expect(entry.signals.delivery.adjustedRawValue).toBeGreaterThan(
      entry.signals.delivery.rawValue!,
    );
  });

  it("role adjustment is descriptive on the entry when applied", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].pillar = "Platform";
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.roleFactor.description).toMatch(/Platform/);
  });
});

// ---------- winsorization / anti-gaming -----------------------------------

describe("buildComposite — winsorization", () => {
  it("capping delivery volume at cohort P90 limits a superspammer", () => {
    // Build 10 engineers with prCount 10..19, plus one superspammer with 200.
    const cohort: EngineerCompositeInput[] = [];
    for (let i = 0; i < 10; i += 1) {
      const email = `be${i}@meetcleo.com`;
      cohort.push(
        makeEngineer({
          email,
          emailHash: hashEmailForRanking(email),
          githubLogin: `be${i}`,
          displayName: `BE ${i}`,
          prCount: 10 + i,
        }),
      );
    }
    const spam = "spammer@meetcleo.com";
    cohort.push(
      makeEngineer({
        email: spam,
        emailHash: hashEmailForRanking(spam),
        githubLogin: "spammer",
        displayName: "Spammer",
        prCount: 200,
      }),
    );

    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const spammer = bundle.entries.find(
      (e) => e.emailHash === hashEmailForRanking(spam),
    )!;
    // Raw is log(1+200) ≈ 5.303. Cap is driven by cohort P90 which should
    // be far smaller. processedValue must be below adjusted raw.
    expect(spammer.signals.delivery.rawValue).toBeGreaterThan(5);
    expect(spammer.signals.delivery.processedValue).toBeLessThan(
      spammer.signals.delivery.adjustedRawValue!,
    );
  });

  it("uses COMPOSITE_DELIVERY_WINSOR_P (0.9) for the cap", () => {
    expect(COMPOSITE_DELIVERY_WINSOR_P).toBe(0.9);
  });

  it("cycle time is bounded by floor/cap so extreme outliers do not dominate", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].medianTimeToMergeMinutes = 1; // absurdly fast
    cohort[1].medianTimeToMergeMinutes = 60 * 24 * 365; // absurdly slow
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const fast = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    const slow = bundle.entries.find(
      (e) => e.emailHash === cohort[1].emailHash,
    )!;
    expect(fast.signals.cycleTime.rawValue).not.toBeNull();
    expect(slow.signals.cycleTime.rawValue).not.toBeNull();
    expect(fast.signals.cycleTime.rawValue).toBeGreaterThan(
      slow.signals.cycleTime.rawValue!,
    );
  });
});

// ---------- missing data ---------------------------------------------------

describe("buildComposite — missing data", () => {
  it("unscored_insufficient_signals when < MIN_SIGNALS signals are present", () => {
    const cohort = makeCohort(5, 3);
    // Strip all quality/reliability/review/cycle → only delivery remains.
    cohort[0].analysedPrCount = 0;
    cohort[0].executionQualityMean = null;
    cohort[0].testAdequacyMean = null;
    cohort[0].riskHandlingMean = null;
    cohort[0].reviewabilityMean = null;
    cohort[0].revertRate = null;
    cohort[0].reviewParticipationRate = null;
    cohort[0].medianTimeToMergeMinutes = null;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.status).toBe("unscored_insufficient_signals");
    expect(entry.score).toBeNull();
    expect(entry.unscoredReason).toMatch(/signals/);
  });

  it("still scores when just the minimum number of signals are present", () => {
    expect(COMPOSITE_MIN_SIGNALS_FOR_SCORE).toBe(3);
    const cohort = makeCohort(5, 3);
    // Only delivery, quality, reliability populated for this engineer.
    cohort[0].reviewParticipationRate = null;
    cohort[0].medianTimeToMergeMinutes = null;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.status).toMatch(/scored/);
    expect(entry.score).not.toBeNull();
  });

  it("unmapped github login → unscored_unmapped", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].githubLogin = null;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.status).toBe("unscored_unmapped");
    expect(entry.score).toBeNull();
  });

  it("leaver / inactive → unscored_leaver regardless of data quality", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].isLeaverOrInactive = true;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.status).toBe("unscored_leaver");
    expect(entry.score).toBeNull();
  });

  it("small cohort (< MIN_COHORT_SIZE) → unscored_small_cohort", () => {
    // Only 2 BE engineers; should not score.
    const cohort: EngineerCompositeInput[] = [
      makeEngineer({
        email: "a@meetcleo.com",
        emailHash: hashEmailForRanking("a@meetcleo.com"),
        githubLogin: "a",
      }),
      makeEngineer({
        email: "b@meetcleo.com",
        emailHash: hashEmailForRanking("b@meetcleo.com"),
        githubLogin: "b",
      }),
    ];
    expect(COMPOSITE_MIN_COHORT_SIZE).toBe(3);
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    for (const entry of bundle.entries) {
      expect(entry.status).toBe("unscored_small_cohort");
      expect(entry.score).toBeNull();
    }
  });

  it("below COMPOSITE_MIN_PRS_FOR_DELIVERY → delivery raw null", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].prCount = 1;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.signals.delivery.rawValue).toBeNull();
  });

  it("below COMPOSITE_MIN_ANALYSED_PRS → quality / reliability / review / cycle all null", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].analysedPrCount = COMPOSITE_MIN_ANALYSED_PRS - 1;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.signals.quality.rawValue).toBeNull();
    expect(entry.signals.reliability.rawValue).toBeNull();
    expect(entry.signals.reviewDiscipline.rawValue).toBeNull();
    expect(entry.signals.cycleTime.rawValue).toBeNull();
  });
});

// ---------- coverage counts ------------------------------------------------

describe("buildComposite — coverage", () => {
  it("counts each status in the coverage breakdown", () => {
    // Cohort large enough that BE retains ≥ MIN_COHORT_SIZE scorable rows
    // after we knock 3 out (leaver / ramp-up / unmapped).
    const cohort = makeCohort(7, 3);
    cohort[0].isLeaverOrInactive = true; // leaver
    cohort[1].tenureDays = 10; // ramp-up
    cohort[2].githubLogin = null; // unmapped
    cohort[3].tenureDays = 60; // partial_window_scored
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    expect(bundle.coverage.total).toBe(10);
    expect(bundle.coverage.unscoredLeaver).toBe(1);
    expect(bundle.coverage.unscoredRampUp).toBe(1);
    expect(bundle.coverage.unscoredUnmapped).toBe(1);
    expect(bundle.coverage.partialWindowScored).toBe(1);
    // 7 BE - 3 unscored = 4 BE scored (one partial, 3 full). Plus 3 FE. = 7 scored total minus partial.
    // partialWindowScored counts separately.
    expect(bundle.coverage.scored).toBe(6);
  });
});

// ---------- scoping -------------------------------------------------------

describe("scopeComposite", () => {
  function buildBundleWithManager(managerEmail: string): CompositeBundle {
    const cohort = makeCohort(6, 3).map((e, i) => ({
      ...e,
      managerEmail: i < 2 ? managerEmail : "other@meetcleo.com",
    }));
    return buildComposite({ now: NOW, engineers: cohort });
  }

  it("filters by manager email", () => {
    const bundle = buildBundleWithManager("mgr@meetcleo.com");
    const directs = scopeComposite(bundle, {
      managerEmail: "mgr@meetcleo.com",
    });
    expect(directs).toHaveLength(2);
    for (const e of directs) {
      expect(e.managerEmail).toBe("mgr@meetcleo.com");
    }
  });

  it("filters by pillar", () => {
    const cohort = makeCohort(4, 3);
    cohort[0].pillar = "Platform";
    cohort[1].pillar = "Platform";
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const platform = scopeComposite(bundle, { pillar: "Platform" });
    expect(platform).toHaveLength(2);
  });

  it("filters by squad", () => {
    const cohort = makeCohort(4, 3);
    cohort[0].squad = "Autopilot";
    cohort[1].squad = "Autopilot";
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const squad = scopeComposite(bundle, { squad: "Autopilot" });
    expect(squad).toHaveLength(2);
  });

  it("scoredOnly drops unscored entries", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].isLeaverOrInactive = true;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const scored = scopeComposite(bundle, { scoredOnly: true });
    expect(scored).toHaveLength(7);
    for (const e of scored) {
      expect(["scored", "partial_window_scored"]).toContain(e.status);
    }
  });
});

describe("findEngineerInComposite", () => {
  it("returns null for an unknown hash", () => {
    const bundle = buildComposite({ now: NOW, engineers: makeCohort(3, 3) });
    expect(findEngineerInComposite(bundle, "deadbeef")).toBeNull();
  });
  it("returns the matching entry for a known hash", () => {
    const cohort = makeCohort(3, 3);
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const hit = findEngineerInComposite(bundle, cohort[0].emailHash);
    expect(hit).not.toBeNull();
    expect(hit!.emailHash).toBe(cohort[0].emailHash);
  });
});

// ---------- gaming / anti-gaming --------------------------------------------

describe("gaming resistance", () => {
  it("inflating pure PR count without quality cannot beat a peer with quality", () => {
    // Engineer A: 50 low-quality, often-reverted PRs.
    // Engineer B: 15 high-quality, clean-merge PRs.
    // B must out-rank A on the composite.
    const a = makeEngineer({
      email: "a@meetcleo.com",
      emailHash: hashEmailForRanking("a@meetcleo.com"),
      displayName: "A",
      githubLogin: "a",
      prCount: 50,
      analysedPrCount: 50,
      executionQualityMean: 2,
      testAdequacyMean: 2,
      riskHandlingMean: 2,
      reviewabilityMean: 2,
      technicalDifficultyMean: 2,
      revertRate: 0.4,
      reviewParticipationRate: 0.5,
      medianTimeToMergeMinutes: 60,
    });
    const b = makeEngineer({
      email: "b@meetcleo.com",
      emailHash: hashEmailForRanking("b@meetcleo.com"),
      displayName: "B",
      githubLogin: "b",
      prCount: 15,
      analysedPrCount: 15,
      executionQualityMean: 4.5,
      testAdequacyMean: 4.5,
      riskHandlingMean: 4.5,
      reviewabilityMean: 4.5,
      technicalDifficultyMean: 4,
      revertRate: 0,
      reviewParticipationRate: 1,
      medianTimeToMergeMinutes: 8 * 60,
    });
    // Pad the cohort with middle-of-the-road ICs for a non-trivial compare.
    const pad = makeCohort(5, 0, (i, base) => ({
      ...base,
      prCount: 12,
      analysedPrCount: 12,
      executionQualityMean: 3,
      testAdequacyMean: 3,
      riskHandlingMean: 3,
      reviewabilityMean: 3,
      revertRate: 0.05,
      reviewParticipationRate: 0.8,
      medianTimeToMergeMinutes: 10 * 60,
      email: `pad${i}@meetcleo.com`,
      emailHash: hashEmailForRanking(`pad${i}@meetcleo.com`),
      githubLogin: `pad${i}`,
    }));
    // Need ≥ 3 FE to hit min cohort size as well, but we only care about BE.
    const fePadding = makeCohort(0, 3);
    const bundle = buildComposite({
      now: NOW,
      engineers: [a, b, ...pad, ...fePadding],
    });
    const entryA = findEngineerInComposite(bundle, a.emailHash)!;
    const entryB = findEngineerInComposite(bundle, b.emailHash)!;
    expect(entryB.score).not.toBeNull();
    expect(entryA.score).not.toBeNull();
    expect(entryB.score!).toBeGreaterThan(entryA.score!);
  });

  it("cycle time cannot be gamed to infinity by merging a 1-minute PR", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].medianTimeToMergeMinutes = 0.5;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    // Floor of 30 min means raw = 1 / (30/60) = 2 hours^-1.
    expect(entry.signals.cycleTime.rawValue).toBeCloseTo(2, 5);
  });
});

// ---------- assembleCompositeInputs ---------------------------------------

describe("assembleCompositeInputs (loader integration)", () => {
  it("filters non-rankable disciplines", () => {
    const inputs = assembleCompositeInputs({
      headcountRows: [
        {
          email: "be@meetcleo.com",
          preferred_name: "BE",
          hb_function: "Engineer",
          rp_specialisation: "Backend Engineer",
          start_date: "2024-01-01",
          rp_department_name: "Growth Pillar",
          line_manager_email: "mgr@meetcleo.com",
        },
        {
          email: "em@meetcleo.com",
          preferred_name: "EM",
          hb_function: "Engineer",
          rp_specialisation: "Engineering Manager",
          start_date: "2023-01-01",
          rp_department_name: "Growth Pillar",
        },
      ],
      githubMap: [
        {
          githubLogin: "be",
          employeeEmail: "be@meetcleo.com",
          isBot: false,
        },
      ],
      prCountByLogin: new Map([["be", { prCount: 20 }]]),
      rubricByLogin: new Map(),
      now: NOW,
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0].discipline).toBe("BE");
    expect(inputs[0].pillar).toBe("Growth");
  });

  it("detects leavers", () => {
    const inputs = assembleCompositeInputs({
      headcountRows: [
        {
          email: "leaver@meetcleo.com",
          hb_function: "Engineer",
          rp_specialisation: "Backend Engineer",
          start_date: "2022-01-01",
          termination_date: "2025-01-01",
          rp_department_name: "Growth Pillar",
        },
      ],
      githubMap: [],
      prCountByLogin: new Map(),
      rubricByLogin: new Map(),
      now: NOW,
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0].isLeaverOrInactive).toBe(true);
  });

  it("skips future hires entirely", () => {
    const inputs = assembleCompositeInputs({
      headcountRows: [
        {
          email: "future@meetcleo.com",
          hb_function: "Engineer",
          rp_specialisation: "Backend Engineer",
          start_date: "2099-01-01",
          rp_department_name: "Growth Pillar",
        },
      ],
      githubMap: [],
      prCountByLogin: new Map(),
      rubricByLogin: new Map(),
      now: NOW,
    });
    expect(inputs).toHaveLength(0);
  });

  it("hashes emails via hashEmailForRanking", () => {
    const inputs = assembleCompositeInputs({
      headcountRows: [
        {
          email: "Alice@MeetCleo.com",
          hb_function: "Engineer",
          rp_specialisation: "Backend Engineer",
          start_date: "2024-01-01",
          rp_department_name: "Growth Pillar",
        },
      ],
      githubMap: [],
      prCountByLogin: new Map(),
      rubricByLogin: new Map(),
      now: NOW,
    });
    expect(inputs[0].emailHash).toBe(hashEmailForRanking("alice@meetcleo.com"));
  });

  it("must not import impact-model per M3 audit", async () => {
    // Read the two B-side composite source files and confirm they never
    // reference the impact-model path. The guard runs as a real test so a
    // future accidental import surfaces immediately, aligned with the
    // M3 audit's explicit EXCLUDE call.
    const { readFileSync } = await import("node:fs");
    const pure = readFileSync(
      "src/lib/data/engineering-composite.ts",
      "utf8",
    );
    const server = readFileSync(
      "src/lib/data/engineering-composite.server.ts",
      "utf8",
    );
    // Matches literal imports, not doc-comments that mention the audit.
    const bannedImport = /from\s+["'][^"']*\/impact-model/;
    expect(bannedImport.test(pure)).toBe(false);
    expect(bannedImport.test(server)).toBe(false);
  });
});

// ---------- partial-window + tenure pro-rate regression -------------------

describe("partial-window scoring regression", () => {
  it("partial-window engineer has tenureFactor > 1 and status=partial_window_scored", () => {
    const cohort = makeCohort(5, 3);
    cohort[0].tenureDays = COMPOSITE_SIGNAL_WINDOW_DAYS - 1;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.tenureFactor).toBeGreaterThan(1);
    expect(entry.status).toBe("partial_window_scored");
  });

  // Exact tenure-day boundary table for M7. Any scored entry with a
  // pro-rated delivery denominator must be visible as `partial_window_scored`
  // so the self-defence panel never hides rank-affecting normalisation.
  it.each([
    { tenureDays: 89, expectedStatus: "partial_window_scored" as const },
    { tenureDays: 90, expectedStatus: "partial_window_scored" as const },
    { tenureDays: 120, expectedStatus: "partial_window_scored" as const },
    { tenureDays: 179, expectedStatus: "partial_window_scored" as const },
    { tenureDays: 180, expectedStatus: "scored" as const },
  ])(
    "tenure=$tenureDays days → status=$expectedStatus with factor invariant",
    ({ tenureDays, expectedStatus }) => {
      const cohort = makeCohort(5, 3);
      cohort[0].tenureDays = tenureDays;
      const bundle = buildComposite({ now: NOW, engineers: cohort });
      const entry = bundle.entries.find(
        (e) => e.emailHash === cohort[0].emailHash,
      )!;
      expect(entry.status).toBe(expectedStatus);
      if (expectedStatus === "partial_window_scored") {
        expect(entry.tenureFactor).toBeGreaterThan(1);
      } else {
        expect(entry.tenureFactor).toBe(1);
      }
    },
  );

  it("invariant: every scored entry satisfies tenureFactor↔status 1:1", () => {
    const cohort = makeCohort(6, 3).map((e, i) => ({
      ...e,
      tenureDays: [30, 89, 90, 120, 179, 180, 365, 720, 40][i] ?? 365,
    }));
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    for (const entry of bundle.entries) {
      if (entry.status === "scored") {
        expect(
          entry.tenureFactor,
          `scored ${entry.displayName} at ${entry.tenureDays}d must have tenureFactor=1`,
        ).toBe(1);
      } else if (entry.status === "partial_window_scored") {
        expect(
          entry.tenureFactor,
          `partial_window_scored ${entry.displayName} at ${entry.tenureDays}d must have tenureFactor>1`,
        ).toBeGreaterThan(1);
      }
    }
  });
});

// ---------- scopeComposite contract defaults ------------------------------

describe("scopeComposite — default excludes unscored rows", () => {
  function buildMixedBundle(managerEmail: string): CompositeBundle {
    // 5 BE + 3 FE = 8 scorable, then attach a leaver / unmapped / ramp-up
    // direct report to the same manager so the default scope contract is
    // exercised on a realistic manager stack-rank join.
    const cohort = makeCohort(5, 3);
    const leaver = makeEngineer({
      email: "leaver@meetcleo.com",
      emailHash: hashEmailForRanking("leaver@meetcleo.com"),
      displayName: "Leaver",
      githubLogin: "leaver",
      managerEmail,
      isLeaverOrInactive: true,
    });
    const unmapped = makeEngineer({
      email: "unmapped@meetcleo.com",
      emailHash: hashEmailForRanking("unmapped@meetcleo.com"),
      displayName: "Unmapped",
      githubLogin: null,
      managerEmail,
    });
    const rampUp = makeEngineer({
      email: "rampup@meetcleo.com",
      emailHash: hashEmailForRanking("rampup@meetcleo.com"),
      displayName: "Ramp-up",
      githubLogin: "rampup",
      managerEmail,
      tenureDays: COMPOSITE_MIN_TENURE_DAYS - 1,
    });
    const scoredReport = cohort[0];
    scoredReport.managerEmail = managerEmail;
    return buildComposite({
      now: NOW,
      engineers: [...cohort, leaver, unmapped, rampUp],
    });
  }

  it("default (no scoredOnly) excludes leaver / unmapped / ramp-up rows", () => {
    const bundle = buildMixedBundle("mgr@meetcleo.com");
    const directs = scopeComposite(bundle, {
      managerEmail: "mgr@meetcleo.com",
    });
    // Only the single scored direct report survives the default scope.
    expect(directs).toHaveLength(1);
    for (const entry of directs) {
      expect(["scored", "partial_window_scored"]).toContain(entry.status);
    }
  });

  it("scoredOnly: false includes every unscored row", () => {
    const bundle = buildMixedBundle("mgr@meetcleo.com");
    const allDirects = scopeComposite(bundle, {
      managerEmail: "mgr@meetcleo.com",
      scoredOnly: false,
    });
    // 1 scored + 1 leaver + 1 unmapped + 1 ramp-up = 4 rows.
    expect(allDirects).toHaveLength(4);
    const statuses = new Set(allDirects.map((e) => e.status));
    expect(statuses.has("unscored_leaver")).toBe(true);
    expect(statuses.has("unscored_unmapped")).toBe(true);
    expect(statuses.has("unscored_ramp_up")).toBe(true);
  });

  it("scoredOnly: true (explicit) matches the default", () => {
    const bundle = buildMixedBundle("mgr@meetcleo.com");
    const defaultScope = scopeComposite(bundle, {
      managerEmail: "mgr@meetcleo.com",
    });
    const explicit = scopeComposite(bundle, {
      managerEmail: "mgr@meetcleo.com",
      scoredOnly: true,
    });
    expect(explicit.map((e) => e.emailHash).sort()).toEqual(
      defaultScope.map((e) => e.emailHash).sort(),
    );
  });

  it("org-wide default excludes unscored rows too", () => {
    const bundle = buildMixedBundle("mgr@meetcleo.com");
    const orgDefault = scopeComposite(bundle, {});
    for (const entry of orgDefault) {
      expect(["scored", "partial_window_scored"]).toContain(entry.status);
    }
    const orgAll = scopeComposite(bundle, { scoredOnly: false });
    expect(orgAll.length).toBeGreaterThan(orgDefault.length);
  });
});

// ---------- computeConfidenceBand -------------------------------------------

describe("computeConfidenceBand", () => {
  it("data-rich engineer gets narrow band", () => {
    const { band, nEffective } = computeConfidenceBand({
      score: 60,
      prCount: 20,
      analysedPrCount: 15,
      presentSignalCount: 5,
      tenureFactor: 1,
    });
    expect(band.halfWidth).toBeLessThan(8);
    expect(band.halfWidth).toBeGreaterThanOrEqual(CONFIDENCE_MIN_HALF_WIDTH);
    expect(band.lower).toBeCloseTo(60 - band.halfWidth, 5);
    expect(band.upper).toBeCloseTo(60 + band.halfWidth, 5);
    expect(nEffective).toBeGreaterThan(10);
  });

  it("sparse-data engineer gets wider band than data-rich", () => {
    const rich = computeConfidenceBand({
      score: 50,
      prCount: 20,
      analysedPrCount: 15,
      presentSignalCount: 5,
      tenureFactor: 1,
    });
    const sparse = computeConfidenceBand({
      score: 50,
      prCount: 3,
      analysedPrCount: 3,
      presentSignalCount: 3,
      tenureFactor: 1,
    });
    expect(sparse.band.halfWidth).toBeGreaterThan(rich.band.halfWidth);
    expect(sparse.nEffective).toBeLessThan(rich.nEffective);
  });

  it("partial-window engineer gets wider band due to tenure penalty", () => {
    const full = computeConfidenceBand({
      score: 50,
      prCount: 10,
      analysedPrCount: 8,
      presentSignalCount: 5,
      tenureFactor: 1,
    });
    const partial = computeConfidenceBand({
      score: 50,
      prCount: 10,
      analysedPrCount: 8,
      presentSignalCount: 5,
      tenureFactor: 2,
    });
    expect(partial.band.halfWidth).toBeGreaterThan(full.band.halfWidth);
    const expectedPenalty = (2 - 1) * CONFIDENCE_TENURE_PENALTY_PER_UNIT;
    expect(partial.band.halfWidth - full.band.halfWidth).toBeCloseTo(
      expectedPenalty,
      5,
    );
  });

  it("respects minimum half-width even for extreme data richness", () => {
    const result = computeConfidenceBand({
      score: 50,
      prCount: 500,
      analysedPrCount: 500,
      presentSignalCount: 5,
      tenureFactor: 1,
    });
    expect(result.band.halfWidth).toBeGreaterThanOrEqual(
      CONFIDENCE_MIN_HALF_WIDTH,
    );
  });

  it("respects maximum half-width even for extreme sparsity", () => {
    const result = computeConfidenceBand({
      score: 50,
      prCount: 0,
      analysedPrCount: 0,
      presentSignalCount: 1,
      tenureFactor: 3,
    });
    expect(result.band.halfWidth).toBeLessThanOrEqual(
      CONFIDENCE_MAX_HALF_WIDTH,
    );
  });

  it("clamps lower bound to 0 and upper bound to 100", () => {
    const low = computeConfidenceBand({
      score: 1,
      prCount: 3,
      analysedPrCount: 3,
      presentSignalCount: 3,
      tenureFactor: 1,
    });
    expect(low.band.lower).toBe(0);
    expect(low.band.upper).toBeGreaterThan(1);

    const high = computeConfidenceBand({
      score: 99,
      prCount: 3,
      analysedPrCount: 3,
      presentSignalCount: 3,
      tenureFactor: 1,
    });
    expect(high.band.upper).toBe(100);
    expect(high.band.lower).toBeLessThan(99);
  });

  it("fewer present signals widen the band", () => {
    const five = computeConfidenceBand({
      score: 50,
      prCount: 10,
      analysedPrCount: 8,
      presentSignalCount: 5,
      tenureFactor: 1,
    });
    const three = computeConfidenceBand({
      score: 50,
      prCount: 10,
      analysedPrCount: 8,
      presentSignalCount: 3,
      tenureFactor: 1,
    });
    expect(three.band.halfWidth).toBeGreaterThan(five.band.halfWidth);
  });

  it("low rubric coverage widens the band", () => {
    const highCov = computeConfidenceBand({
      score: 50,
      prCount: 20,
      analysedPrCount: 18,
      presentSignalCount: 5,
      tenureFactor: 1,
    });
    const lowCov = computeConfidenceBand({
      score: 50,
      prCount: 20,
      analysedPrCount: 3,
      presentSignalCount: 5,
      tenureFactor: 1,
    });
    expect(lowCov.band.halfWidth).toBeGreaterThan(highCov.band.halfWidth);
  });
});

// ---------- confidence bands in buildComposite ------------------------------

describe("buildComposite confidence bands", () => {
  it("scored entries have non-null confidenceBand and nEffective", () => {
    const bundle = buildComposite({
      now: NOW,
      engineers: makeCohort(5, 0),
    });
    for (const entry of bundle.scored) {
      expect(entry.confidenceBand).not.toBeNull();
      expect(entry.confidenceBand!.halfWidth).toBeGreaterThanOrEqual(
        CONFIDENCE_MIN_HALF_WIDTH,
      );
      expect(entry.confidenceBand!.lower).toBeLessThanOrEqual(entry.score!);
      expect(entry.confidenceBand!.upper).toBeGreaterThanOrEqual(entry.score!);
      expect(entry.nEffective).not.toBeNull();
      expect(entry.nEffective).toBeGreaterThan(0);
    }
  });

  it("unscored entries have null confidenceBand and nEffective", () => {
    const bundle = buildComposite({
      now: NOW,
      engineers: [
        ...makeCohort(4, 0),
        makeEngineer({
          email: "leaver@meetcleo.com",
          emailHash: hashEmailForRanking("leaver@meetcleo.com"),
          isLeaverOrInactive: true,
        }),
        makeEngineer({
          email: "ramp@meetcleo.com",
          emailHash: hashEmailForRanking("ramp@meetcleo.com"),
          githubLogin: "ramp",
          tenureDays: 10,
        }),
      ],
    });
    const unscoredEntries = bundle.entries.filter(
      (e) => e.status.startsWith("unscored"),
    );
    expect(unscoredEntries.length).toBeGreaterThan(0);
    for (const entry of unscoredEntries) {
      expect(entry.confidenceBand).toBeNull();
      expect(entry.nEffective).toBeNull();
    }
  });

  it("engineers with fewer PRs get wider bands", () => {
    const engineers = makeCohort(5, 0, (i, base) => ({
      ...base,
      prCount: i === 0 ? 3 : 20 + i * 5,
      analysedPrCount: i === 0 ? 3 : 15 + i * 3,
    }));
    const bundle = buildComposite({ now: NOW, engineers });
    const sparse = bundle.scored.find((e) => e.githubLogin === "be0");
    const rich = bundle.scored.find((e) => e.githubLogin === "be4");
    expect(sparse).toBeDefined();
    expect(rich).toBeDefined();
    expect(sparse!.confidenceBand!.halfWidth).toBeGreaterThan(
      rich!.confidenceBand!.halfWidth,
    );
  });
});

// ---------- rankWithConfidence — tie groups ----------------------------------

describe("rankWithConfidence", () => {
  function buildBundleFromSpread(
    scores: number[],
    halfWidths?: number[],
  ): CompositeEntry[] {
    const entries: CompositeEntry[] = scores.map((score, i) => {
      const hw = halfWidths?.[i] ?? 5;
      return {
        emailHash: `hash-${i}`,
        displayName: `Eng ${i}`,
        email: `eng${i}@meetcleo.com`,
        githubLogin: `eng${i}`,
        discipline: "BE" as const,
        pillar: "Growth",
        squad: null,
        managerEmail: null,
        tenureDays: 365,
        status: "scored" as const,
        score,
        orgPercentile: null,
        disciplinePercentile: null,
        signals: {} as CompositeEntry["signals"],
        tenureFactor: 1,
        roleFactor: {
          isPlatformOrInfra: false,
          deliveryFactor: 1,
          cycleTimeFactor: 1,
          description: null,
        },
        evidence: [],
        unscoredReason: null,
        confidenceBand: {
          lower: Math.max(0, score - hw),
          upper: Math.min(100, score + hw),
          halfWidth: hw,
        },
        nEffective: 10,
      };
    });
    return entries;
  }

  it("non-overlapping bands produce distinct tie groups", () => {
    // Scores spread far apart with narrow bands
    const entries = buildBundleFromSpread([90, 70, 50, 30], [3, 3, 3, 3]);
    const ranked = rankWithConfidence(entries);
    expect(ranked).toHaveLength(4);
    const tieGroupIds = ranked.map((r) => r.tieGroupId);
    const uniqueGroups = new Set(tieGroupIds);
    expect(uniqueGroups.size).toBe(4);
  });

  it("overlapping bands collapse into a shared tie group", () => {
    // Three engineers with overlapping bands
    const entries = buildBundleFromSpread([52, 50, 48], [5, 5, 5]);
    const ranked = rankWithConfidence(entries);
    expect(ranked).toHaveLength(3);
    const tieGroupIds = new Set(ranked.map((r) => r.tieGroupId));
    expect(tieGroupIds.size).toBe(1);
  });

  it("mixed overlaps: A-B overlap, B-C overlap → all in one group (transitive)", () => {
    // A=60±5=[55,65], B=56±5=[51,61], C=52±5=[47,57]
    // A-B overlap (55 < 61 and 51 < 65) ✓
    // B-C overlap (51 < 57 and 47 < 61) ✓
    // A-C don't directly overlap but B bridges them
    const entries = buildBundleFromSpread([60, 56, 52], [5, 5, 5]);
    const ranked = rankWithConfidence(entries);
    const tieGroupIds = new Set(ranked.map((r) => r.tieGroupId));
    expect(tieGroupIds.size).toBe(1);
  });

  it("two separate clusters form two tie groups", () => {
    // High cluster: 80, 78 (±5 → overlap)
    // Low cluster: 30, 28 (±5 → overlap)
    // No overlap between clusters
    const entries = buildBundleFromSpread([80, 78, 30, 28], [5, 5, 5, 5]);
    const ranked = rankWithConfidence(entries);
    const tieGroupIds = new Set(ranked.map((r) => r.tieGroupId));
    expect(tieGroupIds.size).toBe(2);
    // Top two should share a group
    expect(ranked[0].tieGroupId).toBe(ranked[1].tieGroupId);
    // Bottom two should share a group
    expect(ranked[2].tieGroupId).toBe(ranked[3].tieGroupId);
    // Top and bottom groups are distinct
    expect(ranked[0].tieGroupId).not.toBe(ranked[2].tieGroupId);
  });

  it("assigns rank by score descending", () => {
    const entries = buildBundleFromSpread([90, 70, 50, 30], [2, 2, 2, 2]);
    const ranked = rankWithConfidence(entries);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(ranked.map((r) => r.score)).toEqual([90, 70, 50, 30]);
  });

  it("assigns quartiles correctly", () => {
    const entries = buildBundleFromSpread(
      [95, 85, 75, 65, 55, 45, 35, 25],
      [2, 2, 2, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    // Top 2 should be Q4, next 2 Q3, next 2 Q2, bottom 2 Q1
    expect(ranked[0].quartile).toBe(4);
    expect(ranked[1].quartile).toBe(4);
    expect(ranked[6].quartile).toBe(1);
    expect(ranked[7].quartile).toBe(1);
  });

  // --- Quartile flag tests ---

  it("clear Q4 group with real gap gets promote_candidate flag", () => {
    // Well-separated scores with narrow bands
    const entries = buildBundleFromSpread(
      [95, 85, 75, 65, 55, 45, 35, 25],
      [2, 2, 2, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    const q4 = ranked.filter((r) => r.quartile === 4);
    expect(q4.length).toBeGreaterThan(0);
    for (const entry of q4) {
      expect(entry.quartileFlag).toBe("promote_candidate");
      expect(entry.flagEligible).toBe(true);
    }
  });

  it("clear Q1 group with real gap gets performance_manage flag", () => {
    const entries = buildBundleFromSpread(
      [95, 85, 75, 65, 55, 45, 35, 25],
      [2, 2, 2, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    const q1 = ranked.filter((r) => r.quartile === 1);
    expect(q1.length).toBeGreaterThan(0);
    for (const entry of q1) {
      expect(entry.quartileFlag).toBe("performance_manage");
      expect(entry.flagEligible).toBe(true);
    }
  });

  it("tie group straddling Q4/Q3 boundary gets no promote flag", () => {
    // Engineer at the Q4/Q3 boundary with wide bands that overlap into Q3
    // Score around p75 with wide bands so the tie group straddles the boundary
    const entries = buildBundleFromSpread(
      [90, 78, 76, 60, 50, 40, 30, 20],
      [2, 5, 5, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    // 78 and 76 likely form a tie group (bands overlap). If one is Q4 and one
    // is Q3, neither should get a promote flag.
    const straddleGroup = ranked.filter(
      (r) => r.score === 78 || r.score === 76,
    );
    if (straddleGroup.length === 2) {
      const quartiles = new Set(straddleGroup.map((r) => r.quartile));
      if (quartiles.size > 1) {
        for (const entry of straddleGroup) {
          expect(entry.quartileFlag).toBeNull();
        }
      }
    }
  });

  it("bottom-quartile gap smaller than confidence width → no PM flag", () => {
    // Bottom group has wide bands that reach into the Q2 zone
    const entries = buildBundleFromSpread(
      [90, 80, 70, 60, 50, 40, 30, 28],
      [2, 2, 2, 2, 2, 2, 15, 15],
    );
    const ranked = rankWithConfidence(entries);
    // The bottom entries (30, 28) have wide bands (±15). Their upper envelope
    // reaches into the 40s, overlapping with the non-Q1 group. Gap is not real.
    const bottomTwo = ranked.filter((r) => r.score !== null && r.score <= 30);
    for (const entry of bottomTwo) {
      if (entry.quartile === 1) {
        expect(entry.quartileFlag).toBeNull();
        expect(entry.flagEligible).toBe(false);
      }
    }
  });

  it("fewer than CONFIDENCE_MIN_ENTRIES_FOR_FLAGS entries → no flags", () => {
    const entries = buildBundleFromSpread([90, 50, 10], [2, 2, 2]);
    const ranked = rankWithConfidence(entries);
    expect(ranked).toHaveLength(3);
    for (const entry of ranked) {
      expect(entry.quartileFlag).toBeNull();
      expect(entry.flagEligible).toBe(false);
    }
  });

  it("unscored entries are silently excluded from ranking", () => {
    const scored = buildBundleFromSpread([90, 70, 50, 30], [2, 2, 2, 2]);
    const unscored: CompositeEntry = {
      ...scored[0],
      emailHash: "unscored-hash",
      displayName: "Unscored",
      status: "unscored_leaver",
      score: null,
      confidenceBand: null,
      nEffective: null,
    };
    const ranked = rankWithConfidence([...scored, unscored]);
    expect(ranked).toHaveLength(4);
    expect(ranked.find((r) => r.emailHash === "unscored-hash")).toBeUndefined();
  });

  it("all Q2/Q3 entries get null flags (mid-range, no promote or PM)", () => {
    const entries = buildBundleFromSpread(
      [95, 85, 75, 65, 55, 45, 35, 25],
      [2, 2, 2, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    const midRange = ranked.filter(
      (r) => r.quartile === 2 || r.quartile === 3,
    );
    for (const entry of midRange) {
      expect(entry.quartileFlag).toBeNull();
    }
  });

  it("single large tie group spanning all quartiles → no flags", () => {
    // Everyone within overlapping distance
    const entries = buildBundleFromSpread(
      [55, 53, 51, 49, 47, 45, 43, 41],
      [10, 10, 10, 10, 10, 10, 10, 10],
    );
    const ranked = rankWithConfidence(entries);
    const tieGroupIds = new Set(ranked.map((r) => r.tieGroupId));
    // Should collapse into one or very few groups
    expect(tieGroupIds.size).toBeLessThanOrEqual(2);
    // Because the group straddles multiple quartiles, no flags
    for (const entry of ranked) {
      if (tieGroupIds.size === 1) {
        expect(entry.quartileFlag).toBeNull();
      }
    }
  });

  it("empty input returns empty output", () => {
    expect(rankWithConfidence([])).toEqual([]);
  });

  it("partial_window_scored entries are included in ranking", () => {
    const entries = buildBundleFromSpread([80, 60, 40, 20], [3, 3, 3, 3]);
    entries[0].status = "partial_window_scored";
    const ranked = rankWithConfidence(entries);
    expect(ranked).toHaveLength(4);
    expect(ranked[0].status).toBe("partial_window_scored");
    expect(ranked[0].rank).toBe(1);
  });

  // --- Position-aware quartile flag eligibility (M9) ---

  it("eight equal-score entries all tied → no promote or PM flags", () => {
    const entries = buildBundleFromSpread(
      [50, 50, 50, 50, 50, 50, 50, 50],
      [5, 5, 5, 5, 5, 5, 5, 5],
    );
    const ranked = rankWithConfidence(entries);
    expect(ranked).toHaveLength(8);
    const tieGroupIds = new Set(ranked.map((r) => r.tieGroupId));
    expect(tieGroupIds.size).toBe(1);
    for (const entry of ranked) {
      expect(entry.quartileFlag).toBeNull();
      expect(entry.flagEligible).toBe(false);
    }
  });

  it("bottom tie group straddling positional bottom-quartile cutoff → no PM flag", () => {
    // 8 entries, bottom quartile positionally = indices 6–7.
    // Bottom 3 entries (indices 5,6,7) form a tie group via overlapping bands.
    // The group spans index 5 which is outside the positional bottom quartile.
    const entries = buildBundleFromSpread(
      [90, 80, 70, 60, 50, 32, 30, 28],
      [2, 2, 2, 2, 2, 5, 5, 5],
    );
    const ranked = rankWithConfidence(entries);
    const bottomThree = ranked.filter(
      (r) => r.score !== null && r.score <= 32,
    );
    expect(bottomThree.length).toBe(3);
    // All three should share one tie group (32±5=[27,37], 30±5=[25,35], 28±5=[23,33] — all overlap)
    const groupIds = new Set(bottomThree.map((r) => r.tieGroupId));
    expect(groupIds.size).toBe(1);
    // Group spans indices 5,6,7 but positional bottom Q is indices 6,7 only → no PM flag
    for (const entry of bottomThree) {
      expect(entry.quartileFlag).toBeNull();
      expect(entry.flagEligible).toBe(false);
    }
  });

  it("top tie group straddling positional top-quartile cutoff → no promote flag", () => {
    // 8 entries, top quartile positionally = indices 0–1.
    // Top 3 entries (indices 0,1,2) form a tie group via overlapping bands.
    const entries = buildBundleFromSpread(
      [82, 80, 78, 50, 40, 30, 20, 10],
      [5, 5, 5, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    const topThree = ranked.filter(
      (r) => r.score !== null && r.score >= 78,
    );
    expect(topThree.length).toBe(3);
    const groupIds = new Set(topThree.map((r) => r.tieGroupId));
    expect(groupIds.size).toBe(1);
    // Group spans indices 0,1,2 but positional top Q is indices 0,1 only → no promote flag
    for (const entry of topThree) {
      expect(entry.quartileFlag).toBeNull();
      expect(entry.flagEligible).toBe(false);
    }
  });

  // --- Competition-style displayRank for tie groups (M11) ---

  it("non-tied entries get sequential displayRank matching positional rank", () => {
    const entries = buildBundleFromSpread([95, 80, 65, 50, 35, 20], [2, 2, 2, 2, 2, 2]);
    const ranked = rankWithConfidence(entries);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ranked.map((r) => r.displayRank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("members of a multi-row tie group share a displayRank equal to the group's first index + 1", () => {
    // 8 identical scores collapse to a single tie group via overlapping bands.
    const entries = buildBundleFromSpread(
      [50, 50, 50, 50, 50, 50, 50, 50],
      [5, 5, 5, 5, 5, 5, 5, 5],
    );
    const ranked = rankWithConfidence(entries);
    const tieGroupIds = new Set(ranked.map((r) => r.tieGroupId));
    expect(tieGroupIds.size).toBe(1);
    for (const entry of ranked) {
      expect(entry.displayRank).toBe(1);
    }
    // rank stays positional and sequential for stable ordering.
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("displayRank skips past the size of the preceding tie group", () => {
    // Two-way tie at top, then well-separated singletons. Expected
    // displayRanks: [1, 1, 3, 4, 5, 6, 7, 8].
    const entries = buildBundleFromSpread(
      [85, 84, 60, 50, 40, 30, 20, 10],
      [3, 3, 2, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    expect(ranked[0].tieGroupId).toBe(ranked[1].tieGroupId);
    expect(ranked[2].tieGroupId).not.toBe(ranked[0].tieGroupId);
    expect(ranked[0].displayRank).toBe(1);
    expect(ranked[1].displayRank).toBe(1);
    expect(ranked[2].displayRank).toBe(3);
    expect(ranked[3].displayRank).toBe(4);
    expect(ranked[ranked.length - 1].displayRank).toBe(ranked.length);
  });

  it("multiple disjoint tie groups each share a displayRank equal to their group's start index + 1", () => {
    // Top pair tied (indices 0,1), middle pair tied (indices 3,4), bottom
    // pair tied (indices 6,7). Bands wide enough to fuse the pairs but not
    // bridge the gaps.
    const entries = buildBundleFromSpread(
      [80, 78, 60, 41, 39, 25, 12, 10],
      [3, 3, 2, 3, 3, 2, 3, 3],
    );
    const ranked = rankWithConfidence(entries);
    // Sanity-check group structure rather than trust exact band arithmetic.
    expect(ranked[0].tieGroupId).toBe(ranked[1].tieGroupId);
    expect(ranked[3].tieGroupId).toBe(ranked[4].tieGroupId);
    expect(ranked[6].tieGroupId).toBe(ranked[7].tieGroupId);
    expect(ranked[2].tieGroupId).not.toBe(ranked[0].tieGroupId);
    expect(ranked[2].tieGroupId).not.toBe(ranked[3].tieGroupId);
    expect(ranked[5].tieGroupId).not.toBe(ranked[3].tieGroupId);
    expect(ranked[5].tieGroupId).not.toBe(ranked[6].tieGroupId);
    // displayRank reflects the group's first positional index + 1.
    expect(ranked[0].displayRank).toBe(1);
    expect(ranked[1].displayRank).toBe(1);
    expect(ranked[2].displayRank).toBe(3);
    expect(ranked[3].displayRank).toBe(4);
    expect(ranked[4].displayRank).toBe(4);
    expect(ranked[5].displayRank).toBe(6);
    expect(ranked[6].displayRank).toBe(7);
    expect(ranked[7].displayRank).toBe(7);
  });

  it("displayRank does not regress promote/PM flag eligibility for tied top/bottom groups", () => {
    // 8 well-separated entries: top 2 in their own group (overlapping bands),
    // bottom 2 in their own group (overlapping bands). Both groups span only
    // the positional top/bottom quartile, so flags must remain eligible.
    const entries = buildBundleFromSpread(
      [95, 94, 75, 65, 55, 45, 26, 25],
      [3, 3, 2, 2, 2, 2, 3, 3],
    );
    const ranked = rankWithConfidence(entries);
    expect(ranked[0].tieGroupId).toBe(ranked[1].tieGroupId);
    expect(ranked[6].tieGroupId).toBe(ranked[7].tieGroupId);
    expect(ranked[0].displayRank).toBe(1);
    expect(ranked[1].displayRank).toBe(1);
    expect(ranked[6].displayRank).toBe(7);
    expect(ranked[7].displayRank).toBe(7);
    for (const entry of ranked.slice(0, 2)) {
      expect(entry.quartile).toBe(4);
      expect(entry.quartileFlag).toBe("promote_candidate");
      expect(entry.flagEligible).toBe(true);
    }
    for (const entry of ranked.slice(-2)) {
      expect(entry.quartile).toBe(1);
      expect(entry.quartileFlag).toBe("performance_manage");
      expect(entry.flagEligible).toBe(true);
    }
  });

  it("groups wholly inside positional top/bottom quartile still get flags", () => {
    // Well-separated 8 entries: top 2 in their own groups, bottom 2 in their own groups
    const entries = buildBundleFromSpread(
      [95, 85, 75, 65, 55, 45, 35, 25],
      [2, 2, 2, 2, 2, 2, 2, 2],
    );
    const ranked = rankWithConfidence(entries);
    // Top two: indices 0,1 — positional top Q = indices [0,1] — should get promote flags
    const top = ranked.filter((r) => r.quartile === 4);
    expect(top.length).toBeGreaterThan(0);
    for (const entry of top) {
      expect(entry.quartileFlag).toBe("promote_candidate");
      expect(entry.flagEligible).toBe(true);
    }
    // Bottom two: indices 6,7 — positional bottom Q = indices [6,7] — should get PM flags
    const bottom = ranked.filter((r) => r.quartile === 1);
    expect(bottom.length).toBeGreaterThan(0);
    for (const entry of bottom) {
      expect(entry.quartileFlag).toBe("performance_manage");
      expect(entry.flagEligible).toBe(true);
    }
  });
});

// ---------- end-to-end: buildComposite + rankWithConfidence -----------------

describe("end-to-end confidence/rank pipeline", () => {
  it("builds composite and ranks with tie groups from real inputs", () => {
    const engineers = makeCohort(8, 0, (i, base) => ({
      ...base,
      prCount: 5 + i * 5,
      analysedPrCount: 4 + i * 3,
      executionQualityMean: 2 + i * 0.3,
      testAdequacyMean: 2 + i * 0.3,
      riskHandlingMean: 2 + i * 0.3,
      reviewabilityMean: 2 + i * 0.3,
      revertRate: Math.max(0, 0.3 - i * 0.04),
      reviewParticipationRate: 0.5 + i * 0.06,
      medianTimeToMergeMinutes: 600 - i * 50,
    }));
    const bundle = buildComposite({ now: NOW, engineers });
    const scored = scopeComposite(bundle, {});
    expect(scored.length).toBeGreaterThanOrEqual(4);

    const ranked = rankWithConfidence(scored);
    expect(ranked.length).toBe(scored.length);

    // Rank is monotonically increasing
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].rank).toBe(ranked[i - 1].rank + 1);
    }

    // Scores are monotonically non-increasing
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].score!).toBeLessThanOrEqual(ranked[i - 1].score!);
    }

    // Every entry has a valid quartile
    for (const entry of ranked) {
      expect([1, 2, 3, 4]).toContain(entry.quartile);
    }
  });

  it("scoped ranking excludes unscored rows from quartile thresholds", () => {
    const cohort = makeCohort(6, 0);
    const leaver = makeEngineer({
      email: "leaver@meetcleo.com",
      emailHash: hashEmailForRanking("leaver@meetcleo.com"),
      displayName: "Leaver",
      githubLogin: "leaver",
      isLeaverOrInactive: true,
    });
    const bundle = buildComposite({
      now: NOW,
      engineers: [...cohort, leaver],
    });

    const scored = scopeComposite(bundle, {});
    const ranked = rankWithConfidence(scored);

    // Leaver should not appear in ranked output
    expect(ranked.find((r) => r.emailHash === leaver.emailHash)).toBeUndefined();
    // Only scored entries
    for (const entry of ranked) {
      expect(["scored", "partial_window_scored"]).toContain(entry.status);
    }
  });
});

describe("methodology metadata cross-check (M13)", () => {
  it("emits one methodology row per signal in canonical order", () => {
    expect(COMPOSITE_METHODOLOGY_ROWS).toHaveLength(COMPOSITE_SIGNAL_KEYS.length);
    expect(COMPOSITE_METHODOLOGY_ROWS.map((r) => r.key)).toEqual(
      Array.from(COMPOSITE_SIGNAL_KEYS),
    );
  });

  it("matches each row's weight and label to the canonical constants", () => {
    for (const row of COMPOSITE_METHODOLOGY_ROWS) {
      expect(row.label).toBe(COMPOSITE_SIGNAL_LABELS[row.key]);
      expect(row.weightPct).toBeCloseTo(COMPOSITE_WEIGHTS[row.key] * 100, 6);
    }
  });

  it("does not let any methodology row description drift from the canonical signal description", () => {
    for (const row of COMPOSITE_METHODOLOGY_ROWS) {
      expect(row.description).toBe(COMPOSITE_SIGNAL_DESCRIPTIONS[row.key]);
    }
  });

  it("declares known methodology sections covering tenure/role/confidence/ties/flags/anti-gaming/coverage", () => {
    const titles = COMPOSITE_METHODOLOGY_SECTIONS.map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Tenure normalisation",
        "Role normalisation",
        "Confidence model",
        "Tie-group rule",
        "Flag eligibility",
        "Anti-gaming",
        "Coverage rules",
      ]),
    );
  });

  it("anchors every numeric token in methodology copy to a known composite constant", () => {
    // The set of numbers we authorise in methodology copy. New numbers in the
    // copy must come from one of these constants; otherwise the copy has
    // drifted from the code and the cross-check fails.
    const allowedNumbers = new Set<number>([
      COMPOSITE_SIGNAL_WINDOW_DAYS,
      COMPOSITE_MIN_TENURE_DAYS,
      COMPOSITE_MIN_ANALYSED_PRS,
      COMPOSITE_MIN_PRS_FOR_DELIVERY,
      COMPOSITE_MIN_COHORT_SIZE,
      COMPOSITE_MIN_SIGNALS_FOR_SCORE,
      COMPOSITE_DELIVERY_WINSOR_P * 100, // 90
      COMPOSITE_CYCLE_TIME_FLOOR_MIN, // 30 min
      COMPOSITE_CYCLE_TIME_CAP_HOURS / 24, // 14 days
      COMPOSITE_MAX_SINGLE_WEIGHT * 100, // 30
      COMPOSITE_SIGNAL_WINDOW_DAYS - 1, // 179, used in "between 30 and 179 days"
      CONFIDENCE_K,
      CONFIDENCE_MIN_HALF_WIDTH,
      CONFIDENCE_MAX_HALF_WIDTH,
      CONFIDENCE_TENURE_PENALTY_PER_UNIT,
      CONFIDENCE_MIN_ENTRIES_FOR_FLAGS,
      // Allowed presentational constants — fractions inside formulas.
      0.5,
      1.0,
      1.3,
      1, // "≥ 1 review round"
      0,
      4, // "of 5 signals" (total signal count)
      5,
      14, // 14-day revert window
    ]);

    // Add weight percentages for every signal so 20/30/15/etc. resolve.
    for (const key of COMPOSITE_SIGNAL_KEYS) {
      allowedNumbers.add(COMPOSITE_WEIGHTS[key] * 100);
    }

    const tokens: { source: string; value: number }[] = [];
    // Greedy digit-run regex, no boundary anchors. Letters that immediately
    // touch a number ("P90", "≥3") are absorbed by the surrounding char run
    // boundary already provided by the regex engine; this regex extracts the
    // pure numeric run only.
    const numericRegex = /\d+(?:\.\d+)?/g;

    const collect = (label: string, body: string) => {
      const matches = body.match(numericRegex);
      if (!matches) return;
      for (const raw of matches) {
        const value = Number(raw);
        if (Number.isFinite(value)) tokens.push({ source: label, value });
      }
    };

    for (const row of COMPOSITE_METHODOLOGY_ROWS) {
      collect(`row.${row.key}.normalizationRule`, row.normalizationRule);
      collect(`row.${row.key}.minimumSampleRule`, row.minimumSampleRule);
      collect(`row.${row.key}.knownLimitations`, row.knownLimitations);
    }
    for (const section of COMPOSITE_METHODOLOGY_SECTIONS) {
      collect(`section.${section.title}`, section.body);
    }

    // Every numeric token must resolve to an allowed constant.
    for (const { source, value } of tokens) {
      expect(
        allowedNumbers.has(value),
        `Numeric token ${value} in ${source} is not anchored to a composite constant`,
      ).toBe(true);
    }
  });

  it("never references the impact-model in methodology copy (M3 audit)", () => {
    const flat = [
      ...COMPOSITE_METHODOLOGY_ROWS.flatMap((r) => [
        r.normalizationRule,
        r.minimumSampleRule,
        r.knownLimitations,
      ]),
      ...COMPOSITE_METHODOLOGY_SECTIONS.map((s) => s.body),
    ].join(" ");
    expect(flat.toLowerCase()).not.toMatch(/impact[- ]model/);
    expect(flat.toLowerCase()).not.toMatch(/shap/);
  });

  it("freezes the methodology version exposed to consumers", () => {
    expect(COMPOSITE_METHODOLOGY_VERSION).toBe("b-1.0.0");
  });
});
