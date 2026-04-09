import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockCaptureException,
  mockCaptureMessage,
  mockAnd,
  mockDesc,
  mockEq,
  mockFrom,
  mockInnerJoin,
  mockOrderBy,
  mockSelect,
  mockWhere,
} = vi.hoisted(() => {
  const mockCaptureException = vi.fn();
  const mockCaptureMessage = vi.fn();
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin, where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockCaptureException,
    mockCaptureMessage,
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

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
}));

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
    startedAt: "syncLog.startedAt",
    status: "syncLog.status",
  },
}));

import {
  getReportData,
  getLatestTerminalSyncRun,
  getModeEmptyStateReason,
  resetReportDataCacheForTests,
  REPORT_DATA_CACHE_MAX_ENTRIES,
  validateModeColumns,
} from "../mode";

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

function createSyncRows(
  ...rows: Array<{
    status: string;
    startedAt: Date;
    completedAt?: Date | null;
  }>
) {
  return rows.map((row) => ({
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
  }));
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
  mockCaptureException.mockClear();
  mockCaptureMessage.mockClear();
  mockAnd.mockClear();
  mockDesc.mockClear();
  mockEq.mockClear();
  mockFrom.mockClear();
  mockInnerJoin.mockClear();
  mockOrderBy.mockReset();
  mockSelect.mockClear();
  mockWhere.mockClear();
});

describe("validateModeColumns", () => {
  it("returns present and missing columns and warns when required columns are absent", () => {
    const result = validateModeColumns({
      row: { week: "2026-04-01", actual: 42 },
      expectedColumns: ["week", "actual", "target"] as const,
      reportName: "Strategic Finance KPIs",
      queryName: "Query 3",
    });

    expect(result).toEqual({
      expectedColumns: ["week", "actual", "target"],
      presentColumns: ["week", "actual"],
      missingColumns: ["target"],
      isValid: false,
    });
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "Mode schema drift: missing expected columns",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          reportName: "Strategic Finance KPIs",
          queryName: "Query 3",
          missingColumns: ["target"],
        }),
      })
    );
  });

  it("does not warn when every expected column is present", () => {
    const result = validateModeColumns({
      row: { week: "2026-04-01", actual: 42, target: 55 },
      expectedColumns: ["week", "actual", "target"] as const,
      reportName: "Strategic Finance KPIs",
      queryName: "Query 3",
    });

    expect(result).toEqual({
      expectedColumns: ["week", "actual", "target"],
      presentColumns: ["week", "actual", "target"],
      missingColumns: [],
      isValid: true,
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
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
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
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

  it("warns when expected queries are missing without changing the return value", async () => {
    mockOrderBy.mockResolvedValueOnce(createReportRows(12));

    await expect(
      getReportData("unit-economics", "kpis", ["Query 1", "Query 2"])
    ).resolves.toEqual([
      expect.objectContaining({
        queryName: "Query 1",
        rows: [{ value: 12 }],
      }),
    ]);

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "Mode schema drift: missing expected queries",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          section: "unit-economics",
          category: "kpis",
          missingQueries: ["Query 2"],
          availableQueryNames: ["Query 1"],
        }),
      })
    );
  });

  it("does not fragment the cache when expectedQueries changes", async () => {
    mockOrderBy.mockResolvedValueOnce(createReportRows(12));

    await getReportData("unit-economics", "kpis", ["Query 1"]);
    await getReportData("unit-economics", "kpis", ["Query 1", "Query 2"]);

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "Mode schema drift: missing expected queries",
      expect.objectContaining({
        extra: expect.objectContaining({
          missingQueries: ["Query 2"],
        }),
      })
    );
  });
});

describe("Mode sync metadata helpers", () => {
  it("returns the latest terminal sync run for a source", async () => {
    const failedAt = new Date("2026-04-09T11:30:00.000Z");

    mockOrderBy.mockResolvedValueOnce(
      createSyncRows(
        {
          status: "running",
          startedAt: new Date("2026-04-09T12:00:00.000Z"),
        },
        {
          status: "error",
          startedAt: new Date("2026-04-09T11:00:00.000Z"),
          completedAt: failedAt,
        },
        {
          status: "success",
          startedAt: new Date("2026-04-09T10:00:00.000Z"),
          completedAt: new Date("2026-04-09T10:20:00.000Z"),
        }
      )
    );

    await expect(getLatestTerminalSyncRun("mode")).resolves.toEqual({
      status: "error",
      completedAt: failedAt,
    });
  });

  it("returns a stale-data message when the latest mode sync failed and report data is empty", async () => {
    mockOrderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        createSyncRows({
          status: "error",
          startedAt: new Date("2026-04-09T11:00:00.000Z"),
          completedAt: new Date("2026-04-09T11:30:00.000Z"),
        })
      );

    await expect(
      getModeEmptyStateReason({
        section: "product",
        category: "active-users",
        emptyReason: "Sync the App Active Users report to view charts",
      })
    ).resolves.toMatch(
      /^Data temporarily unavailable — last sync failed at .+ UTC$/
    );
  });

  it("preserves the default empty-state reason when Mode has never synced successfully or failed", async () => {
    mockOrderBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      getModeEmptyStateReason({
        section: "product",
        category: "retention",
        emptyReason: "Sync the App Retention report to view MAU retention cohorts",
      })
    ).resolves.toBe("Sync the App Retention report to view MAU retention cohorts");
  });
});

