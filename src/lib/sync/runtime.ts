import * as Sentry from "@sentry/nextjs";
import {
  claimQueuedSyncRun,
  expireAbandonedSyncRuns,
  expireStaleSyncRuns,
  finalizeSyncRun,
  formatSyncError,
  isSyncRunCancelled,
  markSyncRunsFailed,
  startSyncHeartbeat,
  touchSyncHeartbeat,
  type SyncLogRow,
} from "./coordinator";
import { runModeSync } from "./mode";
import { runSlackSync } from "./slack";
import { runManagementAccountsSync } from "./management-accounts";
import { runMeetingsSync } from "./meetings";
import { runGitHubSync } from "./github";
import { getSyncSourceConfig, type SyncSource } from "./config";
import { isSchemaCompatibilityError } from "@/lib/db/errors";
import {
  SyncDeadlineExceededError,
  isSyncDeadlineExceededError,
  type SyncControl,
  type SyncStopReason,
} from "./errors";
import { protectLocalSyncRun, releaseLocalSyncRun } from "./worker-state";

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
  meetings: runMeetingsSync,
  github: runGitHubSync,
};

const FINALIZE_RECOVERY_DELAYS_MS = [5_000, 15_000, 30_000];
const PENDING_FINALIZE_RECOVERY_INTERVAL_MS = 30_000;
const ABANDONED_SYNC_SWEEP_INTERVAL_MS = 30_000;
const DB_CANCEL_POLL_MS = 5_000;

type FinalizeInput = Parameters<typeof finalizeSyncRun>[1];

const pendingFinalizeRecoveries = new Map<number, FinalizeInput>();
let pendingFinalizeRecoveryInterval:
  | ReturnType<typeof setInterval>
  | null = null;
let abandonedSyncSweepInterval: ReturnType<typeof setInterval> | null = null;
let abandonedSyncSweepInFlight: Promise<void> | null = null;

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
    Sentry.captureException(error, { extra: { runId } });
    console.error(
      `[sync-worker] failed to stop heartbeat for run ${runId}:`,
      error
    );
  }
}

function stopPendingFinalizeRecoverySweepIfIdle(): void {
  if (pendingFinalizeRecoveryInterval && pendingFinalizeRecoveries.size === 0) {
    clearInterval(pendingFinalizeRecoveryInterval);
    pendingFinalizeRecoveryInterval = null;
  }
}

async function flushPendingFinalizeRecoveries(): Promise<void> {
  if (pendingFinalizeRecoveries.size === 0) {
    stopPendingFinalizeRecoverySweepIfIdle();
    return;
  }

  for (const [runId, input] of pendingFinalizeRecoveries.entries()) {
    try {
      const { finalized } = await finalizeSyncRun(runId, input);
      pendingFinalizeRecoveries.delete(runId);
      releaseLocalSyncRun(runId);
      if (finalized) {
        console.warn(
          `[sync-worker] recovered finalize for run ${runId} via background sweep`
        );
      }
    } catch (error) {
      Sentry.captureException(error, { extra: { runId } });
      console.error(
        `[sync-worker] background finalize sweep failed for run ${runId}:`,
        error
      );
    }
  }

  stopPendingFinalizeRecoverySweepIfIdle();
}

function ensurePendingFinalizeRecoverySweep(): void {
  if (pendingFinalizeRecoveryInterval) {
    return;
  }

  pendingFinalizeRecoveryInterval = setInterval(() => {
    void flushPendingFinalizeRecoveries();
  }, PENDING_FINALIZE_RECOVERY_INTERVAL_MS);
  pendingFinalizeRecoveryInterval.unref?.();
}

function queuePendingFinalizeRecovery(
  runId: number,
  input: FinalizeInput
): void {
  pendingFinalizeRecoveries.set(runId, input);
  ensurePendingFinalizeRecoverySweep();
}

async function runAbandonedSyncSweep(): Promise<void> {
  if (abandonedSyncSweepInFlight) {
    return abandonedSyncSweepInFlight;
  }

  abandonedSyncSweepInFlight = (async () => {
    try {
      const expiredIds = await expireAbandonedSyncRuns();
      const staleIds = await expireStaleSyncRuns();
      if (expiredIds.length > 0) {
        console.warn(
          `[sync-worker] expired abandoned sync runs: ${expiredIds.join(", ")}`
        );
      }
      if (staleIds.length > 0) {
        console.warn(
          `[sync-worker] expired stale sync runs: ${staleIds.join(", ")}`
        );
      }
    } catch (error) {
      console.error("[sync-worker] abandoned sync sweep failed:", error);
    } finally {
      abandonedSyncSweepInFlight = null;
    }
  })();

  await abandonedSyncSweepInFlight;
}

