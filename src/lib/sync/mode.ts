import { db } from "@/lib/db";
import { modeReports, modeReportData, syncLog } from "@/lib/db/schema";
import {
  MODE_SYNC_PROFILES,
  getModeSyncProfile,
} from "@/lib/integrations/mode-config";
import {
  checkModeHealth,
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
import {
  determineSyncStatus,
  formatSyncError,
  type SyncRunScope,
} from "./coordinator";
import { getSyncSourceConfig } from "./config";
import { debugLog } from "@/lib/debug-logger";
import * as Sentry from "@sentry/nextjs";

const MODE_QUERY_FETCH_CONCURRENCY = 3;
const MODE_REPORT_FRESHNESS_WINDOW_MS =
  getSyncSourceConfig("mode").normalIntervalMs;

type ModeQueryJob = {
  queryRunToken: string;
  queryToken: string;
  queryName: string;
  queryProfile: NonNullable<ReturnType<typeof getModeQuerySyncProfile>>;
};

type PreparedModeQueryWrite = {
  queryToken: string;
  queryName: string;
  rows: Record<string, unknown>[];
  columns: Array<{ name: string; type: string }>;
  sourceRowCount: number;
  storedRowCount: number;
  truncated: boolean;
  storageWindow: ReturnType<typeof prepareModeRowsForStorage>["storageWindow"];
  responseBytes: number;
  durationMs: number;
};

type ModeQueryJobResult =
  | {
      status: "success";
      storedRecords: number;
      warnings: string[];
      preparedWrite: PreparedModeQueryWrite | null;
    }
  | { status: "error"; message: string };

type ExistingModeQueryData = typeof modeReportData.$inferSelect;
type ModeReportDataDeleteExecutor = Pick<typeof db, "delete">;
type ModeReportFreshnessRow = Pick<
  typeof modeReportData.$inferSelect,
  "queryToken" | "syncedAt"
>;

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

function getModeFreshnessCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - MODE_REPORT_FRESHNESS_WINDOW_MS);
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: readonly T[],
  concurrencyLimit: number,
  mapper: (item: T, index: number) => Promise<TResult>
): Promise<PromiseSettledResult<TResult>[]> {
  const settledResults: PromiseSettledResult<TResult>[] = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrencyLimit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        const value = await mapper(items[currentIndex], currentIndex);
        settledResults[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        settledResults[currentIndex] = { status: "rejected", reason };
      }
    }
  });

  const workerResults = await Promise.allSettled(workers);
  const rejectedWorker = workerResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejectedWorker) {
    throw rejectedWorker.reason;
  }

  return settledResults;
}

/**
 * Ensure all reports from config exist in the database.
 */
export async function ensureModeReportsSeeded() {
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

export type ModeSyncTargetValidationResult =
  | { ok: true; report: typeof modeReports.$inferSelect }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function validateModeReportSyncTarget(
  reportToken: unknown
): Promise<ModeSyncTargetValidationResult> {
  if (typeof reportToken !== "string" || reportToken.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      error: "reportToken is required",
    };
  }

  const normalizedToken = reportToken.trim();
  const profile = getModeSyncProfile(normalizedToken);

  if (!profile) {
    return {
      ok: false,
      status: 404,
      error: `Unknown Mode report token "${normalizedToken}"`,
    };
  }

  if (!profile.syncEnabled) {
    return {
      ok: false,
      status: 409,
      error: `Mode report "${profile.name}" is disabled for sync`,
    };
  }

  await ensureModeReportsSeeded();

  const [report] = await db
    .select()
    .from(modeReports)
    .where(eq(modeReports.reportToken, normalizedToken))
    .limit(1);

  if (!report) {
    return {
      ok: false,
      status: 404,
      error: `Mode report "${normalizedToken}" is not available in the database`,
    };
  }

  if (!report.isActive) {
    return {
      ok: false,
      status: 409,
      error: `Mode report "${report.name}" is inactive`,
    };
  }

  return {
    ok: true,
    report,
  };
}

