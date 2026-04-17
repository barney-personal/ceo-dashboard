import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const mockMessages = vi.hoisted(() => ({ create: vi.fn() }));
const mockSentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = mockMessages;
    },
  };
});

vi.mock("@sentry/nextjs", () => mockSentry);

import { parseManagementAccounts } from "../excel-parser";

function buildWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2026-02"],
    ["Revenue", 28.5],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "P&L Summary");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("management accounts extraction validation", () => {
  beforeEach(() => {
    mockMessages.create.mockReset();
    mockSentry.captureException.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses validated financial extraction payloads", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            period: "2026-02",
            periodLabel: "February 2026",
            revenue: 28.5,
            grossProfit: 20.1,
            grossMargin: 0.705,
            contributionProfit: null,
            contributionMargin: null,
            ebitda: 3.2,
            ebitdaMargin: 0.112,
            netIncome: -1.5,
            cashPosition: 18.4,
            cashBurn: 0.8,
            opex: 16.9,
            headcountCost: 7.1,
            marketingCost: 2.3,
          }),
        },
      ],
    });

    await expect(
      parseManagementAccounts(buildWorkbookBuffer(), "0226 - management accounts.xlsx"),
    ).resolves.toMatchObject({
      period: "2026-02",
      periodLabel: "February 2026",
      revenue: 28.5,
      grossProfit: 20.1,
      netIncome: -1.5,
      rawSheets: expect.objectContaining({
        "P&L Summary": expect.any(Array),
      }),
    });
  });

  it("rejects malformed management-accounts extraction JSON", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            period: "2026-02",
            periodLabel: "February 2026",
            revenue: "28.5",
            grossProfit: 20.1,
          }),
        },
      ],
    });

    await expect(
      parseManagementAccounts(buildWorkbookBuffer(), "0226 - management accounts.xlsx"),
    ).rejects.toThrow(/anthropic returned malformed management_accounts_extraction/i);

    expect(mockSentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ExternalValidationError",
        boundary: "management_accounts_extraction",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "management-accounts-extraction",
          validation_boundary: "management_accounts_extraction",
          validation_source: "anthropic",
        }),
        extra: expect.objectContaining({
          filenameHint: "0226 - management accounts.xlsx",
        }),
      }),
    );
  });
});
