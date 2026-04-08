import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted ensures these fns are created before vi.mock factories run
// ---------------------------------------------------------------------------

const { mockReturning, mockLimit, mockWhere, mockSet, mockFrom, mockUpdate, mockSelect } =
  vi.hoisted(() => {
    const mockReturning = vi.fn();
    const mockLimit = vi.fn();
    const mockWhere = vi.fn(() => ({ returning: mockReturning, limit: mockLimit }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    return { mockReturning, mockLimit, mockWhere, mockSet, mockFrom, mockUpdate, mockSelect };
  });

// ---------------------------------------------------------------------------
// DB mock — returns controllable values for each chained Drizzle call.
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    update: mockUpdate,
    select: mockSelect,
    insert: vi.fn(),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  syncLog: { id: "id", status: "status", source: "source" },
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
}));

vi.mock("@/lib/sync/config", () => ({
  getSyncSourceConfig: vi.fn(() => ({
    leaseMs: 60_000,
    maxAttempts: 3,
    intervalMs: 14_400_000,
    retryAfterErrorMs: 600_000,
  })),
  evaluateQueueDecision: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  cancelSyncRun,
  finalizeSyncRun,
  isSyncRunCancelled,
} from "@/lib/sync/coordinator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return { id: 1, status: "running", source: "mode", ...overrides };
}

// Reset all mock state before each test so calls don't bleed across.
beforeEach(() => {
  vi.resetAllMocks();
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ returning: mockReturning, limit: mockLimit });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
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
    mockWhere.mockReturnValue({ returning: mockReturning, limit: mockLimit });
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
