import * as XLSX from "xlsx";
import { downloadSlackFile } from "./slack-files";

const KEY_SHEETS = [
  "P&L Summary",
  "P&L Variance Analysis Flash",
  "BS Summary",
  "Cash Flow",
  "Treasury Dashboard",
  "KPIs",
  "Headcount",
  "EWA Summary",
];

const MAX_ROWS = 200;
const MAX_DATA_COLS = 14;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export interface ParsedSheets {
  sheetNames: string[];
  sheets: Record<string, unknown[][]>;
}

const MAX_CACHE_ENTRIES = 10;
const cache = new Map<string, { data: ParsedSheets; fetchedAt: number }>();
const inflight = new Map<string, Promise<ParsedSheets>>();

/**
 * Trim wide rows: strip trailing nulls, then keep first 2 label columns
 * + last N data columns reversed so newest is first.
 */
function trimRow(row: unknown[], maxDataCols: number = MAX_DATA_COLS): unknown[] {
  // Strip trailing null/empty cells
  let end = row.length;
  while (end > 0 && (row[end - 1] === null || row[end - 1] === "")) {
    end--;
  }
  const trimmed = row.slice(0, end);

  if (trimmed.length <= maxDataCols + 2) return trimmed;
  const labels = trimmed.slice(0, 2);
  const dataCols = trimmed.slice(2);
  return [...labels, ...dataCols.slice(-maxDataCols).reverse()];
}

/**
 * Parse key sheets from an Excel buffer for HTML rendering.
 */
function parseKeySheets(buffer: Buffer): ParsedSheets {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const available = workbook.SheetNames.filter(
    (n) => !n.startsWith("lf-shadow")
  );

  // Use key sheets that exist in this workbook, preserving KEY_SHEETS order
  const sheetNames = KEY_SHEETS.filter((name) => available.includes(name));

  const sheets: Record<string, unknown[][]> = {};
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][];

    sheets[name] = rows.slice(0, MAX_ROWS).map((row) => trimRow(row));
  }

  return { sheetNames, sheets };
}

/**
 * Get parsed sheet data for a Slack file, with in-memory caching.
 */
export async function getSheetData(
  fileId: string,
  downloadUrl: string
): Promise<ParsedSheets> {
  const cached = cache.get(fileId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }
  if (cached) cache.delete(fileId);

  // Deduplicate concurrent requests for the same file
  const existing = inflight.get(fileId);
  if (existing) return existing;

  const promise = (async () => {
    const buffer = await downloadSlackFile(downloadUrl);
    const data = parseKeySheets(buffer);

    // Evict oldest entry if cache is full
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = [...cache.entries()].sort(
        (a, b) => a[1].fetchedAt - b[1].fetchedAt
      )[0];
      if (oldest) cache.delete(oldest[0]);
    }

    cache.set(fileId, { data, fetchedAt: Date.now() });
    inflight.delete(fileId);
    return data;
  })();

  inflight.set(fileId, promise);
  return promise;
}
