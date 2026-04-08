import {
  claimQueuedSyncRun,
  finalizeSyncRun,
  formatSyncError,
  markSyncRunsFailed,
  startSyncHeartbeat,
  type SyncLogRow,
} from "./coordinator";
import { runModeSync } from "./mode";
import { runSlackSync } from "./slack";
import { runManagementAccountsSync } from "./management-accounts";
import { getSyncSourceConfig, type SyncSource } from "./config";
import { isSchemaCompatibilityError } from "@/lib/db/errors";
import {
  SyncDeadlineExceededError,
  isSyncDeadlineExceededError,
  type SyncControl,
  type SyncStopReason,
} from "./errors";

type SyncRunResult = {
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
};

type SyncRunner = (
  run: { id: number },
  opts?: SyncControl
) => Promise<SyncRunResult>;

const RUNNERS: Record<SyncSource, SyncRunner> = {
  mode: runModeSync,
  slack: runSlackSync,
  "management-accounts": runManagementAccountsSync,
};

const FINALIZE_RECOVERY_DELAYS_MS = [5_000, 15_000, 30_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  if (ms % (60 * 1000) === 0) {
    const minutes = ms / (60 * 1000);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const seconds = Math.round(ms / 1000);
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function getExecutionBudgetMessage(source: string, budgetMs: number): string {
  return `${source} sync exceeded the ${formatDuration(
    budgetMs
  )} execution budget`;
}

function createExecutionControl(
  run: SyncLogRow,
  opts: SyncControl
): {
  control: SyncControl;
  budgetMs: number;
  clear: () => void;
  stopReason: () => SyncStopReason | undefined;
  exceededBudget: () => boolean;
} {
  const { executionBudgetMs } = getSyncSourceConfig(run.source as SyncSource);
  let deadlineExceeded = false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(
      new SyncDeadlineExceededError(
        getExecutionBudgetMessage(run.source, executionBudgetMs)
      )
    );
  }, executionBudgetMs);
  timeoutId.unref?.();

  const stopReason = (): SyncStopReason | undefined => {
    if (deadlineExceeded) {
      return "deadline_exceeded";
    }

    return opts.stopReason?.() ?? (opts.shouldStop?.() ? "cancelled" : undefined);
  };

  return {
    control: {
      shouldStop: () => stopReason() != null,
      stopReason,
      signal: controller.signal,
    },
    budgetMs: executionBudgetMs,
    clear: () => clearTimeout(timeoutId),
    stopReason,
    exceededBudget: () => deadlineExceeded,
  };
}

export function createWorkerId(prefix: string): string {
  return `${prefix}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stop the heartbeat timer, logging and suppressing any Postgres error so that
 * a DB outage during cleanup does not mask the original sync error or leave an
 * unhandled rejection.
 */
async function safeStopHeartbeat(
  stopHeartbeat: () => Promise<void>,
  runId: number
): Promise<void> {
  try {
    await stopHeartbeat();
  } catch (error) {
    console.error(
      `[sync-worker] failed to stop heartbeat for run ${runId}:`,
      error
    );
  }
}

function scheduleFinalizeRecovery(
  runId: number,
  input: Parameters<typeof finalizeSyncRun>[1],
  attempt: number
): void {
  const delayMs = FINALIZE_RECOVERY_DELAYS_MS[attempt - 1];
  if (!delayMs) {
    console.error(
      `[sync-worker] exhausted finalize recovery for run ${runId} (status=${input.status})`
    );
    return;
  }

  const timeoutId = setTimeout(() => {
    void retryFinalizeSyncRun(runId, input, attempt);
  }, delayMs);
  timeoutId.unref?.();
}

async function retryFinalizeSyncRun(
  runId: number,
  input: Parameters<typeof finalizeSyncRun>[1],
  attempt: number
): Promise<void> {
  try {
    await finalizeSyncRun(runId, input);
    console.warn(
      `[sync-worker] recovered finalize for run ${runId} on attempt ${attempt}`
    );
  } catch (error) {
    console.error(
      `[sync-worker] finalize recovery attempt ${attempt} failed for run ${runId}:`,
      error
    );
    scheduleFinalizeRecovery(runId, input, attempt + 1);
  }
}

/**
 * Write the final sync status to Postgres, logging and suppressing any DB
 * error.  The lease-expiry mechanism in expireAbandonedSyncRuns will
 * eventually clean up orphaned `running` rows if this write fails.
 */
async function safeFinalizeSyncRun(
  runId: number,
  input: Parameters<typeof finalizeSyncRun>[1]
): Promise<void> {
  try {
    await finalizeSyncRun(runId, input);
  } catch (error) {
    console.error(
      `[sync-worker] failed to finalize run ${runId} (status=${input.status}):`,
      error
    );
    scheduleFinalizeRecovery(runId, input, 1);
  }
}

export async function runClaimedSync(
  run: SyncLogRow,
  opts: SyncControl = {}
): Promise<SyncRunResult> {
  const execution = createExecutionControl(run, opts);
  const stopHeartbeat = startSyncHeartbeat(run);

  try {
    const runner = RUNNERS[run.source as SyncSource];
    let result = await runner(run, execution.control);
    if (execution.exceededBudget() && result.status !== "cancelled") {
      const timeoutMessage = getExecutionBudgetMessage(
        run.source,
        execution.budgetMs
      );
      result = {
        status: result.recordsSynced > 0 ? "partial" : "error",
        recordsSynced: result.recordsSynced,
        errors: [...result.errors, timeoutMessage],
      };
    }
    await safeStopHeartbeat(stopHeartbeat, run.id);
    await safeFinalizeSyncRun(run.id, {
      status: result.status,
      recordsSynced: result.recordsSynced,
      errorMessage: result.errors.length > 0 ? result.errors.join("\n") : null,
    });
    return result;
  } catch (error) {
    const message = isSyncDeadlineExceededError(error)
      ? error.message
      : formatSyncError(error);
    await safeStopHeartbeat(stopHeartbeat, run.id);
    await safeFinalizeSyncRun(run.id, {
      status: "error",
      recordsSynced: 0,
      errorMessage: message,
    });
    throw error;
  } finally {
    execution.clear();
  }
}

export async function drainSyncQueue(
  workerId: string,
  opts: {
    source?: SyncSource;
    shouldStop?: SyncControl["shouldStop"];
    stopReason?: SyncControl["stopReason"];
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

export function startBackgroundSyncDrain(
  workerId: string,
  opts: {
    source?: SyncSource;
    shouldStop?: SyncControl["shouldStop"];
    stopReason?: SyncControl["stopReason"];
    runIds?: number[];
    triggerLabel: string;
  }
): void {
  void drainSyncQueue(workerId, opts).catch(async (error) => {
    const message = `Background sync drain failed for ${opts.triggerLabel} (${workerId}): ${formatSyncError(
      error
    )}`;

    console.error("[sync-worker] background drain failed", {
      workerId,
      source: opts.source ?? "all",
      triggerLabel: opts.triggerLabel,
      runIds: opts.runIds ?? [],
      error,
    });

    if (!opts.runIds?.length) {
      return;
    }

    try {
      await markSyncRunsFailed(opts.runIds, message);
    } catch (markError) {
      console.error("[sync-worker] failed to mark background drain runs as error", {
        workerId,
        runIds: opts.runIds,
        error: markError,
      });
    }
  });
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
