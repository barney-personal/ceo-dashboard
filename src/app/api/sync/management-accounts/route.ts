import { NextRequest, NextResponse } from "next/server";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import {
  authorizeSyncRequestWithIdentity,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import {
  manualSyncRateLimitKey,
  manualSyncRateLimiter,
  rateLimitErrorResponse,
} from "@/lib/sync/rate-limit";
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
    const identity = await authorizeSyncRequestWithIdentity(
      request,
      "admin.status",
    );
    const accessError = syncRequestAccessErrorResponse(identity.access);
    if (accessError) {
      return accessError;
    }

    if (identity.access === "manual") {
      const decision = manualSyncRateLimiter.check(
        manualSyncRateLimitKey("management-accounts", identity.userId)
      );
      if (!decision.ok) {
        return rateLimitErrorResponse(
          decision.retryAfterSeconds,
          "management-accounts"
        );
      }
    }

    const trigger = identity.access === "cron" ? "cron" : "manual";

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
        triggerLabel: `${identity.access} management-accounts sync request`,
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
