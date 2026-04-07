import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { syncAllModeReports } from "@/lib/sync/mode";

const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // Check if Mode sync is due
  const lastModeSync = await db
    .select()
    .from(syncLog)
    .where(eq(syncLog.source, "mode"))
    .orderBy(desc(syncLog.startedAt))
    .limit(1);

  const lastSyncTime = lastModeSync[0]?.startedAt;
  const isDue =
    !lastSyncTime ||
    Date.now() - lastSyncTime.getTime() > SYNC_INTERVAL_MS;

  if (isDue) {
    try {
      results.mode = await syncAllModeReports();
    } catch (err) {
      results.mode = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    results.mode = { skipped: true, lastSync: lastSyncTime };
  }

  return NextResponse.json({ synced: results });
}
