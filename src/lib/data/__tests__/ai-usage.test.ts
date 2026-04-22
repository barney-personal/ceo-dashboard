import { describe, expect, it, vi, afterEach } from "vitest";

const { getReportDataMock } = vi.hoisted(() => ({
  getReportDataMock: vi.fn(),
}));

vi.mock("../mode", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mode")>();
  return {
    ...actual,
    getReportData: getReportDataMock,
  };
});

import {
  aggregateLatestMonthByUser,
  buildTopModelTrends,
  buildUserMonthlyTrends,
  getAiUsageData,
  getLatestMonthPeerSpend,
  getTrailingWeeklyTotals,
  getUserTrend,
  summariseTotals,
} from "../ai-usage";

afterEach(() => {
  getReportDataMock.mockReset();
});

function makeReportData() {
  const syncedAt = new Date("2026-04-22T06:00:00Z");
  return [
    {
      reportName: "AI Model Usage Dashboard",
      section: "people",
      category: "ai-usage",
      queryName: "Overall Data",
      columns: [],
      rows: [
        {
          week_: "2026-04-13T00:00:00.000Z",
          category: "claude",
          distinct_users: 40,
          total_cost: 1500,
          total_tokens: 2_500_000_000,
          n_rows: 500,
        },
        {
          week_: "2026-04-13T00:00:00.000Z",
          category: "cursor",
          distinct_users: 120,
          total_cost: 3700,
          total_tokens: 4_400_000_000,
          n_rows: 9000,
        },
        {
          week_: "2026-04-06T00:00:00.000Z",
          category: "claude",
          distinct_users: 38,
          total_cost: 1200,
          total_tokens: 2_000_000_000,
          n_rows: 400,
        },
      ],
      rowCount: 3,
      syncedAt,
    },
    {
      reportName: "AI Model Usage Dashboard",
      section: "people",
      category: "ai-usage",
      queryName: "Query 1",
      columns: [],
      rows: [
        {
          week_: "2026-04-13T00:00:00.000Z",
          category: "cursor",
          model_name: "claude-4.6-sonnet-medium",
          distinct_users: 2,
          total_cost: 55,
          total_tokens: 66_000_000,
          n_rows: 70,
        },
      ],
      rowCount: 1,
      syncedAt,
    },
    {
      reportName: "AI Model Usage Dashboard",
      section: "people",
      category: "ai-usage",
      queryName: "MoM Usage",
      columns: [],
      rows: [
        {
          month_: "2026-04-01T00:00:00.000Z",
          category: "ALL MODELS",
          model_name: "ALL MODELS",
          distinct_users: 150,
          n_days: 22,
          total_cost: 8000,
          total_tokens: 9_000_000_000,
          n_rows: 10000,
        },
        {
          month_: "2026-03-01T00:00:00.000Z",
          category: "ALL MODELS",
          model_name: "ALL MODELS",
          distinct_users: 140,
          n_days: 30,
          total_cost: 6200,
          total_tokens: 7_500_000_000,
          n_rows: 9000,
        },
        {
          month_: "2026-04-01T00:00:00.000Z",
          category: "claude",
          model_name: "Claude Sonnet 4.6",
          distinct_users: 50,
          n_days: 18,
          total_cost: 2000,
          total_tokens: 2_100_000_000,
          n_rows: 200,
        },
      ],
      rowCount: 3,
      syncedAt,
    },
    {
      reportName: "AI Model Usage Dashboard",
      section: "people",
      category: "ai-usage",
      queryName: "Query 3",
      columns: [],
      rows: [
        {
          month_: "2026-04-01T00:00:00.000Z",
          category: "claude",
          user_email: "Alice@meetcleo.com",
          n_days: 10,
          n_models_used: 2,
          total_cost: 500,
          total_tokens: 800_000_000,
          n_rows: 100,
          median_tokens_used_per_person: 30_000_000,
          avg_tokens_used_per_person: 80_000_000,
          avg_cost_used_per_person: 40,
          median_cost: 25,
        },
        {
          month_: "2026-04-01T00:00:00.000Z",
          category: "cursor",
          user_email: "alice@meetcleo.com",
          n_days: 8,
          n_models_used: 1,
          total_cost: 120,
          total_tokens: 200_000_000,
          n_rows: 60,
          median_tokens_used_per_person: 30_000_000,
          avg_tokens_used_per_person: 80_000_000,
          avg_cost_used_per_person: 40,
          median_cost: 25,
        },
        {
          month_: "2026-04-01T00:00:00.000Z",
          category: "cursor",
          user_email: "bob@meetcleo.com",
          n_days: 4,
          n_models_used: 1,
          total_cost: 45,
          total_tokens: 90_000_000,
          n_rows: 30,
          median_tokens_used_per_person: 30_000_000,
          avg_tokens_used_per_person: 80_000_000,
          avg_cost_used_per_person: 40,
          median_cost: 25,
        },
        {
          month_: "2026-03-01T00:00:00.000Z",
          category: "cursor",
          user_email: "alice@meetcleo.com",
          n_days: 20,
          n_models_used: 3,
          total_cost: 300,
          total_tokens: 500_000_000,
          n_rows: 200,
          median_tokens_used_per_person: 27_000_000,
          avg_tokens_used_per_person: 70_000_000,
          avg_cost_used_per_person: 35,
          median_cost: 20,
        },
      ],
      rowCount: 4,
      syncedAt,
    },
  ];
}

