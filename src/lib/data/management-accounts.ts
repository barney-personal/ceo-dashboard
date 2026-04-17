import {
  getManagementAccountFiles,
  type SlackFile,
} from "@/lib/integrations/slack-files";
import { getSheetData, type ParsedSheets } from "@/lib/integrations/excel-sheets";
import { extractPeriodFromFilename } from "@/lib/integrations/excel-parser";

export interface FileInfo {
  id: string;
  name: string;
  period: string | null;
  periodLabel: string;
  permalink: string;
  timestamp: number;
}

function periodLabel(period: string | null): string {
  if (!period) return "Unknown";
  const date = new Date(period + "-01");
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function toFileInfo(f: SlackFile): FileInfo {
  const period = extractPeriodFromFilename(f.name);
  return {
    id: f.id,
    name: f.name,
    period,
    periodLabel: periodLabel(period),
    permalink: f.permalink,
    timestamp: f.timestamp,
  };
}

export interface ManagementAccountsData {
  files: FileInfo[];
  currentFile: FileInfo;
  sheetData: ParsedSheets;
}

/**
 * Fetch management accounts data for the Financial page.
 * Downloads the selected (or latest) xlsx from Slack, parses key sheets.
 * Returns `null` when no management account files have been synced yet —
 * this is the explicit empty-state signal for the page. Slack/download/parse
 * failures still throw so callers can distinguish real errors from emptiness.
 */
export async function getManagementAccountsData(
  period?: string
): Promise<ManagementAccountsData | null> {
  const rawFiles = await getManagementAccountFiles();
  if (rawFiles.length === 0) {
    return null;
  }

  const files = rawFiles.map(toFileInfo);

  // Find the requested period or default to latest
  const targetInfo = period
    ? files.find((f) => f.period === period) ?? files[0]
    : files[0];

  const rawFile = rawFiles.find((f) => f.id === targetInfo.id);
  if (!rawFile) {
    throw new Error("File metadata mismatch");
  }

  const sheetData = await getSheetData(rawFile.id, rawFile.url_private_download);

  return { files, currentFile: targetInfo, sheetData };
}

/**
 * Get the latest ARR from the most recent management accounts P&L.
 * Reads the "ARR" row, skipping YTD to get the latest monthly value.
 */
export async function getLatestARR(): Promise<{
  value: number;
  period: string;
} | null> {
  const rawFiles = await getManagementAccountFiles();
  if (rawFiles.length === 0) return null;

  const latest = rawFiles[0];
  const sheetData = await getSheetData(latest.id, latest.url_private_download);
  const plRows = sheetData.sheets["P&L Summary"];
  if (!plRows) return null;

  const arrRow = plRows.find((row) => {
    const label = String(row[0] ?? "").trim().toLowerCase();
    return label.startsWith("arr");
  });
  if (!arrRow) return null;

  // After reversal: [label, code, YTD, latest_month, prev_month, ...]
  // Start at index 3 to skip YTD and get the latest monthly value
  for (let i = 3; i < arrRow.length; i++) {
    const val = arrRow[i];
    if (typeof val === "number" && val > 1_000_000) {
      const period = extractPeriodFromFilename(latest.name);
      return { value: val, period: period ?? "latest" };
    }
  }

  return null;
}
