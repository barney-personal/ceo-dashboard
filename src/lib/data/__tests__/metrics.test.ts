import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData, mockValidateModeColumns } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
  mockValidateModeColumns: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  validateModeColumns: mockValidateModeColumns,
  rowStr: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "string" ? row[key] : row[key] != null ? String(row[key]) : "",
  rowNum: (row: Record<string, unknown>, key: string, fallback = 0) =>
    typeof row[key] === "number" ? row[key] : fallback,
  rowNumOrNull: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "number" ? row[key] : null,
}));

import {
  formatCompact,
  formatCurrency,
  formatPercent,
} from "@/lib/format/number";
import {
  getHeadcountMetrics,
  getQueryRow,
  getUnitEconomicsMetrics,
} from "../metrics";

beforeEach(() => {
  mockValidateModeColumns.mockReset();
  mockValidateModeColumns.mockReturnValue({
    expectedColumns: [],
    presentColumns: [],
    missingColumns: [],
    isValid: true,
  });
});

afterEach(() => {
  mockGetReportData.mockReset();
});

describe("formatCurrency", () => {
  it("formats USD values with configurable decimals", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(1234.5, 0)).toBe("$1,235");
  });
});

describe("formatPercent", () => {
  it("formats ratios as percentages", () => {
    expect(formatPercent(0.1234)).toBe("12.3%");
    expect(formatPercent(0.1234, 2)).toBe("12.34%");
  });
});

describe("formatCompact", () => {
  it("formats values with compact suffixes", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1250)).toBe("1.3K");
    expect(formatCompact(1_250_000)).toBe("1.3M");
  });
});

describe("getQueryRow", () => {
  const data = [
    {
      queryName: "CPA",
      rows: [
        { time_period: "Last 30 days", avg_cpa: 12 },
        { time_period: "Previous 365 days", avg_cpa: 34 },
      ],
    },
    {
      queryName: "ARPU",
      rows: [{ arpmau: 99 }],
    },
  ] as Awaited<ReturnType<typeof mockGetReportData>>;

  it("returns the first row when no matcher is provided", () => {
    expect(getQueryRow(data, "ARPU")).toEqual({ arpmau: 99 });
  });

  it("returns the row matching the provided field constraints", () => {
    expect(
      getQueryRow(data, "CPA", { time_period: "Previous 365 days" }),
    ).toEqual({
      time_period: "Previous 365 days",
      avg_cpa: 34,
    });
  });

  it("returns null when the query or row match is missing", () => {
    expect(getQueryRow(data, "Missing")).toBeNull();
    expect(getQueryRow(data, "CPA", { time_period: "Yesterday" })).toBeNull();
  });
});

describe("getUnitEconomicsMetrics", () => {
  it("returns the null fallback when a required KPI column drifts", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Strategic Finance KPIs",
        queryName: "36M LTV",
        rows: [{ user_pnl_36m: 240 }],
      },
      {
        reportName: "Strategic Finance KPIs",
        queryName: "ARPU Annualized",
        rows: [
          {
            arpmau: 10,
            gross_margin: 0.4,
            contribution_margin: 0.2,
            mau: 1000,
          },
        ],
      },
      {
        reportName: "Strategic Finance KPIs",
        queryName: "CPA",
        rows: [{ time_period: "Previous 365 days", avg_cpa: 30 }],
      },
      {
        reportName: "Strategic Finance KPIs",
        queryName: "M11 Plus CVR, past 7 days",
        rows: [{ average_7d_plus_m11_cvr: 0.1 }],
      },
      {
        reportName: "Strategic Finance KPIs",
        queryName: "Subscribers at end of period: Growth accounting",
        rows: [{ total: 123 }],
      },
    ]);
    mockValidateModeColumns.mockImplementation(({ queryName }) => ({
      expectedColumns: [],
      presentColumns: [],
      missingColumns:
        queryName === "ARPU Annualized" ? ["monthly_revenue"] : [],
      isValid: queryName !== "ARPU Annualized",
    }));

    const metrics = await getUnitEconomicsMetrics();

    expect(metrics).toEqual({
      ltv: null,
      arpu: null,
      grossMargin: null,
      contributionMargin: null,
      cpa: null,
      cvr: null,
      mau: null,
      revenue: null,
      ltvCac: null,
      subscribers: null,
    });
    expect(mockGetReportData).toHaveBeenCalledWith("unit-economics", "kpis", [
      "36M LTV",
      "ARPU Annualized",
      "CPA",
      "M11 Plus CVR, past 7 days",
      "Subscribers at end of period: Growth accounting",
    ]);
    expect(mockValidateModeColumns).toHaveBeenCalledTimes(4);
  });
});

describe("getHeadcountMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the empty fallback when headcount columns drift", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Headcount SSoT",
        queryName: "headcount",
        syncedAt: new Date("2026-04-08T12:00:00Z"),
        rows: [{ start_date: "2025-01-01" }],
      },
    ]);
    mockValidateModeColumns.mockReturnValue({
      expectedColumns: ["start_date", "termination_date", "headcount_label"],
      presentColumns: ["start_date"],
      missingColumns: ["termination_date", "headcount_label"],
      isValid: false,
    });

    const metrics = await getHeadcountMetrics();

    expect(metrics).toEqual({ total: null, lastSync: null });
    expect(mockGetReportData).toHaveBeenCalledWith("people", "headcount", [
      "headcount",
    ]);
    expect(mockValidateModeColumns).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedColumns: ["start_date", "termination_date", "headcount_label"],
      }),
    );
  });

  it("counts only FTE-active rows (Mode SSoT definition)", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Headcount SSoT",
        queryName: "headcount",
        syncedAt: new Date("2026-04-08T12:00:00Z"),
        rows: [
          // ✓ FTE active
          { headcount_label: "FTE", start_date: "2025-01-01", termination_date: null },
          { headcount_label: "FTE", start_date: "2025-06-01", termination_date: null },
          // ✗ FTE terminated yesterday
          { headcount_label: "FTE", start_date: "2024-01-01", termination_date: "2026-04-07" },
          // ✗ FTE not yet started
          { headcount_label: "FTE", start_date: "2026-05-01", termination_date: null },
          // ✗ CS active (different label)
          { headcount_label: "CS", start_date: "2025-01-01", termination_date: null },
          // ✗ Contractor active (different label)
          { headcount_label: "Contractor", start_date: "2025-01-01", termination_date: null },
        ],
      },
    ]);

    const metrics = await getHeadcountMetrics();

    expect(metrics).toEqual({
      total: 2,
      lastSync: new Date("2026-04-08T12:00:00Z"),
    });
  });
});
