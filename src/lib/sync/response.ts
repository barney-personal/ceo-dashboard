import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { EnqueueSyncResult } from "@/lib/sync/coordinator";

export interface SerializedEnqueueSyncResult {
  outcome: EnqueueSyncResult["outcome"];
  runId: number | null;
  reason: string | null;
  nextEligibleAt: string | null;
  activeScopeDescription?: string;
}

export function serializeEnqueueSyncResult(
  result: EnqueueSyncResult
): SerializedEnqueueSyncResult {
  const serialized: SerializedEnqueueSyncResult = {
    outcome: result.outcome,
    runId: result.runId,
    reason: result.reason,
    nextEligibleAt: result.nextEligibleAt?.toISOString() ?? null,
  };

  if (result.activeScopeDescription) {
    serialized.activeScopeDescription = result.activeScopeDescription;
  }

  return serialized;
}

export function unexpectedSyncRouteErrorResponse(route: string, error: unknown) {
  Sentry.captureException(error, { extra: { route } });
  console.error(`[sync-api] unexpected ${route} route error`, error);

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
