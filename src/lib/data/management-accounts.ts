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
 */
export async function getManagementAccountsData(
  period?: string
): Promise<ManagementAccountsData> {
  const rawFiles = await getManagementAccountFiles();
  const files = rawFiles.map(toFileInfo);

  // Find the requested period or default to latest
  const targetInfo = period
    ? files.find((f) => f.period === period) ?? files[0]
    : files[0];

  // Find the raw file to get the download URL
  const rawFile = rawFiles.find((f) => f.id === targetInfo.id)!;

  const sheetData = await getSheetData(rawFile.id, rawFile.url_private_download);

  return { files, currentFile: targetInfo, sheetData };
}
