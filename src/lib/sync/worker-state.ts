import type { SyncSource } from "./config";

type LocalSyncRunState = {
  runId: number;
  source: SyncSource;
  workerId: string | null;
};

const localActiveSyncRuns = new Map<number, LocalSyncRunState>();

export function protectLocalSyncRun(input: {
  runId: number;
  source: SyncSource;
  workerId?: string | null;
}): void {
  localActiveSyncRuns.set(input.runId, {
    runId: input.runId,
    source: input.source,
    workerId: input.workerId ?? null,
  });
}

export function releaseLocalSyncRun(runId: number): void {
  localActiveSyncRuns.delete(runId);
}

export function isLocalSyncRunProtected(input: {
  runId: number;
  workerId?: string | null;
}): boolean {
  const activeRun = localActiveSyncRuns.get(input.runId);
  if (!activeRun) {
    return false;
  }

  if (!input.workerId || !activeRun.workerId) {
    return true;
  }

  return input.workerId === activeRun.workerId;
}

export function resetLocalSyncRunProtectionForTest(): void {
  localActiveSyncRuns.clear();
}
