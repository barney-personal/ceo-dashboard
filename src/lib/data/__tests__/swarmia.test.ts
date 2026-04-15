import { describe, expect, it } from "vitest";
import {
  classifyDeployFrequency,
  classifyChangeLeadTime,
  classifyChangeFailureRate,
  classifyMttr,
  normalizeTeamName,
  periodDaysToSwarmiaTimeframe,
  computePillarMovers,
  type PillarTrends,
} from "../swarmia";

// ---------------------------------------------------------------------------
// DORA classifiers — boundaries matter because the UI colors cards by band.
// ---------------------------------------------------------------------------

describe("classifyDeployFrequency", () => {
  it("classifies values at and around each boundary", () => {
    // Elite: >= 1/day. High: >= 1/7 per day (weekly).
    // Medium: >= 1/30 per day (monthly). Low: below.
    expect(classifyDeployFrequency(10).band).toBe("elite");
    expect(classifyDeployFrequency(1).band).toBe("elite");
    expect(classifyDeployFrequency(0.99).band).toBe("high");
    expect(classifyDeployFrequency(1 / 7).band).toBe("high");
    expect(classifyDeployFrequency(1 / 7 - 0.001).band).toBe("medium");
    expect(classifyDeployFrequency(1 / 30).band).toBe("medium");
    expect(classifyDeployFrequency(1 / 30 - 0.001).band).toBe("low");
    expect(classifyDeployFrequency(0).band).toBe("low");
  });
});

describe("classifyChangeLeadTime", () => {
  it("boundaries at 1d / 1w / 1m in minutes", () => {
    const min = (hrs: number) => hrs * 60;
    expect(classifyChangeLeadTime(min(23)).band).toBe("elite");
    expect(classifyChangeLeadTime(min(24)).band).toBe("high");
    expect(classifyChangeLeadTime(min(24 * 7 - 1)).band).toBe("high");
    expect(classifyChangeLeadTime(min(24 * 7)).band).toBe("medium");
    expect(classifyChangeLeadTime(min(24 * 30 - 1)).band).toBe("medium");
    expect(classifyChangeLeadTime(min(24 * 30)).band).toBe("low");
  });
});

describe("classifyChangeFailureRate", () => {
  it("boundaries at 5% / 15% / 30%", () => {
    expect(classifyChangeFailureRate(0).band).toBe("elite");
    expect(classifyChangeFailureRate(5).band).toBe("elite");
    expect(classifyChangeFailureRate(5.01).band).toBe("high");
    expect(classifyChangeFailureRate(15).band).toBe("high");
    expect(classifyChangeFailureRate(15.01).band).toBe("medium");
    expect(classifyChangeFailureRate(30).band).toBe("medium");
    expect(classifyChangeFailureRate(30.01).band).toBe("low");
  });
});

