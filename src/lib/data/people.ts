import { getReportData, parseRows, rowStr, rowNum } from "./mode";
import type { HeadcountRow } from "@/lib/validation/mode-rows";
import { currentFteSchema, headcountSchema } from "@/lib/validation/mode-rows";
import type { BarChartData } from "@/components/charts/bar-chart";
import {
  DAYS_PER_MONTH,
  getPillarForSquad,
  isProductPillar,
  normalizeJobTitle,
  normalizeDepartment,
  normalizeLevel,
  resolveEngineerDiscipline,
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
      const rawLevel = rowStr(r, "hb_level");
      const specialisation = rowStr(r, "rp_specialisation");
      const jobTitle = resolveEngineerDiscipline(
        normalizeJobTitle(rowStr(r, "job_title")),
        rawLevel,
        specialisation,
      );
      const func = rowStr(r, "hb_function") || "Unassigned";
      const squad = rowStr(r, "hb_squad") || func || "Unassigned";
      return {
        name: rowStr(r, "preferred_name") || "Unknown",
        email: rowStr(r, "email"),
        jobTitle,
        level: normalizeLevel(rawLevel, jobTitle),
        squad,
        pillar: getPillarForSquad(squad),
        function: normalizeDepartment(func, jobTitle),
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

      const rawLevel = old ? rowStr(old, "hb_level") : "";
      const specialisation = old ? rowStr(old, "rp_specialisation") : "";
      const jobTitle = old
        ? resolveEngineerDiscipline(
            normalizeJobTitle(rowStr(old, "job_title")),
            rawLevel,
            specialisation,
          )
        : "";
      const func = functionName || "Unassigned";
      return {
        name: rowStr(r, "preferred_name") || "Unknown",
        email,
        jobTitle,
        level: normalizeLevel(rawLevel, jobTitle),
        squad: squadName || functionName || "Unassigned",
        pillar: rowStr(r, "pillar_name") || "Other",
        function: normalizeDepartment(func, jobTitle),
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
    .sort(([nameA, a], [nameB, b]) => {
      const countA = [...a.values()].reduce((s, p) => s + p.length, 0);
      const countB = [...b.values()].reduce((s, p) => s + p.length, 0);
      return countB - countA || nameA.localeCompare(nameB);
    })
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

export interface MovementPerson {
  name: string;
  email: string;
  jobTitle: string;
  level: string;
  function: string;
  squad: string;
  location: string;
  startDate: string;
  terminationDate: string;
  monthKey: string;
}

/**
 * Get per-person joiner and departure records keyed by month.
 * Used for drilldown from the Joiners & Departures chart.
 */
export function getMonthlyMovementPeople(
  allRows: Record<string, unknown>[],
): { joiners: MovementPerson[]; departures: MovementPerson[] } {
  const joiners: MovementPerson[] = [];
  const departures: MovementPerson[] = [];

  for (const r of allRows) {
    if (rowNum(r, "is_cleo_headcount") !== 1) continue;
    const name = rowStr(r, "preferred_name") || "Unknown";
    const email = rowStr(r, "email");
    const rawLevel = rowStr(r, "hb_level");
    const specialisation = rowStr(r, "rp_specialisation");
    const jobTitle = resolveEngineerDiscipline(
      normalizeJobTitle(rowStr(r, "job_title")),
      rawLevel,
      specialisation,
    );
    const level = normalizeLevel(rawLevel, jobTitle);
    const func = normalizeDepartment(
      rowStr(r, "hb_function") || "Unassigned",
      jobTitle,
    );

    const startDate = rowStr(r, "start_date");
    if (startDate) {
      const d = new Date(startDate);
      if (!isNaN(d.getTime())) {
        joiners.push({
          name,
          email,
          jobTitle,
          level,
          function: func,
          squad: rowStr(r, "hb_squad") || func,
          location: rowStr(r, "work_location"),
          startDate,
          terminationDate: "",
          monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        });
      }
    }

    if (String(r.lifecycle_status).toLowerCase() === "terminated") {
      const termDate = rowStr(r, "termination_date");
      if (termDate) {
        const d = new Date(termDate);
        if (!isNaN(d.getTime())) {
          departures.push({
            name,
            email,
            jobTitle,
            level,
            function: func,
            squad: rowStr(r, "hb_squad") || func,
            location: rowStr(r, "work_location"),
            startDate,
            terminationDate: termDate,
            monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          });
        }
      }
    }
  }

  return { joiners, departures };
}

/**
 * Part-time Customer Champions appear as "no pillar" / "no squad" in the
 * Current FTEs report AND belong to Customer Operations. They are excluded
 * from all metrics and shown separately.
 */
export function isPartTimeChampion(person: Person): boolean {
  return (
    (person.pillar === "no pillar" || person.squad === "no squad") &&
    person.function === "Customer Operations"
  );
}

/**
 * People with "no pillar" / "no squad" who are NOT in Customer Operations.
 * Shown in a separate "Unassigned" bucket above part-time champions.
 */
export function isUnassigned(person: Person): boolean {
  return (
    (person.pillar === "no pillar" || person.squad === "no squad") &&
    person.function !== "Customer Operations"
  );
}

/**
 * Compute tenure in calendar days from a start date string.
 */
export function computeTenureDays(startDate: string): number {
  const start = new Date(startDate);
  const now = Date.now();
  const startMs = start.getTime();
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((now - startMs) / (24 * 60 * 60 * 1000)));
}

/**
 * Fetch and transform active employees from Mode data.
 *
 * Primary source: Current FTEs report (Rev — canonical org structure).
 * Augmentation: Headcount SSoT report (job title, level, location, termination history).
 *
 * Falls back to Headcount SSoT alone when Current FTEs is unavailable.
 * Part-time Customer Champions ("no pillar"/"no squad") are returned separately.
 */
export async function getActiveEmployees(): Promise<{
  employees: Person[];
  partTimeChampions: Person[];
  unassigned: Person[];
  allRows: HeadcountRow[];
  lastSync: Date | null;
}> {
  const [fteData, headcountData] = await Promise.all([
    getReportData("people", "org", ["current_employees"]),
    getReportData("people", "headcount", ["headcount"]),
  ]);

  const fteQuery = fteData.find((d) => d.queryName === "current_employees");
  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");

  // Validate headcount rows — allRows is used for attrition/departures
  // metrics, so rows that fail field-level validation are dropped and
  // counted once per batch via `parseRows`.
  let allRows: HeadcountRow[] = [];
  if (headcountQuery && headcountQuery.rows.length > 0) {
    const { valid: hcValid } = parseRows(headcountSchema, headcountQuery.rows, {
      reportName: headcountQuery.reportName,
      queryName: headcountQuery.queryName,
    });
    allRows = hcValid;
  }

  // Primary path: Current FTEs available
  if (fteQuery && fteQuery.rows.length > 0) {
    const { valid: fteValid } = parseRows(currentFteSchema, fteQuery.rows, {
      reportName: fteQuery.reportName,
      queryName: fteQuery.queryName,
    });

    if (fteValid.length > 0) {
      const all = mergeEmployeeData(fteValid, allRows);
      return {
        employees: all.filter((p) => !isPartTimeChampion(p) && !isUnassigned(p)),
        partTimeChampions: all.filter(isPartTimeChampion),
        unassigned: all.filter(isUnassigned),
        allRows,
        lastSync: fteQuery.syncedAt,
      };
    }
  }

  // Fallback: use Headcount SSoT alone (allRows already validated above)
  if (allRows.length === 0) {
    return { employees: [], partTimeChampions: [], unassigned: [], allRows: [], lastSync: null };
  }

  const activeRows = allRows.filter(
    (r) => r.lifecycle_status.toLowerCase() === "employed" && r.is_cleo_headcount === 1,
  );

  const all = transformToPersons(activeRows);
  return {
    employees: all.filter((p) => !isPartTimeChampion(p) && !isUnassigned(p)),
    partTimeChampions: all.filter(isPartTimeChampion),
    unassigned: all.filter(isUnassigned),
    allRows,
    lastSync: headcountQuery?.syncedAt ?? null,
  };
}
