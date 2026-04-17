import * as Sentry from "@sentry/nextjs";
import type { ZodType } from "zod";
import { db } from "@/lib/db";
import {
  DatabaseUnavailableError,
  isSchemaCompatibilityError,
  normalizeDatabaseError,
} from "@/lib/db/errors";
import { modeReports, modeReportData, syncLog } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { DashboardSection } from "@/lib/integrations/mode-config";

export interface ReportData {
  reportName: string;
  section: string;
  category: string | null;
  queryName: string;
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  syncedAt: Date;
}

export interface ColumnValidationResult<TColumn extends string = string> {
  expectedColumns: TColumn[];
  presentColumns: TColumn[];
  missingColumns: TColumn[];
  isValid: boolean;
}

export interface LatestTerminalSyncRun {
  status: string;
  completedAt: Date | null;
}

const REPORT_DATA_CACHE_TTL_MS = 60_000;
export const REPORT_DATA_CACHE_MAX_ENTRIES = 20;
const TERMINAL_SYNC_STATUSES = new Set([
  "success",
  "partial",
  "error",
  "cancelled",
]);
const STALE_EMPTY_STATE_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

type ReportDataCacheEntry =
  | {
      kind: "pending";
      promise: Promise<ReportData[]>;
    }
  | {
      kind: "resolved";
      expiresAt: number;
      value: ReportData[];
    };

// Map preserves insertion order: first entry = LRU, last entry = MRU.
const reportDataCache = new Map<string, ReportDataCacheEntry>();

function evictOneEntry(): void {
  // Prefer evicting a resolved entry (oldest first) so in-flight promises aren't wasted.
  for (const [key, entry] of reportDataCache) {
    if (entry.kind === "resolved") {
      reportDataCache.delete(key);
      return;
    }
  }
  // All entries are pending — evict the oldest one.
  const firstKey = reportDataCache.keys().next().value;
  if (firstKey !== undefined) {
    reportDataCache.delete(firstKey);
  }
}

async function withDatabaseReadFallback<T>(
  context: string,
  fallback: T,
  read: () => Promise<T>
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const normalized = normalizeDatabaseError(context, error);
    if (
      normalized instanceof DatabaseUnavailableError ||
      isSchemaCompatibilityError(error)
    ) {
      Sentry.captureException(normalized, {
        tags: { data_loader: "mode" },
        extra: { context, fallbackUsed: true },
      });
      console.error(`[data] ${context} degraded to fallback`, normalized);
      return fallback;
    }

    throw normalized;
  }
}

function getReportDataCacheKey(
  section: DashboardSection,
  category?: string
): string {
  return `${section}::${category ?? ""}`;
}

async function loadReportDataFromDatabase(
  section: DashboardSection,
  category?: string
): Promise<ReportData[]> {
  const conditions = [eq(modeReports.section, section)];
  if (category) {
    conditions.push(eq(modeReports.category, category));
  }

  const results = await db
    .select({
      reportName: modeReports.name,
      section: modeReports.section,
      category: modeReports.category,
      queryName: modeReportData.queryName,
      columns: modeReportData.columns,
      data: modeReportData.data,
      rowCount: modeReportData.rowCount,
      syncedAt: modeReportData.syncedAt,
    })
    .from(modeReportData)
    .innerJoin(modeReports, eq(modeReportData.reportId, modeReports.id))
    .where(and(...conditions))
    .orderBy(desc(modeReportData.syncedAt));

  return results.map((r) => ({
    reportName: r.reportName,
    section: r.section,
    category: r.category,
    queryName: r.queryName,
    columns: r.columns as Array<{ name: string; type: string }>,
    rows: r.data as Record<string, unknown>[],
    rowCount: r.rowCount,
    syncedAt: r.syncedAt,
  }));
}

async function getCachedReportData(
  section: DashboardSection,
  category?: string
): Promise<ReportData[]> {
  const cacheKey = getReportDataCacheKey(section, category);
  const entry = reportDataCache.get(cacheKey);

  if (entry?.kind === "pending") {
    // Refresh LRU position on hit (delete + re-insert moves to MRU end).
    reportDataCache.delete(cacheKey);
    reportDataCache.set(cacheKey, entry);
    return entry.promise;
  }

  if (entry?.kind === "resolved") {
    if (entry.expiresAt > Date.now()) {
      // Refresh LRU position on hit.
      reportDataCache.delete(cacheKey);
      reportDataCache.set(cacheKey, entry);
      return entry.value;
    }

    reportDataCache.delete(cacheKey);
  }

  if (reportDataCache.size >= REPORT_DATA_CACHE_MAX_ENTRIES) {
    evictOneEntry();
  }

  const pending = loadReportDataFromDatabase(section, category)
    .then((results) => {
      // Guard: only update if this pending entry is still the current one.
      const current = reportDataCache.get(cacheKey);
      if (current?.kind === "pending" && current.promise === pending) {
        reportDataCache.set(cacheKey, {
          kind: "resolved",
          expiresAt: Date.now() + REPORT_DATA_CACHE_TTL_MS,
          value: results,
        });
      }
      return results;
    })
    .catch((error) => {
      const current = reportDataCache.get(cacheKey);
      if (current?.kind === "pending" && current.promise === pending) {
        reportDataCache.delete(cacheKey);
      }

      throw error;
    });

  reportDataCache.set(cacheKey, {
    kind: "pending",
    promise: pending,
  });

  return pending;
}

