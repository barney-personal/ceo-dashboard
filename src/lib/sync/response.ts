import { NextResponse } from "next/server";
import type { EnqueueSyncResult } from "@/lib/sync/coordinator";

export interface SerializedEnqueueSyncResult {
  outcome: EnqueueSyncResult["outcome"];
  runId: number | null;
  reason: string | null;
  nextEligibleAt: string | null;
}

export function serializeEnqueueSyncResult(
  result: EnqueueSyncResult
): SerializedEnqueueSyncResult {
  return {
    outcome: result.outcome,
    runId: result.runId,
    reason: result.reason,
    nextEligibleAt: result.nextEligibleAt?.toISOString() ?? null,
  };
}

export function unexpectedSyncRouteErrorResponse(route: string, error: unknown) {
  console.error(`[sync-api] unexpected ${route} route error`, error);

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
