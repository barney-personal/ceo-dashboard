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
  category?: string
): Promise<ReportData[]> {
  return withDatabaseReadFallback(
    `load report data for ${section}${category ? `/${category}` : ""}`,
    [],
    async () => {
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
  );
}

/**
 * Extract a single metric value from synced data.
 * Looks for the first row of the first matching query and returns the column value.
 */
export async function getMetricValue(
  section: DashboardSection,
  category: string,
  queryName: string,
  columnName: string
): Promise<unknown | null> {
  const data = await getReportData(section, category);
  const match = data.find((d) => d.queryName === queryName);
  if (!match || match.rows.length === 0) return null;
  return match.rows[0][columnName] ?? null;
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
