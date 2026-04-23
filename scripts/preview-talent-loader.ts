// Exercise the talent data loader end-to-end against the live DB.
//
// Usage: doppler run -- npx tsx scripts/preview-talent-loader.ts

import { getTalentData } from "@/lib/data/talent";
import {
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  predictHiresPerRecruiter,
  sumToTeamMonthly,
} from "@/lib/data/talent-utils";

async function main() {
  const data = await getTalentData();
  console.log(
    `Loaded: ${data.hireRows.length} summary rows, ${data.targets.length} targets, syncedAt=${data.syncedAt?.toISOString() ?? "n/a"}`,
  );

  const histories = aggregateHiresByRecruiterMonth(data.hireRows);
  console.log(`Recruiters with hires: ${histories.length}`);

  // Validate Beth Baron specifically
  const beth = histories.find((h) => h.recruiter === "Beth Baron");
  if (beth) {
    console.log(`\nBeth Baron full history (${beth.monthly.length} months):`);
    for (const m of beth.monthly) {
      if (m.hires > 0) console.log(`  ${m.month}  → ${m.hires}`);
    }
    console.log(`  last 3 months: ${JSON.stringify(beth.monthly.slice(-3))}`);
  }

  // Check distribution of hire dates across the dataset
  const byMonth = new Map<string, number>();
  for (const r of data.hireRows) {
    if (r.actionType !== "hires") continue;
    const m = r.actionDate.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + (r.cnt || 0));
  }
  const sortedMonths = [...byMonth.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  console.log("\nFull team monthly hires (non-zero months):");
  for (const [m, v] of sortedMonths) {
    if (v > 0) console.log(`  ${m}  → ${v}`);
  }

  const teamActual = sumToTeamMonthly(histories);
  console.log("\nTeam totals via histories (last 12 months):");
  for (const m of teamActual.slice(-12)) {
    console.log(`  ${m.month}  → ${m.hires}`);
  }

  const projections = predictHiresPerRecruiter(histories, 3);
  const teamProjection = sumToTeamMonthly(projections);
  console.log("\nTeam projection (next 3 months):");
  for (const m of teamProjection) {
    console.log(`  ${m.month}  → ${m.hires.toFixed(2)}`);
  }

  const summaries = buildRecruiterSummaries(histories, data.targets);
  console.log("\nTop 10 recruiters by hires L12m:");
  console.log(
    [
      "recruiter",
      "tech",
      "hiresL12m",
      "trailing3m",
      "proj3m",
      "qtd",
      "target",
      "attain",
    ].join("\t"),
  );
  for (const s of summaries.slice(0, 10)) {
    console.log(
      [
        s.recruiter,
        s.tech ?? "-",
        s.hiresLast12m,
        s.trailing3mAvg.toFixed(2),
        s.projectedNext3m.toFixed(2),
        s.hiresQtd ?? "-",
        s.targetQtd ?? "-",
        s.attainmentQtd == null ? "-" : `${(s.attainmentQtd * 100).toFixed(0)}%`,
      ].join("\t"),
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
