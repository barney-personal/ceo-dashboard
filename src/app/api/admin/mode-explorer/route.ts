import { NextResponse, type NextRequest } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/sync/request-auth";
import { db } from "@/lib/db";
import { modeReportData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const auth = await requireRole("ceo");
  const authError = authErrorResponse(auth);
  if (authError) return authError;

  const queryId = request.nextUrl.searchParams.get("queryId");
  if (!queryId) {
    return NextResponse.json({ error: "queryId is required" }, { status: 400 });
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
