// Inspect lifecycle_status values and cross-reference recruiter names.
// Usage: doppler run -- npx tsx scripts/inspect-headcount-lifecycle.ts

import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const [report] = await db
    .select()
    .from(modeReports)
    .where(eq(modeReports.reportToken, "c458b52ceb68"));
  if (!report) return;
  const rows = await db
    .select()
    .from(modeReportData)
    .where(eq(modeReportData.reportId, report.id));
  const headcount = rows.find((r) => r.queryName === "headcount");
  if (!headcount) return;
  const data = headcount.data as Record<string, unknown>[];

  const byStatus: Record<string, number> = {};
  for (const r of data) {
    const k = String(r.lifecycle_status ?? "(null)");
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  console.log("lifecycle_status distribution:", byStatus);
  console.log(
    "rows with termination_date:",
    data.filter((r) => r.termination_date).length,
  );

  const names = [
    "Sophie Elliott",
    "Olivia de Peyronnet",
    "Beth Baron",
    "Jeremy Barnes",
    "Sam Taylor",
    "Lucy Lynn",
    "Kushla Egan",
    "Aliecee Cummings",
    "Iona Hamilton",
    "Millie Di Luzio",
    "Florian Rose",
    "Laura Scott",
    "Simon Pinner",
    "Chloe Fleming",
    "Chris Rea",
    "Gowtam Rajasegaran",
    "Sofia Thomaidou",
    "Angela Komornik",
    "Mario Tavares",
    "Angelika Komornik",
  ];

  console.log("\nRecruiter check against headcount SSoT:");
  for (const n of names) {
    const m = data.find(
      (r) => r.preferred_name === n || r.rp_full_name === n,
    );
    if (m) {
      console.log(
        `  ${n.padEnd(28)} | ${String(m.lifecycle_status).padEnd(12)} | term=${m.termination_date ?? "-"} | dept=${m.hb_function ?? m.rp_department_name ?? "-"}`,
      );
    } else {
      console.log(`  ${n.padEnd(28)} | NO MATCH`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