export function validateModeColumns<TColumn extends string>({
  row,
  expectedColumns,
  reportName,
  queryName,
}: {
  row: Record<string, unknown> | null | undefined;
  expectedColumns: readonly TColumn[];
  reportName: string;
  queryName: string;
}): ColumnValidationResult<TColumn> {
  const uniqueExpectedColumns = [...new Set(expectedColumns)] as TColumn[];
  const sourceRow = row ?? {};
  const presentColumns = uniqueExpectedColumns.filter((column) =>
    Object.prototype.hasOwnProperty.call(sourceRow, column)
  );
  const missingColumns = uniqueExpectedColumns.filter(
    (column) => !Object.prototype.hasOwnProperty.call(sourceRow, column)
  );
  const result: ColumnValidationResult<TColumn> = {
    expectedColumns: uniqueExpectedColumns,
    presentColumns,
    missingColumns,
    isValid: missingColumns.length === 0,
  };

  if (!result.isValid) {
    Sentry.captureMessage("Mode schema drift: missing expected columns", {
      level: "warning",
      tags: {
        data_loader: "mode",
        validation_scope: "columns",
      },
      extra: {
        reportName,
        queryName,
        expectedColumns: result.expectedColumns,
        presentColumns: result.presentColumns,
        missingColumns: result.missingColumns,
      },
    });
  }

  return result;
}

const SCHEMA_DRIFT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const schemaDriftLastWarned = new Map<string, number>();

function validateExpectedQueries({
  reportData,
  expectedQueries,
  section,
  category,
}: {
  reportData: ReportData[];
  expectedQueries: readonly string[];
  section: DashboardSection;
  category?: string;
}): void {
  const uniqueExpectedQueries = [...new Set(expectedQueries)];
  if (uniqueExpectedQueries.length === 0) {
    return;
  }

  const availableQueryNames = new Set(reportData.map((entry) => entry.queryName));
  const missingQueries = uniqueExpectedQueries.filter(
    (queryName) => !availableQueryNames.has(queryName)
  );

  if (missingQueries.length === 0) {
    return;
  }

  const cacheKey = `${section}:${category ?? ""}:${missingQueries.join(",")}`;
  const lastWarned = schemaDriftLastWarned.get(cacheKey) ?? 0;
  if (Date.now() - lastWarned < SCHEMA_DRIFT_COOLDOWN_MS) {
    return;
  }
  schemaDriftLastWarned.set(cacheKey, Date.now());

  Sentry.captureMessage("Mode schema drift: missing expected queries", {
    level: "warning",
    tags: {
      data_loader: "mode",
      validation_scope: "queries",
      section,
      ...(category ? { category } : {}),
    },
    extra: {
      section,
      category: category ?? null,
      missingQueries,
      availableQueryNames: [...availableQueryNames],
      reportNames: [...new Set(reportData.map((entry) => entry.reportName))],
    },
  });
}

/**
 * Get all synced report data for a dashboard section.
 * Optionally filter by category (e.g. 'ltv', 'cac').
 */
export async function getReportData(
  section: DashboardSection,
  category?: string,
  expectedQueries: readonly string[] = []
): Promise<ReportData[]> {
  return withDatabaseReadFallback(
    `load report data for ${section}${category ? `/${category}` : ""}`,
    [],
    async () => {
      const reportData = await getCachedReportData(section, category);
      validateExpectedQueries({
        reportData,
        expectedQueries,
        section,
        category,
      });
      return reportData;
    }
  );
}

export function resetReportDataCacheForTests(): void {
  reportDataCache.clear();
  schemaDriftLastWarned.clear();
}

export interface ParseRowsResult<T> {
  valid: T[];
  invalidCount: number;
}

/**
 * Validate a batch of Mode rows against a zod schema. Invalid rows are
 * skipped and counted; a single Sentry breadcrumb is emitted per batch
 * (never per row) with a PII-safe preview of the first invalid row. Every
 * invalid batch emits — there is no cross-batch cooldown, so repeated
 * malformed batches from the same report/query remain observable.
 *
 * Use this at loader boundaries to replace ad-hoc `as number` / `as string`
 * casts on JSONB row data.
 */
