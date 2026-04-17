import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import type {
  Message as AnthropicMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeDatabaseError } from "@/lib/db/errors";
import { squads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { safeParseWithSchema } from "@/lib/validation/external";

const client = new Anthropic();

/**
 * Max wall-clock time for a single LLM API call (including any SDK retries).
 * Prevents a stuck Anthropic request from keeping a sync worker alive past its budget.
 */
const LLM_CALL_TIMEOUT_MS = 90_000;
const LLM_MAX_ATTEMPTS = 3;
const LLM_INITIAL_BACKOFF_MS = 1_000;

export interface ParsedKr {
  objective: string;
  name: string;
  rag: "green" | "amber" | "red" | "not_started";
  metric: string | null;
}

export interface ParsedOkrUpdate {
  squadName: string;
  tldr: string;
  krs: ParsedKr[];
}

export interface OkrParseInput {
  messageText: string;
  channelContext: string;
}

interface ParseOkrOptions {
  signal?: AbortSignal;
}

interface AnthropicFailureShape {
  status?: unknown;
  type?: unknown;
  error?: {
    type?: unknown;
  };
}

interface ValidParsedEnvelope {
  squadName: string;
  tldr?: string | null;
  krs: unknown[];
}

const VALID_RAGS: ParsedKr["rag"][] = [
  "green",
  "amber",
  "red",
  "not_started",
];

const ParsedKrSchema = z.object({
  objective: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  rag: z.enum(VALID_RAGS),
  metric: z.string().nullable().optional(),
});

const ParsedOkrEnvelopeSchema = z.object({
  squadName: z.string().trim().min(1),
  tldr: z.string().trim().min(1).nullable().optional(),
  krs: z.array(z.unknown()),
});

const ParsedOkrBatchSchema = z.array(z.unknown());

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
    controller.abort(new Error(timeoutMessage ?? "LLM OKR parse timed out"));
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

function abortReasonToError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error("LLM OKR parse was aborted");
}

function getAnthropicFailureDetails(error: unknown): {
  status?: number;
  type?: string;
} {
  if (!error || typeof error !== "object") {
    return {};
  }

  const anthropicError = error as AnthropicFailureShape;
  const status =
    typeof anthropicError.status === "number" ? anthropicError.status : undefined;
  const type =
    typeof anthropicError.type === "string"
      ? anthropicError.type
      : typeof anthropicError.error?.type === "string"
        ? anthropicError.error.type
        : undefined;

  return { status, type };
}

function isRetryableAnthropicError(error: unknown): boolean {
  const { status, type } = getAnthropicFailureDetails(error);
  return status === 429 || status === 529 || type === "overloaded_error";
}

function getRetryFailureReason(error: unknown): string {
  const { status, type } = getAnthropicFailureDetails(error);

  if (type === "overloaded_error") {
    return "overloaded_error";
  }

  if (status === 429 || status === 529) {
    return `status_${status}`;
  }

  return "unknown";
}

function waitForRetryBackoff(
  delayMs: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortReasonToError(signal.reason));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      reject(abortReasonToError(signal.reason));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function createMessageWithRetry(
  prompt: string,
  userContent: string,
  signal: AbortSignal,
  maxTokens = 2000
): Promise<AnthropicMessage> {
  const request: MessageCreateParamsNonStreaming = {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: prompt,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await client.messages.create(request, { signal });
    } catch (error) {
      if (
        signal.aborted ||
        !isRetryableAnthropicError(error) ||
        attempt === LLM_MAX_ATTEMPTS
      ) {
        throw error;
      }

      const backoffMs = LLM_INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
      Sentry.addBreadcrumb({
        category: "llm-okr-parser",
        level: "warning",
        message: "Retrying Claude OKR parse after retryable failure",
        data: {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: LLM_MAX_ATTEMPTS,
          backoffMs,
          reason: getRetryFailureReason(error),
        },
      });

      await waitForRetryBackoff(backoffMs, signal);
    }
  }

  throw new Error("LLM OKR parse exhausted all retry attempts");
}

