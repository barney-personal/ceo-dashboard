// Pure functions for attrition data transformation.
// Client-safe — no server-only imports (mode.ts, db, etc.).

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

export interface Employee {
  startDate: string;
  terminationDate: string | null;
}

export interface AttritionData {
  rollingAttrition: AttritionRow[];
  y1Attrition: Y1AttritionRow[];
  recentLeavers: Leaver[];
  employees: Employee[];
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

    total.data.push({ date, value: (agg.leavers / agg.headcount) * 100 });
    regretted.data.push({ date, value: (agg.regretted / agg.headcount) * 100 });
    volNonReg.data.push({ date, value: (agg.volNonReg / agg.headcount) * 100 });
    involuntary.data.push({ date, value: (agg.involuntary / agg.headcount) * 100 });
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
          return { date, value: (agg.leavers / agg.headcount) * 100 };
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

    total.data.push({ date, value: (agg.leavers / agg.starters) * 100 });
    regretted.data.push({ date, value: (agg.regretted / agg.starters) * 100 });
    nonRegretted.data.push({ date, value: ((agg.volNonReg + agg.involuntary) / agg.starters) * 100 });
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

// ── Helpers ──

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

// ── Employee Retention Cohorts ──

function getQuarterKey(date: Date): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

function quarterStartDate(key: string): Date {
  const [yearStr, qStr] = key.split("-Q");
  const month = (parseInt(qStr, 10) - 1) * 3;
  return new Date(Date.UTC(parseInt(yearStr, 10), month, 1));
}

function addQuarters(date: Date, quarters: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + quarters * 3);
  return d;
}

export interface RetentionCohort {
  cohort: string;
  periods: (number | null)[];
  cohortSize: number;
}

/**
 * Build quarterly employee retention cohorts.
 *
 * For each quarter, count how many FTEs started. Then for each subsequent
 * quarter, compute the fraction still employed (no termination_date, or
 * termination_date >= quarter start). The result is a retention triangle
 * compatible with the RetentionTriangle component.
 */
export function buildEmployeeRetentionCohorts(employees: Employee[]): RetentionCohort[] {
  if (employees.length === 0) return [];

  const now = new Date();
  const currentQuarter = getQuarterKey(now);

  // Group employees by start quarter
  const cohortMap = new Map<string, Employee[]>();
  for (const emp of employees) {
    const startDate = new Date(emp.startDate);
    if (!Number.isFinite(startDate.getTime())) continue;
    const key = getQuarterKey(startDate);
    const list = cohortMap.get(key) ?? [];
    list.push(emp);
    cohortMap.set(key, list);
  }

  // Sort cohort keys chronologically
  const sortedKeys = [...cohortMap.keys()].sort();
  if (sortedKeys.length === 0) return [];

  // Don't include current quarter (incomplete)
  const cohortKeys = sortedKeys.filter((k) => k !== currentQuarter);

  return cohortKeys.map((key) => {
    const members = cohortMap.get(key)!;
    const cohortSize = members.length;
    const cohortStart = quarterStartDate(key);

    // Calculate how many quarters have elapsed since this cohort started
    const maxQuarters = Math.floor(
      (now.getTime() - cohortStart.getTime()) / (90 * 86400000),
    );

    const periods: (number | null)[] = [];
    for (let q = 0; q <= maxQuarters; q++) {
      const periodStart = addQuarters(cohortStart, q);
      // Count employees who were still active at the start of this period
      const survivors = members.filter((emp) => {
        if (!emp.terminationDate) return true;
        const termDate = new Date(emp.terminationDate);
        return termDate >= periodStart;
      }).length;
      periods.push(survivors / cohortSize);
    }

    return { cohort: key, periods, cohortSize };
  });
}
