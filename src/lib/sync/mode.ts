import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import {
  MODE_SYNC_PROFILES,
  getModeSyncProfile,
} from "@/lib/integrations/mode-config";
import {
  extractQueryToken,
  getLatestRun,
  getQueryResultContent,
  getQueryRuns,
  getReportQueries,
} from "@/lib/integrations/mode";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { createPhaseTracker } from "./phase-tracker";
import { prepareModeRowsForStorage, getModeQuerySyncProfile } from "./mode-storage";
import { SyncCancelledError } from "./errors";

function logModeEvent(event: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      source: "mode",
      event,
      ...payload,
    })
  );
}

function getHeapMb(): number {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Ensure all reports from config exist in the database.
 */
async function seedReports() {
  for (const config of MODE_SYNC_PROFILES) {
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

async function cleanupReportData(
  reportId: number,
  allowedQueryTokens: string[]
): Promise<void> {
  if (allowedQueryTokens.length === 0) {
    await db.delete(modeReportData).where(eq(modeReportData.reportId, reportId));
    return;
  }

  await db
    .delete(modeReportData)
    .where(
      and(
        eq(modeReportData.reportId, reportId),
        notInArray(modeReportData.queryToken, allowedQueryTokens)
      )
    );
}

/**
 * Sync a single Mode report and return the stored row count plus any per-query errors.
 */
async function syncReport(
  report: typeof modeReports.$inferSelect,
  opts: { shouldStop?: () => boolean } = {}
): Promise<{ recordsSynced: number; errors: string[] }> {
  const profile = getModeSyncProfile(report.reportToken);
  if (!profile?.syncEnabled) {
    await cleanupReportData(report.id, []);
    return { recordsSynced: 0, errors: [] };
  }

  const run = await getLatestRun(report.reportToken);
  if (!run) {
    throw new Error(`No successful runs found for report ${report.reportToken}`);
  }

  const [queries, queryRuns] = await Promise.all([
    getReportQueries(report.reportToken),
    getQueryRuns(report.reportToken, run.token),
  ]);

  const queryNameMap = new Map(queries.map((query) => [query.token, query.name]));
  const allowedQueryTokens: string[] = [];
  const errors: string[] = [];
  let storedRecords = 0;

  for (const queryRun of queryRuns) {
    if (opts.shouldStop?.()) {
      throw new SyncCancelledError("Mode sync cancelled between query runs");
    }

    if (queryRun.state !== "succeeded") continue;

    const queryToken = extractQueryToken(queryRun);
    const queryName = queryNameMap.get(queryToken) ?? queryToken;
    const queryProfile = getModeQuerySyncProfile(report.reportToken, queryName);

    if (!queryProfile) {
      continue;
    }

    allowedQueryTokens.push(queryToken);
    const queryStartedAt = Date.now();

    try {
      const { rows: sourceRows, responseBytes } = await getQueryResultContent(
        report.reportToken,
        run.token,
        queryRun.token
      );
      const prepared = prepareModeRowsForStorage(sourceRows, queryProfile);

      const sampleRow = prepared.rows[0] ?? sourceRows[0] ?? {};
      const columns = Object.keys(sampleRow).map((name) => ({
        name,
        type: typeof sampleRow[name],
      }));

      await db
        .insert(modeReportData)
        .values({
          reportId: report.id,
          queryToken,
          queryName,
          data: prepared.rows,
          columns,
          rowCount: prepared.storedRowCount,
          sourceRowCount: prepared.sourceRowCount,
          storedRowCount: prepared.storedRowCount,
          truncated: prepared.truncated,
          storageWindow: prepared.storageWindow,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [modeReportData.reportId, modeReportData.queryToken],
          set: {
            queryName,
            data: prepared.rows,
            columns,
            rowCount: prepared.storedRowCount,
            sourceRowCount: prepared.sourceRowCount,
            storedRowCount: prepared.storedRowCount,
            truncated: prepared.truncated,
            storageWindow: prepared.storageWindow,
            syncedAt: new Date(),
          },
        });

      storedRecords += prepared.storedRowCount;

      logModeEvent("query_synced", {
        reportToken: report.reportToken,
        reportName: report.name,
        queryToken,
        queryName,
        durationMs: Date.now() - queryStartedAt,
        responseBytes,
        sourceRows: prepared.sourceRowCount,
        storedRows: prepared.storedRowCount,
        truncated: prepared.truncated,
        heapMb: getHeapMb(),
      });
    } catch (error) {
      const message = `Failed to sync query "${queryName}" in report "${report.name}": ${
        error instanceof Error ? error.message : String(error)
      }`;
      errors.push(message);
      console.error(message);
      logModeEvent("query_failed", {
        reportToken: report.reportToken,
        reportName: report.name,
        queryToken,
        queryName,
        durationMs: Date.now() - queryStartedAt,
        error: message,
        heapMb: getHeapMb(),
      });
    }
  }

  await cleanupReportData(report.id, allowedQueryTokens);

  return {
    recordsSynced: storedRecords,
    errors,
  };
}

export async function runModeSync(
  run: { id: number },
  opts: { shouldStop?: () => boolean } = {}
): Promise<{
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
}> {
  const tracker = createPhaseTracker(run.id);
  let totalRecords = 0;
  const errors: string[] = [];

  try {
    let phaseId = await tracker.startPhase(
      "seed_reports",
      "Ensuring config reports exist in DB"
    );
    await seedReports();
    await tracker.endPhase(phaseId, {
      detail: `Checked ${MODE_SYNC_PROFILES.length} report definitions`,
    });

    const enabledTokens = MODE_SYNC_PROFILES.filter((profile) => profile.syncEnabled).map(
      (profile) => profile.reportToken
    );

    phaseId = await tracker.startPhase(
      "fetch_active_reports",
      "Loading active reports from DB"
    );
    const reports = enabledTokens.length
      ? await db
          .select()
          .from(modeReports)
          .where(
            and(
              eq(modeReports.isActive, true),
              inArray(modeReports.reportToken, enabledTokens)
            )
          )
      : [];
    await tracker.endPhase(phaseId, {
      itemsProcessed: reports.length,
      detail: `Found ${reports.length} active sync-enabled reports`,
    });

    let succeededReports = 0;

    for (const report of reports) {
      if (opts.shouldStop?.()) {
        throw new SyncCancelledError("Mode sync cancelled between reports");
      }

      const reportPhaseId = await tracker.startPhase(
        `sync_report:${report.name}`,
        "Fetching latest run and syncing allowed queries"
      );
      const reportStartedAt = Date.now();

      try {
        logModeEvent("report_started", {
          runId: run.id,
          reportToken: report.reportToken,
          reportName: report.name,
          heapMb: getHeapMb(),
        });

        const result = await syncReport(report, opts);
        totalRecords += result.recordsSynced;
        errors.push(...result.errors);
        succeededReports += 1;

        await tracker.endPhase(reportPhaseId, {
          status: result.errors.length > 0 ? "error" : "success",
          itemsProcessed: result.recordsSynced,
          errorMessage: result.errors.length > 0 ? result.errors.join("\n") : undefined,
          detail: `Stored ${result.recordsSynced} rows`,
        });

        logModeEvent("report_finished", {
          runId: run.id,
          reportToken: report.reportToken,
          reportName: report.name,
          durationMs: Date.now() - reportStartedAt,
          storedRows: result.recordsSynced,
          errors: result.errors.length,
          heapMb: getHeapMb(),
        });
      } catch (error) {
        const message = `Failed to sync report "${report.name}" (${report.reportToken}): ${
          error instanceof Error ? error.message : String(error)
        }`;
        if (error instanceof SyncCancelledError) {
          await tracker.endPhase(reportPhaseId, {
            status: "skipped",
            detail: "Cancelled before report completed",
            errorMessage: error.message,
          });
          throw error;
        }

        errors.push(message);
        console.error(message);
        await tracker.endPhase(reportPhaseId, {
          status: "error",
          errorMessage: message,
        });
        logModeEvent("report_failed", {
          runId: run.id,
          reportToken: report.reportToken,
          reportName: report.name,
          durationMs: Date.now() - reportStartedAt,
          error: message,
          heapMb: getHeapMb(),
        });
      }

      await yieldToEventLoop();
    }

    const status =
      errors.length === 0
        ? "success"
        : succeededReports > 0
          ? "partial"
          : "error";

    logModeEvent("run_finished", {
      runId: run.id,
      status,
      storedRows: totalRecords,
      errors: errors.length,
      heapMb: getHeapMb(),
    });

    return {
      status,
      recordsSynced: totalRecords,
      errors,
    };
  } catch (error) {
    if (error instanceof SyncCancelledError) {
      return {
        status: "cancelled",
        recordsSynced: totalRecords,
        errors: [...errors, error.message],
      };
    }

    throw error;
  }
}
