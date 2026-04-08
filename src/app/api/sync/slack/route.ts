import { NextRequest, NextResponse } from "next/server";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import { serializeEnqueueSyncResult } from "@/lib/sync/response";
import { createWorkerId, startBackgroundSyncDrain } from "@/lib/sync/runtime";

export async function POST(request: NextRequest) {
  const access = await authorizeSyncRequest(request);
  const accessError = syncRequestAccessErrorResponse(access);
  if (accessError) {
    return accessError;
  }
  const trigger = access === "cron" ? "cron" : "manual";

  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await enqueueSyncRun("slack", {
    trigger,
    force,
  });

  if (result.outcome === "queued" || result.outcome === "forced") {
    const workerId = createWorkerId("web-slack");
    startBackgroundSyncDrain(workerId, {
      source: "slack",
      runIds: result.runId != null ? [result.runId] : [],
      triggerLabel: `${access} slack sync request`,
    });
  }

  return NextResponse.json(serializeEnqueueSyncResult(result));
}
