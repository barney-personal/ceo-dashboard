// Diagnose data freshness for the Talent report across available queries.
// Usage: doppler run -- npx tsx scripts/diagnose-talent-freshness.ts

import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getReportQueries, getLatestRun, getQueryRuns, getQueryResultContent, extractQueryToken } from "@/lib/integrations/mode";

const REPORT_TOKEN = "e9766a6cd260";

async function fromDb() {
  console.log("=== DB (currently synced) ===\n");
  const [report] = await db.select().from(modeReports).where(eq(modeReports.reportToken, REPORT_TOKEN));
  if (!report) return;
  const rows = await db.select().from(modeReportData).where(eq(modeReportData.reportId, report.id));
  for (const r of rows) {
    const data = r.data as Record<string, unknown>[];
    const hires = data.filter((x) => x.action_type === "hires");
    const hiresWithCount = hires.filter((x) => Number(x.cnt ?? 0) > 0);
    const dates = hiresWithCount.map((x) => String(x.action_date).slice(0, 7)).sort();
    console.log(`query=${r.queryName} total=${data.length} hires=${hires.length} hires(cnt>0)=${hiresWithCount.length}`);
    if (dates.length > 0) {
      const byMonth = new Map<string, number>();
      for (const m of dates) byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
      console.log(`  hire-month range: ${dates[0]} → ${dates[dates.length - 1]}`);
      const tail = [...byMonth.entries()].sort().slice(-8);
      console.log(`  last months: ${tail.map(([m, c]) => `${m}:${c}`).join(", ")}`);
    }
  }
}

async function fromModeLive() {
  console.log("\n=== Mode API (live, bypassing storage window) ===\n");
  const queries = await getReportQueries(REPORT_TOKEN);
  const latest = await getLatestRun(REPORT_TOKEN);
  if (!latest) return;
  console.log(`Latest run: ${latest.token} state=${latest.state}`);
  const queryRuns = await getQueryRuns(REPORT_TOKEN, latest.token);
  const byQuery = new Map(queryRuns.map((qr) => [extractQueryToken(qr), qr]));

  for (const qName of ["talent_summary_gh", "talent_summary_rev", "all_hires"]) {
    const q = queries.find((qq) => qq.name === qName);
    if (!q) continue;
    const qr = byQuery.get(q.token);
    if (!qr) continue;
    const { rows } = await getQueryResultContent(REPORT_TOKEN, latest.token, qr.token, 50000);

    // all_hires is per-hire, not action-typed
    const hireRows = qName === "all_hires"
      ? rows.filter((r) => r.is_hired === "Yes" && r.date_hired)
      : rows.filter((r) => r.action_type === "hires" && Number(r.cnt ?? 0) > 0);

    const dateField = qName === "all_hires" ? "date_hired" : "action_date";
    const dates = hireRows
      .map((r) => String(r[dateField]).slice(0, 7))
      .filter((d) => /^\d{4}-\d{2}$/.test(d))
      .sort();

    const byMonth = new Map<string, number>();
    for (const m of dates) byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    const tail = [...byMonth.entries()].sort().slice(-10);

    console.log(`query=${qName} total=${rows.length} hires=${hireRows.length}`);
    if (dates.length > 0) {
      console.log(`  hire-month range: ${dates[0]} → ${dates[dates.length - 1]}`);
      console.log(`  last months: ${tail.map(([m, c]) => `${m}:${c}`).join(", ")}`);
    }
  }
}

async function main() {
  await fromDb();
  await fromModeLive();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
