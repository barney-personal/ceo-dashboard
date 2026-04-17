import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const mockMessages = vi.hoisted(() => ({ create: vi.fn() }));
const mockSentry = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = mockMessages;
  },
}));

vi.mock("@sentry/nextjs", () => mockSentry);

import {
  parseManagementAccounts,
  extractPeriodFromFilename,
} from "../excel-parser";

function makeExcelBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Metric", "Jan 2026"],
    ["Revenue", 28.5],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Summary");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("parseManagementAccounts", () => {
  beforeEach(() => {
    mockMessages.create.mockReset();
    mockSentry.captureMessage.mockReset();
    mockSentry.captureException.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns structured financial data on valid LLM response", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            period: "2026-01",
            periodLabel: "January 2026",
            revenue: 28.5,
            grossProfit: 22.0,
            grossMargin: 0.77,
            contributionProfit: 15.0,
            contributionMargin: 0.53,
            ebitda: -2.0,
            ebitdaMargin: -0.07,
            netIncome: -3.0,
            cashPosition: 100.0,
            cashBurn: -4.0,
            opex: 20.0,
            headcountCost: 15.0,
            marketingCost: 3.0,
          }),
        },
      ],
    });

    const result = await parseManagementAccounts(makeExcelBuffer(), "test.xlsx");
    expect(result).not.toBeNull();
    expect(result!.period).toBe("2026-01");
    expect(result!.revenue).toBe(28.5);
    expect(result!.rawSheets).toHaveProperty("Summary");
  });

  it("returns null and emits Sentry on invalid JSON from LLM", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "This is not JSON at all" }],
    });

    const result = await parseManagementAccounts(makeExcelBuffer(), "test.xlsx");
    expect(result).toBeNull();
    expect(mockSentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ llm_parse_invalid: "true" }),
      }),
    );
  });

  it("returns null and emits Sentry when LLM returns out-of-bound margins", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            period: "2026-01",
            periodLabel: "January 2026",
            revenue: 28.5,
            grossMargin: 5.0,
          }),
        },
      ],
    });

    const result = await parseManagementAccounts(makeExcelBuffer(), "test.xlsx");
    expect(result).toBeNull();
    expect(mockSentry.captureMessage).toHaveBeenCalledWith(
      "Management accounts extract failed zod validation",
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "excel-parser",
          llm_parse_invalid: "true",
        }),
        extra: expect.objectContaining({
          operation: "parseManagementAccounts",
        }),
      }),
    );
  });

  it("returns null when LLM returns period in wrong format", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            period: "January 2026",
            periodLabel: "January 2026",
            revenue: 28.5,
          }),
        },
      ],
    });

    const result = await parseManagementAccounts(makeExcelBuffer(), "test.xlsx");
    expect(result).toBeNull();
  });
});

describe("extractPeriodFromFilename", () => {
  it("extracts period from standard filename", () => {
    expect(extractPeriodFromFilename("0226 - Cleo AI Management Accounts.xlsx")).toBe(
      "2026-02",
    );
  });

  it("returns null for non-matching filename", () => {
    expect(extractPeriodFromFilename("report.xlsx")).toBeNull();
  });
});
