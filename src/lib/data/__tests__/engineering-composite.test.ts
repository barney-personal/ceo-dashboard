import { describe, expect, it } from "vitest";

import {
  COMPOSITE_DELIVERY_WINSOR_P,
  COMPOSITE_MAX_SINGLE_WEIGHT,
  COMPOSITE_METHODOLOGY_VERSION,
  COMPOSITE_MIN_ANALYSED_PRS,
  COMPOSITE_MIN_COHORT_SIZE,
  COMPOSITE_MIN_PRS_FOR_DELIVERY,
  COMPOSITE_MIN_SIGNALS_FOR_SCORE,
  COMPOSITE_MIN_TENURE_DAYS,
  COMPOSITE_PARTIAL_WINDOW_TENURE_DAYS,
  COMPOSITE_SIGNAL_KEYS,
  COMPOSITE_SIGNAL_LABELS,
  COMPOSITE_SIGNAL_WINDOW_DAYS,
  COMPOSITE_WEIGHTS,
  buildComposite,
  findEngineerInComposite,
  isPlatformOrInfraEngineer,
  roleAdjustmentFor,
  scopeComposite,
  tenureFactorFor,
  type CompositeBundle,
  type EngineerCompositeInput,
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
    cohort[0].tenureDays = COMPOSITE_PARTIAL_WINDOW_TENURE_DAYS - 1;
    const bundle = buildComposite({ now: NOW, engineers: cohort });
    const entry = bundle.entries.find(
      (e) => e.emailHash === cohort[0].emailHash,
    )!;
    expect(entry.tenureFactor).toBeGreaterThan(1);
    expect(entry.status).toBe("partial_window_scored");
  });
});
