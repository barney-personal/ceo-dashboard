import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { debugLogs } from "@/lib/db/schema";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";

export async function GET(request: NextRequest) {
  const access = await authorizeSyncRequest(request);
  const accessError = syncRequestAccessErrorResponse(access);
  if (accessError) {
    return accessError;
  }

  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const event = url.searchParams.get("event");
  const level = url.searchParams.get("level");
  const syncRunId = url.searchParams.get("syncRunId");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
    500
  );

  const conditions = [];
  if (source) {
    conditions.push(eq(debugLogs.source, source));
  }
  if (event) {
    conditions.push(eq(debugLogs.event, event));
  }
  if (level) {
    conditions.push(eq(debugLogs.level, level));
  }
  if (syncRunId) {
    const parsed = parseInt(syncRunId, 10);
    if (!isNaN(parsed)) {
      conditions.push(eq(debugLogs.syncRunId, parsed));
    }
  }

  const logs = await db
    .select()
    .from(debugLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(debugLogs.createdAt))
    .limit(limit);

  return NextResponse.json({
    count: logs.length,
    logs,
  });
}