function buildSingleMessagePromptContent(input: OkrParseInput): string {
  return `Channel: ${input.channelContext}\n\nSlack message:\n${input.messageText}`;
}

function buildBatchMessagePromptContent(inputs: readonly OkrParseInput[]): string {
  return [
    `Parse ${inputs.length} Slack messages and return a JSON array with exactly ${inputs.length} items.`,
    "Each array item must correspond to the input message at the same index.",
    "Return null for messages that are not weekly squad OKR updates.",
    "Do not omit items, reorder items, or wrap the array in another object.",
    "",
    ...inputs.map(
      (input, index) =>
        `Message ${index}\nChannel: ${input.channelContext}\n\nSlack message:\n${input.messageText}`
    ),
  ].join("\n\n");
}

function validateParsedKr(
  kr: unknown,
  index: number
): ParsedKr | null {
  const result = safeParseWithSchema(ParsedKrSchema, kr, {
    source: "anthropic",
    boundary: "okr_key_result",
    payload: kr,
  });

  if (!result.success) {
    Sentry.captureMessage("Dropped invalid OKR key result from Claude response", {
      level: "warning",
      tags: { integration: "llm-okr-parser" },
      extra: {
        operation: "validateParsedKr",
        krIndex: index,
        invalidFields: result.error.issuePaths,
        issues: result.error.issues,
        rawPayloadPreview: result.error.payloadPreview,
      },
    });
    return null;
  }

  return {
    objective: result.data.objective,
    name: result.data.name,
    rag: result.data.rag,
    metric: result.data.metric ?? null,
  };
}

function validateParsedEnvelope(parsed: unknown): ValidParsedEnvelope | null {
  const result = safeParseWithSchema(ParsedOkrEnvelopeSchema, parsed, {
    source: "anthropic",
    boundary: "okr_parse_envelope",
    payload: parsed,
  });

  if (!result.success) {
    return null;
  }

  return {
    squadName: result.data.squadName,
    tldr: result.data.tldr ?? null,
    krs: result.data.krs,
  };
}

function normalizeResponseText(response: AnthropicMessage): string | null {
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  return trimmed === "null" || trimmed === "" ? null : trimmed;
}

function toParsedOkrUpdate(envelope: ValidParsedEnvelope): ParsedOkrUpdate {
  return {
    squadName: envelope.squadName,
    tldr: envelope.tldr ?? "",
    krs: envelope.krs
      .map((kr, index) => validateParsedKr(kr, index))
      .filter((kr): kr is ParsedKr => kr !== null),
  };
}

/**
 * Build squad context for the LLM prompt from the database.
 * This way adding a squad is just a DB insert — no code changes.
 */
export async function buildSquadContext(): Promise<string> {
  let allSquads: Array<typeof squads.$inferSelect>;
  try {
    allSquads = await db.select().from(squads).where(eq(squads.isActive, true));
  } catch (error) {
    const normalized = normalizeDatabaseError("Build LLM squad context", error);
    Sentry.captureException(normalized, {
      tags: { integration: "llm-okr-parser" },
      extra: { operation: "buildSquadContext" },
    });
    throw normalized;
  }

  // Group by pillar
  const byPillar = new Map<string, typeof allSquads>();
  for (const s of allSquads) {
    const existing = byPillar.get(s.pillar) ?? [];
    existing.push(s);
    byPillar.set(s.pillar, existing);
  }

  const pillarLines = [...byPillar.entries()]
    .map(
      ([pillar, sqs]) =>
        `${pillar}: ${sqs.map((s) => s.name).join(", ")}`
    )
    .join("\n");

  const authorLines = allSquads
    .filter((s) => s.pmName)
    .map((s) => `- ${s.pmName} → ${s.name} (${s.pillar})`)
    .join("\n");

  return `Known squads per pillar:\n${pillarLines}\n\nKnown author → squad mapping:\n${authorLines}`;
}

