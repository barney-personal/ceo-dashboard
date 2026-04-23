import { describe, expect, it } from "vitest";
import {
  forecastFromActiveCapacity,
  forecastTeamHires,
  totalForecastOverRange,
} from "../talent-forecast";
import type { MonthlyHires, RecruiterHistory } from "../talent-utils";

function mh(month: string, hires: number): MonthlyHires {
  return { month, hires };
}

describe("forecastTeamHires", () => {
  it("produces a flat projection when history has zero slope", () => {
    const history = [
      mh("2025-01", 10),
      mh("2025-02", 10),
      mh("2025-03", 10),
      mh("2025-04", 10),
      mh("2025-05", 10),
      mh("2025-06", 10),
    ];
    const { forecast, fit } = forecastTeamHires(history, "2025-09");
    expect(forecast).toHaveLength(3);
    expect(forecast.every((m) => Math.abs(m.mid - 10) < 1e-6)).toBe(true);
    // No variance, so bounds collapse onto the mid.
    expect(forecast.every((m) => m.low === m.mid)).toBe(true);
    expect(forecast.every((m) => m.high === m.mid)).toBe(true);
    expect(fit?.slopePerMonth).toBeCloseTo(0, 5);
  });

  it("extrapolates an upward trend with widening bounds", () => {
    // Perfect +2/mo trend → slope=2, σ=0 → bands should collapse to the
    // trend line and widen only because of the 1/n term in SE.
    const history = [
      mh("2025-01", 10),
      mh("2025-02", 12),
      mh("2025-03", 14),
      mh("2025-04", 16),
      mh("2025-05", 18),
      mh("2025-06", 20),
    ];
    const { forecast, fit } = forecastTeamHires(history, "2025-09");
    expect(fit?.slopePerMonth).toBeCloseTo(2, 5);
    expect(forecast[0].month).toBe("2025-07");
    expect(forecast[0].mid).toBeCloseTo(22, 5);
    expect(forecast[1].mid).toBeCloseTo(24, 5);
    expect(forecast[2].mid).toBeCloseTo(26, 5);
  });

  it("excludes the in-progress current month from the fit but still starts the projection the next month", () => {
    const history = [
      mh("2025-01", 10),
      mh("2025-02", 10),
      mh("2025-03", 10),
      mh("2025-04", 10),
      mh("2025-05", 3), // partial current month — shouldn't drag trend
    ];
    const { forecast, fit } = forecastTeamHires(history, "2025-07", {
      currentMonth: "2025-05",
    });
    expect(fit?.slopePerMonth).toBeCloseTo(0, 5);
    expect(fit?.trainingMonths).toBe(4);
    // Projection starts the month after the last observed month.
    expect(forecast[0].month).toBe("2025-06");
    expect(forecast.map((f) => f.mid.toFixed(1))).toEqual(["10.0", "10.0"]);
  });

  it("widens the prediction interval further out", () => {
    // Noisy data — should produce a non-zero σ.
    const history = [
      mh("2025-01", 10),
      mh("2025-02", 14),
      mh("2025-03", 12),
      mh("2025-04", 16),
      mh("2025-05", 13),
      mh("2025-06", 18),
      mh("2025-07", 15),
      mh("2025-08", 20),
      mh("2025-09", 17),
      mh("2025-10", 22),
      mh("2025-11", 20),
      mh("2025-12", 24),
    ];
    const { forecast } = forecastTeamHires(history, "2026-06");
    expect(forecast).toHaveLength(6);
    // Near-term bound should be tighter than far-horizon bound.
    const nearHalfWidth = forecast[0].high - forecast[0].mid;
    const farHalfWidth = forecast[5].high - forecast[5].mid;
    expect(farHalfWidth).toBeGreaterThan(nearHalfWidth);
    // Low is clamped to zero.
    expect(forecast.every((m) => m.low >= 0)).toBe(true);
  });

  it("returns an empty forecast when there are fewer than 3 complete months", () => {
    expect(forecastTeamHires([mh("2025-01", 10)], "2025-06")).toEqual({
      forecast: [],
      fit: null,
    });
    expect(
      forecastTeamHires([mh("2025-01", 10), mh("2025-02", 12)], "2025-06"),
    ).toEqual({ forecast: [], fit: null });
  });

  it("forecasts across a year+ horizon through Dec 2027", () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      mh(`2025-${String(i + 1).padStart(2, "0")}`, 10 + i),
    );
    const { forecast } = forecastTeamHires(history, "2027-12");
    // Jan 2026 → Dec 2027 = 24 months.
    expect(forecast.length).toBe(24);
    expect(forecast[0].month).toBe("2026-01");
    expect(forecast[forecast.length - 1].month).toBe("2027-12");
  });
});

