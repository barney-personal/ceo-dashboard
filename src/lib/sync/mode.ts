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
import {
  prepareModeRowsForStorage,
  getModeQuerySyncProfile,
} from "./mode-storage";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  type SyncControl,
  throwIfSyncShouldStop,
} from "./errors";
import { determineSyncStatus, formatSyncError } from "./coordinator";
import { debugLog } from "@/lib/debug-logger";

function logModeEvent(event: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      source: "mode",
      event,
      ...payload,
    }),
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
    await db
      .insert(modeReports)
      .values({
        reportToken: config.reportToken,
        name: config.name,
        section: config.section,
        category: config.category ?? null,
      })
      .onConflictDoUpdate({
        target: modeReports.reportToken,
        set: {
          name: config.name,
          section: config.section,
          category: config.category ?? null,
        },
      });
  }
}

async function cleanupReportData(
  reportId: number,
  allowedQueryTokens: string[],
): Promise<void> {
  if (allowedQueryTokens.length === 0) {
    await db
      .delete(modeReportData)
      .where(eq(modeReportData.reportId, reportId));
    return;
  }

  await db
    .delete(modeReportData)
    .where(
      and(
        eq(modeReportData.reportId, reportId),
        notInArray(modeReportData.queryToken, allowedQueryTokens),
      ),
    );
}

/**
 * Sync a single Mode report and return the stored row count plus any per-query errors.
 */
async function syncReport(
  report: typeof modeReports.$inferSelect,
  opts: SyncControl & { syncRunId?: number } = {},
): Promise<{ recordsSynced: number; errors: string[] }> {
  throwIfSyncShouldStop(opts, {
    cancelled: "Mode sync cancelled before report fetch started",
    deadlineExceeded:
      "Mode sync exceeded its execution budget before report fetch started",
  });

  const profile = getModeSyncProfile(report.reportToken);
  if (!profile?.syncEnabled) {
    await cleanupReportData(report.id, []);
    return { recordsSynced: 0, errors: [] };
  }

  const run = await getLatestRun(report.reportToken, { signal: opts.signal });
  if (!run) {
    throw new Error(
      `No successful runs found for report ${report.reportToken}`,
    );
  }

  const [queries, queryRuns] = await Promise.all([
    getReportQueries(report.reportToken, { signal: opts.signal }),
    getQueryRuns(report.reportToken, run.token, { signal: opts.signal }),
  ]);

  const queryNameMap = new Map(
    queries.map((query) => [query.token, query.name]),
  );
  const allowedQueryTokens: string[] = [];
  const errors: string[] = [];
  let storedRecords = 0;

  const isGrowthMarketing = report.name
    .toLowerCase()
    .includes("growth marketing");

  logModeEvent("report_query_resolution", {
    reportToken: report.reportToken,
    reportName: report.name,
    runToken: run.token,
    queryDefinitionCount: queries.length,
    queryDefinitionTokens: queries.map((q) => q.token),
    queryDefinitionNames: queries.map((q) => q.name),
    queryRunCount: queryRuns.length,
    queryRunTokens: queryRuns.map((qr) => qr.token),
    queryRunQueryLinks: queryRuns.map((qr) => qr._links.query.href),
    extractedQueryTokens: queryRuns.map((qr) => extractQueryToken(qr)),
    isGrowthMarketing,
  });

  await debugLog("mode", "report_query_resolution", {
    reportToken: report.reportToken,
    reportName: report.name,
    runToken: run.token,
    queryDefinitionCount: queries.length,
    queryDefinitionNames: queries.map((q) => q.name),
    queryRunCount: queryRuns.length,
    extractedQueryTokens: queryRuns.map((qr) => extractQueryToken(qr)),
    isGrowthMarketing,
  }, { syncRunId: opts.syncRunId });

  if (isGrowthMarketing) {
    // Extra diagnostic: check if extracted query tokens from runs match any definition tokens
    const definitionTokenSet = new Set(queries.map((q) => q.token));
    for (const qr of queryRuns) {
      const extractedToken = extractQueryToken(qr);
      const matchesDefinition = definitionTokenSet.has(extractedToken);
      logModeEvent("growth_marketing_token_match", {
        queryRunToken: qr.token,
        extractedQueryToken: extractedToken,
        queryLink: qr._links.query.href,
        matchesDefinition,
        resolvedName: queryNameMap.get(extractedToken) ?? null,
        queryRunState: qr.state,
      });
    }
  }

  for (const queryRun of queryRuns) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Mode sync cancelled between query runs",
      deadlineExceeded:
        "Mode sync exceeded its execution budget between query runs",
    });

    if (queryRun.state !== "succeeded") {
      logModeEvent("query_run_skipped_state", {
        reportName: report.name,
        queryRunToken: queryRun.token,
        state: queryRun.state,
      });
      continue;
    }

    const queryToken = extractQueryToken(queryRun);
    const queryName = queryNameMap.get(queryToken) ?? queryToken;
    const queryProfile = getModeQuerySyncProfile(report.reportToken, queryName);

    logModeEvent("query_run_check", {
      reportName: report.name,
      queryName,
      queryToken,
      queryRunToken: queryRun.token,
      hasProfile: !!queryProfile,
      state: queryRun.state,
      nameFromDefinition: queryNameMap.has(queryToken),
      configuredQueryNames: profile?.queries.map((q) => q.name) ?? [],
    });

    await debugLog("mode", "query_run_check", {
      reportName: report.name,
      queryName,
      queryToken,
      hasProfile: !!queryProfile,
      profileQueryNames: profile?.queries?.map((q) => q.name) ?? [],
    }, { syncRunId: opts.syncRunId });

    if (!queryProfile) {
      logModeEvent("query_run_skipped_no_profile", {
        reportName: report.name,
        queryName,
        queryToken,
        queryRunToken: queryRun.token,
        availableProfiles: profile?.queries.map((q) => q.name) ?? [],
      });

      await debugLog("mode", "query_run_skipped_no_profile", {
        reportName: report.name,
        queryName,
        queryToken,
        availableProfiles: profile?.queries.map((q) => q.name) ?? [],
      }, { level: "warn", syncRunId: opts.syncRunId });
      continue;
    }

    allowedQueryTokens.push(queryToken);
    const queryStartedAt = Date.now();

    try {
      const { rows: sourceRows, responseBytes } = await getQueryResultContent(
        report.reportToken,
        run.token,
        queryRun.token,
        1000,
        { signal: opts.signal },
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

      await debugLog("mode", "query_synced", {
        reportName: report.name,
        queryName,
        queryToken,
        sourceRows: prepared.sourceRowCount,
        storedRows: prepared.storedRowCount,
        durationMs: Date.now() - queryStartedAt,
      }, { syncRunId: opts.syncRunId });
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

      await debugLog("mode", "query_failed", {
        reportName: report.name,
        queryName,
        queryToken,
        error: message,
        durationMs: Date.now() - queryStartedAt,
      }, { level: "error", syncRunId: opts.syncRunId });
    }
  }

  await cleanupReportData(report.id, allowedQueryTokens);

  return {
    recordsSynced: storedRecords,
    errors,
  };
}

