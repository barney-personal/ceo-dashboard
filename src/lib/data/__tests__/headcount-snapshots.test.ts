import { describe, expect, it } from "vitest";
import { computeForecastAccuracy } from "../headcount-snapshots";
import type { HeadcountForecastSnapshot } from "../headcount-snapshots";

function snap(
  asOfMonth: string,
  projection: Array<{
    month: string;
    low: number;
    mid: number;
    high: number;
  }>,
): HeadcountForecastSnapshot {
  return {
    id: 0,
    asOfMonth,
    capturedAt: new Date(),
    startingHeadcount: 500,
    hireScenarios: { low: 20, mid: 30, high: 40 },
    attritionRates: { under1yrAnnual: 0.34, over1yrAnnual: 0.4 },
    projection: projection.map((p) => ({
      ...p,
      hires: 30,
      departures: 20,
      netChange: 10,
    })),
  };
}

describe("computeForecastAccuracy", () => {
  it("returns zero hits when no target months have actuals yet", () => {
    const snaps = [
      snap("2026-01", [
        { month: "2026-02", low: 490, mid: 510, high: 530 },
      ]),
    ];
    const actuals = new Map<string, number>(); // none known
    const result = computeForecastAccuracy(snaps, actuals);
    expect(result.hits).toHaveLength(0);
    expect(result.mae).toBeNull();
    expect(result.bias).toBeNull();
    expect(result.coverage80).toBeNull();
  });

  it("aggregates MAE, bias, and coverage correctly", () => {
    const snaps = [
      snap("2026-01", [
        { month: "2026-02", low: 490, mid: 500, high: 510 }, // actual 505 → inBand, err +5
        { month: "2026-03", low: 500, mid: 520, high: 540 }, // actual 515 → inBand, err -5
        { month: "2026-04", low: 510, mid: 540, high: 570 }, // actual 600 → OUTSIDE, err +60
      ]),
    ];
    const actuals = new Map([
      ["2026-02", 505],
      ["2026-03", 515],
      ["2026-04", 600],
    ]);
    const r = computeForecastAccuracy(snaps, actuals);
    expect(r.nHits).toBe(3);
    // errors: +5, -5, +60 → MAE = 70/3, bias = 60/3
    expect(r.mae).toBeCloseTo(70 / 3, 5);
    expect(r.bias).toBeCloseTo(60 / 3, 5);
    // 2 of 3 in band → coverage = 2/3
    expect(r.coverage80).toBeCloseTo(2 / 3, 5);
  });

  it("records horizon as months between asOf and target", () => {
    const snaps = [
      snap("2026-01", [
        { month: "2026-02", low: 0, mid: 100, high: 200 },
        { month: "2026-07", low: 0, mid: 100, high: 200 },
      ]),
    ];
    const actuals = new Map([
      ["2026-02", 100],
      ["2026-07", 100],
    ]);
    const r = computeForecastAccuracy(snaps, actuals);
    const byMonth = Object.fromEntries(
      r.hits.map((h) => [h.targetMonth, h.horizonMonths]),
    );
    expect(byMonth["2026-02"]).toBe(1);
    expect(byMonth["2026-07"]).toBe(6);
  });

  it("ignores zero-or-negative horizons (target before asOf)", () => {
    // Snapshot captured in March but the projection somehow contains Feb
    // (shouldn't happen, but guard against bad data).
    const snaps = [
      snap("2026-03", [
        { month: "2026-02", low: 0, mid: 100, high: 200 },
        { month: "2026-03", low: 0, mid: 100, high: 200 },
        { month: "2026-04", low: 0, mid: 100, high: 200 },
      ]),
    ];
    const actuals = new Map([
      ["2026-02", 100],
      ["2026-03", 100],
      ["2026-04", 100],
    ]);
    const r = computeForecastAccuracy(snaps, actuals);
    // Only 2026-04 counts (horizon 1); the other two have horizon 0 or -1.
    expect(r.nHits).toBe(1);
    expect(r.hits[0].targetMonth).toBe("2026-04");
  });

  it("collects multiple snapshots' forecasts of the same target", () => {
    // Two snapshots (Jan, Feb) both forecasting April.
    const snaps = [
      snap("2026-01", [
        { month: "2026-04", low: 480, mid: 500, high: 520 }, // 3mo horizon
      ]),
      snap("2026-02", [
        { month: "2026-04", low: 490, mid: 510, high: 530 }, // 2mo horizon
      ]),
    ];
    const actuals = new Map([["2026-04", 515]]);
    const r = computeForecastAccuracy(snaps, actuals);
    // Both hits included — downstream dedup is the caller's job.
    expect(r.nHits).toBe(2);
    expect(r.hits.map((h) => h.horizonMonths).sort()).toEqual([2, 3]);
  });
});
