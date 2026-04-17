import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData, mockParseRows } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
  mockParseRows: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  parseRows: mockParseRows,
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
  mockParseRows.mockReset();
  mockParseRows.mockImplementation((_schema, rows) => ({
    valid: [...rows],
    invalidCount: 0,
  }));
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
    mockParseRows
      .mockImplementationOnce((_schema, rows) => ({
        valid: [...rows],
        invalidCount: 0,
      }))
      .mockImplementationOnce((_schema, rows) => ({
        valid: [],
        invalidCount: rows.length,
      }))
      .mockImplementationOnce((_schema, rows) => ({
        valid: [...rows],
        invalidCount: 0,
      }))
      .mockImplementationOnce((_schema, rows) => ({
        valid: [...rows],
        invalidCount: 0,
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
    expect(mockParseRows).toHaveBeenCalledTimes(4);
  });
});

describe("getHeadcountMetrics", () => {
  it("returns the empty fallback when headcount columns drift", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Headcount SSoT",
        queryName: "headcount",
        syncedAt: new Date("2026-04-08T12:00:00Z"),
        rows: [{ lifecycle_status: "employed" }],
      },
    ]);
    mockParseRows.mockReturnValue({
      valid: [],
      invalidCount: 1,
    });

    const metrics = await getHeadcountMetrics();

    expect(metrics).toEqual({ total: null, lastSync: null });
    expect(mockGetReportData).toHaveBeenCalledWith("people", "headcount", [
      "headcount",
    ]);
    expect(mockParseRows).toHaveBeenCalledTimes(1);
  });
});
