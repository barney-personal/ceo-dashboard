import { afterEach, describe, expect, it, vi } from "vitest";

const { mockDesc, mockLimit, mockOrderBy, mockFrom, mockSelect } = vi.hoisted(
  () => {
    const mockLimit = vi.fn();
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockFrom = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));

    return {
      mockDesc: vi.fn((value) => value),
      mockLimit,
      mockOrderBy,
      mockFrom,
      mockSelect,
    };
  },
);

vi.mock("drizzle-orm", () => ({
  desc: mockDesc,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  syncLog: {
    startedAt: "startedAt",
  },
}));

import { getRecentSyncRuns } from "../sync";

afterEach(() => {
  mockDesc.mockClear();
  mockFrom.mockClear();
  mockLimit.mockReset();
  mockOrderBy.mockClear();
  mockSelect.mockClear();
});

describe("getRecentSyncRuns", () => {
  it("loads the most recent sync rows ordered by startedAt descending", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockLimit.mockResolvedValue(rows);

    await expect(getRecentSyncRuns(10)).resolves.toEqual(rows);

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith({ startedAt: "startedAt" });
    expect(mockDesc).toHaveBeenCalledWith("startedAt");
    expect(mockOrderBy).toHaveBeenCalledWith("startedAt");
    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it("surfaces Postgres outages as DatabaseUnavailableError", async () => {
    mockLimit.mockRejectedValue(new Error("fetch failed"));

    await expect(getRecentSyncRuns(10)).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });
});
