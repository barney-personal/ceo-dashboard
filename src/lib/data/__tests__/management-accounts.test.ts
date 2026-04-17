import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetManagementAccountFiles, mockGetSheetData } = vi.hoisted(() => ({
  mockGetManagementAccountFiles: vi.fn(),
  mockGetSheetData: vi.fn(),
}));

vi.mock("@/lib/integrations/slack-files", () => ({
  getManagementAccountFiles: mockGetManagementAccountFiles,
}));

vi.mock("@/lib/integrations/excel-sheets", () => ({
  getSheetData: mockGetSheetData,
}));

vi.mock("@/lib/integrations/excel-parser", () => ({
  extractPeriodFromFilename: (name: string) => {
    const match = /(\d{4})-(\d{2})/.exec(name);
    return match ? `${match[1]}-${match[2]}` : null;
  },
}));

import { getManagementAccountsData } from "../management-accounts";

afterEach(() => {
  mockGetManagementAccountFiles.mockReset();
  mockGetSheetData.mockReset();
});

describe("getManagementAccountsData", () => {
  it("returns null when no management account files have been synced yet", async () => {
    mockGetManagementAccountFiles.mockResolvedValue([]);

    await expect(getManagementAccountsData()).resolves.toBeNull();
    expect(mockGetSheetData).not.toHaveBeenCalled();
  });

  it("propagates Slack API failures instead of masking them as empty", async () => {
    mockGetManagementAccountFiles.mockRejectedValue(
      new Error("slack_api_error: invalid_auth")
    );

    await expect(getManagementAccountsData()).rejects.toThrow(
      /slack_api_error/
    );
  });

  it("propagates download / sheet parse failures instead of masking them as empty", async () => {
    mockGetManagementAccountFiles.mockResolvedValue([
      {
        id: "F1",
        name: "Management Accounts 2026-03.xlsx",
        filetype: "xlsx",
        size: 1024,
        url_private_download: "https://example.invalid/file.xlsx",
        permalink: "https://slack.example/permalink",
        timestamp: 1_700_000_000,
        user: "U1",
        channels: ["C1"],
      },
    ]);
    mockGetSheetData.mockRejectedValue(new Error("xlsx parse failed"));

    await expect(getManagementAccountsData()).rejects.toThrow(
      /xlsx parse failed/
    );
  });

  it("returns parsed data for the latest file when files exist", async () => {
    mockGetManagementAccountFiles.mockResolvedValue([
      {
        id: "F_MAR",
        name: "Management Accounts 2026-03.xlsx",
        filetype: "xlsx",
        size: 1024,
        url_private_download: "https://example.invalid/mar.xlsx",
        permalink: "https://slack.example/mar",
        timestamp: 1_700_000_200,
        user: "U1",
        channels: ["C1"],
      },
    ]);
    mockGetSheetData.mockResolvedValue({
      sheets: { "P&L Summary": [["ARR", "", 2_000_000]] },
      sheetNames: ["P&L Summary"],
    });

    const result = await getManagementAccountsData();
    expect(result).not.toBeNull();
    expect(result?.currentFile.period).toBe("2026-03");
    expect(result?.files).toHaveLength(1);
    expect(mockGetSheetData).toHaveBeenCalledWith(
      "F_MAR",
      "https://example.invalid/mar.xlsx"
    );
  });
});