export function parseRows<T>(
  schema: ZodType<T>,
  rows: readonly Record<string, unknown>[],
  context: {
    reportName?: string;
    queryName: string;
  }
): ParseRowsResult<T> {
  const valid: T[] = [];
  let invalidCount = 0;
  let firstInvalidRow: Record<string, unknown> | null = null;
  let firstInvalidMessage: string | null = null;

  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
      continue;
    }

    invalidCount += 1;
    if (firstInvalidRow === null) {
      firstInvalidRow = row;
      firstInvalidMessage = result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
    }
  }

  if (invalidCount > 0) {
    Sentry.captureMessage("Mode row validation failure", {
      level: "warning",
      tags: {
        data_loader: "mode",
        validation_failure: "true",
        ...(context.reportName ? { reportName: context.reportName } : {}),
        queryName: context.queryName,
      },
      extra: {
        reportName: context.reportName ?? null,
        queryName: context.queryName,
        invalidCount,
        totalRows: rows.length,
        firstInvalidFieldNames: firstInvalidRow
          ? Object.keys(firstInvalidRow)
          : [],
        firstInvalidIssues: firstInvalidMessage,
      },
    });
  }

  return { valid, invalidCount };
}

/**
 * Safely extract a string value from a report row.
 * Returns "" if the key is absent, null, or not a string.
 */
export function rowStr(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : v != null ? String(v) : "";
}

/**
 * Safely extract a number value from a report row.
 * Returns `fallback` (default 0) if the key is absent, null, or not a number.
 */
export function rowNum(
  row: Record<string, unknown>,
  key: string,
  fallback = 0
): number {
  const v = row[key];
  return typeof v === "number" ? v : fallback;
}

/**
 * Safely extract a nullable number value from a report row.
 * Returns null if the key is absent, null, or not a number.
 */
export function rowNumOrNull(
  row: Record<string, unknown>,
  key: string
): number | null {
  const v = row[key];
  return typeof v === "number" ? v : null;
}

/**
 * Get the last successful sync time for a source.
 */
export async function getLastSyncTime(
  source: string = "mode"
): Promise<Date | null> {
  return withDatabaseReadFallback(`load last sync time for ${source}`, null, async () => {
    const result = await db
      .select({ completedAt: syncLog.completedAt })
      .from(syncLog)
      .where(and(eq(syncLog.source, source), eq(syncLog.status, "success")))
      .orderBy(desc(syncLog.completedAt))
      .limit(1);

    return result[0]?.completedAt ?? null;
  });
}

export async function getLatestTerminalSyncRun(
  source: string = "mode"
): Promise<LatestTerminalSyncRun | null> {
  return withDatabaseReadFallback(
    `load latest terminal sync run for ${source}`,
    null,
    async () => {
      const result = await db
        .select({
          status: syncLog.status,
          completedAt: syncLog.completedAt,
          startedAt: syncLog.startedAt,
        })
        .from(syncLog)
        .where(eq(syncLog.source, source))
        .orderBy(desc(syncLog.startedAt));

      const latestTerminal = result.find((run) =>
        TERMINAL_SYNC_STATUSES.has(run.status)
      );

      if (!latestTerminal) {
        return null;
      }

      return {
        status: latestTerminal.status,
        completedAt: latestTerminal.completedAt ?? latestTerminal.startedAt ?? null,
      };
    }
  );
}

function formatFailedSyncTimestamp(timestamp: Date | null): string {
  if (!timestamp) {
    return "an unknown time";
  }

  return `${STALE_EMPTY_STATE_DATE_FORMATTER.format(timestamp)} UTC`;
}

/**
 * Pure synchronous helper — resolves the empty-state copy based on whether
 * the specific chart/loader result is empty and the latest sync status.
 *
 * Use this (with a pre-fetched latestSyncRun) so the check is keyed off the
 * actual rendered data, not the raw report/category row presence. This means
 * partial Mode payloads (e.g. Query 3 missing while other queries exist) still
 * surface the stale-failure message for the affected chart.
 */
export function resolveModeStaleReason(
  isDataEmpty: boolean,
  latestSyncRun: LatestTerminalSyncRun | null,
  emptyReason: string
): string {
  if (isDataEmpty && latestSyncRun?.status === "error") {
    return `Data temporarily unavailable — last sync failed at ${formatFailedSyncTimestamp(latestSyncRun.completedAt)}`;
  }

  return emptyReason;
}

export async function getModeEmptyStateReason({
  section,
  category,
  emptyReason,
  source = "mode",
}: {
  section: DashboardSection;
  category: string;
  emptyReason: string;
  source?: string;
}): Promise<string> {
  const [reportData, latestSyncRun] = await Promise.all([
    getReportData(section, category),
    getLatestTerminalSyncRun(source),
  ]);

  return resolveModeStaleReason(reportData.length === 0, latestSyncRun, emptyReason);
}
