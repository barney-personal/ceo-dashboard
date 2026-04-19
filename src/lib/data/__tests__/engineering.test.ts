import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/lib/db/schema", () => ({
  githubPrs: {
    authorLogin: "authorLogin",
    authorAvatarUrl: "authorAvatarUrl",
    additions: "additions",
    deletions: "deletions",
    changedFiles: "changedFiles",
    repo: "repo",
    mergedAt: "mergedAt",
  },
  githubCommits: {
    authorLogin: "authorLogin",
    committedAt: "committedAt",
  },
  githubEmployeeMap: {
    githubLogin: "githubLogin",
    employeeName: "employeeName",
    employeeEmail: "employeeEmail",
    isBot: "isBot",
  },
}));

vi.mock("drizzle-orm", () => ({
  gte: vi.fn(),
  desc: vi.fn((v) => v),
  eq: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      template: strings,
      values,
      as: (alias: string) => ({ alias }),
      mapWith: () => ({ as: (alias: string) => ({ alias }) }),
    }),
    {
      raw: vi.fn(),
    }
  ),
  count: vi.fn(() => ({ as: (alias: string) => ({ alias }) })),
  sum: vi.fn(() => ({
    mapWith: () => ({ as: (alias: string) => ({ alias }) }),
  })),
}));

import {
  getEngineeringRankings,
  computeImpact,
  computeImpactRate,
  MIN_ACTIVE_DAYS,
  RAMPING_DAYS,
} from "../engineering";

afterEach(() => {
  mockSelect.mockReset();
});

describe("computeImpact", () => {
  it("is zero when no PRs", () => {
    expect(computeImpact(0, 500, 200)).toBe(0);
    expect(computeImpact(-1, 100, 100)).toBe(0);
  });

  it("scales roughly linearly with PR count for fixed lines-per-PR", () => {
    const one = computeImpact(1, 100, 100);
    const ten = computeImpact(10, 1000, 1000);
    // Rounded math drifts by a small amount; stay within 5%
    expect(ten).toBeGreaterThan(one * 9.5);
    expect(ten).toBeLessThan(one * 10.5);
  });

  it("log-scales lines-per-PR so one giant PR can't dominate", () => {
    const steady = computeImpact(20, 2000, 2000);
    const oneMega = computeImpact(1, 20_000, 20_000);
    expect(steady).toBeGreaterThan(oneMega);
  });
});

describe("computeImpactRate", () => {
  it("scales short tenures up to a 30-day cadence so new hires rank fairly", () => {
    // 10 days at Cleo, 5 impact over those 10 days should project to 15/30d
    const rate = computeImpactRate(5, 10, 360);
    // activeDays floors at MIN_ACTIVE_DAYS (14), so it's actually 5 * 30 / 14
    expect(rate.activeDays).toBe(MIN_ACTIVE_DAYS);
    expect(rate.impactPer30d).toBe(Math.round((5 * 30) / MIN_ACTIVE_DAYS));
    expect(rate.isRamping).toBe(true);
  });

  it("caps denominator at the period when tenure >= period", () => {
    // 500-day engineer, 360-day window, impact = 600 → 600 * 30 / 360 = 50/30d
    const rate = computeImpactRate(600, 500, 360);
    expect(rate.activeDays).toBe(360);
    expect(rate.impactPer30d).toBe(50);
    expect(rate.isRamping).toBe(false);
  });

  it("uses tenure when tenure < period (new hire case)", () => {
    // 60 days tenure, 360 day period, impact 30 → normalised over 60
    const rate = computeImpactRate(30, 60, 360);
    expect(rate.activeDays).toBe(60);
    expect(rate.impactPer30d).toBe(15);
    expect(rate.isRamping).toBe(false);
  });

  it("flags ramping engineers below RAMPING_DAYS regardless of rate", () => {
    const rate = computeImpactRate(100, RAMPING_DAYS - 1, 90);
    expect(rate.isRamping).toBe(true);
  });

  it("doesn't flag as ramping when tenure is unknown", () => {
    // Unknown tenure → treated as full period, not demoted
    const rate = computeImpactRate(10, null, 90);
    expect(rate.isRamping).toBe(false);
    expect(rate.activeDays).toBe(90);
  });

  it("applies MIN_ACTIVE_DAYS floor to avoid silly rate inflation", () => {
    // 1 day tenure, 1 impact → without floor would be 30/30d (absurd)
    const rate = computeImpactRate(1, 1, 360);
    expect(rate.activeDays).toBe(MIN_ACTIVE_DAYS);
    expect(rate.impactPer30d).toBe(Math.round((1 * 30) / MIN_ACTIVE_DAYS));
  });
});

describe("getEngineeringRankings", () => {
  it("surfaces Postgres outages as DatabaseUnavailableError", async () => {
    const throwingChain = {
      select: () => throwingChain,
      from: () => throwingChain,
      innerJoin: () => throwingChain,
      leftJoin: () => throwingChain,
      where: () => throwingChain,
      groupBy: () => throwingChain,
      orderBy: () => Promise.reject(new Error("fetch failed")),
      as: () => throwingChain,
    };
    mockSelect.mockImplementation(() => throwingChain);

    await expect(getEngineeringRankings(30)).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });
});
