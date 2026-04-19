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

import { getEngineeringRankings, computeImpact } from "../engineering";

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

describe("getEngineeringRankings", () => {
  it("surfaces Postgres outages as DatabaseUnavailableError", async () => {
    // Make every chained call return the same thenable object, and have
    // `await`-ing it reject — this way the caller can chain any combination
    // of select/from/where/groupBy/etc. without us needing to know the
    // exact drizzle shape under test.
    const throwingChain: Record<string, unknown> = {};
    const chainMethods = [
      "select",
      "from",
      "innerJoin",
      "leftJoin",
      "where",
      "groupBy",
      "orderBy",
      "as",
    ];
    for (const m of chainMethods) throwingChain[m] = () => throwingChain;
    throwingChain.then = (
      _resolve: (v: unknown) => unknown,
      reject: (e: Error) => unknown
    ) => reject(new Error("fetch failed"));
    mockSelect.mockImplementation(() => throwingChain);

    await expect(getEngineeringRankings(30)).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });
});
