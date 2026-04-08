import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  protectLocalSyncRun,
  releaseLocalSyncRun,
  resetLocalSyncRunProtectionForTest,
} from "../worker-state";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  selectFrom: vi.fn(),
  selectWhere: vi.fn(),
  selectOrderBy: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  closePhasesWhere: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

import { expireAbandonedSyncRuns } from "../coordinator";

describe("expireAbandonedSyncRuns", () => {
  const expiredRun = {
    id: 17,
    source: "slack",
    status: "running",
    startedAt: new Date("2026-04-08T12:00:00Z"),
    completedAt: null,
    trigger: "manual",
    attempt: 1,
    maxAttempts: 1,
    heartbeatAt: new Date("2026-04-08T12:00:30Z"),
    leaseExpiresAt: new Date("2026-04-08T12:02:00Z"),
    workerId: "worker-1",
    recordsSynced: 0,
    skipReason: null,
    errorMessage: null,
  };

  beforeEach(() => {
    resetLocalSyncRunProtectionForTest();

    mocks.select.mockReset();
    mocks.selectFrom.mockReset();
    mocks.selectWhere.mockReset();
    mocks.selectOrderBy.mockReset();
    mocks.update.mockReset();
    mocks.updateSet.mockReset();
    mocks.updateWhere.mockReset();
    mocks.updateReturning.mockReset();
    mocks.closePhasesWhere.mockReset();

    mocks.selectOrderBy.mockResolvedValue([expiredRun]);
    mocks.selectWhere.mockReturnValue({ orderBy: mocks.selectOrderBy });
    mocks.selectFrom.mockReturnValue({ where: mocks.selectWhere });
    mocks.select.mockReturnValue({ from: mocks.selectFrom });
  });

  it("does not expire a locally protected run whose Postgres lease has gone stale", async () => {
    protectLocalSyncRun({
      runId: expiredRun.id,
      source: "slack",
      workerId: expiredRun.workerId,
    });

    await expect(expireAbandonedSyncRuns("slack")).resolves.toEqual([]);

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("expires the run after local protection is released", async () => {
    mocks.updateReturning.mockResolvedValue([{ id: expiredRun.id }]);
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.closePhasesWhere.mockResolvedValue(undefined);
    mocks.updateSet
      .mockImplementationOnce(() => ({ where: mocks.updateWhere }))
      .mockImplementationOnce(() => ({ where: mocks.closePhasesWhere }));
    mocks.update.mockReturnValue({ set: mocks.updateSet });

    protectLocalSyncRun({
      runId: expiredRun.id,
      source: "slack",
      workerId: expiredRun.workerId,
    });
    releaseLocalSyncRun(expiredRun.id);

    await expect(expireAbandonedSyncRuns("slack")).resolves.toEqual([17]);

    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
