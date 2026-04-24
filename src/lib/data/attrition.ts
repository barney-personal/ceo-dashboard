// Server-only data fetching for attrition metrics.
// Pure transformation functions live in ./attrition-utils.ts (client-safe).

import {
  getReportData,
  rowStr,
  rowNum,
  validateModeColumns,
} from "./mode";
import type { AttritionRow, Y1AttritionRow, Leaver, Employee, AttritionData } from "./attrition-utils";
import { canonicalDepartment } from "./attrition-utils";

// Re-export everything from the client-safe module so server consumers
// can import from a single path.
export {
  type AttritionRow,
  type Y1AttritionRow,
  type Leaver,
  type Employee,
  type AttritionData,
  type AttritionMetrics,
  type Y1AttritionMetrics,
  type DepartmentOption,
  getRollingAttritionSeries,
  getAttritionByDepartment,
  getLatestAttritionMetrics,
  getY1AttritionSeries,
  getLatestY1Metrics,
  getDepartments,
  getTenureBuckets,
  getRecentLeavers,
  buildEmployeeRetentionCohorts,
} from "./attrition-utils";

// ── Column schemas ──

const ATTRITION_COLUMNS = [
  "reporting_period",
  "department",
  "tenure",
  "headcount_avg_of_month",
  "avg_headcount_l12m",
  "leavers_l12m",
  "leavers_voluntary_regrettable_l12m",
  "leavers_voluntary_non_regrettable_l12m",
  "leavers_involuntary_non_regrettable_l12m",
] as const;

const Y1_ATTRITION_COLUMNS = [
  "start_month",
  "department",
  "cohort_maturity",
  "num_starters",
  "num_leavers_within_1y",
  "num_voluntary_regrettable_leavers_within_1y",
  "num_voluntary_non_regrettable_leavers_within_1y",
  "num_involuntary_non_regrettable_leavers_within_1y",
  "num_starters_l12m",
  "num_leavers_within_1y_l12m",
  "num_voluntary_regrettable_leavers_within_1y_l12m",
  "num_voluntary_non_regrettable_leavers_within_1y_l12m",
  "num_involuntary_non_regrettable_leavers_within_1y_l12m",
] as const;

const LEAVER_COLUMNS = [
  "display_name",
  "department",
  "squad",
  "level",
  "start_date",
  "termination_date",
  "termination_type",
  "regretted_leaver",
  "manager_name",
  "work_location",
] as const;

const EMPLOYEE_COLUMNS = [
  "start_date",
  "termination_date",
  "is_employee",
] as const;

// ── Data fetching ──

type ModeQueryData = Awaited<ReturnType<typeof getReportData>>[number];

function getValidatedQuery<TColumn extends string>(
  data: ModeQueryData[],
  queryName: string,
  expectedColumns: readonly TColumn[],
): ModeQueryData | null {
  const query = data.find((entry) => entry.queryName === queryName);
  if (!query || query.rows.length === 0) return null;

  const validation = validateModeColumns({
    row: query.rows[0],
    expectedColumns,
    reportName: query.reportName,
    queryName: query.queryName,
  });

  return validation.isValid ? query : null;
}

function computeTenureMonths(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return 0;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / (30.44 * 86400000)));
}

export async function getAttritionData(): Promise<AttritionData> {
  const data = await getReportData("people", "attrition", [
    "attrition",
    "attrition_within_1y_joining",
    "Query 2",
    "employees",
  ]);

  const attritionQuery = getValidatedQuery(data, "attrition", ATTRITION_COLUMNS);
  const y1Query = getValidatedQuery(data, "attrition_within_1y_joining", Y1_ATTRITION_COLUMNS);
  const leaverQuery = getValidatedQuery(data, "Query 2", LEAVER_COLUMNS);
  const employeeQuery = getValidatedQuery(data, "employees", EMPLOYEE_COLUMNS);

  const rollingAttrition: AttritionRow[] = (attritionQuery?.rows ?? []).map((row) => ({
    reportingPeriod: rowStr(row, "reporting_period"),
    department: canonicalDepartment(rowStr(row, "department")),
    tenure: rowStr(row, "tenure"),
    headcountAvg: rowNum(row, "headcount_avg_of_month"),
    avgHeadcountL12m: rowNum(row, "avg_headcount_l12m"),
    leaversL12m: rowNum(row, "leavers_l12m"),
    regrettedL12m: rowNum(row, "leavers_voluntary_regrettable_l12m"),
    voluntaryNonRegrettedL12m: rowNum(row, "leavers_voluntary_non_regrettable_l12m"),
    involuntaryL12m: rowNum(row, "leavers_involuntary_non_regrettable_l12m"),
  }));

  const y1Attrition: Y1AttritionRow[] = (y1Query?.rows ?? []).map((row) => ({
    startMonth: rowStr(row, "start_month"),
    department: canonicalDepartment(rowStr(row, "department")),
    cohortMaturity: rowStr(row, "cohort_maturity"),
    numStarters: rowNum(row, "num_starters"),
    numLeaversWithin1y: rowNum(row, "num_leavers_within_1y"),
    regrettedWithin1y: rowNum(row, "num_voluntary_regrettable_leavers_within_1y"),
    voluntaryNonRegrettedWithin1y: rowNum(row, "num_voluntary_non_regrettable_leavers_within_1y"),
    involuntaryWithin1y: rowNum(row, "num_involuntary_non_regrettable_leavers_within_1y"),
    numStartersL12m: rowNum(row, "num_starters_l12m"),
    numLeaversWithin1yL12m: rowNum(row, "num_leavers_within_1y_l12m"),
    regrettedWithin1yL12m: rowNum(row, "num_voluntary_regrettable_leavers_within_1y_l12m"),
    voluntaryNonRegrettedWithin1yL12m: rowNum(row, "num_voluntary_non_regrettable_leavers_within_1y_l12m"),
    involuntaryWithin1yL12m: rowNum(row, "num_involuntary_non_regrettable_leavers_within_1y_l12m"),
  }));

  const recentLeavers: Leaver[] = (leaverQuery?.rows ?? []).map((row) => {
    const startDate = rowStr(row, "start_date");
    const terminationDate = rowStr(row, "termination_date");
    return {
      name: rowStr(row, "display_name"),
      department: canonicalDepartment(rowStr(row, "department")),
      squad: rowStr(row, "squad"),
      level: rowStr(row, "level"),
      startDate,
      terminationDate,
      terminationType: rowStr(row, "termination_type"),
      regretted: rowStr(row, "regretted_leaver"),
      managerName: rowStr(row, "manager_name"),
      workLocation: rowStr(row, "work_location"),
      tenureMonths: computeTenureMonths(startDate, terminationDate),
    };
  });

  const employees: Employee[] = (employeeQuery?.rows ?? [])
    .filter((row) => rowStr(row, "is_employee") === "FTE")
    .map((row) => ({
      startDate: rowStr(row, "start_date"),
      terminationDate: rowStr(row, "termination_date") || null,
    }))
    .filter((e) => e.startDate.length > 0);

  return { rollingAttrition, y1Attrition, recentLeavers, employees };
}
