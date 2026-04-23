// Server-only data fetching for the Talent dashboard.
// Pure transformation functions live in ./talent-utils.ts (client-safe).

import {
  getReportData,
  rowStr,
  rowNum,
  validateModeColumns,
} from "./mode";
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
  aggregateHiresByRecruiterMonth,
  predictHiresPerRecruiter,
  sumToTeamMonthly,
  buildTeamChartSeries,
  buildRecruiterSummaries,
  trailing3mAvg,
  onlyHires,
} from "./talent-utils";

const SUMMARY_COLUMNS = [
  "recruiter",
  "action_type",
  "action_date",
  "cnt",
  "role",
  "department",
  "candidate",
  "level",
] as const;

const TARGET_COLUMNS = [
  "recruiter",
  "tech",
  "hires_qtd",
  "target_qtd",
  "team_qtd",
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
  const data = await getReportData("people", "talent", [
    "talent_summary_gh",
    "target qtd team",
  ]);

  const summary = validatedQuery(data, "talent_summary_gh", SUMMARY_COLUMNS);
  const targetQuery = validatedQuery(data, "target qtd team", TARGET_COLUMNS);

  const hireRows: TalentHireRow[] = (summary?.rows ?? []).map((row) => ({
    recruiter: rowStr(row, "recruiter"),
    actionType: rowStr(row, "action_type"),
    actionDate: rowStr(row, "action_date"),
    cnt: rowNum(row, "cnt"),
    role: rowStr(row, "role"),
    department: rowStr(row, "department"),
    candidate: rowStr(row, "candidate"),
    level: rowStr(row, "level") || null,
    tech: null,
  }));

  const targets: TalentTargetRow[] = (targetQuery?.rows ?? []).map((row) => ({
    recruiter: rowStr(row, "recruiter"),
    tech: rowStr(row, "tech"),
    hiresQtd: rowNum(row, "hires_qtd"),
    targetQtd: rowNum(row, "target_qtd"),
    teamQtd: rowNum(row, "team_qtd"),
  }));

  // Backfill tech focus on hire rows from the target roster so the table can
  // show a recruiter's pillar without a join on every row downstream.
  const techByRecruiter = new Map(targets.map((t) => [t.recruiter, t.tech]));
  for (const row of hireRows) {
    row.tech = techByRecruiter.get(row.recruiter) ?? null;
  }

  const syncedAt =
    summary?.syncedAt ?? targetQuery?.syncedAt ?? null;

  return { hireRows, targets, syncedAt };
}
