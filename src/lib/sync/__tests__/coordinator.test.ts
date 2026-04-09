import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted ensures these fns are created before vi.mock factories run
// ---------------------------------------------------------------------------

const {
  mockInsertReturning,
  mockInsertValues,
  mockInsert,
  mockOrderBy,
  mockReturning,
  mockLimit,
  mockWhere,
  mockSet,
  mockFrom,
  mockUpdate,
  mockSelect,
} =
  vi.hoisted(() => {
    const mockInsertReturning = vi.fn();
    const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
    const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
    const mockOrderBy = vi.fn(() => ({
      limit: mockLimit,
      then: (onFulfilled?: ((value: unknown[]) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
        Promise.resolve([]).then(onFulfilled, onRejected),
      catch: (onRejected?: ((reason: unknown) => unknown) | null) =>
        Promise.resolve([]).catch(onRejected),
      finally: (onFinally?: () => void) => Promise.resolve([]).finally(onFinally),
    }));
    const mockReturning = vi.fn();
    const mockLimit = vi.fn();
    const mockWhere = vi.fn(() => ({
      returning: mockReturning,
      limit: mockLimit,
      orderBy: mockOrderBy,
    }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    return {
      mockInsertReturning,
      mockInsertValues,
      mockInsert,
      mockOrderBy,
      mockReturning,
      mockLimit,
      mockWhere,
      mockSet,
      mockFrom,
      mockUpdate,
      mockSelect,
    };
  });

// ---------------------------------------------------------------------------
// DB mock — returns controllable values for each chained Drizzle call.
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    update: mockUpdate,
    select: mockSelect,
    insert: mockInsert,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  syncLog: {
    id: "id",
    status: "status",
    source: "source",
    startedAt: "startedAt",
    leaseExpiresAt: "leaseExpiresAt",
    heartbeatAt: "heartbeatAt",
    workerId: "workerId",
    completedAt: "completedAt",
    errorMessage: "errorMessage",
    skipReason: "skipReason",
    scope: "scope",
    trigger: "trigger",
    attempt: "attempt",
    maxAttempts: "maxAttempts",
  },
  syncPhases: { syncLogId: "syncLogId", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  lt: (col: unknown, val: unknown) => ({ lt: [col, val] }),
  or: (...args: unknown[]) => ({ or: args }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("@/lib/sync/config", () => ({
  getSyncSourceConfig: vi.fn(() => ({
    leaseMs: 60_000,
    staleTimeoutMs: 15 * 60_000,
    maxAttempts: 3,
    intervalMs: 14_400_000,
    retryAfterErrorMs: 600_000,
  })),
  evaluateQueueDecision: vi.fn(),
}));

vi.mock("@/lib/sync/worker-state", () => ({
  isLocalSyncRunProtected: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  expireStaleSyncRuns,
  enqueueSyncRun,
  cancelSyncRun,
  finalizeSyncRun,
  isSyncRunCancelled,
} from "@/lib/sync/coordinator";
import { isLocalSyncRunProtected } from "@/lib/sync/worker-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "running",
    source: "mode",
    startedAt: new Date("2026-04-08T11:00:00Z"),
    leaseExpiresAt: new Date("2026-04-08T11:30:00Z"),
    workerId: "worker-1",
    errorMessage: null,
    ...overrides,
  };
}

// Reset all mock state before each test so calls don't bleed across.
beforeEach(() => {
  vi.resetAllMocks();
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({
    returning: mockReturning,
    limit: mockLimit,
    orderBy: mockOrderBy,
  });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  vi.mocked(isLocalSyncRunProtected).mockReturnValue(false);
});

describe("expireStaleSyncRuns", () => {
  it("marks overdue running syncs as stale_timeout and closes open phases", async () => {
    const now = Date.now();
    mockLimit.mockResolvedValueOnce([
      makeRow({
        id: 55,
        source: "mode",
        startedAt: new Date(now - 20 * 60_000),
        leaseExpiresAt: new Date(now - 60_000), // lease expired — abandoned
        workerId: "worker-55",
      }),
    ]);
    mockReturning
      .mockResolvedValueOnce([makeRow({ id: 55, status: "error" })])
      .mockResolvedValueOnce([]);

    const result = await expireStaleSyncRuns("mode");

    expect(result).toEqual([55]);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        skipReason: "stale_timeout",
        leaseExpiresAt: null,
        errorMessage: expect.stringContaining("stale timeout"),
      })
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("does not expire runs that are still heartbeating", async () => {
    const now = Date.now();
    mockLimit.mockResolvedValueOnce([
      makeRow({
        id: 56,
        startedAt: new Date(now - 20 * 60_000),
        leaseExpiresAt: new Date(now + 60_000), // lease still valid
      }),
    ]);

    const result = await expireStaleSyncRuns("mode");

    expect(result).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("leaves locally protected runs untouched", async () => {
    vi.mocked(isLocalSyncRunProtected).mockReturnValue(true);
    const now = Date.now();
    mockLimit.mockResolvedValueOnce([
      makeRow({
        id: 57,
        startedAt: new Date(now - 20 * 60_000),
        leaseExpiresAt: new Date(now - 60_000),
      }),
    ]);

    const result = await expireStaleSyncRuns("mode");

    expect(result).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("enqueueSyncRun", () => {
  it("persists the requested Mode report token on queued scoped runs", async () => {
    const { evaluateQueueDecision } = await import("@/lib/sync/config");
    vi.mocked(evaluateQueueDecision).mockReturnValue({
      shouldQueue: true,
      outcome: "queued",
      reason: null,
      nextEligibleAt: null,
    });
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockInsertReturning.mockResolvedValueOnce([{ id: 41 }]);

    const result = await enqueueSyncRun("mode", {
      trigger: "manual",
      scope: { reportToken: "report-alpha" },
    });

    expect(result).toEqual({
      outcome: "queued",
      runId: 41,
      reason: null,
      nextEligibleAt: null,
    });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "mode",
        trigger: "manual",
        scope: { reportToken: "report-alpha" },
      })
    );
  });

  it("reports whether the conflicting Mode run is full-source or scoped", async () => {
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
      { id: 99, status: "running", source: "mode", scope: null },
      ]);

    const result = await enqueueSyncRun("mode", {
      trigger: "manual",
      scope: { reportToken: "report-alpha" },
    });

    expect(result).toEqual({
      outcome: "already-running",
      runId: 99,
      reason: "running",
      nextEligibleAt: null,
      activeScopeDescription: "all Mode reports",
    });
  });
});

// ---------------------------------------------------------------------------
// cancelSyncRun — atomic CAS
// ---------------------------------------------------------------------------

describe("cancelSyncRun", () => {
  it("returns cancelled:true when the UPDATE matches a queued row", async () => {
    mockReturning.mockResolvedValueOnce([makeRow({ status: "cancelled" })]);

    const result = await cancelSyncRun(1);

    expect(result).toEqual({ cancelled: true });
    // One UPDATE for syncLog cancellation, one for closeOpenPhases on syncPhases
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("returns cancelled:true when the UPDATE matches a running row", async () => {
    mockReturning.mockResolvedValueOnce([makeRow({ status: "cancelled" })]);

    const result = await cancelSyncRun(42);

    expect(result.cancelled).toBe(true);
  });

  it("returns not_cancellable when the row exists but is terminal", async () => {
    // Atomic UPDATE matches nothing (row is terminal)
    mockReturning.mockResolvedValueOnce([]);
    // Existence SELECT finds the row
    mockLimit.mockResolvedValueOnce([makeRow({ status: "success" })]);

    const result = await cancelSyncRun(1);

    expect(result).toEqual({ cancelled: false, reason: "not_cancellable" });
  });

  it("returns not_found when no row exists with the given id", async () => {
    mockReturning.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([]);

    const result = await cancelSyncRun(999);

    expect(result).toEqual({ cancelled: false, reason: "not_found" });
  });

  it("does NOT do a pre-flight SELECT before the UPDATE", async () => {
    // After the fix, the only SELECT is the post-failure existence check.
    mockReturning.mockResolvedValueOnce([makeRow({ status: "cancelled" })]);

    await cancelSyncRun(1);

    // db.select should NOT have been called (no pre-flight read)
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("cancelled row remains terminal — second cancel returns not_cancellable", async () => {
    // First cancel succeeds
    mockReturning.mockResolvedValueOnce([makeRow({ status: "cancelled" })]);
    await cancelSyncRun(1);

    vi.resetAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({
      returning: mockReturning,
      limit: mockLimit,
      orderBy: mockOrderBy,
    });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });

    // Second cancel: UPDATE matches nothing (already cancelled)
    mockReturning.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([makeRow({ status: "cancelled" })]);

    const result = await cancelSyncRun(1);

    expect(result).toEqual({ cancelled: false, reason: "not_cancellable" });
  });
});

// ---------------------------------------------------------------------------
// finalizeSyncRun — CAS guard
// ---------------------------------------------------------------------------

describe("finalizeSyncRun", () => {
  it("returns finalized:true when the UPDATE matches an active row", async () => {
    mockReturning.mockResolvedValueOnce([makeRow({ status: "success" })]);

    const result = await finalizeSyncRun(1, { status: "success" });

    expect(result).toEqual({ finalized: true });
  });

  it("returns finalized:false when no rows were updated (row already terminal)", async () => {
    mockReturning.mockResolvedValueOnce([]);

    const result = await finalizeSyncRun(1, { status: "success" });

    expect(result).toEqual({ finalized: false });
  });

  it("returns finalized:false when row was already cancelled", async () => {
    mockReturning.mockResolvedValueOnce([]);

    const result = await finalizeSyncRun(1, { status: "partial" });

    expect(result).toEqual({ finalized: false });
  });

  it("issues only one db.update when the row is already terminal (no phase close)", async () => {
    // If finalized:false, closeOpenPhases must not fire (no second db.update)
    mockReturning.mockResolvedValueOnce([]);

    await finalizeSyncRun(1, { status: "cancelled" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// isSyncRunCancelled
// ---------------------------------------------------------------------------

describe("isSyncRunCancelled", () => {
  it("returns true when the DB row has status cancelled", async () => {
    mockLimit.mockResolvedValueOnce([{ status: "cancelled" }]);

    expect(await isSyncRunCancelled(1)).toBe(true);
  });

  it("returns false when the DB row has status running", async () => {
    mockLimit.mockResolvedValueOnce([{ status: "running" }]);

    expect(await isSyncRunCancelled(1)).toBe(false);
  });

  it("returns false when the DB row has status success", async () => {
    mockLimit.mockResolvedValueOnce([{ status: "success" }]);

    expect(await isSyncRunCancelled(1)).toBe(false);
  });

  it("returns false when no row is found", async () => {
    mockLimit.mockResolvedValueOnce([]);

    expect(await isSyncRunCancelled(1)).toBe(false);
  });
});
