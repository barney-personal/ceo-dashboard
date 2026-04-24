// Surface department names in the attrition query that look broken by
// People Ops renames. Two signatures to watch for:
//   (a) LEGACY: tiny current headcount + real L12M leavers → insane % spikes
//   (b) ZOMBIE: real current headcount + zero L12M leavers → false 0%
// Usage: doppler run -- npx tsx scripts/diagnose-attrition-renames.ts

import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { canonicalDepartment } from "@/lib/data/attrition-utils";

async function main() {
  const [report] = await db
    .select()
    .from(modeReports)
    .where(eq(modeReports.reportToken, "47715a0cccf7"));
  if (!report) return;

  const rows = await db
    .select()
    .from(modeReportData)
    .where(eq(modeReportData.reportId, report.id));
  const attrition = rows.find((r) => r.queryName === "attrition");
  if (!attrition) return;

  const raw = attrition.data as Record<string, unknown>[];
  const data: Record<string, unknown>[] = raw.map((r) => ({
    ...r,
    department: canonicalDepartment(String(r.department ?? "")),
  }));
  const latestPeriod = data.reduce(
    (acc, r) => (String(r.reporting_period ?? "") > acc ? String(r.reporting_period) : acc),
    "",
  );

  // Aggregate per department in the latest period.
  type Agg = { hc: number; leavers: number };
  const agg = new Map<string, Agg>();
  for (const r of data) {
    if (String(r.reporting_period) !== latestPeriod) continue;
    const dept = String(r.department ?? "");
    const tenure = String(r.tenure ?? "");
    if (!dept || dept === "All") continue;
    if (!tenure || tenure === "All") continue;
    const cur = agg.get(dept) ?? { hc: 0, leavers: 0 };
    cur.hc += Number(r.avg_headcount_l12m ?? 0);
    cur.leavers += Number(r.leavers_l12m ?? 0);
    agg.set(dept, cur);
  }

  const sorted = [...agg.entries()]
    .map(([name, a]) => ({ name, hc: a.hc, leavers: a.leavers, rate: a.hc > 0 ? (a.leavers / a.hc) * 100 : 0 }))
    .sort((a, b) => b.hc - a.hc);

  const legacy = sorted.filter((d) => d.hc > 0 && d.hc < 3 && d.leavers >= 1);
  const zombie = sorted.filter((d) => d.hc >= 5 && d.leavers === 0);
  const healthy = sorted.filter((d) => !legacy.includes(d) && !zombie.includes(d));

  const fmt = (d: { name: string; hc: number; leavers: number; rate: number }) =>
    `  ${d.name.padEnd(40)} hc=${d.hc.toFixed(1).padStart(6)}  leavers_l12m=${String(d.leavers).padStart(3)}  rate=${d.rate.toFixed(0).padStart(4)}%`;

  console.log(`Latest reporting period: ${latestPeriod}\n`);
  console.log(`LEGACY (hc < 3 with real leavers → past leavers pinned to renamed dept): ${legacy.length}`);
  legacy.forEach((d) => console.log(fmt(d)));

  console.log(`\nZOMBIE (hc ≥ 5 with 0 leavers → likely receiving renamed team, leavers pinned elsewhere): ${zombie.length}`);
  zombie.forEach((d) => console.log(fmt(d)));

  console.log(`\nHEALTHY-LOOKING (all others): ${healthy.length}`);
  healthy.forEach((d) => console.log(fmt(d)));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
