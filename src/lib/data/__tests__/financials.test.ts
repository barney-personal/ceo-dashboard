import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/lib/db/schema", () => ({
  financialPeriods: { period: "period" },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((v) => v),
  sql: vi.fn(() => ({})),
}));

import {
  getFinancialPeriods,
  getLatestFinancialPeriod,
} from "../financials";

afterEach(() => {
  mockSelect.mockReset();
});

describe("getFinancialPeriods", () => {
  it("maps rows into typed FinancialPeriod objects", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        orderBy: async () => [
          {
            period: "2026-03",
            periodLabel: "March 2026",
            revenue: "1000.5",
            grossProfit: null,
            grossMargin: "0.25",
            contributionProfit: null,
            contributionMargin: null,
            ebitda: null,
            ebitdaMargin: null,
            netIncome: null,
            cashPosition: null,
            cashBurn: null,
            opex: null,
            headcountCost: null,
            marketingCost: null,
            slackSummary: null,
            postedAt: null,
          },
        ],
      }),
    }));

    const result = await getFinancialPeriods();
    expect(result).toEqual([
      expect.objectContaining({
        period: "2026-03",
        revenue: 1000.5,
        grossMargin: 0.25,
      }),
    ]);
  });

  it("surfaces Postgres outages as DatabaseUnavailableError", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        orderBy: async () => {
          throw new Error("connection terminated unexpectedly");
        },
      }),
    }));

    await expect(getFinancialPeriods()).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });

  it("rewrites schema rollout failures with the compatibility message", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        orderBy: async () => {
          const err = new Error('relation "financial_periods" does not exist');
          (err as unknown as { code: string }).code = "42P01";
          throw err;
        },
      }),
    }));

    await expect(getFinancialPeriods()).rejects.toThrow(/Render migration/);
  });
});

describe("getLatestFinancialPeriod", () => {
  it("returns null when no rows exist", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        orderBy: () => ({ limit: async () => [] }),
      }),
    }));

    await expect(getLatestFinancialPeriod()).resolves.toBeNull();
  });

  it("surfaces Postgres outages as DatabaseUnavailableError", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        orderBy: () => ({
          limit: async () => {
            throw new Error("fetch failed");
          },
        }),
      }),
    }));

    await expect(getLatestFinancialPeriod()).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });
});
