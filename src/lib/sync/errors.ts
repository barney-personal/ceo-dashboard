export class SyncCancelledError extends Error {
  constructor(message: string = "Sync cancelled") {
    super(message);
    this.name = "SyncCancelledError";
  }
}

export type SyncStopReason = "cancelled" | "deadline_exceeded";

export interface SyncControl {
  shouldStop?: () => boolean;
  stopReason?: () => SyncStopReason | undefined;
  signal?: AbortSignal;
}

export class SyncDeadlineExceededError extends Error {
  constructor(message: string = "Sync execution budget exceeded") {
    super(message);
    this.name = "SyncDeadlineExceededError";
  }
}

export function isSyncCancelledError(error: unknown): error is SyncCancelledError {
  return error instanceof SyncCancelledError;
}

export function isSyncDeadlineExceededError(
  error: unknown
): error is SyncDeadlineExceededError {
  return error instanceof SyncDeadlineExceededError;
}

export function throwIfSyncShouldStop(
  control: SyncControl | undefined,
  messages: {
    cancelled: string;
    deadlineExceeded?: string;
  }
): void {
  const reason = control?.stopReason?.();
  if (reason === "deadline_exceeded") {
    throw new SyncDeadlineExceededError(
      messages.deadlineExceeded ?? messages.cancelled
    );
  }

  if (control?.shouldStop?.()) {
    throw new SyncCancelledError(messages.cancelled);
  }
}
