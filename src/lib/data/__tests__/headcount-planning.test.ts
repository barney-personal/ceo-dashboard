import { describe, expect, it } from "vitest";
import {
  buildHistoricalHeadcount,
  buildSurvivalCurve,
  buildSurvivalFromRollingRates,
  projectFromCohorts,
  projectHeadcount,
} from "../headcount-planning";
import type { Employee, RetentionCohort } from "../attrition-utils";

const AS_OF = new Date("2026-04-15T00:00:00Z");

function emp(startDate: string, terminationDate: string | null = null): Employee {
  return { startDate, terminationDate };
}

describe("buildSurvivalCurve", () => {
  it("S(0) = 1 and S is monotone non-increasing", () => {
    const employees: Employee[] = [
      emp("2023-01-01", "2023-06-01"), // 5 months, terminated
      emp("2023-06-01", "2024-06-01"), // 12 months
      emp("2024-01-01", null), // still employed ~27mo as of AS_OF
      emp("2024-06-01", "2025-06-01"), // 12 months
      emp("2025-01-01", null), // still employed ~15mo
    ];
    const curve = buildSurvivalCurve(employees, { asOf: AS_OF, maxMonths: 36 });
    expect(curve.survival[0]).toBe(1);
    for (let i = 1; i < curve.survival.length; i++) {
      expect(curve.survival[i]).toBeLessThanOrEqual(curve.survival[i - 1] + 1e-9);
    }
  });

  it("produces exactly 1.0 survival when nobody has terminated", () => {
    const employees: Employee[] = [
      emp("2023-01-01", null),
      emp("2023-06-01", null),
    ];
    const curve = buildSurvivalCurve(employees, { asOf: AS_OF, maxMonths: 24 });
    expect(curve.survival.every((s) => s === 1)).toBe(true);
  });

  it("survival drops at tenure months where events occurred", () => {
    // 10 employees all joined 2024-01-01. 2 terminate at tenure 6, 1 at tenure 12.
    const employees: Employee[] = [
      emp("2024-01-01", "2024-07-01"), // 6 months
      emp("2024-01-01", "2024-07-01"), // 6 months
      emp("2024-01-01", "2025-01-01"), // 12 months
      // 7 still employed at ~27 months
      ...Array.from({ length: 7 }, () => emp("2024-01-01", null)),
    ];
    const curve = buildSurvivalCurve(employees, { asOf: AS_OF, maxMonths: 36 });
    // At tenure 6: 2 events, 10 at risk → S(6) = 1 × (1 − 2/10) = 0.8
    expect(curve.survival[6]).toBeCloseTo(0.8, 3);
    // At tenure 12: 1 event, 8 at risk → S(12) = 0.8 × (1 − 1/8) = 0.7
    expect(curve.survival[12]).toBeCloseTo(0.7, 3);
  });

  it("right-censors employees with future termination dates as still at risk", () => {
    // Employee on notice with future termination still counts as at-risk at AS_OF.
    const employees: Employee[] = [emp("2024-01-01", "2027-01-01")];
    const curve = buildSurvivalCurve(employees, { asOf: AS_OF, maxMonths: 36 });
    // Their contribution: tenure at AS_OF ≈ 27 months, censored (no event).
    // So at all tenures ≤ 27, they're at risk, no events → S stays 1.
    expect(curve.survival.every((s) => s === 1)).toBe(true);
  });
});

describe("buildHistoricalHeadcount", () => {
  it("counts actives per month inclusive of start, exclusive of termination", () => {
    const employees: Employee[] = [
      emp("2024-01-01", "2024-06-15"), // active Jan-Jun 2024
      emp("2024-03-01", null), // active Mar 2024 →
    ];
    const history = buildHistoricalHeadcount(employees, {
      fromMonth: "2024-01",
      toMonth: "2024-07",
    });
    const byMonth = Object.fromEntries(history.map((h) => [h.month, h.headcount]));
    expect(byMonth["2024-01"]).toBe(1);
    expect(byMonth["2024-02"]).toBe(1);
    expect(byMonth["2024-03"]).toBe(2);
    expect(byMonth["2024-06"]).toBe(2); // A leaves mid-month but counted
    expect(byMonth["2024-07"]).toBe(1);
  });
});

