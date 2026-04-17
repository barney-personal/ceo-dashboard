import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throwIfSyncShouldStop } from "../errors";
import {
  isLocalSyncRunProtected,
  resetLocalSyncRunProtectionForTest,
} from "../worker-state";

const mocks = vi.hoisted(() => ({
  claimQueuedSyncRun: vi.fn(),
  expireAbandonedSyncRuns: vi.fn(),
  expireStaleSyncRuns: vi.fn(),
  finalizeSyncRun: vi.fn(),
  isSyncRunCancelled: vi.fn(),
  markSyncRunsFailed: vi.fn(),
  startSyncHeartbeat: vi.fn(),
  runSlackSync: vi.fn(),
  runModeSync: vi.fn(),
  runManagementAccountsSync: vi.fn(),
}));

vi.mock("../coordinator", () => ({
  claimQueuedSyncRun: mocks.claimQueuedSyncRun,
  expireAbandonedSyncRuns: mocks.expireAbandonedSyncRuns,
  expireStaleSyncRuns: mocks.expireStaleSyncRuns,
  finalizeSyncRun: mocks.finalizeSyncRun,
  formatSyncError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  isSyncRunCancelled: mocks.isSyncRunCancelled,
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

import {
  awaitDrainStarted,
  runClaimedSync,
  startBackgroundSyncDrain,
} from "../runtime";

describe("sync runtime resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLocalSyncRunProtectionForTest();
    mocks.expireAbandonedSyncRuns.mockReset();
    mocks.expireStaleSyncRuns.mockReset();
    mocks.finalizeSyncRun.mockReset();
    mocks.isSyncRunCancelled.mockReset();
    mocks.claimQueuedSyncRun.mockReset();
    mocks.markSyncRunsFailed.mockReset();
    mocks.runSlackSync.mockReset();
    mocks.runModeSync.mockReset();
    mocks.runManagementAccountsSync.mockReset();
    mocks.startSyncHeartbeat.mockReset();
    mocks.expireAbandonedSyncRuns.mockResolvedValue([]);
    mocks.expireStaleSyncRuns.mockResolvedValue([]);
    mocks.finalizeSyncRun.mockResolvedValue({ finalized: true });
    mocks.isSyncRunCancelled.mockResolvedValue(false);
    mocks.startSyncHeartbeat.mockReturnValue(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    resetLocalSyncRunProtectionForTest();
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

  it("returns cancelled when finalizeSyncRun reports the run was already terminal", async () => {
    mocks.runSlackSync.mockResolvedValue({
      status: "success",
      recordsSynced: 4,
      errors: [],
    });
    mocks.finalizeSyncRun.mockResolvedValue({ finalized: false });

    await expect(
      runClaimedSync({ id: 18, source: "slack" } as never)
    ).resolves.toEqual({
      status: "cancelled",
      recordsSynced: 0,
      errors: [],
    });
  });

  it("passes a callable shouldStop function through to the runner", async () => {
    mocks.runModeSync.mockImplementation(async (_run, opts) => {
      expect(typeof opts?.shouldStop).toBe("function");
      expect(opts?.shouldStop?.()).toBe(false);
      return { status: "success", recordsSynced: 0, errors: [] };
    });

    await expect(
      runClaimedSync({ id: 19, source: "mode" } as never)
    ).resolves.toEqual({
      status: "success",
      recordsSynced: 0,
      errors: [],
    });
  });

  it("passes a claimed Mode run scope through to the Mode runner", async () => {
    mocks.runModeSync.mockImplementation(async (run) => {
      expect(run).toMatchObject({
        id: 27,
        source: "mode",
        scope: { reportToken: "report-alpha" },
      });
      return { status: "success", recordsSynced: 3, errors: [] };
    });

    await expect(
      runClaimedSync({
        id: 27,
        source: "mode",
        scope: { reportToken: "report-alpha" },
      } as never)
    ).resolves.toEqual({
      status: "success",
      recordsSynced: 3,
      errors: [],
    });
  });

  it("aborts a long-running sync step via the execution-budget signal", async () => {
    mocks.runSlackSync.mockImplementation(
      async (_run, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener(
            "abort",
            () => reject(opts.signal?.reason ?? new Error("aborted")),
            { once: true }
          );
        })
    );

    const promise = expect(
      runClaimedSync({ id: 23, source: "slack" } as never)
    ).rejects.toThrow(/execution budget/);
    await vi.advanceTimersByTimeAsync(60);

    await promise;
    expect(mocks.finalizeSyncRun).toHaveBeenCalledWith(23, {
      status: "error",
      recordsSynced: 0,
      errorMessage: expect.stringMatching(/execution budget/),
    });
  });

  it("marks queued runs as failed when a background drain crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claimQueuedSyncRun.mockRejectedValue(new Error("claim exploded"));
    mocks.markSyncRunsFailed.mockResolvedValue([91]);

    const handle = startBackgroundSyncDrain("worker-1", {
      source: "slack",
      runIds: [91],
      triggerLabel: "manual slack sync request",
    });
    // Silence the rejected `started` promise here; the route-level
    // consumer awaits it via `awaitDrainStarted` in production.
    handle.started.catch(() => {});

    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.markSyncRunsFailed).toHaveBeenCalledWith(
      [91],
      expect.stringContaining("manual slack sync request")
    );
  });

  it("exposes a started promise that resolves after the first claim settles with no queued run", async () => {
    mocks.claimQueuedSyncRun.mockResolvedValue(null);

    const { started } = startBackgroundSyncDrain("worker-ok", {
      source: "slack",
      runIds: [],
      triggerLabel: "manual slack sync request",
    });

    await expect(awaitDrainStarted(started, 1_000)).resolves.toBe("started");
  });

  it("awaitDrainStarted resolves to 'failed' when the first claim attempt throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claimQueuedSyncRun.mockRejectedValue(new Error("claim exploded"));
    mocks.markSyncRunsFailed.mockResolvedValue([]);

    const { started } = startBackgroundSyncDrain("worker-fail", {
      source: "slack",
      runIds: [],
      triggerLabel: "manual slack sync request",
    });

    await expect(awaitDrainStarted(started, 1_000)).resolves.toBe("failed");
  });

  it("awaitDrainStarted resolves to 'pending' when the first claim has not settled before the timeout", async () => {
    let resolveClaim: (value: null) => void = () => {};
    mocks.claimQueuedSyncRun.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          resolveClaim = resolve;
        })
    );

    const { started } = startBackgroundSyncDrain("worker-slow", {
      source: "slack",
      runIds: [],
      triggerLabel: "manual slack sync request",
    });

    const racePromise = awaitDrainStarted(started, 100);
    await vi.advanceTimersByTimeAsync(150);
    await expect(racePromise).resolves.toBe("pending");

    // Let the hanging claim settle so the drain loop can finish.
    resolveClaim(null);
    await vi.runAllTicks();
  });

  it("keeps retrying finalization after the short recovery window is exhausted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.runSlackSync.mockResolvedValue({
      status: "success",
      recordsSynced: 12,
      errors: [],
    });
    mocks.finalizeSyncRun
      .mockRejectedValueOnce(new Error("db offline"))
      .mockRejectedValueOnce(new Error("db offline"))
      .mockRejectedValueOnce(new Error("db offline"))
      .mockRejectedValueOnce(new Error("db offline"))
      .mockResolvedValue({ finalized: true });

    await expect(
      runClaimedSync({ id: 31, source: "slack" } as never)
    ).resolves.toEqual({
      status: "success",
      recordsSynced: 12,
      errors: [],
    });

    expect(mocks.finalizeSyncRun).toHaveBeenCalledTimes(1);
    expect(isLocalSyncRunProtected({ runId: 31 })).toBe(true);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(mocks.finalizeSyncRun).toHaveBeenCalledTimes(4);
    expect(isLocalSyncRunProtected({ runId: 31 })).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.finalizeSyncRun).toHaveBeenCalledTimes(5);
    expect(mocks.finalizeSyncRun).toHaveBeenLastCalledWith(31, {
      status: "success",
      recordsSynced: 12,
      errorMessage: null,
    });
    expect(isLocalSyncRunProtected({ runId: 31 })).toBe(false);
  });

  it("runs stale-timeout cleanup alongside abandoned cleanup in the recovery sweep", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { ensureSyncRecoverySweep } = await import("../runtime");

    mocks.expireAbandonedSyncRuns.mockResolvedValueOnce([41]);
    mocks.expireStaleSyncRuns.mockResolvedValueOnce([42]);

    ensureSyncRecoverySweep();
    await vi.runOnlyPendingTimersAsync();

    expect(mocks.expireAbandonedSyncRuns).toHaveBeenCalled();
    expect(mocks.expireStaleSyncRuns).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[sync-worker] expired stale sync runs: 42"
    );
  });
});
