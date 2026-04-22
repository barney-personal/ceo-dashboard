import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockGetActiveEmployees, mockGetAiUsageData } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockGetActiveEmployees: vi.fn(),
    mockGetAiUsageData: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("../people", async () => {
  const actual = await vi.importActual<typeof import("../people")>("../people");
  return {
    ...actual,
    getActiveEmployees: mockGetActiveEmployees,
  };
});

vi.mock("../ai-usage", async () => {
  const actual =
    await vi.importActual<typeof import("../ai-usage")>("../ai-usage");
  return {
    ...actual,
    getAiUsageData: mockGetAiUsageData,
  };
});

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
  mockGetActiveEmployees.mockReset();
  mockGetAiUsageData.mockReset();
});

/** Default no-data AI usage payload — overridable per-test. */
function emptyAiUsage() {
  return {
    weeklyByCategory: [],
    weeklyByModel: [],
    monthlyByModel: [],
    monthlyByUser: [],
    syncedAt: null,
    missing: [],
  };
}

/** Build a drizzle-query-shaped thenable whose `await` resolves with `rows`. */
function chainResolving(rows: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of [
    "select",
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "groupBy",
    "orderBy",
    "as",
  ]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return chain;
}

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
  // Cast to `any` because Person has ~12 fields we don't care about here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const person = (over: Record<string, unknown>): any => ({
    name: "Test",
    email: "test@example.com",
    jobTitle: "Backend Engineer",
    level: "B3",
    squad: null,
    pillar: null,
    function: "Engineering",
    manager: "",
    startDate: "2020-01-01",
    location: "",
    tenureMonths: 50,
    employmentType: "FTE",
    ...over,
  });

  function mockDb(opts: {
    prRows?: unknown[];
    commitRows?: unknown[];
    ghMapRows?: unknown[];
  }) {
    const { prRows = [], commitRows = [], ghMapRows = [] } = opts;
    mockSelect
      .mockReturnValueOnce(chainResolving(prRows))
      .mockReturnValueOnce(chainResolving(commitRows))
      .mockReturnValueOnce(chainResolving(ghMapRows));
  }

  it("excludes non-engineering functions from the ranking", async () => {
    mockDb({});
    mockGetAiUsageData.mockResolvedValue(emptyAiUsage());
    mockGetActiveEmployees.mockResolvedValue({
      employees: [
        person({ email: "eng@x.com", function: "Engineering" }),
        person({ email: "pm@x.com", function: "Product" }),
        person({ email: "marketer@x.com", function: "Marketing" }),
      ],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEngineeringRankings(30);
    expect(result.map((r) => r.employeeEmail)).toEqual(["eng@x.com"]);
  });

  it("marks engineers with no PRs in the window as silent", async () => {
    mockDb({
      prRows: [
        {
          login: "alice-gh",
          avatarUrl: "https://example.com/a.png",
          prsCount: 4,
          additions: 200,
          deletions: 50,
          changedFiles: 12,
          repos: ["web"],
        },
      ],
      ghMapRows: [
        {
          githubLogin: "alice-gh",
          employeeEmail: "alice@x.com",
          isBot: false,
        },
        {
          githubLogin: "bob-gh",
          employeeEmail: "bob@x.com",
          isBot: false,
        },
      ],
    });
    mockGetAiUsageData.mockResolvedValue(emptyAiUsage());
    mockGetActiveEmployees.mockResolvedValue({
      employees: [
        person({ email: "alice@x.com", name: "Alice" }),
        person({ email: "bob@x.com", name: "Bob" }),
      ],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEngineeringRankings(30);
    const byEmail = Object.fromEntries(result.map((r) => [r.employeeEmail, r]));

    expect(byEmail["alice@x.com"]).toMatchObject({
      prsCount: 4,
      silent: false,
      githubMapped: true,
    });
    expect(byEmail["bob@x.com"]).toMatchObject({
      prsCount: 0,
      additions: 0,
      silent: true,
      githubMapped: true,
    });
  });

  it("flags unmapped engineers with githubMapped=false", async () => {
    mockDb({ ghMapRows: [] });
    mockGetAiUsageData.mockResolvedValue(emptyAiUsage());
    mockGetActiveEmployees.mockResolvedValue({
      employees: [person({ email: "nomap@x.com" })],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEngineeringRankings(30);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      githubMapped: false,
      silent: true,
    });
  });

  it("returns tenureDays computed from startDate, and null for unparseable dates", async () => {
    mockDb({});
    mockGetAiUsageData.mockResolvedValue(emptyAiUsage());
    const fiveDaysAgoIso = new Date(Date.now() - 5 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    mockGetActiveEmployees.mockResolvedValue({
      employees: [
        person({ email: "recent@x.com", startDate: fiveDaysAgoIso }),
        person({ email: "bad@x.com", startDate: "not-a-date" }),
        person({ email: "missing@x.com", startDate: "" }),
      ],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEngineeringRankings(30);
    const byEmail = Object.fromEntries(result.map((r) => [r.employeeEmail, r]));

    // Recent hire → computed tenure, small positive integer
    expect(byEmail["recent@x.com"].tenureDays).toBeGreaterThanOrEqual(4);
    expect(byEmail["recent@x.com"].tenureDays).toBeLessThanOrEqual(6);
    // Malformed date must NOT propagate NaN — coerced to 0 by computeTenureDays
    expect(byEmail["bad@x.com"].tenureDays).toBe(0);
    // Empty string → null, handled by the falsy-startDate branch
    expect(byEmail["missing@x.com"].tenureDays).toBeNull();
  });

  it("does not leak startDate into the returned payload", async () => {
    mockDb({});
    mockGetAiUsageData.mockResolvedValue(emptyAiUsage());
    mockGetActiveEmployees.mockResolvedValue({
      employees: [person({ startDate: "2021-06-15" })],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEngineeringRankings(30);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("startDate");
  });

  it("joins AI usage onto each engineer by lowercase email", async () => {
    mockDb({});
    // Two engineers, only Alice has AI usage rows for the latest month.
    // Bob has none → his row should carry null AI fields, not undefined or 0.
    mockGetAiUsageData.mockResolvedValue({
      weeklyByCategory: [],
      weeklyByModel: [],
      monthlyByModel: [],
      monthlyByUser: [
        {
          monthStart: "2026-04-01",
          category: "claude",
          userEmail: "alice@x.com",
          nDays: 12,
          nModelsUsed: 2,
          totalCost: 400,
          totalTokens: 600_000_000,
          medianTokensPerPerson: 0,
          avgTokensPerPerson: 0,
          avgCostPerPerson: 0,
          medianCost: 0,
        },
        {
          monthStart: "2026-04-01",
          category: "cursor",
          userEmail: "alice@x.com",
          nDays: 8,
          nModelsUsed: 1,
          totalCost: 60,
          totalTokens: 90_000_000,
          medianTokensPerPerson: 0,
          avgTokensPerPerson: 0,
          avgCostPerPerson: 0,
          medianCost: 0,
        },
      ],
      syncedAt: new Date("2026-04-22T06:00:00Z"),
      missing: [],
    });
    mockGetActiveEmployees.mockResolvedValue({
      // Mixed-case email proves the join is case-insensitive.
      employees: [
        person({ email: "ALICE@x.com", name: "Alice" }),
        person({ email: "bob@x.com", name: "Bob" }),
      ],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEngineeringRankings(30);
    const byEmail = Object.fromEntries(
      result.map((r) => [(r.employeeEmail ?? "").toLowerCase(), r]),
    );

    // Alice's AI fields combine claude + cursor rows for the latest month.
    expect(byEmail["alice@x.com"]).toMatchObject({
      aiSpend: 460, // 400 + 60
      aiTokens: 690_000_000,
      aiMonthStart: "2026-04-01",
    });
    // Bob has no AI usage → fields should be null, NOT 0 (so the column
    // can render "—" instead of misleadingly saying "$0").
    expect(byEmail["bob@x.com"]).toMatchObject({
      aiSpend: null,
      aiTokens: null,
      aiMonthStart: null,
    });
  });

  it("degrades to null AI fields when getAiUsageData throws", async () => {
    mockDb({});
    mockGetAiUsageData.mockRejectedValue(new Error("Mode unreachable"));
    mockGetActiveEmployees.mockResolvedValue({
      employees: [person({ email: "alice@x.com" })],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEngineeringRankings(30);
    expect(result[0]).toMatchObject({
      aiSpend: null,
      aiTokens: null,
      aiMonthStart: null,
    });
  });

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
