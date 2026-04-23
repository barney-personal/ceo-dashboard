// Map each `all_hires.hired_by` recruiter to their HR job title / role so we
// can split the table by Talent Partner vs Sourcer.
// Usage: doppler run -- npx tsx scripts/inspect-recruiter-roles.ts

import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const TALENT_TOKEN = "e9766a6cd260";
const HEADCOUNT_TOKEN = "c458b52ceb68";

async function getQuery(reportToken: string, queryName: string) {
  const [report] = await db
    .select()
    .from(modeReports)
    .where(eq(modeReports.reportToken, reportToken));
  if (!report) return null;
  const rows = await db
    .select()
    .from(modeReportData)
    .where(eq(modeReportData.reportId, report.id));
  const q = rows.find((r) => r.queryName === queryName);
  return q ? (q.data as Record<string, unknown>[]) : null;
}

function nameVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const variants = new Set<string>();
  variants.add(trimmed);
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    variants.add(`${parts[0]} ${parts[parts.length - 1]}`);
  }
  return [...variants];
}

async function main() {
  const hires = await getQuery(TALENT_TOKEN, "all_hires");
  const targets = await getQuery(TALENT_TOKEN, "target qtd team");
  const headcount = await getQuery(HEADCOUNT_TOKEN, "headcount");
  if (!hires || !headcount) return;

  const byName = new Map<string, Record<string, unknown>>();
  for (const r of headcount) {
    const preferred = String(r.preferred_name ?? "").trim();
    const rp = String(r.rp_full_name ?? "").trim();
    for (const name of [preferred, rp].filter(Boolean)) {
      for (const v of nameVariants(name)) {
        if (!byName.has(v)) byName.set(v, r);
      }
    }
  }

  const recruiters = new Map<string, number>();
  for (const h of hires) {
    if (String(h.is_hired) !== "Yes") continue;
    const name = String(h.hired_by ?? "").trim();
    if (!name) continue;
    recruiters.set(name, (recruiters.get(name) ?? 0) + Number(h.hire_attribution ?? 0));
  }
  const targetRoster = new Set(
    (targets ?? []).map((t) => String(t.recruiter ?? "").trim()).filter(Boolean),
  );

  console.log("Recruiter → HR role / specialisation (sorted by hires desc)\n");
  console.log(
    [
      "recruiter",
      "onTargetRoster",
      "hires",
      "lifecycle_status",
      "job_title",
      "hb_role_specialisation",
      "hb_function",
      "rp_specialisation",
    ].join("  |  "),
  );
  const sorted = [...recruiters.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, hires] of sorted) {
    let hr: Record<string, unknown> | undefined;
    for (const v of nameVariants(name)) {
      hr = byName.get(v);
      if (hr) break;
    }
    console.log(
      [
        name.padEnd(26),
        targetRoster.has(name) ? "y" : "n",
        hires.toFixed(1).padStart(6),
        hr?.lifecycle_status ?? "(no HR record)",
        hr?.job_title ?? "-",
        hr?.hb_role_specialisation ?? "-",
        hr?.hb_function ?? "-",
        hr?.rp_specialisation ?? "-",
      ].join("  |  "),
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
