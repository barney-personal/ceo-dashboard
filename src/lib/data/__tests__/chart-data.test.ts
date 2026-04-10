import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData, mockValidateModeColumns } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
  mockValidateModeColumns: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  validateModeColumns: mockValidateModeColumns,
  rowStr: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "string"
      ? row[key]
      : row[key] != null
        ? String(row[key])
        : "",
  rowNum: (row: Record<string, unknown>, key: string, fallback = 0) =>
    typeof row[key] === "number" ? row[key] : fallback,
  rowNumOrNull: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "number" ? row[key] : null,
}));

import {
  aggregateCohortRows,
  aggregateWeeklyCohortRows,
  getActiveUsersSeries,
  getEngagementSeries,
  getHeadcountByDepartment,
  getLatestLtvCacRatio,
  getLtvTimeSeries,
  getLtvCacRatioSeries,
  getMauRetentionCohorts,
  getWauRetentionCohorts,
  getQuery3Series,
  groupByWeek,
} from "../chart-data";

beforeEach(() => {
  mockValidateModeColumns.mockReset();
  mockValidateModeColumns.mockReturnValue({
    expectedColumns: [],
    presentColumns: [],
    missingColumns: [],
    isValid: true,
  });
});

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
      "date",
    );

    expect(
      [...grouped.entries()].map(([date, rows]) => [date, rows.length]),
    ).toEqual([
      ["2022-12-26", 1],
      ["2023-01-02", 2],
      ["2023-01-09", 1],
    ]);
  });
});

describe("getQuery3Series — null safety", () => {
  it("skips rows with null spend or null new_bank_connected_users", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 3",
        rows: [
          // null spend — entire row skipped
          {
            day: "2023-01-02",
            actual_or_target: "actual",
            spend: null,
            new_bank_connected_users: 5,
          },
          // null users — entire row skipped
          {
            day: "2023-01-03",
            actual_or_target: "actual",
            spend: 100,
            new_bank_connected_users: null,
          },
          // valid row
          {
            day: "2023-01-04",
            actual_or_target: "actual",
            spend: 60,
            new_bank_connected_users: 3,
          },
        ],
      },
    ]);

    const series = await getQuery3Series();
    // Only one valid row, so spend = 60, users = 3 for week of 2023-01-02
    expect(series.spend.find((s) => s.label === "actual")?.data[0].value).toBe(60);
    expect(series.users.find((s) => s.label === "actual")?.data[0].value).toBe(3);
  });
});

describe("getQuery3Series", () => {
  it("sums weekly spend and users while deriving weekly CPA from totals", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 3",
        rows: [
          {
            day: "2023-01-02",
            actual_or_target: "actual",
            spend: 10,
            new_bank_connected_users: 2,
            cpa: 500,
          },
          {
            day: "2023-01-08",
            actual_or_target: "actual",
            spend: 30,
            new_bank_connected_users: 3,
            cpa: 900,
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

    expect(mockGetReportData).toHaveBeenCalledWith("unit-economics", "kpis", [
      "Query 3",
    ]);
    expect(series.spend.find((item) => item.label === "actual")?.data).toEqual([
      { date: "2023-01-02", value: 40 },
    ]);
    expect(series.users.find((item) => item.label === "actual")?.data).toEqual([
      { date: "2023-01-02", value: 5 },
    ]);
    expect(series.cpa.find((item) => item.label === "actual")?.data).toEqual([
      { date: "2023-01-02", value: 8 },
    ]);
  });

  it("drops the current incomplete week from weekly charts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00Z"));

    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 3",
        rows: [
          {
            day: "2026-03-31",
            actual_or_target: "actual",
            spend: 40,
            new_bank_connected_users: 4,
            cpa: 999,
          },
          {
            day: "2026-04-07",
            actual_or_target: "actual",
            spend: 150,
            new_bank_connected_users: 2,
            cpa: 75,
          },
        ],
      },
    ]);

    const series = await getQuery3Series();

    expect(series.cpa.find((item) => item.label === "actual")?.data).toEqual([
      { date: "2026-03-30", value: 10 },
    ]);
  });
});