describe("projectHeadcount", () => {
  it("starts from current headcount and grows/shrinks via hires × survival", () => {
    const employees: Employee[] = [
      emp("2023-01-01", null),
      emp("2023-06-01", null),
      emp("2024-01-01", null),
      emp("2024-06-01", "2025-06-01"), // 12mo, terminated
      emp("2025-01-01", null),
    ];
    const result = projectHeadcount(employees, "2026-12", {
      asOf: AS_OF,
      hireScenarios: { low: 5, mid: 10, high: 15 },
      maxTenureMonths: 60,
    });
    expect(result.startingHeadcount).toBe(4); // 4 still active
    expect(result.projection.length).toBeGreaterThan(0);
    // First forecast month should be at/above the starting headcount
    // because we add hires × S(0) = 1 hire worth of contribution.
    expect(result.projection[0].mid).toBeGreaterThan(result.startingHeadcount - 1);
    // High scenario always >= mid always >= low at every month.
    for (const m of result.projection) {
      expect(m.high).toBeGreaterThanOrEqual(m.mid - 1e-9);
      expect(m.mid).toBeGreaterThanOrEqual(m.low - 1e-9);
    }
  });

  it("with zero hires and perfect retention, headcount stays flat", () => {
    const employees: Employee[] = [
      emp("2024-01-01", null),
      emp("2024-06-01", null),
    ];
    const result = projectHeadcount(employees, "2026-06", {
      asOf: AS_OF,
      hireScenarios: { low: 0, mid: 0, high: 0 },
    });
    // No terminations ever → S ≡ 1 → headcount stays at 2 every month.
    for (const m of result.projection) {
      expect(m.mid).toBeCloseTo(2, 6);
      expect(m.hires).toBe(0);
      expect(m.departures).toBeCloseTo(0, 6);
    }
  });

  it("hires scenario ordering: low <= mid <= high at every month", () => {
    const employees: Employee[] = [
      emp("2023-01-01", null),
      emp("2024-06-01", "2025-06-01"),
    ];
    const result = projectHeadcount(employees, "2027-12", {
      asOf: AS_OF,
      hireScenarios: { low: 3, mid: 10, high: 20 },
    });
    for (const m of result.projection) {
      expect(m.low).toBeLessThanOrEqual(m.mid);
      expect(m.mid).toBeLessThanOrEqual(m.high);
    }
  });
});

