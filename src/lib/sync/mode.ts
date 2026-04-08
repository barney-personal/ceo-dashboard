import { db } from "@/lib/db";
import { modeReports, modeReportData, syncLog } from "@/lib/db/schema";
import { MODE_REPORT_MAP } from "@/lib/integrations/mode-config";
import {
  getLatestRun,
  getQueryRuns,
  getReportQueries,
  getQueryResultContent,
  extractQueryToken,
} from "@/lib/integrations/mode";
import { eq } from "drizzle-orm";
import { createPhaseTracker } from "./phase-tracker";

/**
 * Ensure all reports from config exist in the database.
 */
async function seedReports() {
  for (const config of MODE_REPORT_MAP) {
    const existing = await db
      .select()
      .from(modeReports)
      .where(eq(modeReports.reportToken, config.reportToken))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(modeReports).values({
        reportToken: config.reportToken,
        name: config.name,
        section: config.section,
        category: config.category ?? null,
      });
    }
  }
}

/**
 * Sync a single Mode report: fetch latest run results, upsert to DB.
 */
async function syncReport(
  report: typeof modeReports.$inferSelect
): Promise<number> {
  // Get the latest successful run
  const run = await getLatestRun(report.reportToken);
  if (!run) {
    throw new Error(`No successful runs found for report ${report.reportToken}`);
  }

  // Get query definitions (for names) and query runs (for results)
  const [queries, queryRuns] = await Promise.all([
    getReportQueries(report.reportToken),
    getQueryRuns(report.reportToken, run.token),
  ]);

  // Build a map of query token → query name
  const queryNameMap = new Map(queries.map((q) => [q.token, q.name]));

  let recordCount = 0;

  for (const queryRun of queryRuns) {
    if (queryRun.state !== "succeeded") continue;

    const queryToken = extractQueryToken(queryRun);
    const queryName = queryNameMap.get(queryToken) ?? queryToken;

    // Fetch the actual result data (skip queries with excessively large results)
    let rows: Record<string, unknown>[];
    try {
      rows = await getQueryResultContent(
        report.reportToken,
        run.token,
        queryRun.token
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("string longer than")) {
        console.warn(`Skipping oversized query "${queryName}" in report "${report.name}"`);
        continue;
      }
      throw err;
    }

    // Derive columns from the first row
    const columns = rows.length > 0
      ? Object.keys(rows[0]).map((name) => ({
          name,
          type: typeof rows[0][name],
        }))
      : [];

    // Upsert query results
    await db
      .insert(modeReportData)
      .values({
        reportId: report.id,
        queryToken,
        queryName,
        data: rows,
        columns,
        rowCount: rows.length,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [modeReportData.reportId, modeReportData.queryToken],
        set: {
          queryName,
          data: rows,
          columns,
          rowCount: rows.length,
          syncedAt: new Date(),
        },
      });

    recordCount += rows.length;
  }

  return recordCount;
}

/**
 * Sync all active Mode reports. Errors per-report don't block others.
 */
export async function syncAllModeReports(): Promise<{
  status: "success" | "error";
  recordsSynced: number;
  errors: string[];
}> {
  // Create sync log entry
  const [log] = await db
    .insert(syncLog)
    .values({ source: "mode" })
    .returning();

  const tracker = createPhaseTracker(log.id);

  try {
    // Seed any new reports from config
    let phaseId = await tracker.startPhase("seed_reports", "Ensuring config reports exist in DB");
    await seedReports();
    await tracker.endPhase(phaseId, { detail: `Checked ${MODE_REPORT_MAP.length} report definitions` });

    // Get all active reports
    phaseId = await tracker.startPhase("fetch_active_reports", "Loading active reports from DB");
    const reports = await db
      .select()
      .from(modeReports)
      .where(eq(modeReports.isActive, true));
    await tracker.endPhase(phaseId, { itemsProcessed: reports.length, detail: `Found ${reports.length} active reports` });

    let totalRecords = 0;
    const errors: string[] = [];

    for (const report of reports) {
      const reportPhaseId = await tracker.startPhase(`sync_report:${report.name}`, `Fetching latest run and queries`);
      try {
        console.log(`Mode sync: starting report ${report.name}`);
        const count = await syncReport(report);
        console.log(`Mode sync: completed ${report.name} (${count} records)`);
        totalRecords += count;
        await tracker.endPhase(reportPhaseId, { itemsProcessed: count, detail: `Synced ${count} rows` });
      } catch (err) {
        const message = `Failed to sync report "${report.name}" (${report.reportToken}): ${err instanceof Error ? err.message : String(err)}`;
        errors.push(message);
        console.error(message);
        await tracker.endPhase(reportPhaseId, { status: "error", errorMessage: message });
      }
    }

    const status = errors.length === 0 ? "success" : "error";

    // Update sync log
    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status,
        recordsSynced: totalRecords,
        errorMessage: errors.length > 0 ? errors.join("\n") : null,
      })
      .where(eq(syncLog.id, log.id));

    console.log("Mode sync: all reports complete");

    return { status, recordsSynced: totalRecords, errors };
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncLog.id, log.id));

    throw err;
  }
}