describe("getLtvTimeSeries", () => {
  it("returns an empty series when Query 4 columns drift", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Strategic Finance KPIs",
        queryName: "Query 4",
        rows: [{ month: "2023-01-01" }],
      },
    ]);
    mockValidateModeColumns.mockReturnValue({
      expectedColumns: ["month", "user_ltv_36m_actual"],
      presentColumns: ["month"],
      missingColumns: ["user_ltv_36m_actual"],
      isValid: false,
    });

    const series = await getLtvTimeSeries();

    expect(series).toEqual([]);
    expect(mockGetReportData).toHaveBeenCalledWith("unit-economics", "kpis", [
      "Query 4",
    ]);
    expect(mockValidateModeColumns).toHaveBeenCalledTimes(1);
  });
});

describe("getLtvCacRatioSeries", () => {
  it("computes weekly LTV:CAC from Query 4 LTV and Query 3 spend/users", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 4",
        rows: [
          { month: "2023-01-01", user_ltv_36m_actual: 120 },
        ],
      },
      {
        queryName: "Query 3",
        rows: [
          // Week of 2023-01-02 (Mon): two actual days
          {
            day: "2023-01-02",
            actual_or_target: "actual",
            spend: 20,
            new_bank_connected_users: 2,
            cpa: 10,
          },
          {
            day: "2023-01-03",
            actual_or_target: "actual",
            spend: 30,
            new_bank_connected_users: 3,
            cpa: 10,
          },
          // Target row should be ignored
          {
            day: "2023-01-04",
            actual_or_target: "target_base",
            spend: 100,
            new_bank_connected_users: 10,
            cpa: 10,
          },
          // Week of 2023-01-09 (Mon): one actual day
          {
            day: "2023-01-09",
            actual_or_target: "actual",
            spend: 10,
            new_bank_connected_users: 2,
            cpa: 5,
          },
        ],
      },
    ]);

    const series = await getLtvCacRatioSeries();
    const latest = await getLatestLtvCacRatio();

    // Week 2023-01-02: spend=50, users=5, CPA=10, LTV=120 → ratio=12
    // Week 2023-01-09: spend=10, users=2, CPA=5, LTV=120 → ratio=24
    expect(series[0]).toMatchObject({
      label: "LTV:CAC",
      data: [
        { date: "2023-01-02", value: 12 },
        { date: "2023-01-09", value: 24 },
      ],
    });
    expect(latest).toBe(24);
  });

  it("falls back to previous month LTV when current month has no data", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 4",
        rows: [
          { month: "2023-01-01", user_ltv_36m_actual: 100 },
          // No February data
        ],
      },
      {
        queryName: "Query 3",
        rows: [
          {
            day: "2023-02-06",
            actual_or_target: "actual",
            spend: 50,
            new_bank_connected_users: 5,
            cpa: 10,
          },
        ],
      },
    ]);

    const series = await getLtvCacRatioSeries();

    // February has no LTV, falls back to January (100). CPA=10 → ratio=10
    expect(series[0]).toMatchObject({
      label: "LTV:CAC",
      data: [{ date: "2023-02-06", value: 10 }],
    });
  });

  it("returns guardrail series alongside LTV:CAC", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 4",
        rows: [{ month: "2023-01-01", user_ltv_36m_actual: 60 }],
      },
      {
        queryName: "Query 3",
        rows: [
          {
            day: "2023-01-02",
            actual_or_target: "actual",
            spend: 20,
            new_bank_connected_users: 1,
            cpa: 20,
          },
        ],
      },
    ]);

    const series = await getLtvCacRatioSeries();

    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({
      label: "3x guardrail",
      dashed: true,
      data: [{ date: "2023-01-02", value: 3 }],
    });
  });
});

