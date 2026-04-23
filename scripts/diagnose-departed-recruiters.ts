// Cross-reference the recruiters who appear in `all_hires` against the
// Headcount SSoT / Attrition employees list to identify talent-team partners
// who've left the company.
//
// Usage: doppler run -- npx tsx scripts/diagnose-departed-recruiters.ts

import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const TALENT_TOKEN = "e9766a6cd260";
const ATTRITION_TOKEN = "47715a0cccf7";
const HEADCOUNT_TOKEN = "c458b52ceb68";
const CURRENT_FTES_TOKEN = "25a607aa5c6c";

async function getData(reportToken: string, queryName: string) {
  const [report] = await db
    .select()
    .from(modeReports)
    .where(eq(modeReports.reportToken, reportToken));
  if (!report) return null;
  const rows = await db
    .select()
    .from(modeReportData)
    .where(eq(modeReportData.reportId, report.id));
  const row = rows.find((r) => r.queryName === queryName);
  return row ? (row.data as Record<string, unknown>[]) : null;
}

function nameVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const variants = new Set<string>();
  if (!trimmed) return [];
  variants.add(trimmed);
  variants.add(trimmed.toLowerCase());

  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    variants.add(`${first} ${last}`);
    variants.add(`${first} ${last}`.toLowerCase());
  }
  return [...variants];
}

async function main() {
  const allHires = await getData(TALENT_TOKEN, "all_hires");
  const targets = await getData(TALENT_TOKEN, "target qtd team");
  const employees = await getData(ATTRITION_TOKEN, "employees");
  const headcount = await getData(HEADCOUNT_TOKEN, "headcount");
  const currentFtes = await getData(CURRENT_FTES_TOKEN, "current_employees");

  if (!allHires || !employees) {
    console.log("Missing source data");
    return;
  }

  // Build set of recruiter display names that appear in the talent chart.
  const recruiterCounts = new Map<string, number>();
  for (const row of allHires) {
    if (String(row.is_hired) !== "Yes") continue;
    const name = String(row.hired_by ?? "").trim();
    if (!name) continue;
    const weight = Number(row.hire_attribution ?? 0);
    recruiterCounts.set(name, (recruiterCounts.get(name) ?? 0) + weight);
  }

  const targetRecruiters = new Set<string>();
  for (const t of targets ?? []) {
    const name = String(t.recruiter ?? "").trim();
    if (name) targetRecruiters.add(name);
  }

  console.log(`Recruiters in chart: ${recruiterCounts.size} (target roster: ${targetRecruiters.size})\n`);

  // Index employees by name variants, tracking termination + latest start.
  type EmpRecord = {
    displayName: string;
    startDate: string | null;
    terminationDate: string | null;
    isEmployee: string;
    department: string;
  };
  const employeesByName = new Map<string, EmpRecord[]>();
  for (const e of employees) {
    const display = String(e.display_name ?? "").trim();
    if (!display) continue;
    const rec: EmpRecord = {
      displayName: display,
      startDate: String(e.start_date ?? "") || null,
      terminationDate: String(e.termination_date ?? "") || null,
      isEmployee: String(e.is_employee ?? ""),
      department: String(e.department ?? ""),
    };
    for (const v of nameVariants(display)) {
      if (!employeesByName.has(v)) employeesByName.set(v, []);
      employeesByName.get(v)!.push(rec);
    }
  }

  // Also consult headcount SSoT (current_employees) as a truthier "still here"
  // check — anyone in current_employees is active regardless of what the
  // attrition snapshot says.
  const currentNames = new Set<string>();
  for (const c of currentFtes ?? headcount ?? []) {
    const display = String(c.display_name ?? c.full_name ?? "").trim();
    if (!display) continue;
    for (const v of nameVariants(display)) currentNames.add(v);
  }

  console.log(`Active FTE names (from current_employees/headcount): ${currentNames.size}\n`);

  // Classify each recruiter
  type Status = {
    recruiter: string;
    totalHires: number;
    onTargetRoster: boolean;
    matched: EmpRecord | null;
    stillActive: boolean;
    note: string;
  };
  const results: Status[] = [];
  for (const [recruiter, total] of recruiterCounts.entries()) {
    const matches = nameVariants(recruiter).flatMap(
      (v) => employeesByName.get(v) ?? [],
    );
    const matched = matches[0] ?? null;
    const activeViaHeadcount = nameVariants(recruiter).some((v) =>
      currentNames.has(v),
    );

    let stillActive: boolean;
    let note: string;
    if (activeViaHeadcount) {
      stillActive = true;
      note = "active (in headcount SSoT)";
    } else if (!matched) {
      stillActive = false;
      note = "no attrition/headcount record — likely external or stale name";
    } else if (matched.terminationDate) {
      stillActive = false;
      note = `terminated ${matched.terminationDate.slice(0, 10)} (dept: ${matched.department})`;
    } else {
      stillActive = true;
      note = `employee record exists, no termination (dept: ${matched.department})`;
    }

    results.push({
      recruiter,
      totalHires: total,
      onTargetRoster: targetRecruiters.has(recruiter),
      matched,
      stillActive,
      note,
    });
  }

  results.sort((a, b) => b.totalHires - a.totalHires);

  console.log("=== DEPARTED / NOT-IN-CURRENT-HEADCOUNT ===\n");
  for (const r of results.filter((x) => !x.stillActive)) {
    console.log(
      `  ${r.recruiter.padEnd(32)}  hires=${r.totalHires.toFixed(1).padStart(6)}  targetRoster=${r.onTargetRoster ? "y" : "n"}  ${r.note}`,
    );
  }

  console.log("\n=== ACTIVE ===\n");
  for (const r of results.filter((x) => x.stillActive)) {
    console.log(
      `  ${r.recruiter.padEnd(32)}  hires=${r.totalHires.toFixed(1).padStart(6)}  targetRoster=${r.onTargetRoster ? "y" : "n"}  ${r.note}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
