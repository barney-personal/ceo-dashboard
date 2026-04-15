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
}));

import {
  getAttritionData,
  getRollingAttritionSeries,
  getY1AttritionSeries,
  getRecentLeavers,
  getAttritionByDepartment,
  getLatestAttritionMetrics,
} from "../attrition";

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
  mockGetReportData.mockReset();
});

function makeAttritionRow(overrides: Record<string, unknown> = {}) {
  return {
    reporting_period: "2026-01-01T00:00:00.000Z",
    department: "Engineering",
    tenure: "1+ Year",
    headcount_avg_of_month: 50,
    avg_headcount_l12m: 48,
    leavers_l12m: 5,
    leavers_voluntary_regrettable_l12m: 2,
    leavers_voluntary_non_regrettable_l12m: 1,
    leavers_involuntary_non_regrettable_l12m: 2,
    ...overrides,
  };
}

function makeY1Row(overrides: Record<string, unknown> = {}) {
  return {
    start_month: "2026-01-01T00:00:00.000Z",
    department: "Engineering",
    cohort_maturity: "matured",
    num_starters: 5,
    num_leavers_within_1y: 1,
    num_voluntary_regrettable_leavers_within_1y: 1,
    num_voluntary_non_regrettable_leavers_within_1y: 0,
    num_involuntary_non_regrettable_leavers_within_1y: 0,
    num_starters_l12m: 20,
    num_leavers_within_1y_l12m: 3,
    num_voluntary_regrettable_leavers_within_1y_l12m: 1,
    num_voluntary_non_regrettable_leavers_within_1y_l12m: 1,
    num_involuntary_non_regrettable_leavers_within_1y_l12m: 1,
    ...overrides,
  };
}

function makeLeaverRow(overrides: Record<string, unknown> = {}) {
  return {
    employee_hibob_id: "123",
    email: "person@meetcleo.com",
    display_name: "Test Person",
    level: "SE3",
    squad: "Growth",
    start_date: "2023-01-01T00:00:00.000Z",
    termination_date: "2026-01-15T00:00:00.000Z",
    manager_name: "Manager Name",
    manager_email: "manager@meetcleo.com",
    department: "Engineering",
    employment_type: "Permanent (UK)",
    is_employee: "Employee",
    termination_type: "Voluntary",
    regretted_leaver: "Regrettable",
    work_location: "Hybrid",
    ...overrides,
  };
}

function mockReportData(
  attritionRows: Record<string, unknown>[] = [],
  y1Rows: Record<string, unknown>[] = [],
  leaverRows: Record<string, unknown>[] = [],
) {
  mockGetReportData.mockResolvedValue([
    {
      reportName: "Attrition Tracker",
      section: "people",
      category: "attrition",
      queryName: "attrition",
      columns: [],
      rows: attritionRows,
      rowCount: attritionRows.length,
      syncedAt: new Date(),
    },
    {
      reportName: "Attrition Tracker",
      section: "people",
      category: "attrition",
      queryName: "attrition_within_1y_joining",
      columns: [],
      rows: y1Rows,
      rowCount: y1Rows.length,
      syncedAt: new Date(),
    },
    {
      reportName: "Attrition Tracker",
      section: "people",
      category: "attrition",
      queryName: "Query 2",
      columns: [],
      rows: leaverRows,
      rowCount: leaverRows.length,
      syncedAt: new Date(),
    },
  ]);
}

describe("getAttritionData", () => {
  it("returns empty result when no data is synced", async () => {
    mockGetReportData.mockResolvedValue([]);
    const result = await getAttritionData();
    expect(result.rollingAttrition).toEqual([]);
    expect(result.y1Attrition).toEqual([]);
    expect(result.recentLeavers).toEqual([]);
  });

  it("fetches data for section people, category attrition", async () => {
    mockReportData();
    await getAttritionData();
    expect(mockGetReportData).toHaveBeenCalledWith("people", "attrition", [
      "attrition",
      "attrition_within_1y_joining",
      "Query 2",
    ]);
  });
});