describe("getLtvCacRatioSeries — null safety", () => {
  it("skips Query 3 rows with null spend or null users instead of creating zero-spend weeks", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 4",
        rows: [{ month: "2023-01-01", user_ltv_36m_actual: 120 }],
      },
      {
        queryName: "Query 3",
        rows: [
          // null spend — skip entire row
          {
            day: "2023-01-02",
            actual_or_target: "actual",
            spend: null,
            new_bank_connected_users: 5,
          },
          // null users — skip entire row
          {
            day: "2023-01-03",
            actual_or_target: "actual",
            spend: 50,
            new_bank_connected_users: null,
          },
          // valid row
          {
            day: "2023-01-09",
            actual_or_target: "actual",
            spend: 60,
            new_bank_connected_users: 3,
          },
        ],
      },
    ]);

    const series = await getLtvCacRatioSeries();
    const ltvcac = series.find((s) => s.label === "LTV:CAC");
    // Only the valid week (2023-01-09) should produce a data point
    expect(ltvcac?.data).toHaveLength(1);
    expect(ltvcac?.data[0].date).toBe("2023-01-09");
  });
});

describe("getEngagementSeries — null safety", () => {
  it("skips null mau values rather than treating them as 0 in the average", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    mockGetReportData.mockResolvedValue([
      {
        queryName: "dau-wau-mau query all time",
        rows: [
          // null maus — should be excluded from the MAU average (not counted as 0)
          { date: "2026-03-01", daus: 10, waus: 100, maus: null },
          // valid maus row
          { date: "2026-03-15", daus: 20, waus: 100, maus: 200 },
        ],
      },
    ]);

    const series = await getEngagementSeries();
    const wauMau = series.find((s) => s.label === "WAU / MAU");
    // avg(maus) = [200] = 200 (null excluded, not 0+200/2=100)
    // avg(waus) = [100, 100] = 100
    // ratio = 100/200 * 100 = 50 (would be 100/100*100=100 if null treated as 0)
    expect(wauMau?.data[0]).toMatchObject({ date: "2026-03-01", value: 50 });
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

  it("returns an empty fallback when active-user columns drift without warning spam", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "App Active Users",
        queryName: "dau-wau-mau query all time",
        rows: [
          { date: "2026-03-01", daus: 10, waus: 50 },
          { date: "2026-03-15", daus: 20, waus: 70 },
        ],
      },
    ]);
    mockValidateModeColumns.mockReturnValue({
      expectedColumns: ["date", "daus", "waus", "maus"],
      presentColumns: ["date", "daus", "waus"],
      missingColumns: ["maus"],
      isValid: false,
    });

    const series = await getEngagementSeries();

    expect(series).toEqual([]);
    expect(mockGetReportData).toHaveBeenCalledWith("product", "active-users", [
      "dau-wau-mau query all time",
    ]);
    expect(mockValidateModeColumns).toHaveBeenCalledTimes(1);
  });
});

describe("getActiveUsersSeries", () => {
  it("returns empty DAU/WAU/MAU series when the active-users query is missing", async () => {
    mockGetReportData.mockResolvedValue([]);

    const series = await getActiveUsersSeries();

    expect(series).toEqual({ dau: [], wau: [], mau: [] });
    expect(mockGetReportData).toHaveBeenCalledWith("product", "active-users", [
      "dau-wau-mau query all time",
    ]);
    expect(mockValidateModeColumns).not.toHaveBeenCalled();
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

  it("skips rows with null activity_month or null maus instead of coercing to 0", () => {
    const aggregated = aggregateCohortRows([
      // null maus — should be skipped, not counted as 0
      { cohort_month: "2026-01-01", activity_month: 0, maus: null },
      // null activity_month — should be skipped, not collapsed into M0
      { cohort_month: "2026-01-01", activity_month: null, maus: 100 },
      // valid row
      { cohort_month: "2026-01-01", activity_month: 1, maus: 80 },
    ]);

    expect(aggregated.get("2026-01")?.has(0)).toBe(false);
    expect(aggregated.get("2026-01")?.get(1)).toBe(80);
  });

  it("skips rows with invalid cohort_month date strings", () => {
    const aggregated = aggregateCohortRows([
      { cohort_month: "not-a-date", activity_month: 0, maus: 100 },
      { cohort_month: "", activity_month: 0, maus: 50 },
      { cohort_month: "2026-02-01", activity_month: 0, maus: 200 },
    ]);

    expect(aggregated.size).toBe(1);
    expect(aggregated.get("2026-02")?.get(0)).toBe(200);
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

  it("returns an empty fallback when retention columns drift", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "App Retention",
        queryName: "Query 1",
        rows: [{ cohort_month: "2026-01-01", activity_month: 0 }],
      },
    ]);
    mockValidateModeColumns.mockReturnValue({
      expectedColumns: ["cohort_month", "activity_month", "maus"],
      presentColumns: ["cohort_month", "activity_month"],
      missingColumns: ["maus"],
      isValid: false,
    });

    const cohorts = await getMauRetentionCohorts();

    expect(cohorts).toEqual([]);
    expect(mockValidateModeColumns).toHaveBeenCalledTimes(1);
  });
});

