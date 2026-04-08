import { db } from "@/lib/db";
import {
  DatabaseUnavailableError,
  isSchemaCompatibilityError,
  normalizeDatabaseError,
} from "@/lib/db/errors";
import { modeReports, modeReportData, syncLog } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  MODE_REPORT_MAP,
  type DashboardSection,
} from "@/lib/integrations/mode-config";

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

async function withDatabaseReadFallback<T>(
  context: string,
  fallback: T,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const normalized = normalizeDatabaseError(context, error);
    if (
      normalized instanceof DatabaseUnavailableError ||
      isSchemaCompatibilityError(error)
    ) {
      console.error(`[data] ${context} degraded to fallback`, normalized);
      return fallback;
    }

    throw normalized;
  }
}

/**
 * Get all synced report data for a dashboard section.
 * Optionally filter by category (e.g. 'ltv', 'cac').
 */
export async function getReportData(
  section: DashboardSection,
  category?: string,
): Promise<ReportData[]> {
  return withDatabaseReadFallback(
    `load report data for ${section}${category ? `/${category}` : ""}`,
    [],
    async () => {
      const reportTokens = MODE_REPORT_MAP.filter(
        (report) =>
          report.section === section &&
          (!category || report.category === category),
      ).map((report) => report.reportToken);

      if (reportTokens.length === 0) {
        return [];
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
        .where(and(inArray(modeReports.reportToken, reportTokens)))
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
    },
  );
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
  fallback = 0,
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
  key: string,
): number | null {
  const v = row[key];
  return typeof v === "number" ? v : null;
}

/**
 * Get the last successful sync time for a source.
 */
export async function getLastSyncTime(
  source: string = "mode",
): Promise<Date | null> {
  return withDatabaseReadFallback(
    `load last sync time for ${source}`,
    null,
    async () => {
      const result = await db
        .select({ completedAt: syncLog.completedAt })
        .from(syncLog)
        .where(and(eq(syncLog.source, source), eq(syncLog.status, "success")))
        .orderBy(desc(syncLog.completedAt))
        .limit(1);

      return result[0]?.completedAt ?? null;
    },
  );
}
