import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData, mockParseRows } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
  mockParseRows: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  parseRows: mockParseRows,
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
  getQuery3Series,
  getWauRetentionCohorts,
  groupByWeek,
} from "../chart-data";

beforeEach(() => {
  mockParseRows.mockReset();
  mockParseRows.mockImplementation(
    (_schema: unknown, rows: Record<string, unknown>[]) => ({
      valid: [...rows],
      invalidCount: 0,
    }),
  );
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
    mockParseRows.mockReturnValue({
      valid: [],
      invalidCount: 1,
    });

    const series = await getLtvTimeSeries();

    expect(series).toEqual([]);
    expect(mockGetReportData).toHaveBeenCalledWith("unit-economics", "kpis", [
      "Query 4",
    ]);
    expect(mockParseRows).toHaveBeenCalledTimes(1);
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
    mockParseRows.mockReturnValue({
      valid: [],
      invalidCount: 2,
    });

    const series = await getEngagementSeries();

    expect(series).toEqual([]);
    expect(mockGetReportData).toHaveBeenCalledWith("product", "active-users", [
      "dau-wau-mau query all time",
    ]);
    expect(mockParseRows).toHaveBeenCalledTimes(1);
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
    expect(mockParseRows).not.toHaveBeenCalled();
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
  it("normalises cohorts to M0, drops M0 and the incomplete latest month", async () => {
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
          { cohort_month: "2026-01-01", activity_month: 3, maus: 20 },
        ],
      },
    ]);

    const cohorts = await getMauRetentionCohorts();

    // M0 (always ~100%) is dropped, M3 (incomplete) is dropped
    // Remaining: M1 = 120/150 = 0.8, M2 = 60/150 = 0.4
    expect(cohorts).toEqual([
      {
        cohort: "2026-01",
        periods: [0.8, 0.4],
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
    mockParseRows.mockReturnValue({
      valid: [],
      invalidCount: 1,
    });

    const cohorts = await getMauRetentionCohorts();

    expect(cohorts).toEqual([]);
    expect(mockParseRows).toHaveBeenCalledTimes(1);
  });
});

describe("aggregateWeeklyCohortRows", () => {
  it("sums active_users_weekly across segment dimensions per cohort week", () => {
    const aggregated = aggregateWeeklyCohortRows([
      // Two segment slices for the same cohort/period — should sum.
      {
        cohort_week: "2026-01-05",
        relative_moving_week: 0,
        active_users_weekly: 100,
        d30_subscriber: "true",
        age: "18-24",
        user_segment: "A",
        core_intent: "save",
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: 0,
        active_users_weekly: 50,
        d30_subscriber: "false",
        age: "18-24",
        user_segment: "B",
        core_intent: "save",
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: 1,
        active_users_weekly: 80,
      },
    ]);

    expect(aggregated.get("2026-01-05")?.get(0)).toBe(150);
    expect(aggregated.get("2026-01-05")?.get(1)).toBe(80);
  });

  it("skips rows with null relative_moving_week or null active_users_weekly", () => {
    const aggregated = aggregateWeeklyCohortRows([
      {
        cohort_week: "2026-01-05",
        relative_moving_week: 0,
        active_users_weekly: null,
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: null,
        active_users_weekly: 100,
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: 1,
        active_users_weekly: 80,
      },
    ]);

    expect(aggregated.get("2026-01-05")?.has(0)).toBe(false);
    expect(aggregated.get("2026-01-05")?.get(1)).toBe(80);
  });

  it("skips rows with invalid cohort_week date strings", () => {
    const aggregated = aggregateWeeklyCohortRows([
      {
        cohort_week: "not-a-date",
        relative_moving_week: 0,
        active_users_weekly: 100,
      },
      {
        cohort_week: "",
        relative_moving_week: 0,
        active_users_weekly: 50,
      },
      {
        cohort_week: "2026-02-02",
        relative_moving_week: 0,
        active_users_weekly: 200,
      },
    ]);

    expect(aggregated.size).toBe(1);
    expect(aggregated.get("2026-02-02")?.get(0)).toBe(200);
  });
});