type ModeSyncResult = {
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
};

async function failModePreflightPhase(
  tracker: ReturnType<typeof createPhaseTracker>,
  phaseId: number,
  phaseLabel: string,
  error: unknown
): Promise<ModeSyncResult> {
  const message = `Failed to ${phaseLabel}: ${formatSyncError(error)}`;
  await tracker.endPhase(phaseId, {
    status: "error",
    errorMessage: message,
  });

  return {
    status: "error",
    recordsSynced: 0,
    errors: [message],
  };
}

export async function runModeSync(
  run: { id: number },
  opts: SyncControl = {}
): Promise<ModeSyncResult> {
  const tracker = createPhaseTracker(run.id);
  let totalRecords = 0;
  const errors: string[] = [];

  try {
    let phaseId = await tracker.startPhase(
      "seed_reports",
      "Ensuring config reports exist in DB",
    );
    try {
      await seedReports();
    } catch (error) {
      return failModePreflightPhase(tracker, phaseId, "seed report definitions", error);
    }
    await tracker.endPhase(phaseId, {
      detail: `Checked ${MODE_SYNC_PROFILES.length} report definitions`,
    });

    const enabledTokens = MODE_SYNC_PROFILES.filter(
      (profile) => profile.syncEnabled,
    ).map((profile) => profile.reportToken);

    phaseId = await tracker.startPhase(
      "fetch_active_reports",
      "Loading active reports from DB",
    );
    let reports: typeof modeReports.$inferSelect[] = [];
    try {
      reports = enabledTokens.length
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
    } catch (error) {
      return failModePreflightPhase(tracker, phaseId, "load active reports", error);
    }
    await tracker.endPhase(phaseId, {
      itemsProcessed: reports.length,
      detail: `Found ${reports.length} active sync-enabled reports`,
    });

    let succeededReports = 0;

    for (const report of reports) {
      throwIfSyncShouldStop(opts, {
        cancelled: "Mode sync cancelled between reports",
        deadlineExceeded:
          "Mode sync exceeded its execution budget between reports",
      });

      const reportPhaseId = await tracker.startPhase(
        `sync_report:${report.name}`,
        "Fetching latest run and syncing allowed queries",
      );
      const reportStartedAt = Date.now();

      try {
        logModeEvent("report_started", {
          runId: run.id,
          reportToken: report.reportToken,
          reportName: report.name,
          heapMb: getHeapMb(),
        });

        const result = await syncReport(report, { ...opts, syncRunId: run.id });
        totalRecords += result.recordsSynced;
        errors.push(...result.errors);
        succeededReports += 1;

        await tracker.endPhase(reportPhaseId, {
          status: result.errors.length > 0 ? "error" : "success",
          itemsProcessed: result.recordsSynced,
          errorMessage:
            result.errors.length > 0 ? result.errors.join("\n") : undefined,
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

        if (error instanceof SyncDeadlineExceededError) {
          await tracker.endPhase(reportPhaseId, {
            status: "error",
            detail: "Execution budget exceeded before report completed",
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
    if (error instanceof SyncDeadlineExceededError) {
      return {
        status: totalRecords > 0 ? "partial" : "error",
        recordsSynced: totalRecords,
        errors: [...errors, error.message],
      };
    }

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
