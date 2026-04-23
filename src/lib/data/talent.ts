// Server-only data fetching for the Talent dashboard.
// Pure transformation functions live in ./talent-utils.ts (client-safe).

import {
  getReportData,
  rowStr,
  rowNum,
  validateModeColumns,
} from "./mode";
import {
  applyRosterOverride,
  buildEmploymentIndex,
  classifyRole,
} from "./talent-utils";
import { TALENT_ROSTER } from "@/lib/config/talent-roster";
import type {
  HrEmploymentRecord,
  TalentData,
  TalentHireRow,
  TalentTargetRow,
} from "./talent-utils";

export {
  type TalentData,
  type TalentHireRow,
  type TalentTargetRow,
  type MonthlyHires,
  type RecruiterHistory,
  type RecruiterSummary,
  type EmploymentStatus,
  type EmploymentRecord,
  type HrEmploymentRecord,
  type RecruiterRole,
  type RosterOverrideEntry,
  aggregateHiresByRecruiterMonth,
  predictHiresPerRecruiter,
  sumToTeamMonthly,
  buildTeamChartSeries,
  buildRecruiterSummaries,
  trailing3mAvg,
  onlyHires,
  classifyRole,
  applyRosterOverride,
} from "./talent-utils";

const ALL_HIRES_COLUMNS = [
  "hired_by",
  "date_hired",
  "is_hired",
  "hire_attribution",
  "person_hired",
  "job_title",
  "department",
  "level",
  "tech",
] as const;

const TARGET_COLUMNS = [
  "recruiter",
  "tech",
  "hires_qtd",
  "target_qtd",
  "team_qtd",
] as const;

const HEADCOUNT_COLUMNS = [
  "preferred_name",
  "rp_full_name",
  "lifecycle_status",
  "termination_date",
  "hb_function",
  "rp_department_name",
  "job_title",
] as const;

/**
 * `hired_by` in all_hires occasionally contains data-entry placeholders
 * rather than a real person. We drop those outright so they don't clutter
 * the table or the Other filter.
 */
function isJunkRecruiterName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "-") return true;
  // Shared-credit placeholders like "Lucy/Vic", "Annie/Jamie D", "Jamie T/Glen"
  if (trimmed.includes("/")) return true;
  return false;
}

// Lifecycle values come from HiBob via Mode. Anything not marked as
// "terminated" is treated as still at Cleo — `hired` (offer accepted,
// not started), `employed`, and `garden leave` (notice period) all
// remain active for the purposes of the recruiter roster.
const ACTIVE_LIFECYCLE_STATUSES = new Set([
  "employed",
  "hired",
  "garden leave",
]);

type ModeQueryData = Awaited<ReturnType<typeof getReportData>>[number];

function validatedQuery<TColumn extends string>(
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

export async function getTalentData(): Promise<TalentData> {
  // Headcount SSoT is HR's canonical employee list with HiBob's
  // `lifecycle_status` column (employed / hired / garden leave / terminated)
  // — far truthier than `termination_date IS NULL`, which misses people
  // whose leave date hasn't been captured yet. We join it against
  // all_hires.hired_by so the UI can filter departed recruiters.
  const [talentData, headcountData] = await Promise.all([
    getReportData("people", "talent", ["all_hires", "target qtd team"]),
    getReportData("people", "headcount", ["headcount"]),
  ]);

  const allHires = validatedQuery(talentData, "all_hires", ALL_HIRES_COLUMNS);
  const targetQuery = validatedQuery(
    talentData,
    "target qtd team",
    TARGET_COLUMNS,
  );
  const headcountQuery = validatedQuery(
    headcountData,
    "headcount",
    HEADCOUNT_COLUMNS,
  );

  // `all_hires` is one row per hire with `hire_attribution` as a fractional
  // weight when credit is shared across multiple people. We normalise into
  // `TalentHireRow` so the talent-utils aggregators treat it uniformly, and
  // drop junk `hired_by` placeholders ("n/a", "Lucy/Vic", etc.).
  const hireRows: TalentHireRow[] = (allHires?.rows ?? [])
    .filter((row) => rowStr(row, "is_hired") === "Yes")
    .filter((row) => !isJunkRecruiterName(rowStr(row, "hired_by")))
    .map((row) => ({
      recruiter: rowStr(row, "hired_by"),
      actionType: "hires",
      actionDate: rowStr(row, "date_hired"),
      cnt: rowNum(row, "hire_attribution"),
      role: rowStr(row, "job_title"),
      department: rowStr(row, "department"),
      candidate: rowStr(row, "person_hired"),
      level: rowStr(row, "level") || null,
      tech: rowStr(row, "tech") || null,
    }));

  const targets: TalentTargetRow[] = (targetQuery?.rows ?? []).map((row) => ({
    recruiter: rowStr(row, "recruiter"),
    tech: rowStr(row, "tech") || null,
    hiresQtd: rowNum(row, "hires_qtd"),
    targetQtd: rowNum(row, "target_qtd"),
    teamQtd: rowNum(row, "team_qtd"),
  }));

  // Backfill tech focus on hire rows from the target roster so the table can
  // show a recruiter's pillar without a join on every row downstream. Only
  // overwrites rows whose all_hires.tech was empty.
  const techByRecruiter = new Map(targets.map((t) => [t.recruiter, t.tech]));
  for (const row of hireRows) {
    if (!row.tech) row.tech = techByRecruiter.get(row.recruiter) ?? null;
  }

  // Build employment index for every recruiter that actually appears in
  // hireRows (or the target roster) so the client can filter to active.
  const recruiterNames = new Set<string>();
  for (const row of hireRows) {
    if (row.recruiter) recruiterNames.add(row.recruiter);
  }
  for (const t of targets) {
    if (t.recruiter) recruiterNames.add(t.recruiter);
  }

  const headcountRecords: HrEmploymentRecord[] = (headcountQuery?.rows ?? [])
    .map((row) => {
      const preferred = rowStr(row, "preferred_name");
      const greenhouse = rowStr(row, "rp_full_name");
      const status = rowStr(row, "lifecycle_status").toLowerCase();
      const jobTitle = rowStr(row, "job_title") || null;
      const aliases = [greenhouse].filter((v) => v && v !== preferred);
      return {
        displayName: preferred || greenhouse,
        aliases,
        status: ACTIVE_LIFECYCLE_STATUSES.has(status)
          ? ("active" as const)
          : ("departed" as const),
        role: classifyRole(jobTitle),
        terminationDate: rowStr(row, "termination_date") || null,
        department:
          rowStr(row, "hb_function") ||
          rowStr(row, "rp_department_name") ||
          null,
        jobTitle,
      };
    })
    .filter((r) => Boolean(r.displayName));

  const hrEmployment = buildEmploymentIndex(
    headcountRecords,
    recruiterNames,
    // Names on the target QTD roster are canonical recruiters — if HR has
    // no record for them (external contractors), still treat them as TPs.
    targets.map((t) => t.recruiter),
  );

  // Apply Lucy's roster override — her snapshot is more current than HR's
  // lifecycle_status, especially for recent exits.
  const employmentByRecruiter = applyRosterOverride(
    hrEmployment,
    TALENT_ROSTER,
  );

  const syncedAt =
    allHires?.syncedAt ?? targetQuery?.syncedAt ?? null;

  return { hireRows, targets, employmentByRecruiter, syncedAt };
}