export function buildSystemPromptFromContext(squadContext: string): string {
  return `You extract structured OKR data from weekly squad update messages posted by product managers in Slack.

IMPORTANT: Only extract ACTUAL OKR Key Results — these are formal objectives with measurable targets and/or RAG status indicators. Do NOT extract:
- Experiments (live, upcoming, or shipped)
- "Last week" / "This week" / "Working on" items
- Shipped features or initiatives without RAG status
- Discovery work or general status updates
- General delivery/shipping updates (e.g. "Shipped loan offer happy path")

A real KR looks like:
- "KR1: Increase M1 retention rate by 2% :large_green_circle:" or "KR1.1: Reduce arrears by 3% to unlock $5.10 ARPU"
- Funnel metrics with targets: "Rolloff → Insights Start: 29.3% vs 35% target :large_orange_circle:"
- Delivery milestones with RAG status: "Delivery Milestone: Launch savings product in UK — :large_green_circle:"
NOT like: "Shipped loan offer happy path" or "Building fixes for app init time issues"

IMPORTANT: Some PMs post OKR updates without a squad name header. If the message contains formal KRs but no explicit squad name, use the Author → squad mapping below to determine the squad. The author's name is provided in the channel context.

${squadContext}

IMPORTANT: Some PMs belong to multiple squads across different pillars (e.g. "Instalment Loans" in EWA & Credit Products AND "Instalment Loans (New Bets)" in New Bets). When this happens, use the channel's pillar (provided in the channel context) to pick the correct squad.

Extract:
- squadName: map to the closest known squad name above, using the channel pillar to disambiguate
- tldr: 1-2 sentence summary
- krs: array of ONLY formal key results, each with:
  - objective: the parent objective
  - name: the KR name (e.g. "KR1: Total Paid LTV:CPA", "Launch EWA MVP in UK")
  - rag: "green" | "amber" | "red" | "not_started"
  - metric: actual vs target string if present (e.g. "2.86x vs 3x target"), or null

RAG emoji mapping:
- :large_green_circle: / :green_circle: → green
- :large_orange_circle: / :large_yellow_circle: → amber
- :red_circle: → red
- :white_circle: / :black_circle: → not_started
- :apple: → amber
- :green_apple: → green
- Any other custom emoji (e.g. :hold-braveheart:, :nervous-kermit:) → treat as amber unless context clearly indicates green or red

If the message is NOT a weekly squad OKR update (e.g. meeting agenda, action items, planning discussion, question, or general chat), return: null

Return ONLY valid JSON (object or null). No markdown code blocks.`;
}

async function requestOkrParse(
  prompt: string,
  userContent: string,
  opts: ParseOkrOptions = {},
  maxTokens = 2000
): Promise<string | null> {
  const { signal, cleanup, timedOut } = composeAbortSignal(
    LLM_CALL_TIMEOUT_MS,
    opts.signal,
    `LLM OKR parse timed out after ${LLM_CALL_TIMEOUT_MS / 1000}s`
  );

  let response: AnthropicMessage;
  try {
    response = await createMessageWithRetry(prompt, userContent, signal, maxTokens);
  } catch (error) {
    if (signal.aborted) {
      if (timedOut()) {
        const timeoutError = new Error(
          `LLM OKR parse timed out after ${LLM_CALL_TIMEOUT_MS / 1000}s`
        );
        Sentry.captureException(timeoutError, {
          tags: { integration: "llm-okr-parser" },
          extra: { operation: "messages.create", failureType: "timeout" },
        });
        throw timeoutError;
      }

      throw abortReasonToError(signal.reason);
    }

    Sentry.captureException(error, {
      tags: { integration: "llm-okr-parser" },
      extra: { operation: "messages.create" },
    });
    throw error;
  } finally {
    cleanup();
  }

  return normalizeResponseText(response);
}