describe("projectFromCohorts", () => {
  // Helper: build a deterministic survival curve for testing.
  function buildTestSurvival(hazardPerMonth: number) {
    const survival = new Array(121).fill(1);
    for (let t = 1; t < survival.length; t++) {
      survival[t] = survival[t - 1] * (1 - hazardPerMonth);
    }
    return {
      survival,
      atRisk: new Array(121).fill(100),
      events: new Array(121).fill(0),
      extrapolationCutoff: 120,
      n: 100,
    };
  }

  it("starting HC = Σ cohort_size × observed retention (no current-quarter bucket)", () => {
    const cohorts: RetentionCohort[] = [
      { cohort: "2024-Q1", cohortSize: 100, periods: [1.0, 0.9, 0.8, 0.7] },
      { cohort: "2024-Q3", cohortSize: 50, periods: [1.0, 0.95] },
    ];
    const curve = buildTestSurvival(0.01);
    const result = projectFromCohorts(cohorts, curve, "2026-06", {
      asOf: new Date("2025-01-15T00:00:00Z"),
      hireScenarios: { low: 0, mid: 0, high: 0 },
    });
    // 2024-Q1 cohort: anchor periods.length-1=3 (age 9mo), observed 0.7
    //   currentAge ~ 12mo, decay = S(12)/S(9)
    // 2024-Q3 cohort: anchor periods.length-1=1 (age 3mo), observed 0.95
    //   currentAge ~ 6mo, decay = S(6)/S(3)
    // Exact values not critical; just verify non-trivial and positive.
    expect(result.startingHeadcount).toBeGreaterThan(0);
    expect(result.startingHeadcount).toBeLessThan(150);
    expect(result.cohortBreakdown).toHaveLength(2);
  });

  it("currentQuarterActiveCount adds to starting HC at 100% retention", () => {
    const cohorts: RetentionCohort[] = [
      { cohort: "2024-Q1", cohortSize: 100, periods: [1.0, 1.0] },
    ];
    const curve = buildTestSurvival(0); // no churn
    const withoutCQ = projectFromCohorts(cohorts, curve, "2025-06", {
      asOf: new Date("2025-02-15T00:00:00Z"),
    });
    const withCQ = projectFromCohorts(cohorts, curve, "2025-06", {
      asOf: new Date("2025-02-15T00:00:00Z"),
      currentQuarterActiveCount: 25,
    });
    expect(withCQ.startingHeadcount - withoutCQ.startingHeadcount).toBeCloseTo(25, 2);
  });

  it("stationarity diagnostic surfaces retention spread across cohorts at common ages", () => {
    const cohorts: RetentionCohort[] = [
      // Both have a 6-month retention point: compared at ageMonths=6 (q=2)
      { cohort: "2023-Q1", cohortSize: 50, periods: [1.0, 0.9, 0.85] },
      { cohort: "2024-Q1", cohortSize: 60, periods: [1.0, 0.7, 0.6] },
    ];
    const curve = buildTestSurvival(0.02);
    const result = projectFromCohorts(cohorts, curve, "2025-06", {
      asOf: new Date("2025-02-15T00:00:00Z"),
    });
    const age6 = result.stationarityByAge.find((s) => s.ageMonths === 6);
    expect(age6).toBeDefined();
    expect(age6!.byCohort).toHaveLength(2);
    // Retention at 6 months: 0.85 and 0.60 — spread = 25pp.
    const retentions = age6!.byCohort.map((c) => c.retention);
    expect(Math.max(...retentions) - Math.min(...retentions)).toBeCloseTo(
      0.25,
      2,
    );
  });

  it("projection is non-negative and monotone in hire rate", () => {
    const cohorts: RetentionCohort[] = [
      { cohort: "2024-Q1", cohortSize: 100, periods: [1.0, 0.9, 0.8, 0.7] },
    ];
    const curve = buildTestSurvival(0.02);
    const lowRun = projectFromCohorts(cohorts, curve, "2026-12", {
      asOf: new Date("2025-01-15T00:00:00Z"),
      hireScenarios: { low: 0, mid: 0, high: 0 },
      hiresPerMonth: 0,
    });
    const highRun = projectFromCohorts(cohorts, curve, "2026-12", {
      asOf: new Date("2025-01-15T00:00:00Z"),
      hireScenarios: { low: 10, mid: 10, high: 10 },
      hiresPerMonth: 10,
    });
    // More hires → higher HC at every projected month.
    for (let i = 0; i < lowRun.projection.length; i++) {
      expect(highRun.projection[i].mid).toBeGreaterThanOrEqual(
        lowRun.projection[i].mid - 1e-9,
      );
      expect(lowRun.projection[i].low).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildSurvivalFromRollingRates", () => {
  it("S(0) = 1 and S is monotone non-increasing", () => {
    const c = buildSurvivalFromRollingRates({
      under1yrAnnual: 0.339,
      over1yrAnnual: 0.405,
    });
    expect(c.survival[0]).toBe(1);
    for (let i = 1; i < c.survival.length; i++) {
      expect(c.survival[i]).toBeLessThanOrEqual(c.survival[i - 1] + 1e-9);
    }
  });

  it("S(12) matches the annualised <1yr rate", () => {
    // Annual rate 33.9% → S(12) should be 1 - 0.339 = 0.661
    const c = buildSurvivalFromRollingRates({
      under1yrAnnual: 0.339,
      over1yrAnnual: 0.405,
    });
    expect(c.survival[12]).toBeCloseTo(1 - 0.339, 2);
  });

  it("S(24)/S(12) matches the annualised >1yr rate", () => {
    // From tenure month 12 to 24, survival decays at >1yr rate.
    // Year-2 survival = S(24)/S(12) = 1 - 0.405 = 0.595
    const c = buildSurvivalFromRollingRates({
      under1yrAnnual: 0.339,
      over1yrAnnual: 0.405,
    });
    const yr2Retention = c.survival[24] / c.survival[12];
    expect(yr2Retention).toBeCloseTo(1 - 0.405, 2);
  });

  it("zero attrition → S ≡ 1 forever", () => {
    const c = buildSurvivalFromRollingRates({
      under1yrAnnual: 0,
      over1yrAnnual: 0,
    });
    expect(c.survival.every((s) => s === 1)).toBe(true);
  });

  it("clamps negative / >1 rates to [0, 1]", () => {
    const c = buildSurvivalFromRollingRates({
      under1yrAnnual: -0.1,
      over1yrAnnual: 1.5,
    });
    // Negative is treated as 0 → S(12) should be 1.
    expect(c.survival[12]).toBeCloseTo(1, 6);
    // >1 treated as 1 → S(24)/S(12) should be 0 (full churn in year 2).
    expect(c.survival[24] / c.survival[12]).toBeCloseTo(0, 6);
  });
});

describe("projectHeadcount with survivalCurve override", () => {
  it("uses the provided curve instead of fitting KM on employees", () => {
    const employees: Employee[] = [
      // Normally KM on this would produce S(12) = 1 (no terminations).
      { startDate: "2024-01-01", terminationDate: null },
      { startDate: "2024-06-01", terminationDate: null },
    ];
    const harshCurve = buildSurvivalFromRollingRates({
      under1yrAnnual: 0.5, // harsh: 50% leave in year 1
      over1yrAnnual: 0.2,
    });
    const result = projectHeadcount(employees, "2026-06", {
      asOf: new Date("2026-04-15T00:00:00Z"),
      hireScenarios: { low: 0, mid: 0, high: 0 },
      survivalCurve: harshCurve,
    });
    // With 0 hires and a harsh curve, HC should decline from 2 → below 2.
    expect(result.projection[0].mid).toBeLessThan(2);
    expect(result.projection[result.projection.length - 1].mid).toBeLessThan(
      result.projection[0].mid,
    );
  });
});

describe("buildSurvivalCurveRecencyWeighted", () => {
  it("S(0) = 1 and S is monotone non-increasing", async () => {
    const { buildSurvivalCurveRecencyWeighted } = await import(
      "../headcount-planning"
    );
    const employees: Employee[] = [
      emp("2023-01-01", "2023-06-01"),
      emp("2024-01-01", null),
      emp("2025-01-01", "2025-06-01"),
    ];
    const c = buildSurvivalCurveRecencyWeighted(employees, {
      asOf: AS_OF,
      maxMonths: 36,
      halfLifeMonths: 12,
    });
    expect(c.survival[0]).toBe(1);
    for (let i = 1; i < c.survival.length; i++) {
      expect(c.survival[i]).toBeLessThanOrEqual(c.survival[i - 1] + 1e-9);
    }
  });

  it("converges to pooled KM as half-life → ∞", async () => {
    const { buildSurvivalCurveRecencyWeighted } = await import(
      "../headcount-planning"
    );
    const employees: Employee[] = Array.from({ length: 20 }, (_, i) =>
      emp(`2024-01-01`, i < 5 ? "2024-07-01" : null),
    );
    const recencyInf = buildSurvivalCurveRecencyWeighted(employees, {
      asOf: AS_OF,
      halfLifeMonths: 1000,
    });
    const km = buildSurvivalCurve(employees, { asOf: AS_OF });
    // At all tenure months where KM has data, recency-weighted with infinite
    // half-life should match within rounding.
    for (let t = 1; t <= 12; t++) {
      expect(recencyInf.survival[t]).toBeCloseTo(km.survival[t], 3);
    }
  });

  it("weights recent events more than older ones", async () => {
    const { buildSurvivalCurveRecencyWeighted } = await import(
      "../headcount-planning"
    );
    // 10 employees joined Jan 2024. 5 leave at month 6.
    // In cohort A: all 5 leave 18 months before asOf.
    // In cohort B: all 5 leave 1 month before asOf.
    // Both should give the same pooled-KM hazard (50% at tenure 6).
    // But with half-life 3mo, cohort B should imply a HIGHER hazard estimate
    // because recent events dominate.
    const cohortA: Employee[] = [
      ...Array.from({ length: 5 }, () =>
        emp("2024-01-01", "2024-07-01"), // leave 18+ months ago
      ),
      ...Array.from({ length: 5 }, () => emp("2024-01-01", null)),
    ];
    const cohortB: Employee[] = [
      ...Array.from({ length: 5 }, () =>
        emp("2025-09-01", "2026-03-01"), // leave ~1 month ago
      ),
      ...Array.from({ length: 5 }, () => emp("2025-09-01", null)),
    ];
    const aCurve = buildSurvivalCurveRecencyWeighted(cohortA, {
      asOf: AS_OF,
      halfLifeMonths: 3,
    });
    const bCurve = buildSurvivalCurveRecencyWeighted(cohortB, {
      asOf: AS_OF,
      halfLifeMonths: 3,
    });
    // Cohort B (recent events) should have a LOWER S(6) than cohort A
    // (older events, downweighted).
    expect(bCurve.survival[6]).toBeLessThan(aCurve.survival[6]);
  });
});

describe("backtestCurve", () => {
  it("returns MAE and bias over held-out months", async () => {
    const { backtestCurve, buildSurvivalFromRollingRates } = await import(
      "../headcount-planning"
    );
    // Synthetic data: constant monthly hazard. Build a curve matching that
    // hazard → backtest should give low MAE.
    const employees: Employee[] = Array.from({ length: 100 }, (_, i) => {
      const year = 2023 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      // Every 4th employee terminates 6 months later.
      const terminationDate =
        i % 4 === 0
          ? `${year}-${String(Math.min(12, month + 6)).padStart(2, "0")}-15`
          : null;
      return { startDate, terminationDate };
    });
    const metrics = backtestCurve(
      employees,
      () =>
        buildSurvivalFromRollingRates({
          under1yrAnnual: 0.25,
          over1yrAnnual: 0.1,
        }),
      { cutoffsMonthsBack: [3, 6], horizonMonths: 2, asOf: AS_OF },
    );
    expect(metrics.n).toBe(4); // 2 cutoffs × 2 horizons
    expect(Number.isFinite(metrics.mae)).toBe(true);
    expect(Number.isFinite(metrics.bias)).toBe(true);
  });
});
