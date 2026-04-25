import * as XLSX from "xlsx";
import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import {
  financialExtractSchema,
  summarizeZodIssues,
} from "@/lib/validation/llm-output";

// maxRetries: 1 — batch extraction rarely benefits from more retries, and extra
// retries inflate wall-clock time before the AbortController timeout kicks in.
const client = new Anthropic({ maxRetries: 1 });

/**
 * Max wall-clock time for the management accounts LLM extraction call.
 * Prevents a stuck Anthropic request from blocking a sync worker indefinitely.
 */
const LLM_CALL_TIMEOUT_MS = 90_000;

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

interface ParseManagementAccountsOptions {
  signal?: AbortSignal;
}

function composeAbortSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  timeoutMessage?: string
): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let didTimeout = false;
  const onAbort = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort(
      new Error(timeoutMessage ?? "Management accounts extraction timed out")
    );
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onAbort);
      }
    },
    timedOut: () => didTimeout,
  };
}

/**
 * Trim wide rows to keep labels (first 2 cols) + the most recent data columns.
 * Management accounts sheets often have 50+ monthly columns going back years.
 */
function trimRowColumns(row: unknown[], maxDataCols: number = 14): unknown[] {
  if (row.length <= maxDataCols + 2) return row;
  const labels = row.slice(0, 2);
  const dataCols = row.slice(2);
  return [...labels, ...dataCols.slice(-maxDataCols)];
}

/**
 * Read an Excel file and extract sheet data as arrays.
 * Skips LiveFlow shadow sheets and trims wide rows to recent months.
 */
function readExcelSheets(
  buffer: Buffer
): { sheetNames: string[]; sheets: Record<string, unknown[][]> } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets: Record<string, unknown[][]> = {};

  // Skip lf-shadow-* sheets (LiveFlow internal/encrypted data)
  const realSheetNames = workbook.SheetNames.filter(
    (n) => !n.startsWith("lf-shadow")
  );

  for (const name of realSheetNames) {
    const sheet = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][];
    // Keep first 50 rows, trim wide rows to labels + last 14 data columns
    sheets[name] = data.slice(0, 50).map((row) => trimRowColumns(row));
  }

  return { sheetNames: realSheetNames, sheets };
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

    if (totalChars + text.length > MAX_CHARS) continue;
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

function parseJsonFromModelResponse(text: string): Record<string, unknown> {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("Model response did not contain valid JSON");
  }
}

/**
 * Parse management accounts Excel file into structured financial data.
 * Uses xlsx to read the file, then Claude to extract the numbers.
 */
export async function parseManagementAccounts(
  buffer: Buffer,
  filenameHint?: string,
  opts: ParseManagementAccountsOptions = {}
): Promise<FinancialData | null> {
  const { sheetNames, sheets } = readExcelSheets(buffer);
  const sheetText = formatSheetsForLLM(sheets);

  const { signal, cleanup, timedOut } = composeAbortSignal(
    LLM_CALL_TIMEOUT_MS,
    opts.signal,
    `Management accounts LLM extraction timed out after ${
      LLM_CALL_TIMEOUT_MS / 1000
    }s`
  );

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Filename: ${filenameHint ?? "management_accounts.xlsx"}\nSheets: ${sheetNames.join(", ")}\n\nData:\n${sheetText}`,
          },
        ],
      },
      { signal }
    );
  } catch (error) {
    if (signal.aborted) {
      if (timedOut()) {
        throw new Error(
          `Management accounts LLM extraction timed out after ${
            LLM_CALL_TIMEOUT_MS / 1000
          }s`
        );
      }

      if (signal.reason instanceof Error) {
        throw signal.reason;
      }

      throw new Error("Management accounts LLM extraction was aborted");
    }
    throw error;
  } finally {
    cleanup();
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonFromModelResponse(text);
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { integration: "excel-parser", llm_parse_invalid: "true" },
      extra: {
        operation: "parseManagementAccounts",
        filenameHint,
        rawResponse: text,
      },
    });
    return null;
  }

  const validation = financialExtractSchema.safeParse(parsed);
  if (!validation.success) {
    Sentry.captureMessage(
      "Management accounts extract failed zod validation",
      {
        level: "warning",
        tags: { integration: "excel-parser", llm_parse_invalid: "true" },
        extra: {
          operation: "parseManagementAccounts",
          filenameHint,
          issues: summarizeZodIssues(validation.error),
          rawResponse: text,
        },
      },
    );
    return null;
  }

  const v = validation.data;
  return {
    period: v.period,
    periodLabel: v.periodLabel,
    revenue: v.revenue,
    grossProfit: v.grossProfit,
    grossMargin: v.grossMargin,
    contributionProfit: v.contributionProfit,
    contributionMargin: v.contributionMargin,
    ebitda: v.ebitda,
    ebitdaMargin: v.ebitdaMargin,
    netIncome: v.netIncome,
    cashPosition: v.cashPosition,
    cashBurn: v.cashBurn,
    opex: v.opex,
    headcountCost: v.headcountCost,
    marketingCost: v.marketingCost,
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
