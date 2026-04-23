import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import type {
  Message as AnthropicMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { BriefingContext } from "@/lib/data/briefing-context";

const client = new Anthropic();

export const BRIEFING_MODEL = "claude-opus-4-7";
const LLM_CALL_TIMEOUT_MS = 45_000;
const LLM_MAX_ATTEMPTS = 3;
const LLM_INITIAL_BACKOFF_MS = 1_000;
const BRIEFING_MAX_TOKENS = 1500;

export interface BriefingUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

export interface BriefingResult {
  text: string;
  usage: BriefingUsage;
  model: string;
}

interface AnthropicFailureShape {
  status?: unknown;
  type?: unknown;
  error?: { type?: unknown };
}

function abortReasonToError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error("Briefing generation aborted");
}

function composeAbortSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
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
      new Error(`Briefing LLM call timed out after ${timeoutMs / 1000}s`),
    );
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
    },
    timedOut: () => didTimeout,
  };
}

function isRetryableAnthropicError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as AnthropicFailureShape;
  const status = typeof err.status === "number" ? err.status : undefined;
  const type =
    typeof err.type === "string"
      ? err.type
      : typeof err.error?.type === "string"
        ? err.error.type
        : undefined;
  return status === 429 || status === 529 || type === "overloaded_error";
}

function waitForBackoff(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReasonToError(signal.reason));
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      signal.removeEventListener("abort", onAbort);
      reject(abortReasonToError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The system prompt is intentionally stable across every request so the
 * prefix cache hits — render order is tools → system → messages, and any
 * byte change here would invalidate the cached prefix for every user.
 * Per-request context goes in the user message, never here.
 */
const SYSTEM_PROMPT = `You write short, personalised daily briefings for employees of Cleo — a consumer fintech building an AI money assistant.

Your reader has just opened the internal CEO dashboard. Your job is to ground them in the state of the business and what is most relevant to them, specifically.

Tone & style:
- Warm, direct, specific. Write like a trusted chief of staff, not a press release.
- Address the person by first name in the opening line.
- 120–180 words. Flowing prose, not bullet points. Markdown allowed for **bold** emphasis on a metric or name.
- Never invent numbers, squad names, or OKRs. Use only what's in the context JSON.
- If a data point is missing ("null"), gracefully skip it — do not say "data unavailable" or acknowledge gaps.
- Past tense for what happened, present tense for current state, no filler ("Hope you're well").

Content priority (in this order — include what's relevant, skip what isn't):
1. Acknowledge their squad/pillar and anchor the briefing around it. If the person is a manager or leadership, reflect that vantage point.
2. Surface the most pressing OKR signal in their pillar: anything behind/at-risk gets named specifically. If everything in their pillar is on-track, say so and mention a concrete recent KR.
3. Give one relevant company-level number: LTV:Paid CAC ratio (guardrail is 3x) for commercial/growth-adjacent roles, MAU for product, headcount/hires for people/ops roles, ARR for leadership. Pick the one that best fits their role.
4. Close with what to look out for today — one specific thing tied to their role.

Return only the briefing prose. No preamble, no sign-off, no "Here's your briefing:" header.`;

function formatUsdCompact(value: number | null): string {
  if (value == null) return "null";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

function formatContextJson(ctx: BriefingContext): string {
  // Deliberately structured JSON — stable field ordering helps the LLM parse,
  // and keeps the payload transparent for future debugging.
  const payload = {
    today: ctx.generatedAtIso.slice(0, 10),
    person: ctx.person
      ? {
          firstName: ctx.person.firstName,
          jobTitle: ctx.person.jobTitle,
          squad: ctx.person.squad,
          pillar: ctx.person.pillar,
          function: ctx.person.function,
          tenureMonths: ctx.person.tenureMonths,
          role: ctx.person.role,
          isManager:
            ctx.person.role === "manager" ||
            ctx.person.role === "leadership" ||
            ctx.person.role === "ceo" ||
            ctx.person.directReportCount >= 2,
          directReportCount: ctx.person.directReportCount,
        }
      : null,
    company: {
      ltvPaidCacRatio: ctx.company.ltvPaidCacRatio,
      mau: ctx.company.mau,
      headcount: ctx.company.headcount,
      arr: formatUsdCompact(ctx.company.arrUsd),
    },
    pillarOkrs: {
      counts: {
        total: ctx.pillarOkrs.total,
        onTrack: ctx.pillarOkrs.onTrack,
        atRisk: ctx.pillarOkrs.atRisk,
        behind: ctx.pillarOkrs.behind,
        notStarted: ctx.pillarOkrs.notStarted,
      },
      recent: ctx.pillarOkrs.recent.map((o) => ({
        squad: o.squad,
        objective: o.objective,
        kr: o.kr,
        status: o.status,
        actual: o.actual,
        target: o.target,
        postedDate: o.postedAtIso.slice(0, 10),
      })),
    },
    squadOkrs: ctx.squadOkrs.map((o) => ({
      objective: o.objective,
      kr: o.kr,
      status: o.status,
      actual: o.actual,
      target: o.target,
      postedDate: o.postedAtIso.slice(0, 10),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

function extractUsage(msg: AnthropicMessage): BriefingUsage {
  const usage = msg.usage;
  return {
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    cacheReadTokens: usage?.cache_read_input_tokens ?? null,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? null,
  };
}

function extractText(msg: AnthropicMessage): string {
  for (const block of msg.content) {
    if (block.type === "text") return block.text.trim();
  }
  return "";
}

async function createWithRetry(
  request: MessageCreateParamsNonStreaming,
  signal: AbortSignal,
): Promise<AnthropicMessage> {
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
        category: "llm-briefing",
        level: "warning",
        message: "Retrying briefing LLM call after retryable failure",
        data: { attempt, nextAttempt: attempt + 1, backoffMs },
      });
      await waitForBackoff(backoffMs, signal);
    }
  }
  throw new Error("Briefing LLM call exhausted retry attempts");
}

/**
 * Generate a personalised briefing for the given context. Uses Claude Opus 4.7
 * with adaptive thinking. The system prompt is cached (prefix match on the
 * same stable SYSTEM_PROMPT bytes) so repeat callers only pay full input price
 * for the per-user JSON context.
 */
export async function generateBriefing(
  context: BriefingContext,
  { signal: parentSignal }: { signal?: AbortSignal } = {},
): Promise<BriefingResult> {
  const { signal, cleanup, timedOut } = composeAbortSignal(
    LLM_CALL_TIMEOUT_MS,
    parentSignal,
  );

  const request: MessageCreateParamsNonStreaming = {
    model: BRIEFING_MODEL,
    max_tokens: BRIEFING_MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is today's context JSON. Write the briefing.\n\n${formatContextJson(context)}`,
      },
    ],
  };

  try {
    const response = await createWithRetry(request, signal);
    const text = extractText(response);
    if (!text) {
      throw new Error("Briefing LLM returned no text content");
    }
    return { text, usage: extractUsage(response), model: BRIEFING_MODEL };
  } catch (error) {
    if (signal.aborted && timedOut()) {
      const timeoutError = new Error(
        `Briefing LLM call timed out after ${LLM_CALL_TIMEOUT_MS / 1000}s`,
      );
      Sentry.captureException(timeoutError, {
        tags: { integration: "llm-briefing" },
      });
      throw timeoutError;
    }
    Sentry.captureException(error, {
      tags: { integration: "llm-briefing" },
    });
    throw error;
  } finally {
    cleanup();
  }
}
