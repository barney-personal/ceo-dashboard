import { describe, expect, it } from "vitest";
import {
  forecastTeamHires,
  totalForecastOverRange,
} from "../talent-forecast";
import type { MonthlyHires } from "../talent-utils";

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
