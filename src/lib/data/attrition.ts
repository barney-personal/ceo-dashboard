import {
  getReportData,
  rowStr,
  rowNum,
  validateModeColumns,
} from "./mode";

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

// ── Types ──

export interface AttritionRow {
  reportingPeriod: string;
  department: string;
  tenure: string;
  headcountAvg: number;
  avgHeadcountL12m: number;
  leaversL12m: number;
  regrettedL12m: number;
  voluntaryNonRegrettedL12m: number;
  involuntaryL12m: number;
}

export interface Y1AttritionRow {
  startMonth: string;
  department: string;
  cohortMaturity: string;
  numStarters: number;
  numLeaversWithin1y: number;
  regrettedWithin1y: number;
  voluntaryNonRegrettedWithin1y: number;
  involuntaryWithin1y: number;
  numStartersL12m: number;
  numLeaversWithin1yL12m: number;
  regrettedWithin1yL12m: number;
  voluntaryNonRegrettedWithin1yL12m: number;
  involuntaryWithin1yL12m: number;
}

export interface Leaver {
  name: string;
  department: string;
  squad: string;
  level: string;
  startDate: string;
  terminationDate: string;
  terminationType: string;
  regretted: string;
  managerName: string;
  workLocation: string;
  tenureMonths: number;
}

export interface AttritionData {
  rollingAttrition: AttritionRow[];
  y1Attrition: Y1AttritionRow[];
  recentLeavers: Leaver[];
}

type ChartSeries = {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  dashed?: boolean;
};

export interface AttritionMetrics {
  currentRate: number;
  previousRate: number;
  regrettedRate: number;
  previousRegrettedRate: number;
  nonRegrettedRate: number;
  headcount: number;
  leaversL12m: number;
}

