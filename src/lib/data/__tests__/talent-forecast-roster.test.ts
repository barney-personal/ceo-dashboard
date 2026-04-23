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
  it("marks a TP eligible with ≥3 post-ramp months", () => {
    const h = history("Alice", [1, 0, 2, 1, 3, 2, 4]); // 7 months, firstHire=0, postRamp from idx 2 → 5 points
    const p = profileTp(h, { rampMonths: 2, minPostRampMonths: 3 });
    expect(p.eligible).toBe(true);
    expect(p.postRampMonths).toBe(5);
    expect(p.tenureMonths).toBe(7);
    expect(p.firstHireMonth).toBe("2024-01");
    // Post-ramp hires: 2, 1, 3, 2, 4 → median 2
    expect(p.median).toBe(2);
  });

  it("marks a TP ineligible when post-ramp is too short", () => {
    const h = history("Bob", [0, 0, 0, 1, 2]); // firstHireIdx=3, postRamp from idx 5 → empty
    const p = profileTp(h, { rampMonths: 2, minPostRampMonths: 3 });
    expect(p.eligible).toBe(false);
    expect(p.postRampMonths).toBe(0);
    expect(p.median).toBe(0);
  });

  it("excludes the current partial month", () => {
    const h = history("Carol", [1, 2, 3, 4, 99]); // 99 = current, should be dropped
    const p = profileTp(h, {
      rampMonths: 2,
      minPostRampMonths: 1,
      currentMonth: "2024-05",
    });
    // Post-ramp: 3, 4 (current month 99 dropped) → median 3.5
    expect(p.median).toBe(3.5);
  });
});

describe("forecastFromRoster", () => {
  it("sums per-TP medians + non-roster gap into the point forecast", () => {
    // Two active TPs with flat 2-hire/mo post-ramp each.
    const histories: RecruiterHistory[] = [
      history("Alice", [1, 0, 2, 2, 2, 2, 2]), // median = 2
      history("Bob", [0, 1, 0, 3, 3, 3, 3]), // firstHire idx 1, postRamp from 3: [3,3,3,3] → median 3
      // Departed TP — not in activeRecruiters but contributes hires in history.
      history("Dave", [4, 4, 4, 4, 4, 4, 4]),
    ];
    const { forecast, contributors, nonRosterGap } = forecastFromRoster(
      histories,
      ["Alice", "Bob"],
      "2024-08",
      "2024-10",
    );
    // Per-TP: Alice 2, Bob 3 → sum 5. Non-roster gap: Dave's 4/mo.
    // So forecast mid ≈ 5 + 4 = 9.
    expect(forecast).toHaveLength(3);
    expect(forecast[0].mid).toBeCloseTo(9, 0);
    expect(contributors).toHaveLength(2);
    expect(nonRosterGap).toBeCloseTo(4, 1);
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
