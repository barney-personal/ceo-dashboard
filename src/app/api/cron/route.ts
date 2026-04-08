import { NextRequest, NextResponse } from "next/server";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import { createWorkerId, drainSyncQueue } from "@/lib/sync/runtime";
import { isCronRequest } from "@/lib/sync/request-auth";

export async function GET(request: NextRequest) {
  if (!(await isCronRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [mode, slack, managementAccounts] = await Promise.all([
    enqueueSyncRun("mode", { trigger: "cron" }),
    enqueueSyncRun("slack", { trigger: "cron" }),
    enqueueSyncRun("management-accounts", { trigger: "cron" }),
  ]);

  if ([mode, slack, managementAccounts].some((result) => result.outcome !== "skipped")) {
    void drainSyncQueue(createWorkerId("web-cron"));
  }

  return NextResponse.json({
    status: "syncs enqueued",
    results: {
      mode: {
        outcome: mode.outcome,
        runId: mode.runId,
        reason: mode.reason,
        nextEligibleAt: mode.nextEligibleAt?.toISOString() ?? null,
      },
      slack: {
        outcome: slack.outcome,
        runId: slack.runId,
        reason: slack.reason,
        nextEligibleAt: slack.nextEligibleAt?.toISOString() ?? null,
      },
      managementAccounts: {
        outcome: managementAccounts.outcome,
        runId: managementAccounts.runId,
        reason: managementAccounts.reason,
        nextEligibleAt: managementAccounts.nextEligibleAt?.toISOString() ?? null,
      },
    },
  });
}