describe("getAiUsageData", () => {
  it("parses all four queries and surfaces syncedAt", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());

    const data = await getAiUsageData();

    expect(data.weeklyByCategory).toHaveLength(3);
    expect(data.weeklyByCategory[0]).toEqual({
      weekStart: "2026-04-13",
      category: "claude",
      distinctUsers: 40,
      totalCost: 1500,
      totalTokens: 2_500_000_000,
    });

    expect(data.weeklyByModel).toHaveLength(1);
    expect(data.weeklyByModel[0].modelName).toBe("claude-4.6-sonnet-medium");

    expect(data.monthlyByModel).toHaveLength(3);
    expect(data.monthlyByModel[0].category).toBe("ALL MODELS");

    expect(data.monthlyByUser).toHaveLength(4);
    // Emails are lowercased so joins are case-insensitive.
    expect(data.monthlyByUser.every((r) => r.userEmail === r.userEmail.toLowerCase())).toBe(
      true,
    );

    expect(data.syncedAt).toEqual(new Date("2026-04-22T06:00:00Z"));
    expect(data.missing).toEqual([]);
  });

  it("reports missing queries when Mode drops one", async () => {
    const rows = makeReportData().filter((r) => r.queryName !== "Query 3");
    getReportDataMock.mockResolvedValueOnce(rows);

    const data = await getAiUsageData();

    expect(data.missing).toEqual(["Query 3"]);
    expect(data.monthlyByUser).toEqual([]);
  });
});

describe("summariseTotals", () => {
  it("rolls up totals, finds latest week + month, and counts distinct users", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const totals = summariseTotals(data);

    // Sum across 3 Overall rows: 1500 + 3700 + 1200 = 6400
    expect(totals.totalCost).toBe(6400);
    // Unique emails in Query 3 (alice + bob) lowercase-normalized.
    expect(totals.totalUsers).toBe(2);
    // Latest week has 2026-04-13 rows summed: 1500 + 3700 = 5200
    expect(totals.latestWeekStart).toBe("2026-04-13");
    expect(totals.latestWeekCost).toBe(5200);
    // Latest MoM ALL MODELS = April (8000), prior = March (6200).
    expect(totals.latestMonthStart).toBe("2026-04-01");
    expect(totals.latestMonthCost).toBe(8000);
    expect(totals.priorMonthCost).toBe(6200);
  });
});

describe("aggregateLatestMonthByUser", () => {
  it("combines Claude + Cursor into one row per engineer for the latest month", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const perUser = aggregateLatestMonthByUser(data);

    const alice = perUser.get("alice@meetcleo.com");
    expect(alice).toBeDefined();
    expect(alice?.totalCost).toBe(620); // 500 + 120
    expect(alice?.totalTokens).toBe(1_000_000_000); // 800M + 200M
    expect(alice?.byCategory).toHaveLength(2);
    expect(alice?.latestMonthStart).toBe("2026-04-01");

    const bob = perUser.get("bob@meetcleo.com");
    expect(bob?.totalCost).toBe(45);
    expect(bob?.byCategory).toHaveLength(1);

    // March-only rows are excluded from the latest-month aggregation.
    expect(perUser.size).toBe(2);
  });
});

