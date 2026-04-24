import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import type { Message as AnthropicMessage } from "@anthropic-ai/sdk/resources/messages/messages";
import { db as defaultDb } from "@/lib/db";
import { llmUsage } from "@/lib/db/schema";
import { normalizeDatabaseError } from "@/lib/db/errors";

export type LlmSource =
  | "okr-parser"
  | "excel-parser"
  | "github-employee-match";

export const DEFAULT_LLM_DAILY_BUDGET_USD = 50;

// Public Anthropic pricing for claude-sonnet-4-6 (USD per million tokens).
// Cached reads are billed at the lower rate; cache creation is billed as
// regular input.
const PRICING_PER_MTOK = {
  input: 3.0,
  output: 15.0,
  cachedInput: 0.3,
} as const;

const MICRO_USD_PER_USD = 1_000_000;

type DbLike = typeof defaultDb;

interface UsageInput {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface LlmBudgetExceededDetails {
  source: LlmSource;
  date: string;
  spentUsd: number;
  capUsd: number;
}

export class LlmBudgetExceededError extends Error {
  readonly source: LlmSource;
  readonly date: string;
  readonly spentUsd: number;
  readonly capUsd: number;

  constructor(details: LlmBudgetExceededDetails) {
    super(
      `LLM daily budget exceeded for ${details.source} on ${details.date}: ` +
        `spent $${details.spentUsd.toFixed(2)} of $${details.capUsd.toFixed(2)} cap`,
    );
    this.name = "LlmBudgetExceededError";
    this.source = details.source;
    this.date = details.date;
    this.spentUsd = details.spentUsd;
    this.capUsd = details.capUsd;
  }
}

export function isLlmBudgetExceededError(
  error: unknown,
): error is LlmBudgetExceededError {
  return error instanceof LlmBudgetExceededError;
}

/**
 * UTC date key in YYYY-MM-DD form. The cap is a daily window in UTC so a sync
 * worker that crosses midnight resets cleanly without needing a timezone arg.
 */
export function getUtcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Read `LLM_DAILY_BUDGET_USD` and clamp to a positive number. Empty string,
 * NaN, infinite, and zero/negative values fall back to the default and emit a
 * one-shot Sentry warning so misconfiguration is visible without breaking the
 * runner.
 */
export function getLlmDailyBudgetUsd(): number {
  const raw = process.env.LLM_DAILY_BUDGET_USD;
  if (raw === undefined || raw === "") {
    return DEFAULT_LLM_DAILY_BUDGET_USD;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    Sentry.captureMessage("Invalid LLM_DAILY_BUDGET_USD; using default", {
      level: "warning",
      tags: { integration: "llm-budget" },
      extra: {
        rawValue: raw,
        defaultUsd: DEFAULT_LLM_DAILY_BUDGET_USD,
      },
    });
    return DEFAULT_LLM_DAILY_BUDGET_USD;
  }

  return parsed;
}

/**
 * Estimate USD cost for a single Anthropic call from its `usage` block.
 * Returned as integer micro-USD so increments stay exact under concurrent
 * UPSERTs.
 */
export function estimateLlmCostMicroUsd(usage: UsageInput | null | undefined): number {
  if (!usage) return 0;

  const cachedInputTokens = Math.max(0, usage.cache_read_input_tokens ?? 0);
  const cacheCreationTokens = Math.max(
    0,
    usage.cache_creation_input_tokens ?? 0,
  );
  const rawInputTokens = Math.max(0, usage.input_tokens ?? 0);
  const outputTokens = Math.max(0, usage.output_tokens ?? 0);

  // Anthropic reports `input_tokens` separately from cache reads, so don't
  // double-count: regular input billing covers `input_tokens` plus cache
  // creation; cache reads are billed at the discounted rate.
  const billableInputTokens = rawInputTokens + cacheCreationTokens;

  const inputCost =
    (billableInputTokens / 1_000_000) * PRICING_PER_MTOK.input;
  const outputCost = (outputTokens / 1_000_000) * PRICING_PER_MTOK.output;
  const cachedCost =
    (cachedInputTokens / 1_000_000) * PRICING_PER_MTOK.cachedInput;

  const totalUsd = inputCost + outputCost + cachedCost;
  return Math.round(totalUsd * MICRO_USD_PER_USD);
}

interface DailyTotals {
  totalMicroUsd: number;
}

async function readDailyTotalsMicroUsd(
  db: DbLike,
  date: string,
): Promise<DailyTotals> {
  let rows: Array<{ totalMicroUsd: number | null }>;
  try {
    rows = await db
      .select({
        totalMicroUsd: sql<number>`COALESCE(SUM(${llmUsage.costMicroUsd}), 0)::int`,
      })
      .from(llmUsage)
      .where(eq(llmUsage.date, date));
  } catch (error) {
    throw normalizeDatabaseError("Read LLM daily usage totals", error);
  }

  return { totalMicroUsd: rows[0]?.totalMicroUsd ?? 0 };
}

/**
 * Throw `LlmBudgetExceededError` if today's cumulative spend already meets or
 * exceeds the configured cap. Caller should invoke this immediately before
 * issuing the Anthropic call.
 */
export async function assertWithinDailyBudget(
  source: LlmSource,
  options: { db?: DbLike; now?: Date } = {},
): Promise<void> {
  const date = getUtcDateKey(options.now);
  const capUsd = getLlmDailyBudgetUsd();
  const { totalMicroUsd } = await readDailyTotalsMicroUsd(
    options.db ?? defaultDb,
    date,
  );

  const capMicroUsd = Math.round(capUsd * MICRO_USD_PER_USD);
  if (totalMicroUsd >= capMicroUsd) {
    const spentUsd = totalMicroUsd / MICRO_USD_PER_USD;
    Sentry.captureMessage("LLM daily budget exceeded", {
      level: "warning",
      tags: { integration: "llm-budget", source },
      extra: { date, source, spentUsd, capUsd },
    });
    throw new LlmBudgetExceededError({ source, date, spentUsd, capUsd });
  }
}

/**
 * Atomically increment today's usage row for a source. Uses ON CONFLICT so
 * concurrent callers with the same (date, source) sum into the same row
 * without losing tokens.
 */
export async function recordLlmUsage(
  source: LlmSource,
  message: { usage?: UsageInput | null } | null | undefined,
  options: { db?: DbLike; now?: Date } = {},
): Promise<void> {
  const usage = message?.usage ?? null;
  if (!usage) return;

  const date = getUtcDateKey(options.now);
  const inputTokens = Math.max(0, usage.input_tokens ?? 0);
  const outputTokens = Math.max(0, usage.output_tokens ?? 0);
  const cachedInputTokens = Math.max(0, usage.cache_read_input_tokens ?? 0);
  const costMicroUsd = estimateLlmCostMicroUsd(usage);
  const cacheCreationTokens = Math.max(
    0,
    usage.cache_creation_input_tokens ?? 0,
  );

  const db = options.db ?? defaultDb;

  try {
    await db
      .insert(llmUsage)
      .values({
        date,
        source,
        inputTokens: inputTokens + cacheCreationTokens,
        outputTokens,
        cachedInputTokens,
        costMicroUsd,
        calls: 1,
      })
      .onConflictDoUpdate({
        target: [llmUsage.date, llmUsage.source],
        set: {
          inputTokens: sql`${llmUsage.inputTokens} + ${
            inputTokens + cacheCreationTokens
          }`,
          outputTokens: sql`${llmUsage.outputTokens} + ${outputTokens}`,
          cachedInputTokens: sql`${llmUsage.cachedInputTokens} + ${cachedInputTokens}`,
          costMicroUsd: sql`${llmUsage.costMicroUsd} + ${costMicroUsd}`,
          calls: sql`${llmUsage.calls} + 1`,
          updatedAt: sql`now()`,
        },
      });
  } catch (error) {
    // Recording failures must not block the calling sync — the call already
    // succeeded against Anthropic. Surface to Sentry so we notice if the table
    // is missing or the writer is broken.
    Sentry.captureException(error, {
      tags: { integration: "llm-budget", source },
      extra: { operation: "recordLlmUsage", date },
    });
  }
}

/**
 * Test helper for asserting current row state. Not used in production code.
 */
export async function readLlmUsageRow(
  source: LlmSource,
  date: string,
  db: DbLike = defaultDb,
): Promise<typeof llmUsage.$inferSelect | null> {
  const rows = await db
    .select()
    .from(llmUsage)
    .where(and(eq(llmUsage.date, date), eq(llmUsage.source, source)))
    .limit(1);
  return rows[0] ?? null;
}
