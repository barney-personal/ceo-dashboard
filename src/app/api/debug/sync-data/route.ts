import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { modeReports, modeReportData, debugLogs } from "@/lib/db/schema";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";

const GROWTH_MARKETING_REPORT_NAME = "Growth Marketing Performance";

export async function GET(request: NextRequest) {
  const access = await authorizeSyncRequest(request);
  const accessError = syncRequestAccessErrorResponse(access);
  if (accessError) {
    return accessError;
  }

  const reports = await db.select().from(modeReports);

  const reportSummaries = await Promise.all(
    reports.map(async (report) => {
      const queries = await db
        .select()
        .from(modeReportData)
        .where(eq(modeReportData.reportId, report.id));

      return {
        reportId: report.id,
        reportToken: report.reportToken,
        name: report.name,
        section: report.section,
        category: report.category,
        isActive: report.isActive,
        isGrowthMarketing: report.name === GROWTH_MARKETING_REPORT_NAME,
        queries: queries.map((q) => {
          const rows = Array.isArray(q.data) ? (q.data as Record<string, unknown>[]) : [];
          const columns = Array.isArray(q.columns)
            ? (q.columns as { name: string; type?: string }[])
            : [];

          return {
            queryToken: q.queryToken,
            queryName: q.queryName,
            rowCount: q.rowCount,
            sourceRowCount: q.sourceRowCount,
            storedRowCount: q.storedRowCount,
            truncated: q.truncated,
            syncedAt: q.syncedAt,
            columnNames: columns.map((c) => c.name),
            columns,
            sampleRows: rows.slice(0, 2),
          };
        }),
      };
    })
  );

  // Pull out the Growth Marketing report for prominence
  const growthMarketing = reportSummaries.find((r) => r.isGrowthMarketing);
  const ltvPaidCacQuery = growthMarketing?.queries.find(
    (q) => q.queryName === "LTV:Paid CAC"
  );

  const recentLogs = await db
    .select()
    .from(debugLogs)
    .orderBy(desc(debugLogs.createdAt))
    .limit(100);

  return NextResponse.json({
    summary: {
      totalReports: reports.length,
      activeReports: reports.filter((r) => r.isActive).length,
      totalQueries: reportSummaries.reduce(
        (sum, r) => sum + r.queries.length,
        0
      ),
    },
    highlight: {
      description:
        'Growth Marketing Performance report — source of "LTV:Paid CAC" query used by getLtvCacRatioSeries()',
      report: growthMarketing
        ? {
            name: growthMarketing.name,
            section: growthMarketing.section,
            category: growthMarketing.category,
            isActive: growthMarketing.isActive,
          }
        : null,
      ltvPaidCacQuery: ltvPaidCacQuery
        ? {
            queryName: ltvPaidCacQuery.queryName,
            rowCount: ltvPaidCacQuery.rowCount,
            sourceRowCount: ltvPaidCacQuery.sourceRowCount,
            storedRowCount: ltvPaidCacQuery.storedRowCount,
            truncated: ltvPaidCacQuery.truncated,
            syncedAt: ltvPaidCacQuery.syncedAt,
            columnNames: ltvPaidCacQuery.columnNames,
            sampleRows: ltvPaidCacQuery.sampleRows,
          }
        : null,
      lookupPath:
        'getReportData("unit-economics", "cac") -> query.queryName === "LTV:Paid CAC"',
    },
    reports: reportSummaries,
    debugLogs: recentLogs,
  });
}
