import {
  claimQueuedSyncRun,
  finalizeSyncRun,
  formatSyncError,
  isSyncRunCancelled,
  startSyncHeartbeat,
  type SyncLogRow,
} from "./coordinator";
import { runModeSync } from "./mode";
import { runSlackSync } from "./slack";
import { runManagementAccountsSync } from "./management-accounts";
import { type SyncSource } from "./config";
import { isSchemaCompatibilityError } from "@/lib/db/errors";

type SyncRunResult = {
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
};

type SyncRunner = (
  run: { id: number },
  opts?: { shouldStop?: () => boolean }
) => Promise<SyncRunResult>;

const RUNNERS: Record<SyncSource, SyncRunner> = {
  mode: runModeSync,
  slack: runSlackSync,
  "management-accounts": runManagementAccountsSync,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWorkerId(prefix: string): string {
  return `${prefix}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

// How often to poll the DB for an externally-triggered cancellation while a
// sync is in-flight. Kept short enough to stop work promptly, but long enough
// not to hammer the DB on every tick.
const DB_CANCEL_POLL_MS = 5_000;

export async function runClaimedSync(
  run: SyncLogRow,
  opts: { shouldStop?: () => boolean } = {}
): Promise<SyncRunResult> {
  // DB-backed cancellation: poll the syncLog row so that a /api/sync/cancel
  // request stops in-flight work promptly instead of only changing the row
  // after the runner completes.
  let cancelledByDb = false;
  const cancelPollInterval = setInterval(() => {
    void isSyncRunCancelled(run.id).then((cancelled) => {
      if (cancelled) cancelledByDb = true;
    });
  }, DB_CANCEL_POLL_MS);
  cancelPollInterval.unref?.();

  const combinedShouldStop = () =>
    cancelledByDb || (opts.shouldStop?.() ?? false);

  const stopHeartbeat = startSyncHeartbeat(run);

  try {
    const runner = RUNNERS[run.source as SyncSource];
    const result = await runner(run, { shouldStop: combinedShouldStop });
    clearInterval(cancelPollInterval);
    await stopHeartbeat();

    const { finalized } = await finalizeSyncRun(run.id, {
      status: result.status,
      recordsSynced: result.recordsSynced,
      errorMessage: result.errors.length > 0 ? result.errors.join("\n") : null,
    });

    if (!finalized) {
      // The row was already transitioned to a terminal state (e.g. cancelled)
      // while the runner was executing. Return cancelled so callers see the
      // correct outcome rather than the stale runner result.
      return { status: "cancelled", recordsSynced: 0, errors: [] };
    }

    return result;
  } catch (error) {
    clearInterval(cancelPollInterval);
    const message = formatSyncError(error);
    await stopHeartbeat();
    await finalizeSyncRun(run.id, {
      status: "error",
      recordsSynced: 0,
      errorMessage: message,
    });
    throw error;
  }
}

export async function drainSyncQueue(
  workerId: string,
  opts: {
    source?: SyncSource;
    shouldStop?: () => boolean;
  } = {}
): Promise<number> {
  let processed = 0;

  while (!opts.shouldStop?.()) {
    const claimed = await claimQueuedSyncRun(workerId, opts.source);
    if (!claimed) {
      break;
    }

    await runClaimedSync(claimed, opts);
    processed++;
  }

  return processed;
}

export async function runSyncWorker(
  workerId: string,
  opts: {
    pollMs?: number;
    shouldStop?: () => boolean;
  } = {}
): Promise<void> {
  const pollMs = opts.pollMs ?? 5_000;

  while (!opts.shouldStop?.()) {
    try {
      const processed = await drainSyncQueue(workerId, opts);
      if (processed === 0) {
        await sleep(pollMs);
      }
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) {
        throw error;
      }

      console.warn(
        `[sync-worker] database schema is not ready yet, retrying in ${pollMs}ms`,
        error
      );
      await sleep(pollMs);
    }
  }
}