async function parseSingleOkrUpdate(
  input: OkrParseInput,
  prompt: string,
  opts: ParseOkrOptions = {}
): Promise<ParsedOkrUpdate | null> {
  const trimmed = await requestOkrParse(
    prompt,
    buildSingleMessagePromptContent(input),
    opts
  );

  if (trimmed == null) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const envelope = validateParsedEnvelope(parsed);
    if (!envelope) {
      return null;
    }

    return toParsedOkrUpdate(envelope);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { integration: "llm-okr-parser" },
      extra: {
        operation: "parseResponse",
        responsePreview: trimmed.slice(0, 200),
      },
    });
    console.warn("Failed to parse LLM response:", trimmed.slice(0, 200));
    return null;
  }
}

async function fallbackToSingleMessageParses(
  inputs: readonly OkrParseInput[],
  prompt: string,
  opts: ParseOkrOptions = {}
): Promise<Array<ParsedOkrUpdate | null>> {
  const results: Array<ParsedOkrUpdate | null> = [];

  for (const input of inputs) {
    results.push(await parseSingleOkrUpdate(input, prompt, opts));
  }

  return results;
}

/**
 * Use Claude to parse a raw Slack message into structured OKR data.
 * Returns null if the message is not an OKR update.
 */
export async function llmParseOkrUpdate(
  messageText: string,
  channelContext: string,
  systemPrompt?: string,
  opts: ParseOkrOptions = {}
): Promise<ParsedOkrUpdate | null> {
  const prompt =
    systemPrompt ??
    buildSystemPromptFromContext(await buildSquadContext());

  return parseSingleOkrUpdate({ messageText, channelContext }, prompt, opts);
}

export async function llmParseOkrUpdates(
  inputs: readonly OkrParseInput[],
  systemPrompt?: string,
  opts: ParseOkrOptions = {}
): Promise<Array<ParsedOkrUpdate | null>> {
  if (inputs.length === 0) {
    return [];
  }

  const prompt =
    systemPrompt ??
    buildSystemPromptFromContext(await buildSquadContext());

  if (inputs.length === 1) {
    return [await parseSingleOkrUpdate(inputs[0], prompt, opts)];
  }

  const trimmed = await requestOkrParse(
    prompt,
    buildBatchMessagePromptContent(inputs),
    opts,
    4000
  );

  if (trimmed == null) {
    Sentry.captureMessage(
      "Falling back to single-message OKR parsing after unusable batch payload",
      {
        level: "warning",
        tags: { integration: "llm-okr-parser" },
        extra: {
          operation: "parseBatchResponse",
          reason: "null_or_empty_response",
          batchSize: inputs.length,
        },
      }
    );
    return fallbackToSingleMessageParses(inputs, prompt, opts);
  }

  try {
    const parsed = JSON.parse(trimmed);
    const batch = safeParseWithSchema(ParsedOkrBatchSchema, parsed, {
      source: "anthropic",
      boundary: "okr_parse_batch",
      payload: parsed,
    });
    if (!batch.success || batch.data.length !== inputs.length) {
      Sentry.captureMessage(
        "Falling back to single-message OKR parsing after unusable batch payload",
        {
          level: "warning",
          tags: { integration: "llm-okr-parser" },
          extra: {
            operation: "parseBatchResponse",
            reason: !batch.success ? "wrong_top_level_shape" : "wrong_array_length",
            batchSize: inputs.length,
            responsePreview: trimmed.slice(0, 200),
          },
        }
      );
      return fallbackToSingleMessageParses(inputs, prompt, opts);
    }

    return batch.data.map((item) => {
      if (item == null) {
        return null;
      }

      const envelope = validateParsedEnvelope(item);
      return envelope ? toParsedOkrUpdate(envelope) : null;
    });
  } catch {
    Sentry.captureMessage(
      "Falling back to single-message OKR parsing after unusable batch payload",
      {
        level: "warning",
        tags: { integration: "llm-okr-parser" },
        extra: {
          operation: "parseBatchResponse",
          reason: "invalid_json",
          batchSize: inputs.length,
          responsePreview: trimmed.slice(0, 200),
        },
      }
    );
    return fallbackToSingleMessageParses(inputs, prompt, opts);
  }
}
