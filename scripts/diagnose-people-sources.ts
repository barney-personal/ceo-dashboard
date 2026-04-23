// Inspect column shapes of every people-related Mode query so we can pick the
// most authoritative "still at Cleo" list for the talent dashboard.
// Usage: doppler run -- npx tsx scripts/diagnose-people-sources.ts

import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const reports = [
  { label: "Attrition Tracker", token: "47715a0cccf7" },
  { label: "Headcount SSoT Dashboard", token: "c458b52ceb68" },
  { label: "Current FTEs", token: "25a607aa5c6c" },
];

async function main() {
  for (const { label, token } of reports) {
    const [report] = await db
      .select()
      .from(modeReports)
      .where(eq(modeReports.reportToken, token));
    if (!report) {
      console.log(`\n${label} — not in DB\n`);
      continue;
    }
    const rows = await db
      .select()
      .from(modeReportData)
      .where(eq(modeReportData.reportId, report.id));
    console.log(`\n=== ${label} (${token}) ===`);
    for (const r of rows) {
      const data = r.data as Record<string, unknown>[];
      const cols = data[0] ? Object.keys(data[0]) : [];
      console.log(
        `  query=${r.queryName}  rows=${r.storedRowCount}  synced=${r.syncedAt.toISOString()}`,
      );
      console.log(`    columns: [${cols.join(", ")}]`);
      console.log(`    sample: ${JSON.stringify(data[0] ?? null)}`);
      if (data[1]) console.log(`    sample: ${JSON.stringify(data[1])}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
