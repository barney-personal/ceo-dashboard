import { NextRequest, NextResponse } from "next/server";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import { createWorkerId, startBackgroundSyncDrain } from "@/lib/sync/runtime";
import { isCronRequest } from "@/lib/sync/request-auth";
import {
  serializeEnqueueSyncResult,
  unexpectedSyncRouteErrorResponse,
} from "@/lib/sync/response";
import { cleanupDebugLogs } from "@/lib/debug-logger";

export async function GET(request: NextRequest) {
  try {
    if (!(await isCronRequest(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Clean up debug logs older than 24 hours to prevent unbounded growth
    try {
      await cleanupDebugLogs();
    } catch (error) {
      console.error("Failed to clean up debug logs", error);
    }

    const [mode, slack, managementAccounts] = await Promise.all([
      enqueueSyncRun("mode", { trigger: "cron" }),
      enqueueSyncRun("slack", { trigger: "cron" }),
      enqueueSyncRun("management-accounts", { trigger: "cron" }),
    ]);

    if ([mode, slack, managementAccounts].some((result) => result.outcome !== "skipped")) {
      const workerId = createWorkerId("web-cron");
      const runIds = [mode.runId, slack.runId, managementAccounts.runId].filter(
        (runId): runId is number => runId != null
      );
      startBackgroundSyncDrain(workerId, {
        runIds,
        triggerLabel: "cron trigger",
      });
    }

    return NextResponse.json({
      status: "syncs enqueued",
      results: {
        mode: serializeEnqueueSyncResult(mode),
        slack: serializeEnqueueSyncResult(slack),
        managementAccounts: serializeEnqueueSyncResult(managementAccounts),
      },
    });
  } catch (error) {
    return unexpectedSyncRouteErrorResponse("cron", error);
  }
}
