// Server-only data fetching for the Talent dashboard.
// Pure transformation functions live in ./talent-utils.ts (client-safe).

import {
  getReportData,
  rowStr,
  rowNum,
  validateModeColumns,
} from "./mode";
import { buildEmploymentIndex } from "./talent-utils";
import type {
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
  aggregateHiresByRecruiterMonth,
  predictHiresPerRecruiter,
  sumToTeamMonthly,
  buildTeamChartSeries,
  buildRecruiterSummaries,
  trailing3mAvg,
  onlyHires,
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

const EMPLOYEES_COLUMNS = [
  "display_name",
  "start_date",
  "termination_date",
  "department",
] as const;

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
  // Attrition 'employees' is HR's canonical FTE list with termination dates —
  // we join it against all_hires.hired_by to flag recruiters who've left so
  // the UI can filter them out.
  const [talentData, attritionData] = await Promise.all([
    getReportData("people", "talent", ["all_hires", "target qtd team"]),
    getReportData("people", "attrition", ["employees"]),
  ]);

  const allHires = validatedQuery(talentData, "all_hires", ALL_HIRES_COLUMNS);
  const targetQuery = validatedQuery(
    talentData,
    "target qtd team",
    TARGET_COLUMNS,
  );
  const employeesQuery = validatedQuery(
    attritionData,
    "employees",
    EMPLOYEES_COLUMNS,
  );

  // `all_hires` is one row per hire with `hire_attribution` as a fractional
  // weight when credit is shared across multiple people. We normalise into
  // `TalentHireRow` so the talent-utils aggregators treat it uniformly.
  const hireRows: TalentHireRow[] = (allHires?.rows ?? [])
    .filter((row) => rowStr(row, "is_hired") === "Yes")
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
    tech: rowStr(row, "tech"),
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

  const employees = (employeesQuery?.rows ?? []).map((row) => ({
    displayName: rowStr(row, "display_name"),
    startDate: rowStr(row, "start_date") || null,
    terminationDate: rowStr(row, "termination_date") || null,
    department: rowStr(row, "department") || null,
  }));

  const employmentByRecruiter = buildEmploymentIndex(
    employees,
    recruiterNames,
  );

  const syncedAt =
    allHires?.syncedAt ?? targetQuery?.syncedAt ?? null;

  return { hireRows, targets, employmentByRecruiter, syncedAt };
}
