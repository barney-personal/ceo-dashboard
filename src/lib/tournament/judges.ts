import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  ANTHROPIC_MAX_TOKENS,
  ANTHROPIC_MODEL,
  ANTHROPIC_OUTPUT_EFFORT,
  JUDGE_CALL_TIMEOUT_MS,
  JUDGE_MAX_ATTEMPTS,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  PRICING_USD_PER_MTOK,
} from "./config";
import { TOURNAMENT_SYSTEM_PROMPT, renderMatchPrompt } from "./rubric";
import type { JudgmentResult, MatchPairing, Verdict } from "./types";

// Anthropic's API rejects forced `tool_choice` while extended thinking is
// enabled, so both judges parse plain JSON from the response text. The system
// prompt already specifies the exact JSON shape the judge must return.

export interface JudgeInput {
  pairing: MatchPairing;
  windowStart: Date;
  windowEnd: Date;
  dossierA: string;
  dossierB: string;
}

export async function judgeWithAnthropic(
  input: JudgeInput,
  opts: { signal?: AbortSignal } = {},
): Promise<JudgmentResult> {
  const client = new Anthropic({ maxRetries: 0 });
  const userPrompt = renderMatchPrompt(
    input.dossierA,
    input.dossierB,
    input.windowStart,
    input.windowEnd,
  );

  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= JUDGE_MAX_ATTEMPTS; attempt++) {
    const { signal, cleanup } = composeAbortSignal(
      JUDGE_CALL_TIMEOUT_MS,
      opts.signal,
      "Anthropic tournament judge timed out",
    );

    try {
      const response = await client.messages.create(
        {
          model: ANTHROPIC_MODEL,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          thinking: { type: "adaptive" } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          output_config: { effort: ANTHROPIC_OUTPUT_EFFORT } as any,
          system: [
            {
              type: "text",
              text: TOURNAMENT_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userPrompt }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { signal },
      );

      const textBlock = response.content.find(
        (block): block is Extract<typeof block, { type: "text" }> =>
          block.type === "text",
      );
      if (!textBlock) {
        throw new Error(
          `Claude returned no text block (stop_reason=${response.stop_reason})`,
        );
      }

      const parsed = parseVerdict(parseJsonObject(textBlock.text));
      const inputTokens = response.usage.input_tokens ?? null;
      const outputTokens = response.usage.output_tokens ?? null;
      // Anthropic counts thinking as output_tokens; we don't get a separate breakdown.
      const thinkingTokens = null;

      return {
        matchId: input.pairing.matchId,
        judge: { provider: "anthropic", model: ANTHROPIC_MODEL },
        verdict: parsed.verdict,
        confidencePct: parsed.confidencePct,
        reasoning: parsed.reasoning,
        inputTokens,
        outputTokens,
        thinkingTokens,
        costUsd: estimateCost(ANTHROPIC_MODEL, inputTokens, outputTokens),
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      lastError = error;
      if (signal.aborted) {
        throw abortReasonToError(
          signal.reason,
          "Anthropic tournament judge aborted",
        );
      }
      if (!isRetryableAnthropicError(error) || attempt === JUDGE_MAX_ATTEMPTS) {
        break;
      }
      await sleep(1000 * Math.pow(2, attempt - 1), opts.signal);
    } finally {
      cleanup();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Anthropic tournament judge failed: ${String(lastError)}`);
}

export async function judgeWithOpenAi(
  input: JudgeInput,
  opts: { signal?: AbortSignal } = {},
): Promise<JudgmentResult> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  });
  const userPrompt = renderMatchPrompt(
    input.dossierA,
    input.dossierB,
    input.windowStart,
    input.windowEnd,
  );

  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= JUDGE_MAX_ATTEMPTS; attempt++) {
    const { signal, cleanup } = composeAbortSignal(
      JUDGE_CALL_TIMEOUT_MS,
      opts.signal,
      "OpenAI tournament judge timed out",
    );

    try {
      const response = await client.responses.create(
        {
          model: OPENAI_MODEL,
          instructions: TOURNAMENT_SYSTEM_PROMPT,
          input: userPrompt,
          reasoning: { effort: OPENAI_REASONING_EFFORT },
        },
        { signal },
      );

      const parsed = parseVerdict(parseJsonObject(response.output_text));
      const usage = response.usage;
      const inputTokens = usage?.input_tokens ?? null;
      const outputTokens = usage?.output_tokens ?? null;
      const thinkingTokens =
        usage?.output_tokens_details?.reasoning_tokens ?? null;

      return {
        matchId: input.pairing.matchId,
        judge: { provider: "openai", model: OPENAI_MODEL },
        verdict: parsed.verdict,
        confidencePct: parsed.confidencePct,
        reasoning: parsed.reasoning,
        inputTokens,
        outputTokens,
        thinkingTokens,
        costUsd: estimateCost(OPENAI_MODEL, inputTokens, outputTokens),
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      lastError = error;
      if (signal.aborted) {
        throw abortReasonToError(
          signal.reason,
          "OpenAI tournament judge aborted",
        );
      }
      const status = getErrorStatus(error);
      if (
        attempt === JUDGE_MAX_ATTEMPTS ||
        (status !== null && !isRetryableStatus(status))
      ) {
        break;
      }
      await sleep(1000 * Math.pow(2, attempt - 1), opts.signal);
    } finally {
      cleanup();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`OpenAI tournament judge failed: ${String(lastError)}`);
}

interface ParsedVerdict {
  verdict: Verdict;
  confidencePct: number;
  reasoning: string;
}

function parseVerdict(raw: Record<string, unknown>): ParsedVerdict {
  const verdict = raw.verdict;
  if (verdict !== "A" && verdict !== "B" && verdict !== "draw") {
    throw new Error(`Invalid verdict value: ${JSON.stringify(verdict)}`);
  }
  const confidencePct = Math.round(Number(raw.confidencePct ?? 0));
  if (!Number.isFinite(confidencePct) || confidencePct < 0 || confidencePct > 100) {
    throw new Error(`Invalid confidencePct: ${JSON.stringify(raw.confidencePct)}`);
  }
  const reasoning =
    typeof raw.reasoning === "string" ? raw.reasoning.trim() : "";
  return { verdict, confidencePct, reasoning };
}

function parseJsonObject(text: string): Record<string, unknown> {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("Judge response did not contain valid JSON");
  }
}

function estimateCost(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const pricing = PRICING_USD_PER_MTOK[model];
  if (!pricing || inputTokens === null || outputTokens === null) return null;
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

function composeAbortSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  timeoutMessage = "Judge call timed out",
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onAbort, { once: true });
  }

  const timeoutId = setTimeout(
    () => controller.abort(new Error(timeoutMessage)),
    timeoutMs,
  );

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}

function abortReasonToError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortReasonToError(signal.reason, "Judge call aborted"));
  }
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReasonToError(signal?.reason, "Judge call aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableStatus(status: unknown): boolean {
  return (
    typeof status === "number" &&
    (status === 408 || status === 409 || status === 429 || status >= 500)
  );
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown };
  return typeof candidate.status === "number" ? candidate.status : null;
}

function isRetryableAnthropicError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: unknown;
    type?: unknown;
    error?: { type?: unknown };
  };
  const status =
    typeof candidate.status === "number" ? candidate.status : undefined;
  const type =
    typeof candidate.type === "string"
      ? candidate.type
      : typeof candidate.error?.type === "string"
      ? candidate.error.type
      : undefined;
  return status === 429 || status === 529 || type === "overloaded_error";
}
