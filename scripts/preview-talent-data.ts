// Query mode_report_data to verify Talent data synced and inspect shape for
// the Pass 2 data loader.
//
// Usage: doppler run -- npx tsx scripts/preview-talent-data.ts

import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const [report] = await db
    .select()
    .from(modeReports)
    .where(eq(modeReports.reportToken, "e9766a6cd260"));

  if (!report) {
    console.log("Talent report not found in mode_reports!");
    return;
  }

  console.log("Talent report:", {
    id: report.id,
    name: report.name,
    section: report.section,
    category: report.category,
  });

  const rows = await db
    .select()
    .from(modeReportData)
    .where(eq(modeReportData.reportId, report.id));

  for (const r of rows) {
    const data = r.data as Record<string, unknown>[];
    const first = data[0];
    console.log(
      `\nquery=${r.queryName} rows=${r.storedRowCount} truncated=${r.truncated} syncedAt=${r.syncedAt.toISOString()}`,
    );
    if (first) {
      console.log(`  columns: [${Object.keys(first).join(", ")}]`);
    }
  }

  // Deep dive into talent_summary_gh
  const gh = rows.find((r) => r.queryName === "talent_summary_gh");
  if (gh) {
    const data = gh.data as Record<string, unknown>[];
    const hires = data.filter((r) => r.action_type === "hires");
    console.log(`\ntalent_summary_gh: ${data.length} total, ${hires.length} hires`);
    const recs = new Set(hires.map((r) => r.recruiter).filter(Boolean));
    console.log(`  distinct recruiters in hires: ${recs.size}`);
    const dates = hires.map((r) => String(r.action_date).slice(0, 7)).sort();
    console.log(`  hire month range: ${dates[0]} → ${dates[dates.length - 1]}`);

    // Monthly hires per recruiter
    const byMonthRecruiter = new Map<string, number>();
    for (const h of hires) {
      const month = String(h.action_date).slice(0, 7);
      const key = `${h.recruiter ?? "unknown"}|${month}`;
      byMonthRecruiter.set(key, (byMonthRecruiter.get(key) ?? 0) + Number(h.cnt ?? 1));
    }
    console.log("\nTop 20 (recruiter|month → hires) entries:");
    const entries = [...byMonthRecruiter.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    for (const [k, v] of entries.slice(0, 20)) {
      console.log(`  ${k} → ${v}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
