import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
}));

import {
  formatCompact,
  formatCurrency,
  formatPercent,
  getQueryRow,
} from "../metrics";

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
    expect(getQueryRow(data, "CPA", { time_period: "Previous 365 days" })).toEqual({
      time_period: "Previous 365 days",
      avg_cpa: 34,
    });
  });

  it("returns null when the query or row match is missing", () => {
    expect(getQueryRow(data, "Missing")).toBeNull();
    expect(getQueryRow(data, "CPA", { time_period: "Yesterday" })).toBeNull();
  });
});