export function ensureSyncRecoverySweep(): void {
  if (abandonedSyncSweepInterval) {
    return;
  }

  abandonedSyncSweepInterval = setInterval(() => {
    void runAbandonedSyncSweep();
  }, ABANDONED_SYNC_SWEEP_INTERVAL_MS);
  abandonedSyncSweepInterval.unref?.();
  void runAbandonedSyncSweep();
}

function scheduleFinalizeRecovery(
  runId: number,
  input: FinalizeInput,
  attempt: number
): void {
  const delayMs = FINALIZE_RECOVERY_DELAYS_MS[attempt - 1];
  if (!delayMs) {
    console.error(
      `[sync-worker] exhausted finalize recovery for run ${runId} (status=${input.status}); handing off to the background sweep`
    );
    queuePendingFinalizeRecovery(runId, input);
    return;
  }

  const timeoutId = setTimeout(() => {
    void retryFinalizeSyncRun(runId, input, attempt);
  }, delayMs);
  timeoutId.unref?.();
}

async function retryFinalizeSyncRun(
  runId: number,
  input: FinalizeInput,
  attempt: number
): Promise<void> {
  try {
    const { finalized } = await finalizeSyncRun(runId, input);
    pendingFinalizeRecoveries.delete(runId);
    releaseLocalSyncRun(runId);
    stopPendingFinalizeRecoverySweepIfIdle();
    console.warn(
      `[sync-worker] recovered finalize for run ${runId} on attempt ${attempt}`
    );
  } catch (error) {
    Sentry.captureException(error, { extra: { runId, attempt } });
    console.error(
      `[sync-worker] finalize recovery attempt ${attempt} failed for run ${runId}:`,
      error
    );
    scheduleFinalizeRecovery(runId, input, attempt + 1);
  }
}

/**
 * Write the final sync status to Postgres, logging and suppressing any DB
 * error. Short retry timers handle brief outages, the background finalize
 * sweep handles longer outages in the same process, and the abandoned-run
 * sweep backstops worker restarts once the lease expires.
 */
async function safeFinalizeSyncRun(
  runId: number,
  input: FinalizeInput
): Promise<boolean> {
  try {
    const { finalized } = await finalizeSyncRun(runId, input);
    releaseLocalSyncRun(runId);
    return finalized;
  } catch (error) {
    Sentry.captureException(error, { extra: { runId, status: input.status } });
    console.error(
      `[sync-worker] failed to finalize run ${runId} (status=${input.status}):`,
      error
    );
    scheduleFinalizeRecovery(runId, input, 1);
    return true;
  }
}