describe("getRollingAttritionSeries", () => {
  it("computes attrition rate as leavers_l12m / avg_headcount_l12m", async () => {
    mockReportData([
      makeAttritionRow({
        reporting_period: "2026-01-01T00:00:00.000Z",
        department: "All",
        tenure: "All",
        avg_headcount_l12m: 100,
        leavers_l12m: 10,
        leavers_voluntary_regrettable_l12m: 4,
        leavers_voluntary_non_regrettable_l12m: 3,
        leavers_involuntary_non_regrettable_l12m: 3,
      }),
      makeAttritionRow({
        reporting_period: "2026-02-01T00:00:00.000Z",
        department: "All",
        tenure: "All",
        avg_headcount_l12m: 100,
        leavers_l12m: 12,
        leavers_voluntary_regrettable_l12m: 5,
        leavers_voluntary_non_regrettable_l12m: 4,
        leavers_involuntary_non_regrettable_l12m: 3,
      }),
    ]);

    const result = await getAttritionData();
    const series = getRollingAttritionSeries(result.rollingAttrition);

    const totalSeries = series.find((s) => s.label === "Total");
    expect(totalSeries).toBeDefined();
    expect(totalSeries!.data).toHaveLength(2);
    expect(totalSeries!.data[0].value).toBeCloseTo(10);
    expect(totalSeries!.data[1].value).toBeCloseTo(12);
  });

  it("returns separate series for regretted and non-regretted", async () => {
    mockReportData([
      makeAttritionRow({
        department: "All",
        tenure: "All",
        avg_headcount_l12m: 100,
        leavers_l12m: 10,
        leavers_voluntary_regrettable_l12m: 4,
        leavers_voluntary_non_regrettable_l12m: 3,
        leavers_involuntary_non_regrettable_l12m: 3,
      }),
    ]);

    const result = await getAttritionData();
    const series = getRollingAttritionSeries(result.rollingAttrition);
    const labels = series.map((s) => s.label);

    expect(labels).toContain("Total");
    expect(labels).toContain("Regretted");
    expect(labels).toContain("Non-regretted voluntary");
    expect(labels).toContain("Involuntary");
  });

  it("skips rows where avg_headcount_l12m is zero", async () => {
    mockReportData([
      makeAttritionRow({
        department: "All",
        tenure: "All",
        avg_headcount_l12m: 0,
        leavers_l12m: 0,
      }),
    ]);

    const result = await getAttritionData();
    const series = getRollingAttritionSeries(result.rollingAttrition);
    expect(series[0].data).toHaveLength(0);
  });
});

describe("getY1AttritionSeries", () => {
  it("computes Y1 rate as leavers_within_1y_l12m / starters_l12m", async () => {
    mockReportData(
      [],
      [
        makeY1Row({
          department: "All",
          num_starters_l12m: 40,
          num_leavers_within_1y_l12m: 8,
          num_voluntary_regrettable_leavers_within_1y_l12m: 3,
          num_voluntary_non_regrettable_leavers_within_1y_l12m: 3,
          num_involuntary_non_regrettable_leavers_within_1y_l12m: 2,
        }),
      ],
    );

    const result = await getAttritionData();
    const series = getY1AttritionSeries(result.y1Attrition);
    const totalSeries = series.find((s) => s.label === "Total");
    expect(totalSeries!.data[0].value).toBeCloseTo(20);
  });
});

describe("getRecentLeavers", () => {
  it("transforms leaver rows into structured objects", async () => {
    mockReportData([], [], [
      makeLeaverRow({
        display_name: "Jane Doe",
        department: "Product",
        termination_type: "Voluntary",
        regretted_leaver: "Regrettable",
      }),
    ]);

    const result = await getAttritionData();
    expect(result.recentLeavers).toHaveLength(1);
    expect(result.recentLeavers[0]).toMatchObject({
      name: "Jane Doe",
      department: "Product",
      terminationType: "Voluntary",
      regretted: "Regrettable",
    });
  });
});

describe("getLatestAttritionMetrics", () => {
  it("returns latest period metrics for KPI cards", async () => {
    mockReportData([
      makeAttritionRow({
        reporting_period: "2026-03-01T00:00:00.000Z",
        department: "All",
        tenure: "All",
        avg_headcount_l12m: 200,
        leavers_l12m: 20,
        leavers_voluntary_regrettable_l12m: 8,
      }),
      makeAttritionRow({
        reporting_period: "2026-02-01T00:00:00.000Z",
        department: "All",
        tenure: "All",
        avg_headcount_l12m: 200,
        leavers_l12m: 18,
        leavers_voluntary_regrettable_l12m: 7,
      }),
    ]);

    const result = await getAttritionData();
    const metrics = getLatestAttritionMetrics(result.rollingAttrition);

    expect(metrics.currentRate).toBeCloseTo(0.1);
    expect(metrics.previousRate).toBeCloseTo(0.09);
    expect(metrics.regrettedRate).toBeCloseTo(0.04);
  });
});

describe("getAttritionByDepartment", () => {
  it("returns one series per department", async () => {
    mockReportData([
      makeAttritionRow({
        reporting_period: "2026-01-01T00:00:00.000Z",
        department: "Engineering",
        tenure: "All",
        avg_headcount_l12m: 80,
        leavers_l12m: 8,
      }),
      makeAttritionRow({
        reporting_period: "2026-01-01T00:00:00.000Z",
        department: "Product",
        tenure: "All",
        avg_headcount_l12m: 20,
        leavers_l12m: 4,
      }),
    ]);

    const result = await getAttritionData();
    const deptSeries = getAttritionByDepartment(result.rollingAttrition);
    expect(deptSeries).toHaveLength(2);

    const eng = deptSeries.find((s) => s.label === "Engineering");
    expect(eng!.data[0].value).toBeCloseTo(10);

    const prod = deptSeries.find((s) => s.label === "Product");
    expect(prod!.data[0].value).toBeCloseTo(20);
  });
});