export interface Y1AttritionMetrics {
  currentRate: number;
  previousRate: number;
  regrettedRate: number;
  starters: number;
  leavers: number;
}

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
  ]);

  const attritionQuery = getValidatedQuery(data, "attrition", ATTRITION_COLUMNS);
  const y1Query = getValidatedQuery(data, "attrition_within_1y_joining", Y1_ATTRITION_COLUMNS);
  const leaverQuery = getValidatedQuery(data, "Query 2", LEAVER_COLUMNS);

  const rollingAttrition: AttritionRow[] = (attritionQuery?.rows ?? []).map((row) => ({
    reportingPeriod: rowStr(row, "reporting_period"),
    department: rowStr(row, "department"),
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
    department: rowStr(row, "department"),
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
      department: rowStr(row, "department"),
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

  return { rollingAttrition, y1Attrition, recentLeavers };
}

// ── Series builders ──

const COLORS = {
  total: "var(--chart-1)",
  regretted: "var(--chart-destructive, #ef4444)",
  voluntaryNonRegretted: "var(--chart-warning, #f59e0b)",
  involuntary: "var(--chart-3)",
};

function aggregateByPeriod(
  rows: AttritionRow[],
  filterDepartment?: string,
  filterTenure?: string,
): Map<string, { headcount: number; leavers: number; regretted: number; volNonReg: number; involuntary: number }> {
  const map = new Map<string, { headcount: number; leavers: number; regretted: number; volNonReg: number; involuntary: number }>();

  for (const row of rows) {
    if (filterDepartment && row.department !== filterDepartment) continue;
    if (filterTenure && row.tenure !== filterTenure) continue;

    const key = row.reportingPeriod.slice(0, 10);
    const existing = map.get(key) ?? { headcount: 0, leavers: 0, regretted: 0, volNonReg: 0, involuntary: 0 };
    existing.headcount += row.avgHeadcountL12m;
    existing.leavers += row.leaversL12m;
    existing.regretted += row.regrettedL12m;
    existing.volNonReg += row.voluntaryNonRegrettedL12m;
    existing.involuntary += row.involuntaryL12m;
    map.set(key, existing);
  }

  return map;
}

export function getRollingAttritionSeries(
  rows: AttritionRow[],
  filterDepartment?: string,
  filterTenure?: string,
): ChartSeries[] {
  const byPeriod = aggregateByPeriod(rows, filterDepartment, filterTenure);

  const total: ChartSeries = { label: "Total", color: COLORS.total, data: [] };
  const regretted: ChartSeries = { label: "Regretted", color: COLORS.regretted, data: [] };
  const volNonReg: ChartSeries = { label: "Non-regretted voluntary", color: COLORS.voluntaryNonRegretted, data: [] };
  const involuntary: ChartSeries = { label: "Involuntary", color: COLORS.involuntary, data: [] };

  const sortedKeys = [...byPeriod.keys()].sort();
  for (const date of sortedKeys) {
    const agg = byPeriod.get(date)!;
    if (agg.headcount === 0) continue;

    total.data.push({ date, value: agg.leavers / agg.headcount });
    regretted.data.push({ date, value: agg.regretted / agg.headcount });
    volNonReg.data.push({ date, value: agg.volNonReg / agg.headcount });
    involuntary.data.push({ date, value: agg.involuntary / agg.headcount });
  }

  return [total, regretted, volNonReg, involuntary];
}

export function getAttritionByDepartment(rows: AttritionRow[]): ChartSeries[] {
  const departments = [...new Set(rows.map((r) => r.department))].sort();
  const palette = [
    COLORS.total, COLORS.regretted, COLORS.voluntaryNonRegretted, COLORS.involuntary,
    "var(--chart-2)", "var(--chart-4)", "var(--chart-5)",
    "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  ];

  return departments.map((dept, i) => {
    const deptRows = rows.filter((r) => r.department === dept);
    const byPeriod = aggregateByPeriod(deptRows);
    const sortedKeys = [...byPeriod.keys()].sort();

    return {
      label: dept,
      color: palette[i % palette.length],
      data: sortedKeys
        .filter((date) => byPeriod.get(date)!.headcount > 0)
        .map((date) => {
          const agg = byPeriod.get(date)!;
          return { date, value: agg.leavers / agg.headcount };
        }),
    };
  });
}

export function getLatestAttritionMetrics(rows: AttritionRow[]): AttritionMetrics {
  const byPeriod = aggregateByPeriod(rows);
  const sortedKeys = [...byPeriod.keys()].sort();

  if (sortedKeys.length === 0) {
    return { currentRate: 0, previousRate: 0, regrettedRate: 0, previousRegrettedRate: 0, nonRegrettedRate: 0, headcount: 0, leaversL12m: 0 };
  }

  const latest = byPeriod.get(sortedKeys[sortedKeys.length - 1])!;
  const previous = sortedKeys.length >= 2 ? byPeriod.get(sortedKeys[sortedKeys.length - 2])! : latest;

  const hc = latest.headcount || 1;
  const phc = previous.headcount || 1;

  return {
    currentRate: latest.leavers / hc,
    previousRate: previous.leavers / phc,
    regrettedRate: latest.regretted / hc,
    previousRegrettedRate: previous.regretted / phc,
    nonRegrettedRate: (latest.volNonReg + latest.involuntary) / hc,
    headcount: latest.headcount,
    leaversL12m: latest.leavers,
  };
}

// ── Y1 Attrition series ──

function aggregateY1ByPeriod(
  rows: Y1AttritionRow[],
  filterDepartment?: string,
): Map<string, { starters: number; leavers: number; regretted: number; volNonReg: number; involuntary: number }> {
  const map = new Map<string, { starters: number; leavers: number; regretted: number; volNonReg: number; involuntary: number }>();

  for (const row of rows) {
    if (filterDepartment && row.department !== filterDepartment) continue;

    const key = row.startMonth.slice(0, 10);
    const existing = map.get(key) ?? { starters: 0, leavers: 0, regretted: 0, volNonReg: 0, involuntary: 0 };
    existing.starters += row.numStartersL12m;
    existing.leavers += row.numLeaversWithin1yL12m;
    existing.regretted += row.regrettedWithin1yL12m;
    existing.volNonReg += row.voluntaryNonRegrettedWithin1yL12m;
    existing.involuntary += row.involuntaryWithin1yL12m;
    map.set(key, existing);
  }

  return map;
}

export function getY1AttritionSeries(
  rows: Y1AttritionRow[],
  filterDepartment?: string,
): ChartSeries[] {
  const byPeriod = aggregateY1ByPeriod(rows, filterDepartment);

  const total: ChartSeries = { label: "Total", color: COLORS.total, data: [] };
  const regretted: ChartSeries = { label: "Regretted", color: COLORS.regretted, data: [] };
  const nonRegretted: ChartSeries = { label: "Non-regretted", color: COLORS.voluntaryNonRegretted, data: [] };

  const sortedKeys = [...byPeriod.keys()].sort();
  for (const date of sortedKeys) {
    const agg = byPeriod.get(date)!;
    if (agg.starters === 0) continue;

    total.data.push({ date, value: agg.leavers / agg.starters });
    regretted.data.push({ date, value: agg.regretted / agg.starters });
    nonRegretted.data.push({ date, value: (agg.volNonReg + agg.involuntary) / agg.starters });
  }

  return [total, regretted, nonRegretted];
}

export function getLatestY1Metrics(rows: Y1AttritionRow[]): Y1AttritionMetrics {
  const byPeriod = aggregateY1ByPeriod(rows);
  const sortedKeys = [...byPeriod.keys()].sort();

  if (sortedKeys.length === 0) {
    return { currentRate: 0, previousRate: 0, regrettedRate: 0, starters: 0, leavers: 0 };
  }

  const latest = byPeriod.get(sortedKeys[sortedKeys.length - 1])!;
  const previous = sortedKeys.length >= 2 ? byPeriod.get(sortedKeys[sortedKeys.length - 2])! : latest;

  const ls = latest.starters || 1;
  const ps = previous.starters || 1;

  return {
    currentRate: latest.leavers / ls,
    previousRate: previous.leavers / ps,
    regrettedRate: latest.regretted / ls,
    starters: latest.starters,
    leavers: latest.leavers,
  };
}

// ── Helpers for the page ──

export function getDepartments(rows: AttritionRow[]): string[] {
  return [...new Set(rows.map((r) => r.department))].sort();
}

export function getTenureBuckets(rows: AttritionRow[]): string[] {
  return [...new Set(rows.map((r) => r.tenure))].sort();
}

export function getRecentLeavers(leavers: Leaver[]): Leaver[] {
  return [...leavers].sort(
    (a, b) => new Date(b.terminationDate).getTime() - new Date(a.terminationDate).getTime(),
  );
}