describe("getReportData LRU eviction", () => {
  it("evicts the least-recently-used entry when the cache reaches the size limit", async () => {
    // Fill the cache to the max with distinct category keys.
    for (let i = 0; i < REPORT_DATA_CACHE_MAX_ENTRIES; i++) {
      mockOrderBy.mockResolvedValueOnce(createReportRows(i));
    }
    for (let i = 0; i < REPORT_DATA_CACHE_MAX_ENTRIES; i++) {
      await getReportData("unit-economics", `evict-cat-${i}`);
    }
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES);

    // Adding one more key should evict evict-cat-0 (oldest = LRU).
    mockOrderBy.mockResolvedValueOnce(createReportRows(REPORT_DATA_CACHE_MAX_ENTRIES));
    await getReportData("unit-economics", `evict-cat-${REPORT_DATA_CACHE_MAX_ENTRIES}`);
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES + 1);

    // Re-requesting evict-cat-0 should be a cache miss (it was evicted).
    mockOrderBy.mockResolvedValueOnce(createReportRows(0));
    await getReportData("unit-economics", "evict-cat-0");
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES + 2);
  });

  it("refreshes position of a cache hit, protecting it from eviction", async () => {
    // Fill the cache to the max.
    for (let i = 0; i < REPORT_DATA_CACHE_MAX_ENTRIES; i++) {
      mockOrderBy.mockResolvedValueOnce(createReportRows(i));
    }
    for (let i = 0; i < REPORT_DATA_CACHE_MAX_ENTRIES; i++) {
      await getReportData("unit-economics", `lru-cat-${i}`);
    }
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES);

    // Access lru-cat-0 (a cache hit) to move it to MRU position.
    // Now lru-cat-1 is the new LRU.
    await getReportData("unit-economics", "lru-cat-0");
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES); // no DB call

    // Adding a new key should evict lru-cat-1 (now LRU), not lru-cat-0.
    mockOrderBy.mockResolvedValueOnce(createReportRows(REPORT_DATA_CACHE_MAX_ENTRIES));
    await getReportData("unit-economics", `lru-cat-${REPORT_DATA_CACHE_MAX_ENTRIES}`);
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES + 1);

    // lru-cat-0 should still be cached (was refreshed to MRU).
    await getReportData("unit-economics", "lru-cat-0");
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES + 1); // no DB call

    // lru-cat-1 should be evicted (cache miss).
    mockOrderBy.mockResolvedValueOnce(createReportRows(1));
    await getReportData("unit-economics", "lru-cat-1");
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES + 2);
  });

  it("prefers evicting resolved entries over pending entries", async () => {
    // Fill cache with (max - 1) resolved entries.
    for (let i = 0; i < REPORT_DATA_CACHE_MAX_ENTRIES - 1; i++) {
      mockOrderBy.mockResolvedValueOnce(createReportRows(i));
    }
    for (let i = 0; i < REPORT_DATA_CACHE_MAX_ENTRIES - 1; i++) {
      await getReportData("unit-economics", `pend-cat-${i}`);
    }
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES - 1);

    // Add a pending entry (one slot left, cache now full).
    const deferred = createDeferred<ReturnType<typeof createReportRows>>();
    mockOrderBy.mockReturnValueOnce(deferred.promise);
    const pendingRequest = getReportData("unit-economics", `pend-cat-${REPORT_DATA_CACHE_MAX_ENTRIES - 1}`);
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES);

    // Adding one more key should evict the oldest resolved entry (pend-cat-0), NOT the pending entry.
    mockOrderBy.mockResolvedValueOnce(createReportRows(REPORT_DATA_CACHE_MAX_ENTRIES));
    await getReportData("unit-economics", `pend-cat-${REPORT_DATA_CACHE_MAX_ENTRIES}`);
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES + 1);

    // The pending entry should still be in the cache and deduplicate correctly.
    const secondPendingRequest = getReportData("unit-economics", `pend-cat-${REPORT_DATA_CACHE_MAX_ENTRIES - 1}`);
    expect(mockSelect).toHaveBeenCalledTimes(REPORT_DATA_CACHE_MAX_ENTRIES + 1); // no new DB call

    deferred.resolve(createReportRows(REPORT_DATA_CACHE_MAX_ENTRIES - 1));
    const [result1, result2] = await Promise.all([pendingRequest, secondPendingRequest]);
    expect(result1).toEqual(result2);
    expect(result1).toEqual([expect.objectContaining({ rows: [{ value: REPORT_DATA_CACHE_MAX_ENTRIES - 1 }] })]);
  });
});
