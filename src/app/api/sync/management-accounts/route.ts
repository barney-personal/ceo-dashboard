import { NextRequest, NextResponse } from "next/server";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import {
  serializeEnqueueSyncResult,
  unexpectedSyncRouteErrorResponse,
} from "@/lib/sync/response";
import { createWorkerId, startBackgroundSyncDrain } from "@/lib/sync/runtime";

export async function POST(request: NextRequest) {
  try {
    const access = await authorizeSyncRequest(request);
    const accessError = syncRequestAccessErrorResponse(access);
    if (accessError) {
      return accessError;
    }
    const trigger = access === "cron" ? "cron" : "manual";

    const force = request.nextUrl.searchParams.get("force") === "1";
    const result = await enqueueSyncRun("management-accounts", {
      trigger,
      force,
    });

    if (result.outcome === "queued" || result.outcome === "forced") {
      const workerId = createWorkerId("web-accounts");
      startBackgroundSyncDrain(workerId, {
        source: "management-accounts",
        runIds: result.runId != null ? [result.runId] : [],
        triggerLabel: `${access} management-accounts sync request`,
      });
    }

    return NextResponse.json(serializeEnqueueSyncResult(result));
  } catch (error) {
    return unexpectedSyncRouteErrorResponse("management-accounts", error);
  }
}
