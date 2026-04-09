import { getReportData, rowStr, rowNum, validateModeColumns } from "./mode";
import type { BarChartData } from "@/components/charts/bar-chart";
import {
  DAYS_PER_MONTH,
  getPillarForSquad,
  isProductPillar,
} from "@/lib/config/people";

export interface Person {
  name: string;
  email: string;
  jobTitle: string;
  level: string;
  squad: string;
  pillar: string;
  function: string;
  manager: string;
  startDate: string;
  location: string;
  tenureMonths: number;
  employmentType: string;
}

export interface PeopleMetrics {
  total: number;
  departments: number;
  newHiresThisMonth: number;
  newHiresLastMonth: number;
  averageTenureMonths: number;
  attritionLast90Days: number;
}

const CURRENT_FTES_QUERY_COLUMNS = [
  "employee_email",
  "preferred_name",
  "employment_type",
  "start_date",
  "line_manager_email",
  "pillar_name",
  "squad_name",
  "function_name",
] as const;

const HEADCOUNT_QUERY_COLUMNS = [
  "preferred_name",
  "email",
  "job_title",
  "hb_level",
  "hb_squad",
  "hb_function",
  "manager",
  "start_date",
  "work_location",
  "lifecycle_status",
  "is_cleo_headcount",
  "termination_date",
] as const;

/**
 * Transform raw Mode headcount rows (old report) into typed Person objects.
 * Used as fallback when Current FTEs data is unavailable.
 */
