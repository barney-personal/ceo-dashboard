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

import { getEngineeringRankings } from "../engineering";

afterEach(() => {
  mockSelect.mockReset();
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
