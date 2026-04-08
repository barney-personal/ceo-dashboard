import { NextRequest, NextResponse } from "next/server";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import { authorizeSyncRequest } from "@/lib/sync/request-auth";
import { createWorkerId, drainSyncQueue } from "@/lib/sync/runtime";

export async function POST(request: NextRequest) {
  const access = await authorizeSyncRequest(request);
  if (access === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (access === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await enqueueSyncRun("management-accounts", {
    trigger: access,
    force,
  });

  if (result.outcome === "queued" || result.outcome === "forced") {
    void drainSyncQueue(createWorkerId("web-accounts"), {
      source: "management-accounts",
    });
  }

  return NextResponse.json({
    outcome: result.outcome,
    runId: result.runId,
    reason: result.reason,
    nextEligibleAt: result.nextEligibleAt?.toISOString() ?? null,
  });
}
