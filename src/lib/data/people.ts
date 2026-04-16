import { getReportData, rowStr, validateModeColumns } from "./mode";
import type { BarChartData } from "@/components/charts/bar-chart";
import {
  DAYS_PER_MONTH,
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
  "termination_date",
  "headcount_label",
] as const;

type HeadcountLabel = "FTE" | "CS" | "Contractor";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mode's canonical "active headcount" filter, ported from the SSoT report's
 * `headcount_monthly` query at https://app.mode.com/cleoai/reports/c458b52ceb68
 *
 *   start_date <= asOf AND (termination_date IS NULL OR termination_date > asOf)
 *
 * The label argument selects FTE / CS / Contractor (Mode's own bucketing).
 * Lex compare on YYYY-MM-DD prefixes is correct because all SSoT date columns
 * are midnight-UTC ISO timestamps.
 */
export function selectModeFteActive(
  rows: Record<string, unknown>[],
  asOf: string = todayUtc(),
  label: HeadcountLabel = "FTE",
): Record<string, unknown>[] {
  return rows.filter((r) => {
    if (rowStr(r, "headcount_label") !== label) return false;
    const start = rowStr(r, "start_date").slice(0, 10);
    if (!start || start > asOf) return false;
    const term = rowStr(r, "termination_date").slice(0, 10);
    return !term || term > asOf;
  });
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
 * Build a Person from a SSoT row, optionally augmented with the matching
 * Current FTEs row (for canonical pillar/squad/employment_type).
 *
 * The SSoT is the spine: identity, dates, job title, level, manager, location
 * all come from there. Current FTEs only contributes Rev's org structure —
 * if a person isn't in Current FTEs, they end up "no pillar"/"no squad" and
 * get bucketed as `unassigned` by the caller.
 */
function ssotRowToPerson(
  ssot: Record<string, unknown>,
  fte?: Record<string, unknown>,
): Person {
  const startDate = rowStr(ssot, "start_date");
  const rawLevel = rowStr(ssot, "hb_level");
  const specialisation = rowStr(ssot, "rp_specialisation");
  const jobTitle = resolveEngineerDiscipline(
    normalizeJobTitle(rowStr(ssot, "job_title")),
    rawLevel,
    specialisation,
  );
  const fteFunction = fte ? rowStr(fte, "function_name") : "";
  const func = fteFunction || rowStr(ssot, "hb_function") || "Unassigned";
  const fteSquad = fte ? rowStr(fte, "squad_name") : "";
  const ftePillar = fte ? rowStr(fte, "pillar_name") : "";
  return {
    name: rowStr(ssot, "preferred_name") || "Unknown",
    email: rowStr(ssot, "email"),
    jobTitle,
    level: normalizeLevel(rawLevel, jobTitle),
    squad: fteSquad || "no squad",
    pillar: ftePillar || "no pillar",
    function: normalizeDepartment(func, jobTitle),
    manager: rowStr(ssot, "manager") || (fte ? rowStr(fte, "line_manager_email") : ""),
    startDate,
    location: rowStr(ssot, "work_location"),
    tenureMonths: computeTenureMonths(startDate),
    employmentType: fte ? rowStr(fte, "employment_type") : "",
  };
}

/**
 * Build Person objects for a set of SSoT-active rows, joining each by lowercased
 * email to a pre-built Current FTEs lookup for org structure (pillar / squad).
 *
 * SSoT is the spine; Current FTEs is augmentation only. This intentionally
 * reverses the old direction (Current FTEs as spine) so headcount totals match
 * Mode's SSoT report rather than Rev's separate FTE list.
 */
export function buildPersonsFromSsot(
  ssotActiveRows: Record<string, unknown>[],
  fteByEmail: ReadonlyMap<string, Record<string, unknown>>,
): Person[] {
  return ssotActiveRows
    .map((r) => ssotRowToPerson(r, fteByEmail.get(rowStr(r, "email").toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildFteByEmail(
  fteRows: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of fteRows) {
    const email = rowStr(r, "employee_email").toLowerCase();
    if (email) map.set(email, r);
  }
  return map;
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

  // Attrition: FTE departures in the last 90 days. Bound on both sides —
  // garden-leave FTEs carry a future termination_date and would otherwise
  // inflate this count.
  const nowMs = now.getTime();
  const ninetyDaysAgoMs = ninetyDaysAgo.getTime();
  const attritionLast90Days = allRows.filter((r) => {
    if (rowStr(r, "headcount_label") !== "FTE") return false;
    const termDate = rowStr(r, "termination_date");
    if (!termDate) return false;
    const termMs = new Date(termDate).getTime();
    return Number.isFinite(termMs) && termMs >= ninetyDaysAgoMs && termMs <= nowMs;
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

  // FTE joiners by start_date month (Mode SSoT definition — label-driven).
  // Past dates only — pre-employment FTEs would otherwise count as joiners
  // in a future month they haven't started yet.
  const nowMs = now.getTime();
  const joinerCounts = new Map<string, number>();
  for (const r of allRows) {
    if (rowStr(r, "headcount_label") !== "FTE") continue;
    const startDate = rowStr(r, "start_date");
    if (!startDate) continue;
    const d = new Date(startDate);
    const ms = d.getTime();
    if (!Number.isFinite(ms) || ms > nowMs) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    joinerCounts.set(key, (joinerCounts.get(key) ?? 0) + 1);
  }

  // FTE departures by termination_date month. Past dates only — garden-leave
  // FTEs carry a future termination_date and would otherwise show as already
  // departed.
  const departureCounts = new Map<string, number>();
  for (const r of allRows) {
    if (rowStr(r, "headcount_label") !== "FTE") continue;
    const termDate = rowStr(r, "termination_date");
    if (!termDate) continue;
    const d = new Date(termDate);
    const ms = d.getTime();
    if (!Number.isFinite(ms) || ms > nowMs) continue;
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
  const nowMs = Date.now();

  for (const r of allRows) {
    // FTE-only, to match the Mode SSoT report's headcount_monthly definition.
    if (rowStr(r, "headcount_label") !== "FTE") continue;
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

    // Past dates only — pre-employment FTEs would otherwise show as joiners
    // before they've started, and garden-leave FTEs would show as already
    // departed.
    const startDate = rowStr(r, "start_date");
    if (startDate) {
      const d = new Date(startDate);
      const ms = d.getTime();
      if (Number.isFinite(ms) && ms <= nowMs) {
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

    const termDate = rowStr(r, "termination_date");
    if (termDate) {
      const d = new Date(termDate);
      const ms = d.getTime();
      if (Number.isFinite(ms) && ms <= nowMs) {
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

  return { joiners, departures };
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
 * Fetch active employees from Mode data, aligned with the Mode SSoT report's
 * `headcount_monthly` definition: `start_date <= today AND (term IS NULL OR term > today)`,
 * bucketed by `headcount_label` (FTE / CS / Contractor).
 *
 * Source of truth: Headcount SSoT (Mode report c458b52ceb68).
 * Augmentation: Current FTEs (Rev) provides Rev's pillar/squad/employment_type by
 * email join. SSoT-active people not in Current FTEs are still counted but bucketed
 * as `unassigned` ("no pillar" / "no squad").
 */
export async function getActiveEmployees(): Promise<{
  employees: Person[];
  partTimeChampions: Person[];
  unassigned: Person[];
  contractors: Person[];
  allRows: Record<string, unknown>[];
  lastSync: Date | null;
}> {
  const [fteData, headcountData] = await Promise.all([
    getReportData("people", "org", ["current_employees"]),
    getReportData("people", "headcount", ["headcount"]),
  ]);

  const fteQuery = fteData.find((d) => d.queryName === "current_employees");
  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");

  const empty = {
    employees: [] as Person[],
    partTimeChampions: [] as Person[],
    unassigned: [] as Person[],
    contractors: [] as Person[],
    allRows: [] as Record<string, unknown>[],
    lastSync: headcountQuery?.syncedAt ?? null,
  };

  // SSoT is the spine — every count comes from here. If it's missing or its
  // schema has drifted, return empty buckets rather than silently bad data.
  if (!headcountQuery || headcountQuery.rows.length === 0) return empty;
  const hcColumnSource = headcountQuery.columns?.length
    ? Object.fromEntries(headcountQuery.columns.map((c) => [c.name, true]))
    : headcountQuery.rows[0] ?? {};
  const hcValidation = validateModeColumns({
    row: hcColumnSource as Record<string, unknown>,
    expectedColumns: HEADCOUNT_QUERY_COLUMNS,
    reportName: headcountQuery.reportName,
    queryName: headcountQuery.queryName,
  });
  if (!hcValidation.isValid) return empty;
  const allRows = headcountQuery.rows;

  // Current FTEs is augmentation only. If it's missing or its schema has drifted,
  // every FTE-active person becomes "unassigned" but the count still equals Mode.
  let fteRows: Record<string, unknown>[] = [];
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
    if (fteValidation.isValid) fteRows = fteQuery.rows;
  }

  const asOf = todayUtc();
  const fteByEmail = buildFteByEmail(fteRows);
  const ftePersons = buildPersonsFromSsot(selectModeFteActive(allRows, asOf, "FTE"), fteByEmail);
  const partTimeChampions = buildPersonsFromSsot(selectModeFteActive(allRows, asOf, "CS"), fteByEmail);
  const contractors = buildPersonsFromSsot(selectModeFteActive(allRows, asOf, "Contractor"), fteByEmail);

  return {
    employees: ftePersons.filter((p) => p.pillar !== "no pillar" && p.squad !== "no squad"),
    unassigned: ftePersons.filter((p) => p.pillar === "no pillar" || p.squad === "no squad"),
    partTimeChampions,
    contractors,
    allRows,
    lastSync: headcountQuery.syncedAt,
  };
}