describe("getUserTrend", () => {
  it("returns a sorted monthly trend combining categories for one user", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const trend = getUserTrend(data, "ALICE@meetcleo.com");

    expect(trend.map((t) => t.monthStart)).toEqual([
      "2026-03-01",
      "2026-04-01",
    ]);
    expect(trend[0].totalCost).toBe(300);
    expect(trend[1].totalCost).toBe(620);
    expect(trend[1].byCategory).toHaveLength(2);
  });

  it("returns an empty array for users with no AI usage", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    expect(getUserTrend(data, "nobody@meetcleo.com")).toEqual([]);
  });
});

describe("summariseTotals — trailing 30d + user counts", () => {
  it("returns trailing-4-week totals and distinct user counts", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const totals = summariseTotals(data);

    // 3 rows across 2 distinct weekStarts (2026-04-06 + 2026-04-13).
    // Trailing 4 sums all weeks present: 1500 + 3700 + 1200 = 6400.
    expect(totals.trailing30DayCost).toBe(6400);
    // No weeks before that window, so prior-30d is 0.
    expect(totals.prior30DayCost).toBe(0);

    // Latest user-month is April: alice + bob = 2.
    expect(totals.latestMonthUsers).toBe(2);
    // Prior (March) has only alice.
    expect(totals.priorMonthUsers).toBe(1);
  });
});

describe("buildUserMonthlyTrends", () => {
  it("returns a padded time series per user for the trailing N months", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const trends = buildUserMonthlyTrends(data, 6);

    const alice = trends.get("alice@meetcleo.com");
    expect(alice?.map((m) => m.monthStart)).toEqual(["2026-03-01", "2026-04-01"]);
    expect(alice?.map((m) => m.cost)).toEqual([300, 620]);

    const bob = trends.get("bob@meetcleo.com");
    // Bob has no March row, so the March entry should be padded with 0.
    expect(bob?.map((m) => m.monthStart)).toEqual(["2026-03-01", "2026-04-01"]);
    expect(bob?.map((m) => m.cost)).toEqual([0, 45]);
  });

  it("respects the months window (caps trailing size)", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const trends = buildUserMonthlyTrends(data, 1);
    const alice = trends.get("alice@meetcleo.com");
    expect(alice).toHaveLength(1);
    expect(alice?.[0].monthStart).toBe("2026-04-01");
  });
});

describe("buildTopModelTrends", () => {
  it("returns top-N models by latest-month cost with prior-month carried through", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const trends = buildTopModelTrends(data, 5);

    // Only the Claude Sonnet 4.6 row exists in monthlyByModel beyond the
    // ALL MODELS rollup. "ALL MODELS" should be excluded.
    expect(trends.map((t) => t.modelName)).toEqual(["Claude Sonnet 4.6"]);
    expect(trends[0].trend.map((p) => p.monthStart)).toEqual([
      "2026-03-01",
      "2026-04-01",
    ]);
    // March has no row for this model → padded with 0 (priorCost).
    expect(trends[0].priorCost).toBe(0);
    expect(trends[0].latestCost).toBe(2000);
  });
});

describe("getLatestMonthPeerSpend", () => {
  it("returns one entry per latest-month user", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const spend = getLatestMonthPeerSpend(data);
    expect(spend.sort((a, b) => b - a)).toEqual([620, 45]);
  });
});

describe("getTrailingWeeklyTotals", () => {
  it("returns week+cost pairs sorted ascending, capped at N weeks", async () => {
    getReportDataMock.mockResolvedValueOnce(makeReportData());
    const data = await getAiUsageData();
    const weekly = getTrailingWeeklyTotals(data, 4);
    expect(weekly.map((w) => w.weekStart)).toEqual([
      "2026-04-06",
      "2026-04-13",
    ]);
    expect(weekly.map((w) => w.cost)).toEqual([1200, 5200]);
  });
});
