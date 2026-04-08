import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOrderBy,
  mockWhere,
  mockInnerJoin,
  mockFrom,
  mockSelect,
  mockInArray,
} = vi.hoisted(() => {
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockInArray = vi.fn((column: unknown, values: unknown[]) => ({
    inArray: [column, values],
  }));

  return {
    mockOrderBy,
    mockWhere,
    mockInnerJoin,
    mockFrom,
    mockSelect,
    mockInArray,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock("@/lib/db/errors", () => ({
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
  isSchemaCompatibilityError: vi.fn(() => false),
  normalizeDatabaseError: vi.fn((_context: string, error: unknown) => error),
}));

vi.mock("@/lib/db/schema", () => ({
  modeReports: {
    id: "mode_reports.id",
    name: "mode_reports.name",
    reportToken: "mode_reports.report_token",
    section: "mode_reports.section",
    category: "mode_reports.category",
  },
  modeReportData: {
    reportId: "mode_report_data.report_id",
    queryName: "mode_report_data.query_name",
    columns: "mode_report_data.columns",
    data: "mode_report_data.data",
    rowCount: "mode_report_data.row_count",
    syncedAt: "mode_report_data.synced_at",
  },
  syncLog: {
    completedAt: "sync_log.completed_at",
    source: "sync_log.source",
    status: "sync_log.status",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (column: unknown) => ({ desc: column }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: mockInArray,
}));

import { getReportData } from "../mode";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
});

describe("getReportData", () => {
  it("filters by configured report token instead of persisted category metadata", async () => {
    mockOrderBy.mockResolvedValue([
      {
        reportName: "Growth Marketing Performance",
        section: "unit-economics",
        category: null,
        queryName: "LTV:Paid CAC",
        columns: [],
        data: [{ period: "2026-03-31", ltv_36m: 120 }],
        rowCount: 1,
        syncedAt: new Date("2026-04-08T10:00:00Z"),
      },
    ]);

    const results = await getReportData("unit-economics", "cac");

    expect(mockInArray).toHaveBeenCalledWith("mode_reports.report_token", [
      "774f14224dd9",
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.queryName).toBe("LTV:Paid CAC");
  });
});