describe("getWauRetentionCohorts", () => {
  function rowsForCohort(
    cohort: string,
    weekly: number[],
  ): Record<string, unknown>[] {
    // weekly[i] = active_users_weekly for relative_moving_week = i
    return weekly.map((value, i) => ({
      cohort_week: cohort,
      relative_moving_week: i,
      active_users_weekly: value,
    }));
  }

  // Pin "now" far in the future so every observation date in these
  // fixtures is a fully-matured week. Individual tests override this
  // when they exercise the unmatured-diagonal filter.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-05T12:00:00Z"));
  });

  it("normalises to W0 base and keeps every observed retention period", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 1",
        // 6 weeks observed (W0..W5) — W0 is dropped as the base (always
        // 100%). Upstream only emits complete weeks so W5 is kept. Two
        // segment slices at W0 verify aggregation across dimensions.
        rows: [
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 0,
            active_users_weekly: 100,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 0,
            active_users_weekly: 50,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 1,
            active_users_weekly: 75,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 1,
            active_users_weekly: 45,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 2,
            active_users_weekly: 30,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 2,
            active_users_weekly: 30,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 3,
            active_users_weekly: 20,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 4,
            active_users_weekly: 15,
          },
          {
            cohort_week: "2025-10-06",
            relative_moving_week: 5,
            active_users_weekly: 5,
          },
        ],
      },
    ]);

    const cohorts = await getWauRetentionCohorts();

    // Base = 150. periods = [W1..W5] = [120/150, 60/150, 20/150, 15/150, 5/150]
    expect(cohorts).toEqual([
      {
        cohort: "2025-10-06",
        periods: [0.8, 0.4, 20 / 150, 15 / 150, 5 / 150],
      },
    ]);
  });

  it("includes recent cohorts that have at least one retention data point", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 1",
        rows: [
          // Cohort A: only W0 → no retention points → filtered out.
          ...rowsForCohort("2026-01-12", [100]),
          // Cohort B: W0/W1 → [W1] is one retention point, enough to show
          // (this is the short bottom row of the triangle).
          ...rowsForCohort("2026-01-05", [100, 80]),
          // Cohort C: W0..W4 → [W1,W2,W3,W4] is a full early-retention row.
          ...rowsForCohort("2025-12-01", [100, 80, 60, 50, 40]),
        ],
      },
    ]);

    const cohorts = await getWauRetentionCohorts();

    expect(cohorts.map((c) => c.cohort)).toEqual([
      "2025-12-01",
      "2026-01-05",
    ]);
    expect(cohorts[0].periods.length).toBe(4);
    expect(cohorts[1].periods).toEqual([0.8]);
  });

  it("returns at most 52 cohorts (newest last)", async () => {
    // Generate 60 cohorts each with enough periods to qualify.
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 60; i++) {
      const cohortDate = new Date(Date.UTC(2025, 0, 6 + i * 7))
        .toISOString()
        .slice(0, 10);
      // 6 periods so every cohort has W1..W5 after dropping W0.
      rows.push(...rowsForCohort(cohortDate, [100, 80, 60, 50, 40, 30]));
    }

    mockGetReportData.mockResolvedValue([{ queryName: "Query 1", rows }]);

    const cohorts = await getWauRetentionCohorts();

    expect(cohorts).toHaveLength(52);
    // Cohorts are returned in chronological order with the newest last,
    // so the last entry should be the 60th generated date.
    const last = new Date(Date.UTC(2025, 0, 6 + 59 * 7))
      .toISOString()
      .slice(0, 10);
    expect(cohorts[cohorts.length - 1].cohort).toBe(last);
  });

  it("returns empty fallback when weekly retention columns drift", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "App Retention Weekly",
        queryName: "Query 1",
        rows: [{ cohort_week: "2026-01-05", relative_moving_week: 0 }],
      },
    ]);
    mockParseRows.mockReturnValue({
      valid: [],
      invalidCount: 1,
    });

    const cohorts = await getWauRetentionCohorts();

    expect(cohorts).toEqual([]);
    expect(mockGetReportData).toHaveBeenCalledWith(
      "product",
      "retention-weekly",
      ["Query 1"],
    );
    expect(mockParseRows).toHaveBeenCalledTimes(1);
  });

  it("drops the per-cohort observation that falls in the current incomplete week", async () => {
    // Freeze "now" to Tuesday 2026-04-14. The current incomplete
    // (Monday-aligned) week starts on 2026-04-13, so every observation
    // dated 2026-04-13 onwards must be dropped — one cell per cohort
    // along the unmatured diagonal, not a fixed global tail.
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));

    mockGetReportData.mockResolvedValue([
      {
        queryName: "Query 1",
        rows: [
          // Cohort Mar 2 (Monday). W0..W6 → W6 observation is Apr 13
          // (current week). Expect periods W1..W5 to remain.
          ...rowsForCohort("2026-03-02", [100, 80, 70, 60, 55, 50, 40]),
          // Cohort Mar 30 (Monday). W0..W2 → W2 observation is Apr 13
          // (current week). Expect periods W1 only (W2 dropped).
          ...rowsForCohort("2026-03-30", [100, 70, 55]),
          // Cohort Apr 6 (Monday). W0..W1 → W1 observation is Apr 13
          // (current week). After dropping W1 there are no retention
          // points → cohort is filtered out entirely.
          ...rowsForCohort("2026-04-06", [100, 60]),
        ],
      },
    ]);

    const cohorts = await getWauRetentionCohorts();

    expect(cohorts.map((c) => c.cohort)).toEqual([
      "2026-03-02",
      "2026-03-30",
    ]);

    const mar2 = cohorts.find((c) => c.cohort === "2026-03-02")!;
    // W1..W5 only — W6 (Apr 13) is in the current week and is dropped.
    expect(mar2.periods).toEqual([0.8, 0.7, 0.6, 0.55, 0.5]);

    const mar30 = cohorts.find((c) => c.cohort === "2026-03-30")!;
    // W1 only — W2 (Apr 13) is in the current week and is dropped.
    expect(mar30.periods).toEqual([0.7]);
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
    mockParseRows.mockReturnValue({
      valid: [],
      invalidCount: 1,
    });

    const departments = await getHeadcountByDepartment();

    expect(departments).toEqual([]);
    expect(mockGetReportData).toHaveBeenCalledWith("people", "headcount", [
      "headcount",
    ]);
    expect(mockParseRows).toHaveBeenCalledTimes(1);
  });
});
