import { NextResponse, type NextRequest } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/sync/request-auth";
import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const auth = await requireRole("ceo");
  const authError = authErrorResponse(auth);
  if (authError) return authError;

  const { searchParams } = request.nextUrl;
  const reportId = searchParams.get("reportId");

  // If no reportId, return list of reports with their queries
  if (!reportId) {
    const reports = await db.select().from(modeReports).orderBy(modeReports.section, modeReports.name);

    const queries = await db
      .select({
        id: modeReportData.id,
        reportId: modeReportData.reportId,
        queryToken: modeReportData.queryToken,
        queryName: modeReportData.queryName,
        rowCount: modeReportData.rowCount,
        sourceRowCount: modeReportData.sourceRowCount,
        storedRowCount: modeReportData.storedRowCount,
        truncated: modeReportData.truncated,
        storageWindow: modeReportData.storageWindow,
        columns: modeReportData.columns,
        syncedAt: modeReportData.syncedAt,
      })
      .from(modeReportData);

    return NextResponse.json({ reports, queries });
  }

  // Return full data for a specific report's query
  const queryId = searchParams.get("queryId");
  if (!queryId) {
    return NextResponse.json({ error: "queryId is required when reportId is provided" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(modeReportData)
    .where(eq(modeReportData.id, parseInt(queryId, 10)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Query data not found" }, { status: 404 });
  }

  return NextResponse.json({
    queryName: row.queryName,
    columns: row.columns,
    data: row.data,
    rowCount: row.rowCount,
    sourceRowCount: row.sourceRowCount,
    storedRowCount: row.storedRowCount,
    truncated: row.truncated,
    storageWindow: row.storageWindow,
    syncedAt: row.syncedAt,
  });
}