async function cleanupReportData(
  executor: ModeReportDataDeleteExecutor,
  reportId: number,
  allowedQueryTokens: string[],
): Promise<void> {
  if (allowedQueryTokens.length === 0) {
    await executor
      .delete(modeReportData)
      .where(eq(modeReportData.reportId, reportId));
    return;
  }

  await executor
    .delete(modeReportData)
    .where(
      and(
        eq(modeReportData.reportId, reportId),
        notInArray(modeReportData.queryToken, allowedQueryTokens),
      ),
    );
}

function getStoredRowCount(row: { storedRowCount?: number; rowCount?: number } | undefined): number {
  if (!row) {
    return 0;
  }

  return row.storedRowCount ?? row.rowCount ?? 0;
}

function getColumnCount(columns: unknown): number {
  return Array.isArray(columns) ? columns.length : 0;
}

async function checkpointModeSyncProgress(
  runId: number,
  recordsSynced: number,
): Promise<void> {
  const now = new Date();
  await db
    .update(syncLog)
    .set({
      status: "running",
      recordsSynced,
      heartbeatAt: now,
    })
    .where(and(eq(syncLog.id, runId), eq(syncLog.status, "running")));
}

async function getExpectedModeQueryTokens(
  reportToken: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const profile = getModeSyncProfile(reportToken);
  if (!profile?.syncEnabled || profile.queries.length === 0) {
    return [];
  }

  const configuredQueryNames = new Set(profile.queries.map((query) => query.name));
  const queries = await getReportQueries(reportToken, { signal });
  const expectedTokens: string[] = [];
  const resolvedQueryNames = new Set<string>();

  for (const query of queries) {
    if (!configuredQueryNames.has(query.name)) {
      continue;
    }

    if (!getModeQuerySyncProfile(reportToken, query.name)) {
      continue;
    }

    expectedTokens.push(query.token);
    resolvedQueryNames.add(query.name);
  }

  if (resolvedQueryNames.size !== configuredQueryNames.size) {
    return [];
  }

  return [...new Set(expectedTokens)];
}

async function getFreshStoredModeRows(
  reportId: number,
  expectedQueryTokens: string[],
): Promise<ModeReportFreshnessRow[]> {
  if (expectedQueryTokens.length === 0) {
    return [];
  }

  return db
    .select({
      queryToken: modeReportData.queryToken,
      syncedAt: modeReportData.syncedAt,
    })
    .from(modeReportData)
    .where(
      and(
        eq(modeReportData.reportId, reportId),
        inArray(modeReportData.queryToken, expectedQueryTokens),
      ),
    );
}

async function shouldSkipFreshModeReport(
  report: typeof modeReports.$inferSelect,
  opts: { signal?: AbortSignal; now?: Date } = {},
): Promise<{
  shouldSkip: boolean;
  expectedQueryCount: number;
}> {
  const expectedQueryTokens = await getExpectedModeQueryTokens(
    report.reportToken,
    opts.signal,
  );

  if (expectedQueryTokens.length === 0) {
    return {
      shouldSkip: false,
      expectedQueryCount: 0,
    };
  }

  const storedRows = await getFreshStoredModeRows(report.id, expectedQueryTokens);
  if (storedRows.length !== expectedQueryTokens.length) {
    return {
      shouldSkip: false,
      expectedQueryCount: expectedQueryTokens.length,
    };
  }

  const freshnessCutoff = getModeFreshnessCutoff(opts.now);
  const storedRowsByToken = new Map(
    storedRows.map((row) => [row.queryToken, row.syncedAt]),
  );

  for (const queryToken of expectedQueryTokens) {
    const syncedAt = storedRowsByToken.get(queryToken);
    if (!syncedAt || syncedAt.getTime() < freshnessCutoff.getTime()) {
      return {
        shouldSkip: false,
        expectedQueryCount: expectedQueryTokens.length,
      };
    }
  }

  return {
    shouldSkip: true,
    expectedQueryCount: expectedQueryTokens.length,
  };
}

