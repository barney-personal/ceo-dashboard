import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockGetReportData,
  mockGetAiUsageData,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockGetReportData: vi.fn(),
  mockGetAiUsageData: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));
vi.mock("@/lib/db/schema", () => ({
  githubPrs: {
    authorLogin: "authorLogin",
    mergedAt: "mergedAt",
    additions: "additions",
    deletions: "deletions",
  },
  githubEmployeeMap: {
    githubLogin: "githubLogin",
    employeeEmail: "employeeEmail",
    isBot: "isBot",
  },
}));
vi.mock("drizzle-orm", () => ({
  gte: vi.fn(),
  eq: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      template: strings,
      values,
      as: () => ({ alias: "x" }),
    }),
    { raw: vi.fn() },
  ),
  and: vi.fn(),
  inArray: vi.fn(),
}));
vi.mock("../mode", async () => {
  const actual = await vi.importActual<typeof import("../mode")>("../mode");
  return {
    ...actual,
    getReportData: mockGetReportData,
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

import { getImpactAnalysis } from "../engineering-impact";

afterEach(() => {
  mockSelect.mockReset();
  mockGetReportData.mockReset();
  mockGetAiUsageData.mockReset();
});

/** Build a drizzle-query-shaped thenable that resolves with `rows`. */
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
  ]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return chain;
}

function setupDb({
  mapRows,
  prsBounds,
  monthlyCounts,
  prs,
}: {
  mapRows: unknown[];
  prsBounds: { start: Date; end: Date };
  monthlyCounts: Array<{ month: Date; n: number }>;
  prs: unknown[];
}) {
  // The data fetcher chains 4 separate db.select calls in this order:
  // 1) employee map, 2) PR bounds, 3) monthlyCounts, 4) PRs.
  mockSelect
    .mockReturnValueOnce(chainResolving(mapRows))
    .mockReturnValueOnce(chainResolving([prsBounds]))
    .mockReturnValueOnce(chainResolving(monthlyCounts))
    .mockReturnValueOnce(chainResolving(prs));
}

describe("getImpactAnalysis — AI usage join", () => {
  it("attaches aiSpend / aiTokens / aiMonthStart by lowercase email", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "headcount",
        rows: [
          {
            email: "ALICE@meetcleo.com",
            preferred_name: "Alice",
            hb_function: "Engineering",
            hb_level: "L4",
            rp_specialisation: "Backend Engineer",
            rp_department_name: "Money Pillar",
            start_date: "2024-01-01",
          },
          {
            email: "bob@meetcleo.com",
            preferred_name: "Bob",
            hb_function: "Engineering",
            hb_level: "L3",
            rp_specialisation: "Frontend Engineer",
            rp_department_name: "Money Pillar",
            start_date: "2024-06-01",
          },
        ],
        syncedAt: new Date("2026-04-22T06:00:00Z"),
        reportName: "Headcount SSoT",
        section: "people",
        category: "headcount",
        columns: [],
        rowCount: 2,
      },
    ]);
    setupDb({
      mapRows: [],
      prsBounds: {
        start: new Date("2024-01-01T00:00:00Z"),
        end: new Date("2026-04-22T00:00:00Z"),
      },
      monthlyCounts: [{ month: new Date("2024-01-01"), n: 100 }],
      prs: [],
    });
    mockGetAiUsageData.mockResolvedValue({
      weeklyByCategory: [],
      weeklyByModel: [],
      monthlyByModel: [],
      monthlyByUser: [
        {
          monthStart: "2026-04-01",
          category: "claude",
          userEmail: "alice@meetcleo.com",
          nDays: 10,
          nModelsUsed: 2,
          totalCost: 500,
          totalTokens: 800_000_000,
          medianTokensPerPerson: 0,
          avgTokensPerPerson: 0,
          avgCostPerPerson: 0,
          medianCost: 0,
        },
        {
          monthStart: "2026-04-01",
          category: "cursor",
          userEmail: "alice@meetcleo.com",
          nDays: 8,
          nModelsUsed: 1,
          totalCost: 120,
          totalTokens: 200_000_000,
          medianTokensPerPerson: 0,
          avgTokensPerPerson: 0,
          avgCostPerPerson: 0,
          medianCost: 0,
        },
      ],
      syncedAt: new Date("2026-04-22T06:00:00Z"),
      missing: [],
    });

    const analysis = await getImpactAnalysis();
    const byEmail = Object.fromEntries(
      analysis.engineers.map((e) => [e.email, e]),
    );

    // Alice's join: combined claude + cursor for April → 620 / 1B tokens.
    // Mixed-case input email proves the join is case-insensitive.
    expect(byEmail["alice@meetcleo.com"].aiSpend).toBe(620);
    expect(byEmail["alice@meetcleo.com"].aiTokens).toBe(1_000_000_000);
    expect(byEmail["alice@meetcleo.com"].aiMonthStart).toBe("2026-04-01");

    // Bob has no AI usage row → null, NOT 0 (so charts can distinguish
    // "non-adopter" from "$0 spend").
    expect(byEmail["bob@meetcleo.com"].aiSpend).toBeNull();
    expect(byEmail["bob@meetcleo.com"].aiTokens).toBeNull();

    // Metadata reports the AI cohort size.
    expect(analysis.metadata.aiMatchedEngineers).toBe(1);
    expect(analysis.metadata.aiMonthStart).toBe("2026-04-01");
  });

  it("degrades to null AI fields when getAiUsageData throws", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "headcount",
        rows: [
          {
            email: "alice@meetcleo.com",
            preferred_name: "Alice",
            hb_function: "Engineering",
            hb_level: "L4",
            rp_specialisation: "Backend Engineer",
            start_date: "2024-01-01",
          },
        ],
        syncedAt: new Date("2026-04-22T06:00:00Z"),
        reportName: "Headcount SSoT",
        section: "people",
        category: "headcount",
        columns: [],
        rowCount: 1,
      },
    ]);
    setupDb({
      mapRows: [],
      prsBounds: {
        start: new Date("2024-01-01T00:00:00Z"),
        end: new Date("2026-04-22T00:00:00Z"),
      },
      monthlyCounts: [{ month: new Date("2024-01-01"), n: 100 }],
      prs: [],
    });
    mockGetAiUsageData.mockRejectedValue(new Error("Mode unreachable"));

    const analysis = await getImpactAnalysis();
    expect(analysis.engineers[0].aiSpend).toBeNull();
    expect(analysis.engineers[0].aiTokens).toBeNull();
    expect(analysis.metadata.aiMatchedEngineers).toBe(0);
    expect(analysis.metadata.aiMonthStart).toBeNull();
  });
});
