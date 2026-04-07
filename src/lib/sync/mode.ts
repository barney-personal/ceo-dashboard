import { db } from "@/lib/db";
import { modeReports, modeReportData, syncLog } from "@/lib/db/schema";
import { MODE_REPORT_MAP } from "@/lib/integrations/mode-config";
import {
  runReportAndWait,
  getRunQueries,
  getQueryResult,
} from "@/lib/integrations/mode";
import { eq } from "drizzle-orm";

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
 * Sync a single Mode report: run it, fetch results, upsert to DB.
 */
async function syncReport(
  report: typeof modeReports.$inferSelect
): Promise<number> {
  // Run the report and wait for completion
  const run = await runReportAndWait(report.reportToken);

  // Get all queries from this run
  const queries = await getRunQueries(report.reportToken, run.token);

  let recordCount = 0;

  for (const query of queries) {
    const { columns, rows } = await getQueryResult(
      report.reportToken,
      run.token,
      query.token
    );

    // Upsert query results
    await db
      .insert(modeReportData)
      .values({
        reportId: report.id,
        queryToken: query.token,
        queryName: query.name,
        data: rows,
        columns: columns,
        rowCount: rows.length,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [modeReportData.reportId, modeReportData.queryToken],
        set: {
          queryName: query.name,
          data: rows,
          columns: columns,
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

  try {
    // Seed any new reports from config
    await seedReports();

    // Get all active reports
    const reports = await db
      .select()
      .from(modeReports)
      .where(eq(modeReports.isActive, true));

    let totalRecords = 0;
    const errors: string[] = [];

    for (const report of reports) {
      try {
        const count = await syncReport(report);
        totalRecords += count;
      } catch (err) {
        const message = `Failed to sync report "${report.name}" (${report.reportToken}): ${err instanceof Error ? err.message : String(err)}`;
        errors.push(message);
        console.error(message);
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

    return { status, recordsSynced: totalRecords, errors };
  } catch (err) {
    // Fatal error — update sync log
    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status: "error",
        errorMessage:
          err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncLog.id, log.id));

    throw err;
  }
}