export async function runClaimedSync(
  run: SyncLogRow,
  opts: SyncControl = {}
): Promise<SyncRunResult> {
  const execution = createExecutionControl(run, opts);
  protectLocalSyncRun({
    runId: run.id,
    source: run.source as SyncSource,
    workerId: run.workerId,
  });
  let cancelledByDb = false;
  const cancelPollInterval = setInterval(() => {
    void isSyncRunCancelled(run.id).then((cancelled) => {
      if (cancelled) {
        cancelledByDb = true;
      }
    });
  }, DB_CANCEL_POLL_MS);
  cancelPollInterval.unref?.();

  const combinedShouldStop = () =>
    cancelledByDb || execution.control.shouldStop?.() === true;
  const combinedStopReason = (): SyncStopReason | undefined =>
    cancelledByDb ? "cancelled" : execution.control.stopReason?.();

  const stopHeartbeat = startSyncHeartbeat(run);
  // Page-boundary heartbeat — must NOT propagate DB errors. The interval-based
  // startSyncHeartbeat above swallows touchSyncHeartbeat failures via .catch()
  // so a transient DB hiccup doesn't kill the run; this checkpoint heartbeat
  // is a thin convenience wrapper for runners that touch the heartbeat at
  // natural progress markers, and it must give the same guarantee. A
  // lease-extension failure is a Sentry breadcrumb, not a sync abort.
  const touchHeartbeat = async () => {
    try {
      await touchSyncHeartbeat(run);
    } catch (err) {
      Sentry.captureException(err, {
        level: "warning",
        tags: { sync_source: run.source, area: "heartbeat" },
      });
    }
  };

  try {
    const runner = RUNNERS[run.source as SyncSource];
    let result = await runner(run, {
      ...execution.control,
      shouldStop: combinedShouldStop,
      stopReason: combinedStopReason,
      touchHeartbeat,
    });
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
    clearInterval(cancelPollInterval);
    await safeStopHeartbeat(stopHeartbeat, run.id);
    const finalized = await safeFinalizeSyncRun(run.id, {
      status: result.status,
      recordsSynced: result.recordsSynced,
      errorMessage: result.errors.length > 0 ? result.errors.join("\n") : null,
    });
    if (!finalized) {
      return { status: "cancelled", recordsSynced: 0, errors: [] };
    }
    return result;
  } catch (error) {
    clearInterval(cancelPollInterval);
    const message = isSyncDeadlineExceededError(error)
      ? error.message
      : formatSyncError(error);
    Sentry.captureException(error, {
      tags: { sync_source: run.source },
      extra: { runId: run.id, errorMessage: message },
    });
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

export const DRAIN_START_TIMEOUT_MS = 5_000;

export type DrainStartOutcome = "started" | "failed" | "pending";

export interface BackgroundSyncDrainHandle {
  /**
   * Resolves once the first `claimQueuedSyncRun` attempt settles
   * (either returns a run, returns null, or throws). Rejects if that
   * attempt throws. A silent `.catch` is attached internally so callers
   * may choose not to await it without triggering an unhandled
   * rejection — the background `.catch` still records the error and
   * calls `markSyncRunsFailed` for queued run ids.
   */
  started: Promise<void>;
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
): BackgroundSyncDrainHandle {
  let firstClaimSettled = false;
  let resolveStarted!: () => void;
  let rejectStarted!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  // Keep unhandled-rejection tracking quiet when the caller opts not to
  // await `started` — e.g. when the 5s route timeout races past it.
  started.catch(() => {});

  const settleStartedSuccess = () => {
    if (firstClaimSettled) return;
    firstClaimSettled = true;
    resolveStarted();
  };
  const settleStartedFailure = (error: unknown) => {
    if (firstClaimSettled) return;
    firstClaimSettled = true;
    rejectStarted(error);
  };

  const drainAll = async () => {
    while (!opts.shouldStop?.()) {
      let claimed;
      try {
        claimed = await claimQueuedSyncRun(workerId, opts.source);
      } catch (error) {
        settleStartedFailure(error);
        throw error;
      }
      settleStartedSuccess();
      if (!claimed) {
        break;
      }
      await runClaimedSync(claimed, opts);
    }
  };

  void drainAll().catch(async (error) => {
    const message = `Background sync drain failed for ${opts.triggerLabel} (${workerId}): ${formatSyncError(
      error
    )}`;

    Sentry.captureException(error, {
      tags: { sync_source: opts.source ?? "all" },
      extra: { workerId, triggerLabel: opts.triggerLabel, runIds: opts.runIds ?? [] },
    });
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
      Sentry.captureException(markError, {
        tags: { sync_source: opts.source ?? "all" },
        extra: { workerId, runIds: opts.runIds },
      });
      console.error("[sync-worker] failed to mark background drain runs as error", {
        workerId,
        runIds: opts.runIds,
        error: markError,
      });
    }
  });

  return { started };
}

/**
 * Race the `started` promise returned by `startBackgroundSyncDrain`
 * against a short timeout. Returns:
 *   - `"started"` when the first claim settled successfully in time
 *   - `"failed"` when the first claim rejected in time
 *   - `"pending"` when neither happened before the timeout elapsed
 */
export async function awaitDrainStarted(
  started: Promise<void>,
  timeoutMs: number = DRAIN_START_TIMEOUT_MS
): Promise<DrainStartOutcome> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<"pending">((resolve) => {
    timeoutId = setTimeout(() => resolve("pending"), timeoutMs);
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([
      started.then((): "started" => "started"),
      timer,
    ]);
  } catch {
    return "failed";
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
