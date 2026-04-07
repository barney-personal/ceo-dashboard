import * as XLSX from "xlsx";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface FinancialData {
  period: string; // "2026-02"
  periodLabel: string; // "February 2026"
  revenue: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  contributionProfit: number | null;
  contributionMargin: number | null;
  ebitda: number | null;
  ebitdaMargin: number | null;
  netIncome: number | null;
  cashPosition: number | null;
  cashBurn: number | null;
  opex: number | null;
  headcountCost: number | null;
  marketingCost: number | null;
  rawSheets: Record<string, unknown[][]>;
}

/**
 * Read an Excel file and extract sheet data as arrays.
 * Returns a summary of each sheet for LLM parsing.
 */
function readExcelSheets(
  buffer: Buffer
): { sheetNames: string[]; sheets: Record<string, unknown[][]> } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets: Record<string, unknown[][]> = {};

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][];
    // Keep first 50 rows to avoid sending too much to LLM
    sheets[name] = data.slice(0, 50);
  }

  return { sheetNames: workbook.SheetNames, sheets };
}

/**
 * Format sheet data as text for the LLM prompt.
 * Focuses on sheets likely to contain P&L/summary data.
 */
function formatSheetsForLLM(
  sheets: Record<string, unknown[][]>
): string {
  const priorityKeywords = [
    "summary",
    "p&l",
    "pnl",
    "profit",
    "income",
    "overview",
    "dashboard",
    "variance",
  ];

  // Sort sheets — priority ones first
  const sortedNames = Object.keys(sheets).sort((a, b) => {
    const aHasPriority = priorityKeywords.some((k) =>
      a.toLowerCase().includes(k)
    );
    const bHasPriority = priorityKeywords.some((k) =>
      b.toLowerCase().includes(k)
    );
    if (aHasPriority && !bHasPriority) return -1;
    if (!aHasPriority && bHasPriority) return 1;
    return 0;
  });

  const parts: string[] = [];
  let totalChars = 0;
  const MAX_CHARS = 15000; // Stay well within context limits

  for (const name of sortedNames) {
    const rows = sheets[name];
    const text = `\n=== Sheet: ${name} ===\n${rows
      .map((row) =>
        (row as unknown[])
          .map((cell) => (cell === null ? "" : String(cell)))
          .join("\t")
      )
      .join("\n")}`;

    if (totalChars + text.length > MAX_CHARS) break;
    parts.push(text);
    totalChars += text.length;
  }

  return parts.join("\n");
}

const SYSTEM_PROMPT = `You extract structured financial data from management accounts Excel spreadsheets.

Given the raw data from spreadsheet tabs, extract the following monthly financial metrics. All monetary values should be in millions (e.g. 28.5 for $28.5m). Margins should be decimals (e.g. 0.805 for 80.5%).

Extract:
- period: the month in YYYY-MM format (e.g. "2026-02")
- periodLabel: human-readable (e.g. "February 2026")
- revenue: total revenue in millions
- grossProfit: gross profit in millions
- grossMargin: gross margin as decimal
- contributionProfit: contribution profit in millions
- contributionMargin: contribution margin as decimal
- ebitda: EBITDA in millions
- ebitdaMargin: EBITDA margin as decimal
- netIncome: net income in millions (can be negative)
- cashPosition: cash position in millions
- cashBurn: monthly cash burn in millions (can be negative)
- opex: total operating expenses in millions
- headcountCost: people/headcount costs in millions
- marketingCost: marketing costs in millions

If a value cannot be found, use null.

Return ONLY valid JSON. No markdown code blocks.`;

/**
 * Parse management accounts Excel file into structured financial data.
 * Uses xlsx to read the file, then Claude to extract the numbers.
 */
export async function parseManagementAccounts(
  buffer: Buffer,
  filenameHint?: string
): Promise<FinancialData> {
  const { sheetNames, sheets } = readExcelSheets(buffer);
  const sheetText = formatSheetsForLLM(sheets);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Filename: ${filenameHint ?? "management_accounts.xlsx"}\nSheets: ${sheetNames.join(", ")}\n\nData:\n${sheetText}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  const parsed = JSON.parse(trimmed);

  return {
    period: parsed.period ?? "",
    periodLabel: parsed.periodLabel ?? "",
    revenue: parsed.revenue,
    grossProfit: parsed.grossProfit,
    grossMargin: parsed.grossMargin,
    contributionProfit: parsed.contributionProfit,
    contributionMargin: parsed.contributionMargin,
    ebitda: parsed.ebitda,
    ebitdaMargin: parsed.ebitdaMargin,
    netIncome: parsed.netIncome,
    cashPosition: parsed.cashPosition,
    cashBurn: parsed.cashBurn,
    opex: parsed.opex,
    headcountCost: parsed.headcountCost,
    marketingCost: parsed.marketingCost,
    rawSheets: sheets,
  };
}

/**
 * Extract period from filename like "0226 - Cleo AI Management Accounts.xlsx"
 * Returns "2026-02" or null.
 */
export function extractPeriodFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{2})(\d{2})\s*-/);
  if (!match) return null;
  const month = match[1];
  const year = `20${match[2]}`;
  return `${year}-${month}`;
}
