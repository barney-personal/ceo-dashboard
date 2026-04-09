import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAnd,
  mockDesc,
  mockEq,
  mockFrom,
  mockInnerJoin,
  mockOrderBy,
  mockSelect,
  mockWhere,
} = vi.hoisted(() => {
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockAnd: vi.fn((...conditions: unknown[]) => conditions),
    mockDesc: vi.fn((value: unknown) => value),
    mockEq: vi.fn((left: unknown, right: unknown) => [left, right]),
    mockFrom,
    mockInnerJoin,
    mockOrderBy,
    mockSelect,
    mockWhere,
  };
});

vi.mock("drizzle-orm", () => ({
  and: mockAnd,
  desc: mockDesc,
  eq: mockEq,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  modeReports: {
    id: "modeReports.id",
    name: "modeReports.name",
    section: "modeReports.section",
    category: "modeReports.category",
  },
  modeReportData: {
    reportId: "modeReportData.reportId",
    queryName: "modeReportData.queryName",
    columns: "modeReportData.columns",
    data: "modeReportData.data",
    rowCount: "modeReportData.rowCount",
    syncedAt: "modeReportData.syncedAt",
  },
  syncLog: {
    completedAt: "syncLog.completedAt",
    source: "syncLog.source",
    status: "syncLog.status",
  },
}));

import { getReportData, resetReportDataCacheForTests } from "../mode";

function createReportRows(rowValue: number) {
  return [
    {
      reportName: "Strategic Finance KPIs",
      section: "unit-economics",
      category: "kpis",
      queryName: "Query 1",
      columns: [{ name: "value", type: "number" }],
      data: [{ value: rowValue }],
      rowCount: 1,
      syncedAt: new Date("2026-04-08T09:00:00.000Z"),
    },
  ];
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetReportDataCacheForTests();
  mockAnd.mockClear();
  mockDesc.mockClear();
  mockEq.mockClear();
  mockFrom.mockClear();
  mockInnerJoin.mockClear();
  mockOrderBy.mockReset();
  mockSelect.mockClear();
  mockWhere.mockClear();
});

describe("getReportData cache", () => {
  it("reuses a successful result within the TTL", async () => {
    mockOrderBy.mockResolvedValueOnce(createReportRows(12));

    const first = await getReportData("unit-economics", "kpis");
    const second = await getReportData("unit-economics", "kpis");

    expect(first).toEqual([
      expect.objectContaining({
        rows: [{ value: 12 }],
      }),
    ]);
    expect(second).toEqual(first);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests for the same cache key", async () => {
    const deferred = createDeferred<ReturnType<typeof createReportRows>>();
    mockOrderBy.mockReturnValueOnce(deferred.promise);

    const first = getReportData("unit-economics", "kpis");
    const second = getReportData("unit-economics", "kpis");

    expect(mockSelect).toHaveBeenCalledTimes(1);

    deferred.resolve(createReportRows(18));

    await expect(Promise.all([first, second])).resolves.toEqual([
      [
        expect.objectContaining({
          rows: [{ value: 18 }],
        }),
      ],
      [
        expect.objectContaining({
          rows: [{ value: 18 }],
        }),
      ],
    ]);
  });

  it("expires entries after the TTL and queries again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T09:00:00.000Z"));

    mockOrderBy
      .mockResolvedValueOnce(createReportRows(21))
      .mockResolvedValueOnce(createReportRows(34));

    await expect(getReportData("unit-economics", "kpis")).resolves.toEqual([
      expect.objectContaining({
        rows: [{ value: 21 }],
      }),
    ]);

    await expect(getReportData("unit-economics", "kpis")).resolves.toEqual([
      expect.objectContaining({
        rows: [{ value: 21 }],
      }),
    ]);

    vi.advanceTimersByTime(60_001);

    await expect(getReportData("unit-economics", "kpis")).resolves.toEqual([
      expect.objectContaining({
        rows: [{ value: 34 }],
      }),
    ]);

    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("scopes cache entries by section and category", async () => {
    mockOrderBy
      .mockResolvedValueOnce(createReportRows(1))
      .mockResolvedValueOnce(createReportRows(2))
      .mockResolvedValueOnce(createReportRows(3));

    await getReportData("unit-economics", "kpis");
    await getReportData("unit-economics", "cac");
    await getReportData("product", "active-users");

    expect(mockSelect).toHaveBeenCalledTimes(3);
  });

  it("does not cache degraded fallback responses", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    mockOrderBy
      .mockRejectedValueOnce({
        code: "57P01",
        message: "admin shutdown",
      })
      .mockResolvedValueOnce(createReportRows(55));

    await expect(getReportData("unit-economics", "kpis")).resolves.toEqual([]);
    await expect(getReportData("unit-economics", "kpis")).resolves.toEqual([
      expect.objectContaining({
        rows: [{ value: 55 }],
      }),
    ]);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("does not cache thrown errors", async () => {
    mockOrderBy
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(createReportRows(89));

    await expect(getReportData("unit-economics", "kpis")).rejects.toThrow(
      "boom"
    );
    await expect(getReportData("unit-economics", "kpis")).resolves.toEqual([
      expect.objectContaining({
        rows: [{ value: 89 }],
      }),
    ]);

    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});