describe("forecastFromActiveCapacity", () => {
  function history(
    recruiter: string,
    series: Array<[string, number]>,
  ): RecruiterHistory {
    return {
      recruiter,
      monthly: series.map(([month, hires]) => ({ month, hires })),
    };
  }

  it("sums per-recruiter trailing-3 means across the active roster", () => {
    const histories = [
      history("Alice", [
        ["2025-11", 1],
        ["2025-12", 2],
        ["2026-01", 3],
        ["2026-02", 2],
        ["2026-03", 3],
      ]),
      history("Bob", [
        ["2026-01", 1],
        ["2026-02", 1],
        ["2026-03", 1],
      ]),
      // Charlie departed — must be excluded.
      history("Charlie", [
        ["2025-06", 5],
        ["2025-07", 5],
        ["2025-08", 5],
      ]),
    ];
    const { forecast, teamMeanMonthly } = forecastFromActiveCapacity(
      histories,
      ["Alice", "Bob"],
      "2026-04",
      "2026-06",
    );
    // Alice's trailing 3 months: (3+2+3)/3 = 2.67
    // Bob's trailing 3 months: (1+1+1)/3 = 1.0
    // Team: 3.67
    expect(teamMeanMonthly).toBeCloseTo(3.667, 2);
    expect(forecast).toHaveLength(3);
    // Flat projection — no trend term.
    expect(forecast[0].mid).toBeCloseTo(3.667, 2);
    expect(forecast[2].mid).toBeCloseTo(3.667, 2);
  });

  it("excludes the in-progress current month from each recruiter's window", () => {
    const histories = [
      history("Alice", [
        ["2026-01", 3],
        ["2026-02", 3],
        ["2026-03", 3],
        ["2026-04", 0], // partial
      ]),
    ];
    const { teamMeanMonthly } = forecastFromActiveCapacity(
      histories,
      ["Alice"],
      "2026-05",
      "2026-07",
      { currentMonth: "2026-04" },
    );
    // Partial April is excluded, so trailing 3 = Jan/Feb/Mar = 3.
    expect(teamMeanMonthly).toBeCloseTo(3, 5);
  });

  it("gives contributors with zero history a zero contribution (no crash)", () => {
    const { forecast, contributors, teamMeanMonthly } =
      forecastFromActiveCapacity([], ["NewJoiner"], "2026-05", "2026-06");
    expect(teamMeanMonthly).toBe(0);
    expect(contributors[0].monthsOfHistory).toBe(0);
    expect(forecast.every((m) => m.mid === 0 && m.low === 0)).toBe(true);
  });

  it("sums σ in quadrature across independent recruiters", () => {
    // Alice: hires = [2, 4, 2, 4, 2, 4] → μ = 3, σ² = 1.2 (sample variance)
    // Bob:   hires = [1, 1, 1, 1, 1, 1] → σ = 0
    const histories = [
      history("Alice", [
        ["2025-11", 2],
        ["2025-12", 4],
        ["2026-01", 2],
        ["2026-02", 4],
        ["2026-03", 2],
        ["2026-04", 4],
      ]),
      history("Bob", [
        ["2025-11", 1],
        ["2025-12", 1],
        ["2026-01", 1],
        ["2026-02", 1],
        ["2026-03", 1],
        ["2026-04", 1],
      ]),
    ];
    const { teamSigmaMonthly, contributors } = forecastFromActiveCapacity(
      histories,
      ["Alice", "Bob"],
      "2026-05",
      "2026-06",
    );
    expect(contributors[0].sigmaMonthly).toBeGreaterThan(0);
    expect(contributors[1].sigmaMonthly).toBe(0);
    // Quadrature with one zero → should equal Alice's σ exactly.
    expect(teamSigmaMonthly).toBeCloseTo(contributors[0].sigmaMonthly, 5);
  });
});

describe("totalForecastOverRange", () => {
  it("sums low / mid / high across a calendar range", () => {
    const forecast = [
      { month: "2026-01", low: 10, mid: 12, high: 14 },
      { month: "2026-02", low: 11, mid: 13, high: 15 },
      { month: "2026-03", low: 12, mid: 14, high: 16 },
    ];
    const totals = totalForecastOverRange(forecast, {
      from: "2026-01",
      to: "2026-02",
    });
    expect(totals).toEqual({ low: 21, mid: 25, high: 29 });
  });

  it("returns null for a range with no overlap", () => {
    expect(
      totalForecastOverRange(
        [{ month: "2026-01", low: 10, mid: 12, high: 14 }],
        { from: "2027-01", to: "2027-12" },
      ),
    ).toBeNull();
  });
});
