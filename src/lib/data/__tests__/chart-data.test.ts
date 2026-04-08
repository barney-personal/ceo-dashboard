import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
}));

import {
  aggregateCohortRows,
  getEngagementSeries,
  getLatestLtvCacRatio,
  getLtvCacRatioSeries,
  getMauRetentionCohorts,
  getQuery3Series,
  groupByWeek,
} from "../chart-data";

afterEach(() => {
  vi.useRealTimers();
  mockGetReportData.mockReset();
});

describe("groupByWeek", () => {
  it("aligns weekly buckets to Monday and rolls Sundays into the same week", () => {
    const grouped = groupByWeek(
      [
        { date: "2023-01-01" },
        { date: "2023-01-02" },
        { date: "2023-01-08" },
        { date: "2023-01-09" },
      ],
      "date"
    );

    expect(
      [...grouped.entries()].map(([date, rows]) => [date, rows.length])
    ).toEqual([
      ["2022-12-26", 1],
      ["2023-01-02", 2],
      ["2023-01-09", 1],
    ]);
  });
});

describe("getQuery3Series", () => {
  it("sums weekly spend and users while averaging weekly CPA", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 3",
        rows: [
          {
            day: "2023-01-02",
            actual_or_target: "actual",
            spend: 10,
            new_bank_connected_users: 2,
            cpa: 5,
          },
          {
            day: "2023-01-08",
            actual_or_target: "actual",
            spend: 30,
            new_bank_connected_users: 3,
            cpa: 9,
          },
          {
            day: "2023-01-03",
            actual_or_target: "target_base",
            spend: 20,
            new_bank_connected_users: 4,
            cpa: 6,
          },
        ],
      },
    ]);

    const series = await getQuery3Series();

    expect(series.spend.find((item) => item.label === "actual")?.data).toEqual([
      { date: "2023-01-02", value: 40 },
    ]);
    expect(series.users.find((item) => item.label === "actual")?.data).toEqual([
      { date: "2023-01-02", value: 5 },
    ]);
    expect(series.cpa.find((item) => item.label === "actual")?.data).toEqual([
      { date: "2023-01-02", value: 7 },
    ]);
  });
});

describe("getLtvCacRatioSeries", () => {
  it("computes weekly LTV:CAC values and latest point from the newest bucket", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "LTV:Paid CAC",
        rows: [
          {
            period: "2023-01-02",
            ltv_36m: 100,
            paid_spend_excl_test: 20,
            paid_users_excl_test: 2,
          },
          {
            period: "2023-01-08",
            ltv_36m: 140,
            paid_spend_excl_test: 10,
            paid_users_excl_test: 1,
          },
          {
            period: "2023-01-09",
            ltv_36m: 80,
            paid_spend_excl_test: 20,
            paid_users_excl_test: 4,
          },
        ],
      },
    ]);

    const series = await getLtvCacRatioSeries();
    const latest = await getLatestLtvCacRatio();

    expect(series[0]).toMatchObject({
      label: "LTV:CAC",
      data: [
        { date: "2023-01-02", value: 12 },
        { date: "2023-01-09", value: 16 },
      ],
    });
    expect(latest).toBe(16);
  });
});

describe("getEngagementSeries", () => {
  it("excludes the current month from WAU/MAU output", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    mockGetReportData.mockResolvedValue([
      {
        queryName: "dau-wau-mau query all time",
        rows: [
          { date: "2026-03-01", daus: 10, waus: 50, maus: 100 },
          { date: "2026-03-15", daus: 20, waus: 70, maus: 140 },
          { date: "2026-04-01", daus: 30, waus: 90, maus: 180 },
        ],
      },
    ]);

    const series = await getEngagementSeries();

    expect(series).toMatchObject([
      {
        label: "WAU / MAU",
        data: [{ date: "2026-03-01", value: 50 }],
      },
    ]);
  });
});

describe("aggregateCohortRows", () => {
  it("aggregates cohort rows across segments before normalisation", () => {
    const aggregated = aggregateCohortRows([
      { cohort_month: "2026-01-01", activity_month: 0, maus: 100 },
      { cohort_month: "2026-01-01", activity_month: 0, maus: 50 },
      { cohort_month: "2026-01-01", activity_month: 1, maus: 80 },
    ]);

    expect(aggregated.get("2026-01")?.get(0)).toBe(150);
    expect(aggregated.get("2026-01")?.get(1)).toBe(80);
  });
});

describe("getMauRetentionCohorts", () => {
  it("normalises cohorts to M0 and drops the incomplete latest month", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 1",
        rows: [
          { cohort_month: "2026-01-01", activity_month: 0, maus: 100 },
          { cohort_month: "2026-01-01", activity_month: 0, maus: 50 },
          { cohort_month: "2026-01-01", activity_month: 1, maus: 75 },
          { cohort_month: "2026-01-01", activity_month: 1, maus: 45 },
          { cohort_month: "2026-01-01", activity_month: 2, maus: 30 },
          { cohort_month: "2026-01-01", activity_month: 2, maus: 30 },
        ],
      },
    ]);

    const cohorts = await getMauRetentionCohorts();

    expect(cohorts).toEqual([
      {
        cohort: "2026-01",
        periods: [1, 0.8],
      },
    ]);
  });
});
