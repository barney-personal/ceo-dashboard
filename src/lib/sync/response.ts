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
