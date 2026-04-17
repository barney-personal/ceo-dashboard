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
import { validateModeReportSyncTarget } from "@/lib/sync/mode";

export async function POST(request: NextRequest) {
  try {
    const access = await authorizeSyncRequest(request);
    const accessError = syncRequestAccessErrorResponse(access);
    if (accessError) {
      return accessError;
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const validation = await validateModeReportSyncTarget(
      (body as { reportToken?: unknown } | null)?.reportToken
    );
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const trigger = access === "cron" ? "cron" : "manual";
    const force = request.nextUrl.searchParams.get("force") === "1";
    const result = await enqueueSyncRun("mode", {
      trigger,
      force,
      scope: { reportToken: validation.report.reportToken },
    });

    const serialized = serializeEnqueueSyncResult(result);

    if (result.outcome === "queued" || result.outcome === "forced") {
      const workerId = createWorkerId("web-mode");
      const { started } = startBackgroundSyncDrain(workerId, {
        source: "mode",
        runIds: result.runId != null ? [result.runId] : [],
        triggerLabel: `${access} mode report sync request (${validation.report.reportToken})`,
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
    return unexpectedSyncRouteErrorResponse("mode/report", error);
  }
}
