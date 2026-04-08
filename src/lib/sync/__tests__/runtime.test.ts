import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throwIfSyncShouldStop } from "../errors";

const mocks = vi.hoisted(() => ({
  claimQueuedSyncRun: vi.fn(),
  finalizeSyncRun: vi.fn(),
  markSyncRunsFailed: vi.fn(),
  startSyncHeartbeat: vi.fn(),
  runSlackSync: vi.fn(),
  runModeSync: vi.fn(),
  runManagementAccountsSync: vi.fn(),
}));

vi.mock("../coordinator", () => ({
  claimQueuedSyncRun: mocks.claimQueuedSyncRun,
  finalizeSyncRun: mocks.finalizeSyncRun,
  formatSyncError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  markSyncRunsFailed: mocks.markSyncRunsFailed,
  startSyncHeartbeat: mocks.startSyncHeartbeat,
}));

vi.mock("../slack", () => ({
  runSlackSync: mocks.runSlackSync,
}));

vi.mock("../mode", () => ({
  runModeSync: mocks.runModeSync,
}));

vi.mock("../management-accounts", () => ({
  runManagementAccountsSync: mocks.runManagementAccountsSync,
}));

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");

  return {
    ...actual,
    getSyncSourceConfig: vi.fn((source: keyof typeof actual.SYNC_SOURCE_CONFIGS) => ({
      ...actual.SYNC_SOURCE_CONFIGS[source],
      executionBudgetMs: 50,
    })),
  };
});

import { runClaimedSync, startBackgroundSyncDrain } from "../runtime";

describe("sync runtime resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.finalizeSyncRun.mockReset();
    mocks.claimQueuedSyncRun.mockReset();
    mocks.markSyncRunsFailed.mockReset();
    mocks.runSlackSync.mockReset();
    mocks.runModeSync.mockReset();
    mocks.runManagementAccountsSync.mockReset();
    mocks.startSyncHeartbeat.mockReset();
    mocks.startSyncHeartbeat.mockReturnValue(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("marks a claimed sync as errored when its execution budget expires", async () => {
    mocks.runSlackSync.mockImplementation(async (_run, opts) => {
      while (!opts?.shouldStop?.()) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      throwIfSyncShouldStop(opts, {
        cancelled: "cancelled",
        deadlineExceeded: "slack budget exceeded",
      });

      return { status: "success", recordsSynced: 0, errors: [] };
    });

    const promise = expect(
      runClaimedSync({ id: 17, source: "slack" } as never)
    ).rejects.toThrow("slack budget exceeded");
    await vi.advanceTimersByTimeAsync(60);

    await promise;
    expect(mocks.finalizeSyncRun).toHaveBeenCalledWith(17, {
      status: "error",
      recordsSynced: 0,
      errorMessage: "slack budget exceeded",
    });
  });

  it("marks queued runs as failed when a background drain crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claimQueuedSyncRun.mockRejectedValue(new Error("claim exploded"));
    mocks.markSyncRunsFailed.mockResolvedValue([91]);

    startBackgroundSyncDrain("worker-1", {
      source: "slack",
      runIds: [91],
      triggerLabel: "manual slack sync request",
    });

    await vi.runAllTicks();
    await Promise.resolve();

    expect(mocks.markSyncRunsFailed).toHaveBeenCalledWith(
      [91],
      expect.stringContaining("manual slack sync request")
    );
  });
});
