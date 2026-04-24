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
import {
  awaitDrainStarted,
  createWorkerId,
  startBackgroundSyncDrain,
} from "@/lib/sync/runtime";

export async function POST(request: NextRequest) {
  try {
    const access = await authorizeSyncRequest(request, "admin.status");
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

    const serialized = serializeEnqueueSyncResult(result);

    if (result.outcome === "queued" || result.outcome === "forced") {
      const workerId = createWorkerId("web-accounts");
      const { started } = startBackgroundSyncDrain(workerId, {
        source: "management-accounts",
        runIds: result.runId != null ? [result.runId] : [],
        triggerLabel: `${access} management-accounts sync request`,
      });
      const drainState = await awaitDrainStarted(started);
      if (drainState === "failed") {
        return NextResponse.json(
          { ...serialized, drain_started: false },
          { status: 503 }
        );
      }
      return NextResponse.json({
        ...serialized,
        drain_started: drainState === "started" ? true : "pending",
      });
    }

    return NextResponse.json(serialized);
  } catch (error) {
    return unexpectedSyncRouteErrorResponse("management-accounts", error);
  }
}