export function transformToPersons(rows: Record<string, unknown>[]): Person[] {
  const now = Date.now();
  return rows
    .map((r) => {
      const startDate = rowStr(r, "start_date");
      const startTs = startDate ? new Date(startDate).getTime() : NaN;
      const startMs = Number.isFinite(startTs) ? startTs : now;
      const tenureMonths = Math.max(
        0,
        Math.floor((now - startMs) / (DAYS_PER_MONTH * 24 * 60 * 60 * 1000)),
      );
      return {
        name: rowStr(r, "preferred_name") || "Unknown",
        email: rowStr(r, "email"),
        jobTitle: rowStr(r, "job_title"),
        level: rowStr(r, "hb_level"),
        squad: rowStr(r, "hb_squad") || rowStr(r, "hb_function") || "Unassigned",
        pillar: getPillarForSquad(rowStr(r, "hb_squad") || rowStr(r, "hb_function") || "Unassigned"),
        function: rowStr(r, "hb_function") || "Unassigned",
        manager: rowStr(r, "manager"),
        startDate,
        location: rowStr(r, "work_location"),
        tenureMonths,
        employmentType: "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function computeTenureMonths(startDate: string): number {
  const now = Date.now();
  const startTs = startDate ? new Date(startDate).getTime() : NaN;
  const startMs = Number.isFinite(startTs) ? startTs : now;
  return Math.max(
    0,
    Math.floor((now - startMs) / (DAYS_PER_MONTH * 24 * 60 * 60 * 1000)),
  );
}

/**
 * Merge Current FTEs (primary) with old Headcount SSoT (augmentation).
 * New report provides: name, email, squad, pillar, function, start_date, employment_type.
 * Old report augments with: job_title, level, location.
 */
export function mergeEmployeeData(
  fteRows: Record<string, unknown>[],
  headcountRows: Record<string, unknown>[],
): Person[] {
  // Build email → old-report row lookup for augmentation (active employees only,
  // so we don't merge stale data from terminated records sharing an email).
  const oldByEmail = new Map<string, Record<string, unknown>>();
  for (const r of headcountRows) {
    if (String(r.lifecycle_status).toLowerCase() !== "employed") continue;
    const email = rowStr(r, "email").toLowerCase();
    if (email) oldByEmail.set(email, r);
  }

  return fteRows
    .map((r) => {
      const email = rowStr(r, "employee_email");
      const old = oldByEmail.get(email.toLowerCase());
      const startDate = rowStr(r, "start_date");
      const squadName = rowStr(r, "squad_name");
      const functionName = rowStr(r, "function_name");

      return {
        name: rowStr(r, "preferred_name") || "Unknown",
        email,
        jobTitle: old ? rowStr(old, "job_title") : "",
        level: old ? rowStr(old, "hb_level") : "",
        squad: squadName || functionName || "Unassigned",
        pillar: rowStr(r, "pillar_name") || "Other",
        function: functionName || "Unassigned",
        manager: old ? rowStr(old, "manager") : rowStr(r, "line_manager_email"),
        startDate,
        location: old ? rowStr(old, "work_location") : "",
        tenureMonths: computeTenureMonths(startDate),
        employmentType: rowStr(r, "employment_type"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compute aggregate people metrics from active employees and the full dataset.
 */
export function getPeopleMetrics(
  active: Person[],
  allRows: Record<string, unknown>[],
): PeopleMetrics {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const newHiresThisMonth = active.filter((p) => {
    if (!p.startDate) return false;
    const d = new Date(p.startDate);
    return d >= thisMonthStart;
  }).length;

  const newHiresLastMonth = active.filter((p) => {
    if (!p.startDate) return false;
    const d = new Date(p.startDate);
    return d >= lastMonthStart && d < thisMonthStart;
  }).length;

  const totalTenure = active.reduce((sum, p) => sum + p.tenureMonths, 0);
  const averageTenureMonths =
    active.length > 0 ? Math.round(totalTenure / active.length) : 0;

  const departments = new Set(active.map((p) => p.function)).size;

  const attritionLast90Days = allRows.filter((r) => {
    if (String(r.lifecycle_status).toLowerCase() !== "terminated") return false;
    if (rowNum(r, "is_cleo_headcount") !== 1) return false;
    const termDate = rowStr(r, "termination_date");
    if (!termDate) return false;
    return new Date(termDate) >= ninetyDaysAgo;
  }).length;

  return {
    total: active.length,
    departments,
    newHiresThisMonth,
    newHiresLastMonth,
    averageTenureMonths,
    attritionLast90Days,
  };
}

export interface PillarGroup {
  name: string;
  count: number;
  isProduct: boolean;
  squads: { name: string; people: Person[] }[];
}

/**
 * Group employees by pillar → squad for drill-down navigation.
 * Uses the pillar field directly from each person (from Rev data or derived).
 */
export function groupByPillarAndSquad(employees: Person[]): PillarGroup[] {
  const byPillar = new Map<string, Map<string, Person[]>>();

  for (const person of employees) {
    const pillar = person.pillar;
    if (!byPillar.has(pillar)) {
      byPillar.set(pillar, new Map());
    }
    const squads = byPillar.get(pillar)!;
    if (!squads.has(person.squad)) {
      squads.set(person.squad, []);
    }
    squads.get(person.squad)!.push(person);
  }

  return [...byPillar.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pillarName, squads]) => {
      const squadList = [...squads.entries()]
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([squadName, people]) => ({ name: squadName, people }));
      return {
        name: pillarName,
        count: squadList.reduce((s, sq) => s + sq.people.length, 0),
        isProduct: isProductPillar(pillarName),
        squads: squadList,
      };
    });
}

/**
 * Tenure distribution for bar chart.
 */
export function getTenureDistribution(employees: Person[]): BarChartData[] {
  const buckets = [
    { label: "< 6 months", min: 0, max: 6 },
    { label: "6–12 months", min: 6, max: 12 },
    { label: "1–2 years", min: 12, max: 24 },
    { label: "2–3 years", min: 24, max: 36 },
    { label: "3–5 years", min: 36, max: 60 },
    { label: "5+ years", min: 60, max: Infinity },
  ];

  return buckets.map((bucket) => ({
    label: bucket.label,
    value: employees.filter(
      (p) => p.tenureMonths >= bucket.min && p.tenureMonths < bucket.max,
    ).length,
    color: "#3b3bba",
  }));
}

/**
 * Monthly joiners and departures for the last N months.
 */
export function getMonthlyJoinersAndDepartures(
  allRows: Record<string, unknown>[],
  months: number = 36,
): {
  joiners: { date: string; value: number }[];
  departures: { date: string; value: number }[];
} {
  const now = new Date();
  const startMonth = new Date(
    now.getFullYear(),
    now.getMonth() - months + 1,
    1,
  );

  // Build month buckets
  const buckets: { key: string; date: string }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      date: d.toISOString().slice(0, 10),
    });
  }

  // Count all Cleo employee joiners by start_date month
  const joinerCounts = new Map<string, number>();
  for (const r of allRows) {
    if (rowNum(r, "is_cleo_headcount") !== 1) continue;
    const startDate = rowStr(r, "start_date");
    if (!startDate) continue;
    const d = new Date(startDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    joinerCounts.set(key, (joinerCounts.get(key) ?? 0) + 1);
  }

  // Count departures by termination_date month
  const departureCounts = new Map<string, number>();
  for (const r of allRows) {
    if (String(r.lifecycle_status).toLowerCase() !== "terminated") continue;
    if (rowNum(r, "is_cleo_headcount") !== 1) continue;
    const termDate = rowStr(r, "termination_date");
    if (!termDate) continue;
    const d = new Date(termDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    departureCounts.set(key, (departureCounts.get(key) ?? 0) + 1);
  }

  return {
    joiners: buckets.map((b) => ({
      date: b.date,
      value: joinerCounts.get(b.key) ?? 0,
    })),
    departures: buckets.map((b) => ({
      date: b.date,
      value: departureCounts.get(b.key) ?? 0,
    })),
  };
}

/**
 * Fetch and transform active employees from Mode data.
 *
 * Primary source: Current FTEs report (Rev — canonical org structure).
 * Augmentation: Headcount SSoT report (job title, level, location, termination history).
 *
 * Falls back to Headcount SSoT alone when Current FTEs is unavailable.
 */
export async function getActiveEmployees(): Promise<{
  employees: Person[];
  allRows: Record<string, unknown>[];
  lastSync: Date | null;
}> {
  const [fteData, headcountData] = await Promise.all([
    getReportData("people", "org", ["current_employees"]),
    getReportData("people", "headcount", ["headcount"]),
  ]);

  const fteQuery = fteData.find((d) => d.queryName === "current_employees");
  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");

  // allRows from old report — used for attrition/departures metrics.
  // If headcount data is unavailable, these metrics degrade to zero rather than
  // erroring, which is acceptable since both reports sync on the same schedule.
  const allRows = headcountQuery?.rows ?? [];

  // Primary path: Current FTEs available
  if (fteQuery && fteQuery.rows.length > 0) {
    const fteColumnSource = fteQuery.columns?.length
      ? Object.fromEntries(fteQuery.columns.map((c) => [c.name, true]))
      : fteQuery.rows[0] ?? {};
    const fteValidation = validateModeColumns({
      row: fteColumnSource as Record<string, unknown>,
      expectedColumns: CURRENT_FTES_QUERY_COLUMNS,
      reportName: fteQuery.reportName,
      queryName: fteQuery.queryName,
    });

    if (fteValidation.isValid) {
      return {
        employees: mergeEmployeeData(fteQuery.rows, allRows),
        allRows,
        lastSync: fteQuery.syncedAt,
      };
    }
  }

  // Fallback: use Headcount SSoT alone
  if (!headcountQuery || headcountQuery.rows.length === 0) {
    return { employees: [], allRows: [], lastSync: null };
  }

  const columnSource = headcountQuery.columns?.length
    ? Object.fromEntries(headcountQuery.columns.map((c) => [c.name, true]))
    : headcountQuery.rows[0] ?? {};
  const validation = validateModeColumns({
    row: columnSource as Record<string, unknown>,
    expectedColumns: HEADCOUNT_QUERY_COLUMNS,
    reportName: headcountQuery.reportName,
    queryName: headcountQuery.queryName,
  });

  if (!validation.isValid) {
    return { employees: [], allRows: [], lastSync: null };
  }

  const activeRows = allRows.filter(
    (r) =>
      String(r.lifecycle_status).toLowerCase() === "employed" &&
      rowNum(r, "is_cleo_headcount") === 1,
  );

  return {
    employees: transformToPersons(activeRows),
    allRows,
    lastSync: headcountQuery.syncedAt,
  };
}
