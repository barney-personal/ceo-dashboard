import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock coordinator — lets tests control finalizeSyncRun / isSyncRunCancelled
// ---------------------------------------------------------------------------

vi.mock("@/lib/sync/coordinator", () => ({
  claimQueuedSyncRun: vi.fn(),
  finalizeSyncRun: vi.fn(),
  formatSyncError: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e)
  ),
  isSyncRunCancelled: vi.fn(),
  startSyncHeartbeat: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the individual sync runners
// ---------------------------------------------------------------------------

vi.mock("@/lib/sync/mode", () => ({ runModeSync: vi.fn() }));
vi.mock("@/lib/sync/slack", () => ({ runSlackSync: vi.fn() }));
vi.mock("@/lib/sync/management-accounts", () => ({
  runManagementAccountsSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------

import {
  claimQueuedSyncRun,
  finalizeSyncRun,
  isSyncRunCancelled,
  startSyncHeartbeat,
} from "@/lib/sync/coordinator";
import { runModeSync } from "@/lib/sync/mode";
import { runClaimedSync } from "@/lib/sync/runtime";

const mockClaimQueuedSyncRun = vi.mocked(claimQueuedSyncRun);
const mockFinalizeSyncRun = vi.mocked(finalizeSyncRun);
const mockIsSyncRunCancelled = vi.mocked(isSyncRunCancelled);
const mockStartSyncHeartbeat = vi.mocked(startSyncHeartbeat);
const mockRunModeSync = vi.mocked(runModeSync);

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source: "mode",
    status: "running",
    workerId: "test-worker",
    attempt: 1,
    maxAttempts: 3,
    trigger: "manual",
    startedAt: new Date(),
    completedAt: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    recordsSynced: 0,
    errorMessage: null,
    skipReason: null,
    ...overrides,
  } as import("@/lib/sync/coordinator").SyncLogRow;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockStartSyncHeartbeat.mockReturnValue(vi.fn().mockResolvedValue(undefined));
  mockIsSyncRunCancelled.mockResolvedValue(false);
  mockFinalizeSyncRun.mockResolvedValue({ finalized: true });
});

// ---------------------------------------------------------------------------
// Normal success path
// ---------------------------------------------------------------------------

describe("runClaimedSync — normal completion", () => {
  it("finalizes with runner result when finalized:true", async () => {
    mockRunModeSync.mockResolvedValue({
      status: "success",
      recordsSynced: 10,
      errors: [],
    });

    const result = await runClaimedSync(makeRun());

    expect(result).toEqual({ status: "success", recordsSynced: 10, errors: [] });
    expect(mockFinalizeSyncRun).toHaveBeenCalledWith(1, {
      status: "success",
      recordsSynced: 10,
      errorMessage: null,
    });
  });

  it("passes errors array as joined errorMessage to finalizeSyncRun", async () => {
    mockRunModeSync.mockResolvedValue({
      status: "partial",
      recordsSynced: 5,
      errors: ["err1", "err2"],
    });

    await runClaimedSync(makeRun());

    expect(mockFinalizeSyncRun).toHaveBeenCalledWith(1, {
      status: "partial",
      recordsSynced: 5,
      errorMessage: "err1\nerr2",
    });
  });
});

// ---------------------------------------------------------------------------
// Cancel-before-finish race
// ---------------------------------------------------------------------------

describe("runClaimedSync — cancel wins the race", () => {
  it("returns cancelled result when finalizeSyncRun returns finalized:false", async () => {
    // Runner completes normally, but the row was already cancelled externally
    mockRunModeSync.mockResolvedValue({
      status: "success",
      recordsSynced: 20,
      errors: [],
    });
    mockFinalizeSyncRun.mockResolvedValue({ finalized: false });

    const result = await runClaimedSync(makeRun());

    expect(result).toEqual({ status: "cancelled", recordsSynced: 0, errors: [] });
  });

  it("does NOT re-throw when finalized:false (worker was cancelled, not errored)", async () => {
    mockRunModeSync.mockResolvedValue({
      status: "success",
      recordsSynced: 5,
      errors: [],
    });
    mockFinalizeSyncRun.mockResolvedValue({ finalized: false });

    await expect(runClaimedSync(makeRun())).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB-backed shouldStop propagation
// ---------------------------------------------------------------------------

describe("runClaimedSync — DB-backed shouldStop", () => {
  it("passes a shouldStop function to the runner", async () => {
    mockRunModeSync.mockImplementation(
      async (_run: unknown, opts?: { shouldStop?: () => boolean }) => {
        // shouldStop must be provided and callable
        expect(typeof opts?.shouldStop).toBe("function");
        // At the start it returns false (not yet cancelled)
        expect(opts!.shouldStop!()).toBe(false);
        return { status: "success", recordsSynced: 0, errors: [] };
      }
    );

    await runClaimedSync(makeRun());
  });

  it("shouldStop returns true when external shouldStop fires", async () => {
    const externalStop = vi.fn(() => true);

    mockRunModeSync.mockImplementation(
      async (_run: unknown, opts?: { shouldStop?: () => boolean }) => {
        expect(opts!.shouldStop!()).toBe(true);
        return { status: "cancelled", recordsSynced: 0, errors: [] };
      }
    );

    await runClaimedSync(makeRun(), { shouldStop: externalStop });
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe("runClaimedSync — runner throws", () => {
  it("finalizes with error status and re-throws", async () => {
    const boom = new Error("network failure");
    mockRunModeSync.mockRejectedValue(boom);

    await expect(runClaimedSync(makeRun())).rejects.toThrow("network failure");

    expect(mockFinalizeSyncRun).toHaveBeenCalledWith(1, {
      status: "error",
      recordsSynced: 0,
      errorMessage: "network failure",
    });
  });
});