describe("aggregateWeeklyCohortRows", () => {
  it("aggregates weekly cohort rows across segments", () => {
    const aggregated = aggregateWeeklyCohortRows([
      { cohort_week: "2026-01-06", activity_month: 0, maus: 100 },
      { cohort_week: "2026-01-06", activity_month: 0, maus: 50 },
      { cohort_week: "2026-01-06", activity_month: 1, maus: 80 },
    ]);

    expect(aggregated.get("2026-01-06")?.get(0)).toBe(150);
    expect(aggregated.get("2026-01-06")?.get(1)).toBe(80);
  });

  it("skips rows with null activity_month or null maus", () => {
    const aggregated = aggregateWeeklyCohortRows([
      { cohort_week: "2026-01-06", activity_month: 0, maus: null },
      { cohort_week: "2026-01-06", activity_month: null, maus: 100 },
      { cohort_week: "2026-01-06", activity_month: 1, maus: 80 },
    ]);

    expect(aggregated.get("2026-01-06")?.has(0)).toBe(false);
    expect(aggregated.get("2026-01-06")?.get(1)).toBe(80);
  });

  it("skips rows with invalid cohort_week date strings", () => {
    const aggregated = aggregateWeeklyCohortRows([
      { cohort_week: "not-a-date", activity_month: 0, maus: 100 },
      { cohort_week: "", activity_month: 0, maus: 50 },
      { cohort_week: "2026-02-02", activity_month: 0, maus: 200 },
    ]);

    expect(aggregated.size).toBe(1);
    expect(aggregated.get("2026-02-02")?.get(0)).toBe(200);
  });
});

describe("getWauRetentionCohorts", () => {
  it("normalises weekly cohorts to M0 and drops the incomplete latest period", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 1",
        rows: [
          { cohort_week: "2026-01-06", activity_month: 0, maus: 200 },
          { cohort_week: "2026-01-06", activity_month: 1, maus: 160 },
          { cohort_week: "2026-01-06", activity_month: 2, maus: 120 },
        ],
      },
    ]);

    const cohorts = await getWauRetentionCohorts();

    expect(cohorts).toEqual([
      {
        cohort: "2026-01-06",
        periods: [1, 0.8],
      },
    ]);
  });

  it("returns empty when weekly retention columns are missing", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "App Retention",
        queryName: "Query 1",
        rows: [{ cohort_week: "2026-01-06", activity_month: 0 }],
      },
    ]);
    mockValidateModeColumns.mockReturnValue({
      expectedColumns: ["cohort_week", "activity_month", "maus"],
      presentColumns: ["cohort_week", "activity_month"],
      missingColumns: ["maus"],
      isValid: false,
    });

    const cohorts = await getWauRetentionCohorts();

    expect(cohorts).toEqual([]);
  });
});

describe("getHeadcountByDepartment", () => {
  it("returns an empty fallback when headcount columns drift", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Headcount SSoT",
        queryName: "headcount",
        rows: [{ lifecycle_status: "employed", is_cleo_headcount: 1 }],
      },
    ]);
    mockValidateModeColumns.mockReturnValue({
      expectedColumns: ["lifecycle_status", "is_cleo_headcount", "hb_function"],
      presentColumns: ["lifecycle_status", "is_cleo_headcount"],
      missingColumns: ["hb_function"],
      isValid: false,
    });

    const departments = await getHeadcountByDepartment();

    expect(departments).toEqual([]);
    expect(mockGetReportData).toHaveBeenCalledWith("people", "headcount", [
      "headcount",
    ]);
    expect(mockValidateModeColumns).toHaveBeenCalledTimes(1);
  });
});
