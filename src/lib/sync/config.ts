export const SYNC_SOURCES = [
  "mode",
  "slack",
  "management-accounts",
  "meetings",
] as const;

export type SyncSource = (typeof SYNC_SOURCES)[number];

export const SYNC_STATUSES = [
  "queued",
  "running",
  "success",
  "partial",
  "error",
  "cancelled",
] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];

export type SyncTrigger =
  | "cron"
  | "manual"
  | "worker"
  | "web"
  | "system";

export interface SyncSourceConfig {
  source: SyncSource;
  normalIntervalMs: number;
  retryAfterMs: number;
  leaseMs: number;
  executionBudgetMs: number;
  maxAttempts: number;
}

export interface QueueDecisionInput {
  latestCompletedAt: Date | null;
  latestCompletedStatus: SyncStatus | null;
  now: Date;
  force?: boolean;
}

export interface QueueDecision {
  shouldQueue: boolean;
  outcome: "queued" | "forced" | "skipped";
  reason: string | null;
  nextEligibleAt: Date | null;
}

export interface SyncRunStateLike {
  status: string;
  leaseExpiresAt: Date | string | null;
  skipReason: string | null;
}

export const SYNC_SOURCE_CONFIGS: Record<SyncSource, SyncSourceConfig> = {
  mode: {
    source: "mode",
    normalIntervalMs: 4 * 60 * 60 * 1000,
    retryAfterMs: 30 * 60 * 1000,
    leaseMs: 2 * 60 * 1000,
    executionBudgetMs: 15 * 60 * 1000,
    maxAttempts: 1,
  },
  slack: {
    source: "slack",
    normalIntervalMs: 2 * 60 * 60 * 1000,
    retryAfterMs: 30 * 60 * 1000,
    leaseMs: 2 * 60 * 1000,
    executionBudgetMs: 10 * 60 * 1000,
    maxAttempts: 1,
  },
  "management-accounts": {
    source: "management-accounts",
    normalIntervalMs: 24 * 60 * 60 * 1000,
    retryAfterMs: 30 * 60 * 1000,
    leaseMs: 2 * 60 * 1000,
    executionBudgetMs: 10 * 60 * 1000,
    maxAttempts: 1,
  },
  meetings: {
    source: "meetings",
    normalIntervalMs: 2 * 60 * 60 * 1000, // every 2 hours
    retryAfterMs: 30 * 60 * 1000,
    leaseMs: 2 * 60 * 1000,
    executionBudgetMs: 10 * 60 * 1000,
    maxAttempts: 1,
  },
};

export function getSyncSourceConfig(source: SyncSource): SyncSourceConfig {
  return SYNC_SOURCE_CONFIGS[source];
}

export function isActiveSyncStatus(status: string): boolean {
  return status === "queued" || status === "running";
}

export function isRetryableSourceStatus(status: SyncStatus | null): boolean {
  return status === "partial" || status === "error" || status === "cancelled";
}

export function evaluateQueueDecision(
  config: SyncSourceConfig,
  input: QueueDecisionInput
): QueueDecision {
  if (input.force) {
    return {
      shouldQueue: true,
      outcome: "forced",
      reason: null,
      nextEligibleAt: input.now,
    };
  }

  if (!input.latestCompletedAt || !input.latestCompletedStatus) {
    return {
      shouldQueue: true,
      outcome: "queued",
      reason: null,
      nextEligibleAt: input.now,
    };
  }

  const retryWindowMs = isRetryableSourceStatus(input.latestCompletedStatus)
    ? config.retryAfterMs
    : config.normalIntervalMs;
  const nextEligibleAt = new Date(
    input.latestCompletedAt.getTime() + retryWindowMs
  );

  if (input.now.getTime() >= nextEligibleAt.getTime()) {
    return {
      shouldQueue: true,
      outcome: "queued",
      reason: null,
      nextEligibleAt,
    };
  }

  return {
    shouldQueue: false,
    outcome: "skipped",
    reason: isRetryableSourceStatus(input.latestCompletedStatus)
      ? `retry_after_${input.latestCompletedStatus}`
      : "within_interval",
    nextEligibleAt,
  };
}

export function getEffectiveSyncState(
  run: SyncRunStateLike,
  now: Date = new Date()
): string {
  if (run.skipReason === "abandoned") {
    return "abandoned";
  }

  if (
    run.status === "running" &&
    run.leaseExpiresAt &&
    new Date(run.leaseExpiresAt).getTime() < now.getTime()
  ) {
    return "abandoned";
  }

  return run.status;
}
