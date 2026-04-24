import { describe, expect, it } from "vitest";
import {
  forecastFromRoster,
  postRampSlice,
  profileTp,
} from "../talent-forecast-roster";
import type { RecruiterHistory } from "../talent-utils";

function history(recruiter: string, hiresByMonth: number[]): RecruiterHistory {
  return {
    recruiter,
    monthly: hiresByMonth.map((h, i) => {
      const year = 2024 + Math.floor(i / 12);
      const month = String((i % 12) + 1).padStart(2, "0");
      return { month: `${year}-${month}`, hires: h };
    }),
  };
}

describe("postRampSlice", () => {
  it("returns empty when no hires logged", () => {
    const mh = [0, 0, 0].map((h, i) => ({
      month: `2024-${String(i + 1).padStart(2, "0")}`,
      hires: h,
    }));
    expect(postRampSlice(mh, 2)).toEqual([]);
  });

  it("drops months before first hire plus rampMonths", () => {
    // hires: 0, 0, 1, 2, 3, 4, 5 → firstHireIdx=2, ramp=2 → slice from idx 4
    const mh = [0, 0, 1, 2, 3, 4, 5].map((h, i) => ({
      month: `2024-${String(i + 1).padStart(2, "0")}`,
      hires: h,
    }));
    const slice = postRampSlice(mh, 2);
    expect(slice.map((m) => m.hires)).toEqual([3, 4, 5]);
  });

  it("respects upToMonthExclusive for historical backtests", () => {
    const mh = [1, 2, 3, 4, 5].map((h, i) => ({
      month: `2024-${String(i + 1).padStart(2, "0")}`,
      hires: h,
    }));
    const slice = postRampSlice(mh, 2, "2024-04");
    // Up to but not including 2024-04 → months [01,02,03]; firstHire=01, ramp=2
    expect(slice.map((m) => m.hires)).toEqual([3]);
  });
});

describe("profileTp", () => {
  it("marks a TP eligible with ≥3 post-ramp months and computes EWMA productivity", () => {
    // Constant post-ramp hires: EWMA of a flat series = the constant.
    const h = history("Alice", [0, 0, 3, 3, 3, 3, 3]); // 7 months, firstHire=idx 2, postRamp from idx 4 → 3 points of 3
    const p = profileTp(h, { rampMonths: 2, minPostRampMonths: 3 });
    expect(p.eligible).toBe(true);
    expect(p.postRampMonths).toBe(3);
    expect(p.productivity).toBeCloseTo(3, 6);
    expect(p.productivityStd).toBeCloseTo(0, 6);
  });

  it("EWMA weights recent months more than older ones", () => {
    // firstHire=idx 2, ramp=2 → post-ramp from idx 4: [1,1,5,5,5,5].
    // Older half of post-ramp = 1/mo, recent half = 5/mo.
    const h = history("Beth", [0, 0, 1, 1, 1, 1, 5, 5, 5, 5]);
    const p = profileTp(h, { rampMonths: 2, minPostRampMonths: 3 });
    const simpleMean = (1 + 1 + 5 + 5 + 5 + 5) / 6;
    // EWMA should lean strongly toward recent (5/mo), well above the
    // simple arithmetic mean.
    expect(p.productivity).toBeGreaterThan(simpleMean);
    expect(p.productivity).toBeLessThanOrEqual(5);
    expect(p.postRampMean).toBeCloseTo(simpleMean, 5);
  });

  it("marks a TP ineligible when post-ramp is too short", () => {
    const h = history("Bob", [0, 0, 0, 1, 2]); // firstHireIdx=3, postRamp from idx 5 → empty
    const p = profileTp(h, { rampMonths: 2, minPostRampMonths: 3 });
    expect(p.eligible).toBe(false);
    expect(p.postRampMonths).toBe(0);
    expect(p.productivity).toBe(0);
  });

  it("excludes the current partial month", () => {
    const h = history("Carol", [1, 2, 3, 4, 99]); // 99 = current, should be dropped
    const p = profileTp(h, {
      rampMonths: 2,
      minPostRampMonths: 1,
      currentMonth: "2024-05",
    });
    // Post-ramp after currentMonth drop: [3, 4]. EWMA leans toward 4.
    expect(p.productivity).toBeGreaterThan(3);
    expect(p.productivity).toBeLessThanOrEqual(4);
  });
});

describe("forecastFromRoster", () => {
  it("sums per-TP EWMA productivity only — excludes departed TPs and non-roster hires", () => {
    // Two active TPs with flat 2 and 3 hire/mo post-ramp each.
    const histories: RecruiterHistory[] = [
      history("Alice", [1, 0, 2, 2, 2, 2, 2]), // post-ramp [2,2,2,2,2] → EWMA = 2
      history("Bob", [0, 1, 0, 3, 3, 3, 3]), // post-ramp [3,3,3,3] → EWMA = 3
      // Departed TP — should NOT contribute to the forecast.
      history("Dave", [4, 4, 4, 4, 4, 4, 4]),
    ];
    const { forecast, contributors } = forecastFromRoster(
      histories,
      ["Alice", "Bob"],
      "2024-08",
      "2024-10",
    );
    // Per-TP: 2 + 3 = 5. Dave is NOT in active roster → excluded.
    expect(forecast).toHaveLength(3);
    expect(forecast[0].mid).toBeCloseTo(5, 1);
    expect(contributors).toHaveLength(2);
  });

  it("produces a flat projection by design", () => {
    const histories: RecruiterHistory[] = [
      history("Alice", [1, 0, 2, 2, 2, 2, 2, 2]),
    ];
    const { forecast } = forecastFromRoster(
      histories,
      ["Alice"],
      "2024-09",
      "2024-12",
    );
    // All 4 forecast months should have identical mid (flat-projection model).
    const mids = forecast.map((f) => f.mid);
    for (let i = 1; i < mids.length; i++) {
      expect(mids[i]).toBeCloseTo(mids[0], 6);
    }
  });

  it("low bound clipped at 0", () => {
    const histories: RecruiterHistory[] = [
      history("Alice", [0, 0, 0, 1, 1]), // tiny
    ];
    const { forecast } = forecastFromRoster(
      histories,
      ["Alice"],
      "2024-06",
      "2024-06",
    );
    expect(forecast[0].low).toBeGreaterThanOrEqual(0);
  });
});
