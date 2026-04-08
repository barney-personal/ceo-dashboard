import { db } from "@/lib/db";
import { syncLog, syncPhases } from "@/lib/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  or,
} from "drizzle-orm";
import {
  evaluateQueueDecision,
  getSyncSourceConfig,
  type SyncSource,
  type SyncStatus,
  type SyncTrigger,
} from "./config";

const ACTIVE_STATUSES = ["queued", "running"] as const;
const TERMINAL_STATUSES = ["success", "partial", "error", "cancelled"] as const;

export interface EnqueueSyncResult {
  outcome: "queued" | "already-running" | "skipped" | "forced";
  runId: number | null;
  reason: string | null;
  nextEligibleAt: Date | null;
}

export interface FinalizeSyncRunInput {
  status: SyncStatus;
  recordsSynced?: number;
  errorMessage?: string | null;
  skipReason?: string | null;
}

export type SyncLogRow = typeof syncLog.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export function formatSyncError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function findActiveSyncRun(
  source: SyncSource
): Promise<SyncLogRow | null> {
  const result = await db
    .select()
    .from(syncLog)
    .where(
      and(
        eq(syncLog.source, source),
        inArray(syncLog.status, [...ACTIVE_STATUSES])
      )
    )
    .orderBy(desc(syncLog.startedAt))
    .limit(1);

  return result[0] ?? null;
}

export async function getLatestCompletedSyncRun(
  source: SyncSource
): Promise<SyncLogRow | null> {
  const result = await db
    .select()
    .from(syncLog)
    .where(
      and(
        eq(syncLog.source, source),
        inArray(syncLog.status, [...TERMINAL_STATUSES])
      )
    )
    .orderBy(desc(syncLog.completedAt), desc(syncLog.startedAt))
    .limit(1);

  return result[0] ?? null;
}

export async function closeOpenPhases(
  runId: number,
  status: "error" | "cancelled" = "error",
  errorMessage?: string
): Promise<void> {
  await db
    .update(syncPhases)
    .set({
      status,
      completedAt: new Date(),
      errorMessage:
        errorMessage ??
        (status === "cancelled"
          ? "Sync stopped before the phase completed"
          : "Phase interrupted before completion"),
    })
    .where(
      and(eq(syncPhases.syncLogId, runId), eq(syncPhases.status, "running"))
    );
}

export async function expireAbandonedSyncRuns(
  source?: SyncSource
): Promise<number[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(syncLog)
    .where(
      and(
        eq(syncLog.status, "running"),
        lt(syncLog.leaseExpiresAt, now),
        source ? eq(syncLog.source, source) : undefined
      )
    )
    .orderBy(asc(syncLog.startedAt));

  const expiredIds: number[] = [];

  for (const row of rows) {
    const [updated] = await db
      .update(syncLog)
      .set({
        completedAt: now,
        status: "error",
        skipReason: "abandoned",
        errorMessage: [
          row.errorMessage,
          "Worker lease expired before the sync completed.",
        ]
          .filter(Boolean)
          .join("\n"),
        heartbeatAt: now,
        leaseExpiresAt: null,
      })
      .where(and(eq(syncLog.id, row.id), eq(syncLog.status, "running")))
      .returning();

    if (updated) {
      expiredIds.push(updated.id);
      await closeOpenPhases(
        updated.id,
        "error",
        "Phase interrupted — worker lease expired before completion"
      );
    }
  }

  return expiredIds;
}