describe("classifyMttr", () => {
  it("boundaries at 1h / 1d / 1w in minutes", () => {
    expect(classifyMttr(0).band).toBe("elite");
    expect(classifyMttr(59).band).toBe("elite");
    expect(classifyMttr(60).band).toBe("high");
    expect(classifyMttr(60 * 24 - 1).band).toBe("high");
    expect(classifyMttr(60 * 24).band).toBe("medium");
    expect(classifyMttr(60 * 24 * 7 - 1).band).toBe("medium");
    expect(classifyMttr(60 * 24 * 7).band).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// normalizeTeamName — HiBob appends " Squad" / " Team"; Swarmia doesn't.
// ---------------------------------------------------------------------------

describe("normalizeTeamName", () => {
  it("lowercases and trims whitespace", () => {
    expect(normalizeTeamName("  BNPL  ")).toBe("bnpl");
  });

  it("strips trailing ' Squad' regardless of case", () => {
    expect(normalizeTeamName("Bills Squad")).toBe("bills");
    expect(normalizeTeamName("SAVINGS SQUAD")).toBe("savings");
    expect(normalizeTeamName("Card squad")).toBe("card");
  });

  it("strips trailing ' Team'", () => {
    expect(normalizeTeamName("Platform Team")).toBe("platform");
  });

  it("only strips a TRAILING suffix, not one in the middle", () => {
    expect(normalizeTeamName("Squad Bills")).toBe("squad bills");
    expect(normalizeTeamName("Team Platform")).toBe("team platform");
  });

  it("handles null / undefined / empty string", () => {
    expect(normalizeTeamName(null)).toBe("");
    expect(normalizeTeamName(undefined)).toBe("");
    expect(normalizeTeamName("")).toBe("");
    expect(normalizeTeamName("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// periodDaysToSwarmiaTimeframe — picker values don't all map 1:1.
// ---------------------------------------------------------------------------

describe("periodDaysToSwarmiaTimeframe", () => {
  it("rounds into Swarmia presets correctly", () => {
    expect(periodDaysToSwarmiaTimeframe(30)).toBe("last_30_days");
    expect(periodDaysToSwarmiaTimeframe(90)).toBe("last_90_days");
    expect(periodDaysToSwarmiaTimeframe(180)).toBe("last_180_days");
    // 360 isn't a Swarmia preset; it rounds to the 365 bucket.
    expect(periodDaysToSwarmiaTimeframe(360)).toBe("last_365_days");
  });

  it("rounds intermediate values to the next-larger bucket", () => {
    expect(periodDaysToSwarmiaTimeframe(1)).toBe("last_30_days");
    expect(periodDaysToSwarmiaTimeframe(45)).toBe("last_90_days");
    expect(periodDaysToSwarmiaTimeframe(120)).toBe("last_180_days");
    expect(periodDaysToSwarmiaTimeframe(200)).toBe("last_365_days");
    expect(periodDaysToSwarmiaTimeframe(999)).toBe("last_365_days");
  });
});

// ---------------------------------------------------------------------------
// computePillarMovers — the most-conditional logic on the page.
// ---------------------------------------------------------------------------

/**
 * Build a 12-week PillarTrends fixture where the final week's metrics
 * differ from the prior 4-week average by a configurable factor.
 */
function buildTrends(
  spec: Array<{
    pillar: string;
    priorCycleHours?: number;
    lastCycleHours?: number;
    priorReviewPercent?: number;
    lastReviewPercent?: number;
    priorPrsPerWeek?: number;
    lastPrsPerWeek?: number;
  }>
): PillarTrends {
  return {
    pillars: spec.map(({ pillar, ...v }) => {
      // 12 weeks total. Weeks 0–10 use prior values, week 11 uses last.
      const priorWeek = {
        weekStart: "prior",
        cycleTimeHours: v.priorCycleHours ?? 24,
        reviewRatePercent: v.priorReviewPercent ?? 90,
        prsPerWeek: v.priorPrsPerWeek ?? 20,
      };
      const lastWeek = {
        weekStart: "2026-04-06",
        cycleTimeHours: v.lastCycleHours ?? 24,
        reviewRatePercent: v.lastReviewPercent ?? 90,
        prsPerWeek: v.lastPrsPerWeek ?? 20,
      };
      const weeks = Array.from({ length: 11 }, () => priorWeek);
      weeks.push(lastWeek);
      return { pillar, weeks };
    }),
  };
}

describe("computePillarMovers", () => {
  it("classifies cycle-time increases as worsened (lower is better)", () => {
    const trends = buildTrends([
      { pillar: "Growth", priorCycleHours: 24, lastCycleHours: 48 },
    ]);
    const { movers } = computePillarMovers(trends, 10);
    const mover = movers.find((m) => m.metric === "Cycle time");
    expect(mover).toBeDefined();
    expect(mover!.direction).toBe("worsened");
    expect(mover!.deltaPercent).toBeGreaterThan(0);
  });

  it("classifies cycle-time decreases as improved", () => {
    const trends = buildTrends([
      { pillar: "Growth", priorCycleHours: 48, lastCycleHours: 24 },
    ]);
    const { movers } = computePillarMovers(trends, 10);
    const mover = movers.find((m) => m.metric === "Cycle time");
    expect(mover!.direction).toBe("improved");
    expect(mover!.deltaPercent).toBeLessThan(0);
  });

  it("classifies review-rate increases as improved (higher is better)", () => {
    const trends = buildTrends([
      { pillar: "Platform", priorReviewPercent: 80, lastReviewPercent: 100 },
    ]);
    const { movers } = computePillarMovers(trends, 10);
    const mover = movers.find((m) => m.metric === "Review rate");
    expect(mover!.direction).toBe("improved");
    expect(mover!.deltaPercent).toBeGreaterThan(0);
  });

  it("classifies throughput decreases as worsened", () => {
    const trends = buildTrends([
      { pillar: "Chat", priorPrsPerWeek: 40, lastPrsPerWeek: 20 },
    ]);
    const { movers } = computePillarMovers(trends, 10);
    const mover = movers.find((m) => m.metric === "PRs / week");
    expect(mover!.direction).toBe("worsened");
  });

  it("skips dormant pillars (prior avg PRs below the threshold)", () => {
    const trends = buildTrends([
      {
        pillar: "Dormant",
        priorPrsPerWeek: 1, // below default minPrevPrsPerWeek (2)
        lastPrsPerWeek: 50,
        priorCycleHours: 1,
        lastCycleHours: 100,
      },
    ]);
    const { movers } = computePillarMovers(trends, 10);
    expect(movers).toHaveLength(0);
  });

  it("sorts by largest absolute delta first", () => {
    const trends = buildTrends([
      { pillar: "Small", priorCycleHours: 24, lastCycleHours: 25 }, // +4%
      { pillar: "Large", priorCycleHours: 24, lastCycleHours: 48 }, // +100%
      { pillar: "Medium", priorCycleHours: 24, lastCycleHours: 36 }, // +50%
    ]);
    const { movers } = computePillarMovers(trends, 10);
    const cycleMovers = movers.filter((m) => m.metric === "Cycle time");
    expect(cycleMovers.map((m) => m.pillar)).toEqual(["Large", "Medium", "Small"]);
  });

  it("respects the limit parameter", () => {
    const trends = buildTrends([
      { pillar: "A", priorCycleHours: 24, lastCycleHours: 48 },
      { pillar: "B", priorCycleHours: 24, lastCycleHours: 36 },
      { pillar: "C", priorCycleHours: 24, lastCycleHours: 30 },
      { pillar: "D", priorCycleHours: 24, lastCycleHours: 28 },
    ]);
    const result = computePillarMovers(trends, 2);
    expect(result.movers).toHaveLength(2);
  });

  it("returns the window label so the UI can render it", () => {
    const { windowLabel } = computePillarMovers(buildTrends([]), 3);
    expect(windowLabel).toBeTruthy();
    expect(windowLabel).toContain("week");
  });

  it("skips pillars with fewer than 5 weeks of data", () => {
    const trends: PillarTrends = {
      pillars: [
        {
          pillar: "TooNew",
          weeks: Array.from({ length: 3 }, () => ({
            weekStart: "x",
            cycleTimeHours: 24,
            reviewRatePercent: 90,
            prsPerWeek: 20,
          })),
        },
      ],
    };
    const { movers } = computePillarMovers(trends);
    expect(movers).toHaveLength(0);
  });
});
