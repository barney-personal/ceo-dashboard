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
 * Find the widest non-null extent across all rows to determine
 * the true data column count (ignoring trailing null padding).
 */
function findMaxDataCol(rows: unknown[][]): number {
  let maxCol = 0;
  for (const row of rows) {
    for (let i = row.length - 1; i >= 0; i--) {
      if (row[i] !== null && row[i] !== "") {
        if (i + 1 > maxCol) maxCol = i + 1;
        break;
      }
    }
  }
  return maxCol;
}

/**
 * Trim all rows in a sheet uniformly: keep first 2 label columns +
 * last N data columns, reversed so newest is first.
 * Uses a single column range derived from the widest row.
 */
function trimSheet(rows: unknown[][]): unknown[][] {
  const totalCols = findMaxDataCol(rows);
  const dataCols = totalCols - 2;

  if (dataCols <= MAX_DATA_COLS) {
    return rows.map((row) => {
      const padded = row.slice(0, totalCols);
      while (padded.length < totalCols) padded.push(null);
      return padded;
    });
  }

  const startCol = totalCols - MAX_DATA_COLS;

  return rows.map((row) => {
    const labels = [row[0] ?? null, row[1] ?? null];
    const data: unknown[] = [];
    for (let i = startCol; i < totalCols; i++) {
      data.push(row[i] ?? null);
    }
    data.reverse();
    return [...labels, ...data];
  });
}

/**
 * Parse key sheets from an Excel buffer for HTML rendering.
 */
function parseKeySheets(buffer: Buffer): ParsedSheets {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const available = workbook.SheetNames.filter(
    (n) => !n.startsWith("lf-shadow")
  );

  const sheetNames = KEY_SHEETS.filter((name) => available.includes(name));

  const sheets: Record<string, unknown[][]> = {};
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][];

    sheets[name] = trimSheet(rows.slice(0, MAX_ROWS));
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