export async function enqueueSyncRun(
  source: SyncSource,
  opts: {
    trigger: SyncTrigger;
    force?: boolean;
    now?: Date;
  }
): Promise<EnqueueSyncResult> {
  const now = opts.now ?? new Date();
  const config = getSyncSourceConfig(source);

  await expireAbandonedSyncRuns(source);

  const active = await findActiveSyncRun(source);
  if (active) {
    return {
      outcome: "already-running",
      runId: active.id,
      reason: active.status,
      nextEligibleAt: null,
    };
  }

  const latest = await getLatestCompletedSyncRun(source);
  const decision = evaluateQueueDecision(config, {
    latestCompletedAt: latest?.completedAt ?? null,
    latestCompletedStatus: (latest?.status as SyncStatus | null) ?? null,
    now,
    force: opts.force,
  });

  if (!decision.shouldQueue) {
    return {
      outcome: "skipped",
      runId: latest?.id ?? null,
      reason: decision.reason,
      nextEligibleAt: decision.nextEligibleAt,
    };
  }

  try {
    const [queued] = await db
      .insert(syncLog)
      .values({
        source,
        trigger: opts.trigger,
        status: "queued",
        attempt: 1,
        maxAttempts: config.maxAttempts,
        startedAt: now,
      })
      .returning();

    return {
      outcome: decision.outcome,
      runId: queued.id,
      reason: null,
      nextEligibleAt: decision.nextEligibleAt,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const lockedRun = await findActiveSyncRun(source);
    return {
      outcome: "already-running",
      runId: lockedRun?.id ?? null,
      reason: "active_run_exists",
      nextEligibleAt: null,
    };
  }
}

export async function claimQueuedSyncRun(
  workerId: string,
  source?: SyncSource
): Promise<SyncLogRow | null> {
  await expireAbandonedSyncRuns(source);

  const candidates = await db
    .select()
    .from(syncLog)
    .where(
      and(
        eq(syncLog.status, "queued"),
        source ? eq(syncLog.source, source) : undefined
      )
    )
    .orderBy(asc(syncLog.startedAt))
    .limit(10);

  for (const candidate of candidates) {
    const config = getSyncSourceConfig(candidate.source as SyncSource);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + config.leaseMs);

    const [claimed] = await db
      .update(syncLog)
      .set({
        status: "running",
        workerId,
        heartbeatAt: now,
        leaseExpiresAt,
      })
      .where(and(eq(syncLog.id, candidate.id), eq(syncLog.status, "queued")))
      .returning();

    if (claimed) {
      return claimed;
    }
  }

  return null;
}

export function startSyncHeartbeat(run: SyncLogRow): () => Promise<void> {
  const config = getSyncSourceConfig(run.source as SyncSource);
  const tick = async () => {
    const now = new Date();
    await db
      .update(syncLog)
      .set({
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + config.leaseMs),
      })
      .where(and(eq(syncLog.id, run.id), eq(syncLog.status, "running")));
  };

  const intervalId = setInterval(() => {
    void tick();
  }, 15_000);
  intervalId.unref?.();

  return async () => {
    clearInterval(intervalId);
    await tick();
  };
}

export async function cancelSyncRun(
  runId: number
): Promise<{ cancelled: boolean; reason?: string }> {
  const completedAt = new Date();

  // Single atomic UPDATE — only transitions queued/running rows to cancelled.
  // This eliminates the read-then-write TOCTOU window where a concurrent
  // finalizeSyncRun call could overwrite a just-completed run.
  const [updated] = await db
    .update(syncLog)
    .set({
      completedAt,
      status: "cancelled",
      errorMessage: "Cancelled by user",
      heartbeatAt: completedAt,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(syncLog.id, runId),
        inArray(syncLog.status, [...ACTIVE_STATUSES])
      )
    )
    .returning();

  if (updated) {
    await closeOpenPhases(runId, "cancelled", "Cancelled by user");
    return { cancelled: true };
  }

  // Nothing was updated — distinguish not_found from not_cancellable.
  const [existing] = await db
    .select({ id: syncLog.id })
    .from(syncLog)
    .where(eq(syncLog.id, runId))
    .limit(1);

  return {
    cancelled: false,
    reason: existing ? "not_cancellable" : "not_found",
  };
}

export async function finalizeSyncRun(
  runId: number,
  input: FinalizeSyncRunInput
): Promise<{ finalized: boolean }> {
  const completedAt = new Date();

  // CAS update: only transition rows that are still active. This prevents a
  // late worker completion from overwriting a cancelled (or otherwise terminal)
  // row, and prevents a late cancel from overwriting a just-completed run.
  const [updated] = await db
    .update(syncLog)
    .set({
      completedAt,
      status: input.status,
      recordsSynced: input.recordsSynced ?? 0,
      errorMessage: input.errorMessage ?? null,
      skipReason: input.skipReason ?? null,
      heartbeatAt: completedAt,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(syncLog.id, runId),
        inArray(syncLog.status, [...ACTIVE_STATUSES])
      )
    )
    .returning();

  if (!updated) {
    return { finalized: false };
  }

  if (input.status === "error" || input.status === "cancelled") {
    await closeOpenPhases(
      runId,
      input.status,
      input.errorMessage ?? undefined
    );
  }

  return { finalized: true };
}

export async function isSyncRunCancelled(runId: number): Promise<boolean> {
  const [row] = await db
    .select({ status: syncLog.status })
    .from(syncLog)
    .where(eq(syncLog.id, runId))
    .limit(1);
  return row?.status === "cancelled";
}
