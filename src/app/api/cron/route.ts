import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { syncAllModeReports } from "@/lib/sync/mode";
import { syncAllSlackOkrs } from "@/lib/sync/slack";

const MODE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const SLACK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function getLastSyncTime(source: string): Promise<Date | null> {
  const result = await db
    .select({ startedAt: syncLog.startedAt })
    .from(syncLog)
    .where(eq(syncLog.source, source))
    .orderBy(desc(syncLog.startedAt))
    .limit(1);
  return result[0]?.startedAt ?? null;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // Mode sync (every 4 hours)
  const lastModeSync = await getLastSyncTime("mode");
  if (!lastModeSync || Date.now() - lastModeSync.getTime() > MODE_INTERVAL_MS) {
    try {
      results.mode = await syncAllModeReports();
    } catch (err) {
      results.mode = { error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    results.mode = { skipped: true, lastSync: lastModeSync };
  }

  // Slack OKR sync (every 2 hours)
  const lastSlackSync = await getLastSyncTime("slack");
  if (!lastSlackSync || Date.now() - lastSlackSync.getTime() > SLACK_INTERVAL_MS) {
    try {
      results.slack = await syncAllSlackOkrs();
    } catch (err) {
      results.slack = { error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    results.slack = { skipped: true, lastSync: lastSlackSync };
  }

  return NextResponse.json({ synced: results });
}
