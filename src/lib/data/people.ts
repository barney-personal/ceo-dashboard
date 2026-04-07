import { getReportData } from "./mode";
import type { BarChartData } from "@/components/charts/bar-chart";

export interface Person {
  name: string;
  email: string;
  jobTitle: string;
  level: string;
  squad: string;
  function: string;
  manager: string;
  startDate: string;
  location: string;
  tenureMonths: number;
}

export interface PeopleMetrics {
  total: number;
  departments: number;
  newHiresThisMonth: number;
  newHiresLastMonth: number;
  averageTenureMonths: number;
  attritionLast90Days: number;
}

/**
 * Transform raw Mode headcount rows into typed Person objects.
 */
export function transformToPersons(rows: Record<string, unknown>[]): Person[] {
  const now = Date.now();
  return rows
    .map((r) => {
      const startDate = (r.start_date as string) || "";
      const startMs = startDate ? new Date(startDate).getTime() : now;
      const tenureMonths = Math.max(
        0,
        Math.floor((now - startMs) / (30.44 * 24 * 60 * 60 * 1000))
      );
      return {
        name: (r.preferred_name as string) || "Unknown",
        email: (r.email as string) || "",
        jobTitle: (r.job_title as string) || "",
        level: (r.hb_level as string) || "",
        squad: (r.hb_squad as string) || "Unassigned",
        function: (r.hb_function as string) || "Unassigned",
        manager: (r.manager as string) || "",
        startDate,
        location: (r.work_location as string) || "",
        tenureMonths,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compute aggregate people metrics from active employees and the full dataset.
 */
export function getPeopleMetrics(
  active: Person[],
  allRows: Record<string, unknown>[]
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
  const averageTenureMonths = active.length > 0 ? Math.round(totalTenure / active.length) : 0;

  const departments = new Set(active.map((p) => p.function)).size;

  const attritionLast90Days = allRows.filter((r) => {
    if (r.lifecycle_status !== "Terminated" && r.lifecycle_status !== "terminated") return false;
    if (r.is_cleo_headcount !== 1) return false;
    const termDate = r.termination_date as string | null;
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

/**
 * Group employees by function, with squads nested inside.
 */
export function groupByFunctionAndSquad(
  employees: Person[]
): { name: string; squads: { name: string; people: Person[] }[] }[] {
  const byFunction = new Map<string, Map<string, Person[]>>();

  for (const person of employees) {
    if (!byFunction.has(person.function)) {
      byFunction.set(person.function, new Map());
    }
    const squads = byFunction.get(person.function)!;
    if (!squads.has(person.squad)) {
      squads.set(person.squad, []);
    }
    squads.get(person.squad)!.push(person);
  }

  return [...byFunction.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([funcName, squads]) => ({
      name: funcName,
      squads: [...squads.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([squadName, people]) => ({ name: squadName, people })),
    }));
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
      (p) => p.tenureMonths >= bucket.min && p.tenureMonths < bucket.max
    ).length,
    color: "#3b3bba",
  }));
}

/**
 * Fetch and transform active employees from Mode headcount data.
 */
export async function getActiveEmployees(): Promise<{
  employees: Person[];
  allRows: Record<string, unknown>[];
  lastSync: Date | null;
}> {
  const data = await getReportData("people", "headcount");
  const query = data.find((d) => d.queryName === "headcount");
  if (!query) return { employees: [], allRows: [], lastSync: null };

  const allRows = query.rows;
  const activeRows = allRows.filter(
    (r) => r.lifecycle_status === "Employed" && r.is_cleo_headcount === 1
  );

  return {
    employees: transformToPersons(activeRows),
    allRows,
    lastSync: query.syncedAt,
  };
}