function captureModeValidationWarning(
  warning: string,
  context: {
    syncRunId?: number;
    reportToken: string;
    reportName: string;
    queryToken: string;
    queryName: string;
    previousRowCount?: number;
    nextRowCount?: number;
    previousColumnCount?: number;
    nextColumnCount?: number;
  },
): void {
  Sentry.captureMessage(warning, {
    level: "warning",
    tags: {
      sync_source: "mode",
      failure_scope: "validation",
    },
    extra: context,
  });
}

type SyncReportResult = {
  recordsSynced: number;
  errors: string[];
  queriesSucceeded: number;
  queriesFailed: number;
  warnings: string[];
  committed: boolean;
};

/**
 * Sync a single Mode report and return the stored row count plus any per-query errors.
 */
async function syncReport(
  report: typeof modeReports.$inferSelect,
  opts: SyncControl & { syncRunId?: number } = {},
): Promise<SyncReportResult> {
  throwIfSyncShouldStop(opts, {
    cancelled: "Mode sync cancelled before report fetch started",
    deadlineExceeded:
      "Mode sync exceeded its execution budget before report fetch started",
  });

  const profile = getModeSyncProfile(report.reportToken);
  if (!profile?.syncEnabled) {
    await cleanupReportData(db, report.id, []);
    return {
      recordsSynced: 0,
      errors: [],
      queriesSucceeded: 0,
      queriesFailed: 0,
      warnings: [],
      committed: true,
    };
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
  const warnings: string[] = [];
  let queriesFailed = 0;
  const queryJobs: ModeQueryJob[] = [];

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
    queryJobs.push({
      queryRunToken: queryRun.token,
      queryToken,
      queryName,
      queryProfile,
    });
  }

  const queryResults = await mapWithConcurrencyLimit(
    queryJobs,
    MODE_QUERY_FETCH_CONCURRENCY,
    async ({
      queryRunToken,
      queryToken,
      queryName,
      queryProfile,
    }): Promise<ModeQueryJobResult> => {
      throwIfSyncShouldStop(opts, {
        cancelled: "Mode sync cancelled between query runs",
        deadlineExceeded:
          "Mode sync exceeded its execution budget between query runs",
      });

      const queryStartedAt = Date.now();

      try {
        const { rows: sourceRows, responseBytes } = await getQueryResultContent(
          report.reportToken,
          run.token,
          queryRunToken,
          1000,
          {
            signal: opts.signal,
            maxBytes: queryProfile.maxResponseBytes,
          },
        );
        const prepared = prepareModeRowsForStorage(sourceRows, queryProfile);

        const sampleRow = prepared.rows[0] ?? sourceRows[0] ?? {};
        const columns = Object.keys(sampleRow).map((name) => ({
          name,
          type: typeof sampleRow[name],
        }));
        const existingRows = await db
          .select({
            rowCount: modeReportData.rowCount,
            storedRowCount: modeReportData.storedRowCount,
            columns: modeReportData.columns,
          })
          .from(modeReportData)
          .where(
            and(
              eq(modeReportData.reportId, report.id),
              eq(modeReportData.queryToken, queryToken),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        const queryWarnings: string[] = [];
        const previousRowCount = getStoredRowCount(existing);
        const previousColumnCount = getColumnCount(existing?.columns);
        const nextRowCount = prepared.storedRowCount;
        const nextColumnCount = columns.length;

        if (nextRowCount === 0 && previousRowCount > 0) {
          const warning = `Skipped empty overwrite for query "${queryName}" in report "${report.name}" because ${previousRowCount} existing rows are already stored`;
          queryWarnings.push(warning);
          captureModeValidationWarning(warning, {
            syncRunId: opts.syncRunId,
            reportToken: report.reportToken,
            reportName: report.name,
            queryToken,
            queryName,
            previousRowCount,
            nextRowCount,
            previousColumnCount,
            nextColumnCount,
          });

          logModeEvent("query_validation_warning", {
            reportToken: report.reportToken,
            reportName: report.name,
            queryToken,
            queryName,
            warning,
            previousRowCount,
            nextRowCount,
            previousColumnCount,
            nextColumnCount,
          });

          await debugLog(
            "mode",
            "query_validation_warning",
            {
              reportName: report.name,
              queryName,
              queryToken,
              warning,
              previousRowCount,
              nextRowCount,
              previousColumnCount,
              nextColumnCount,
            },
            { level: "warn", syncRunId: opts.syncRunId },
          );

          return {
            status: "success",
            storedRecords: 0,
            warnings: queryWarnings,
            preparedWrite: null,
          };
        }

        if (
          previousColumnCount > 0 &&
          Math.abs(nextColumnCount - previousColumnCount) / previousColumnCount > 0.5
        ) {
          const warning = `Column count shifted from ${previousColumnCount} to ${nextColumnCount} for query "${queryName}" in report "${report.name}"`;
          queryWarnings.push(warning);
          captureModeValidationWarning(warning, {
            syncRunId: opts.syncRunId,
            reportToken: report.reportToken,
            reportName: report.name,
            queryToken,
            queryName,
            previousRowCount,
            nextRowCount,
            previousColumnCount,
            nextColumnCount,
          });
        }

        if (previousRowCount > 0 && nextRowCount < previousRowCount * 0.1) {
          const warning = `Row count dropped from ${previousRowCount} to ${nextRowCount} for query "${queryName}" in report "${report.name}"`;
          queryWarnings.push(warning);
          captureModeValidationWarning(warning, {
            syncRunId: opts.syncRunId,
            reportToken: report.reportToken,
            reportName: report.name,
            queryToken,
            queryName,
            previousRowCount,
            nextRowCount,
            previousColumnCount,
            nextColumnCount,
          });
        }

        return {
          status: "success",
          storedRecords: prepared.storedRowCount,
          warnings: queryWarnings,
          preparedWrite: {
            queryToken,
            queryName,
            rows: prepared.rows,
            columns,
            sourceRowCount: prepared.sourceRowCount,
            storedRowCount: prepared.storedRowCount,
            truncated: prepared.truncated,
            storageWindow: prepared.storageWindow,
            responseBytes,
            durationMs: Date.now() - queryStartedAt,
          },
        };
      } catch (error) {
        const message = `Failed to sync query "${queryName}" in report "${report.name}": ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error(message);
        Sentry.captureException(error, {
          tags: {
            sync_source: "mode",
            failure_scope: "query",
          },
          extra: {
            runId: opts.syncRunId,
            reportToken: report.reportToken,
            reportName: report.name,
            queryToken,
            queryName,
            message,
          },
        });
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

        return {
          status: "error",
          message,
        };
      }
    }
  );

  const successfulQueryResults: Extract<ModeQueryJobResult, { status: "success" }>[] = [];
  const preparedWrites: PreparedModeQueryWrite[] = [];

  for (const result of queryResults) {
    if (result.status === "rejected") {
      throw result.reason;
    }

    if (result.value.status === "error") {
      errors.push(result.value.message);
      queriesFailed++;
      continue;
    }

    successfulQueryResults.push(result.value);
    warnings.push(...result.value.warnings);

    if (result.value.preparedWrite) {
      preparedWrites.push(result.value.preparedWrite);
    }
  }

  if (errors.length > 0) {
    return {
      recordsSynced: 0,
      errors,
      queriesSucceeded: 0,
      queriesFailed,
      warnings,
      committed: false,
    };
  }

  const syncedAt = new Date();
  await db.transaction(async (tx) => {
    for (const preparedWrite of preparedWrites) {
      await tx
        .insert(modeReportData)
        .values({
          reportId: report.id,
          queryToken: preparedWrite.queryToken,
          queryName: preparedWrite.queryName,
          data: preparedWrite.rows,
          columns: preparedWrite.columns,
          rowCount: preparedWrite.storedRowCount,
          sourceRowCount: preparedWrite.sourceRowCount,
          storedRowCount: preparedWrite.storedRowCount,
          truncated: preparedWrite.truncated,
          storageWindow: preparedWrite.storageWindow,
          syncedAt,
        })
        .onConflictDoUpdate({
          target: [modeReportData.reportId, modeReportData.queryToken],
          set: {
            queryName: preparedWrite.queryName,
            data: preparedWrite.rows,
            columns: preparedWrite.columns,
            rowCount: preparedWrite.storedRowCount,
            sourceRowCount: preparedWrite.sourceRowCount,
            storedRowCount: preparedWrite.storedRowCount,
            truncated: preparedWrite.truncated,
            storageWindow: preparedWrite.storageWindow,
            syncedAt,
          },
        });
    }

    await cleanupReportData(tx, report.id, allowedQueryTokens);
  });

  let storedRecords = 0;
  for (const queryResult of successfulQueryResults) {
    storedRecords += queryResult.storedRecords;

    if (!queryResult.preparedWrite) {
      continue;
    }

    logModeEvent("query_synced", {
      reportToken: report.reportToken,
      reportName: report.name,
      queryToken: queryResult.preparedWrite.queryToken,
      queryName: queryResult.preparedWrite.queryName,
      durationMs: queryResult.preparedWrite.durationMs,
      responseBytes: queryResult.preparedWrite.responseBytes,
      sourceRows: queryResult.preparedWrite.sourceRowCount,
      storedRows: queryResult.preparedWrite.storedRowCount,
      truncated: queryResult.preparedWrite.truncated,
      heapMb: getHeapMb(),
    });

    await debugLog(
      "mode",
      "query_synced",
      {
        reportName: report.name,
        queryName: queryResult.preparedWrite.queryName,
        queryToken: queryResult.preparedWrite.queryToken,
        sourceRows: queryResult.preparedWrite.sourceRowCount,
        storedRows: queryResult.preparedWrite.storedRowCount,
        durationMs: queryResult.preparedWrite.durationMs,
      },
      { syncRunId: opts.syncRunId },
    );
  }

  return {
    recordsSynced: storedRecords,
    errors,
    queriesSucceeded: successfulQueryResults.length,
    queriesFailed,
    warnings,
    committed: true,
  };
}

type ModeSyncResult = {
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
};

function getModeRunScope(run: { scope?: unknown }): SyncRunScope | null {
  if (!run.scope || typeof run.scope !== "object") {
    return null;
  }

  const reportToken = (run.scope as Record<string, unknown>).reportToken;
  if (typeof reportToken !== "string" || reportToken.length === 0) {
    return null;
  }

  return { reportToken };
}

async function failModePreflightPhase(
  tracker: ReturnType<typeof createPhaseTracker>,
  runId: number,
  phaseId: number,
  phaseLabel: string,
  error: unknown
): Promise<ModeSyncResult> {
  const message = `Failed to ${phaseLabel}: ${formatSyncError(error)}`;
  Sentry.captureException(error, {
    tags: {
      sync_source: "mode",
      failure_scope: "preflight",
    },
    extra: {
      runId,
      phaseLabel,
      message,
    },
  });
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

async function failModeHealthCheck(
  tracker: ReturnType<typeof createPhaseTracker>,
  runId: number,
  phaseId: number,
  error: unknown,
): Promise<ModeSyncResult> {
  const message = `Mode API unreachable, skipping sync: ${formatSyncError(error)}`;
  Sentry.captureMessage("Mode API unreachable, skipping sync", {
    level: "warning",
    tags: {
      sync_source: "mode",
      failure_scope: "health_check",
    },
    extra: {
      runId,
      message,
    },
  });
  await tracker.endPhase(phaseId, {
    status: "error",
    detail: "Mode API unreachable, sync skipped",
    errorMessage: message,
  });

  return {
    status: "error",
    recordsSynced: 0,
    errors: [message],
  };
}

export async function runModeSync(
  run: { id: number; scope?: unknown },
  opts: SyncControl = {}
): Promise<ModeSyncResult> {
  Sentry.setTag("sync_source", "mode");
  const tracker = createPhaseTracker(run.id);
  let totalRecords = 0;
  const errors: string[] = [];
  const scope = getModeRunScope(run);

  try {
    let phaseId = await tracker.startPhase(
      "health_check",
      "Checking Mode API connectivity",
    );
    try {
      await checkModeHealth({ signal: opts.signal });
    } catch (error) {
      // Re-throw cancellation/deadline errors — don't misclassify as health check failure
      if (error instanceof SyncCancelledError || error instanceof SyncDeadlineExceededError) {
        await tracker.endPhase(phaseId, { status: "error", errorMessage: error.message });
        throw error;
      }
      return failModeHealthCheck(tracker, run.id, phaseId, error);
    }
    await tracker.endPhase(phaseId, {
      detail: "Mode API reachable",
    });

    phaseId = await tracker.startPhase(
      "seed_reports",
      "Ensuring config reports exist in DB",
    );
    try {
      await ensureModeReportsSeeded();
    } catch (error) {
      return failModePreflightPhase(
        tracker,
        run.id,
        phaseId,
        "seed report definitions",
        error
      );
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
      const reportFilters = [
        eq(modeReports.isActive, true),
        inArray(modeReports.reportToken, enabledTokens),
      ];

      if (scope?.reportToken) {
        reportFilters.push(eq(modeReports.reportToken, scope.reportToken));
      }

      reports = enabledTokens.length
        ? await db
            .select()
            .from(modeReports)
            .where(and(...reportFilters))
        : [];
    } catch (error) {
      return failModePreflightPhase(
        tracker,
        run.id,
        phaseId,
        "load active reports",
        error
      );
    }
    await tracker.endPhase(phaseId, {
      itemsProcessed: reports.length,
      detail: scope?.reportToken
        ? `Found ${reports.length} active sync-enabled report matching ${scope.reportToken}`
        : `Found ${reports.length} active sync-enabled reports`,
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

        const freshness = await shouldSkipFreshModeReport(report, {
          signal: opts.signal,
        });
        if (freshness.shouldSkip) {
          succeededReports += 1;
          await checkpointModeSyncProgress(run.id, totalRecords);
          await tracker.endPhase(reportPhaseId, {
            status: "skipped",
            itemsProcessed: 0,
            detail: `Skipped report sync because ${freshness.expectedQueryCount} query row${freshness.expectedQueryCount === 1 ? "" : "s"} already cover the configured report and are still fresh`,
          });

          logModeEvent("report_skipped_fresh", {
            runId: run.id,
            reportToken: report.reportToken,
            reportName: report.name,
            expectedQueryCount: freshness.expectedQueryCount,
            durationMs: Date.now() - reportStartedAt,
            heapMb: getHeapMb(),
          });

          await yieldToEventLoop();
          continue;
        }

        const result = await syncReport(report, { ...opts, syncRunId: run.id });
        totalRecords += result.recordsSynced;
        errors.push(...result.errors);

        const phaseStatus =
          result.queriesFailed === 0 && result.warnings.length === 0
            ? "success"
            : result.committed && (result.queriesSucceeded > 0 || result.warnings.length > 0)
              ? "partial"
              : "error";

        if (phaseStatus !== "error") {
          succeededReports += 1;
        }

        await checkpointModeSyncProgress(run.id, totalRecords);

        const queryCountDetail =
          result.queriesSucceeded + result.queriesFailed > 0
            ? ` — ${result.queriesSucceeded} queries succeeded, ${result.queriesFailed} failed`
            : "";
        const warningDetail =
          result.warnings.length > 0
            ? `${queryCountDetail ? "," : " — "} ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`
            : "";

        await tracker.endPhase(reportPhaseId, {
          status: phaseStatus,
          itemsProcessed: result.recordsSynced,
          errorMessage:
            result.errors.length > 0 ? result.errors.join("\n") : undefined,
          detail: `Stored ${result.recordsSynced} rows${queryCountDetail}${warningDetail}`,
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
        Sentry.captureException(error, {
          tags: {
            sync_source: "mode",
            failure_scope: "report",
          },
          extra: {
            runId: run.id,
            reportToken: report.reportToken,
            reportName: report.name,
            message,
          },
        });
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

    if (status === "success" || status === "partial") {
      Sentry.captureMessage("Mode sync completed", {
        level: "info",
        tags: {
          sync_source: "mode",
          status,
        },
        extra: {
          runId: run.id,
          recordsSynced: totalRecords,
        },
      });
    }

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
