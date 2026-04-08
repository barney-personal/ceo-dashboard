import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { syncAllModeReports } from "@/lib/sync/mode";
import { syncAllSlackOkrs } from "@/lib/sync/slack";
import { syncManagementAccounts } from "@/lib/sync/management-accounts";

const MODE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const SLACK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MGMT_ACCOUNTS_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily

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

  const results: Record<string, string> = {};

  // Mode sync (every 4 hours)
  const lastModeSync = await getLastSyncTime("mode");
  if (!lastModeSync || Date.now() - lastModeSync.getTime() > MODE_INTERVAL_MS) {
    results.mode = "triggered";
    syncAllModeReports()
      .then((r) => console.log("Cron: Mode sync finished", r))
      .catch((err) => console.error("Cron: Mode sync failed", err));
  } else {
    results.mode = "skipped";
  }

  // Slack OKR sync (every 2 hours)
  const lastSlackSync = await getLastSyncTime("slack");
  if (!lastSlackSync || Date.now() - lastSlackSync.getTime() > SLACK_INTERVAL_MS) {
    results.slack = "triggered";
    syncAllSlackOkrs()
      .then((r) => console.log("Cron: Slack sync finished", r))
      .catch((err) => console.error("Cron: Slack sync failed", err));
  } else {
    results.slack = "skipped";
  }

  // Management accounts sync (daily)
  const lastMgmtSync = await getLastSyncTime("management-accounts");
  if (!lastMgmtSync || Date.now() - lastMgmtSync.getTime() > MGMT_ACCOUNTS_INTERVAL_MS) {
    results.managementAccounts = "triggered";
    syncManagementAccounts()
      .then((r) => console.log("Cron: Management accounts sync finished", r))
      .catch((err) => console.error("Cron: Management accounts sync failed", err));
  } else {
    results.managementAccounts = "skipped";
  }

  return NextResponse.json({ status: "syncs triggered", results });
}
