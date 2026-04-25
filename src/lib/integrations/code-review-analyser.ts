import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type { PRAnalysisPayload } from "./github";
import {
  PRIMARY_REVIEW_SYSTEM_PROMPT,
  REVIEW_OUTPUT_JSON_SCHEMA,
  type CodeReviewAnalysis,
  type CodeReviewModelReview,
  type ModelAgreementLevel,
  normalizeModelReview,
  renderReviewPayload,
} from "./code-review-rubric";

export { RUBRIC_VERSION } from "./code-review-rubric";
export type {
  AnalysisCategory,
  AnalysisStandout,
  CodeReviewAnalysis,
  CodeReviewModelReview,
  CodeReviewSurface,
  ModelAgreementLevel,
  SecondOpinionReason,
} from "./code-review-rubric";

const LLM_CALL_TIMEOUT_MS = 90_000;
const LLM_MAX_ATTEMPTS = 3;
const OPENAI_DEFAULT_MODEL = "gpt-5.4";
const OPENAI_DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const DEFAULT_PROVIDER_CONCURRENCY = 2;

type ProviderKey = "anthropic" | "openai";

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const providerSemaphores = new Map<
  ProviderKey,
  { limit: number; semaphore: Semaphore }
>();

function getProviderConcurrency(provider: ProviderKey): number {
  const envName =
    provider === "anthropic"
      ? "CODE_REVIEW_ANTHROPIC_CONCURRENCY"
      : "CODE_REVIEW_OPENAI_CONCURRENCY";
  const parsed = Number(process.env[envName] ?? "");
  if (!Number.isFinite(parsed)) return DEFAULT_PROVIDER_CONCURRENCY;
  return Math.max(1, Math.min(16, Math.trunc(parsed)));
}

function withProviderSlot<T>(
  provider: ProviderKey,
  fn: () => Promise<T>,
): Promise<T> {
  const limit = getProviderConcurrency(provider);
  const cached = providerSemaphores.get(provider);
  if (!cached || cached.limit !== limit) {
    const fresh = { limit, semaphore: new Semaphore(limit) };
    providerSemaphores.set(provider, fresh);
    return fresh.semaphore.run(fn);
  }
  return cached.semaphore.run(fn);
}

const ANTHROPIC_TOOL = {
  name: "submit_review",
  description:
    "Submit the structured code-review judgement for this merged pull request.",
  input_schema: REVIEW_OUTPUT_JSON_SCHEMA as unknown as {
    type: "object";
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, unknown>;
  },
};

function composeAbortSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  timeoutMessage = "LLM review timed out",
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
    return Promise.reject(abortReasonToError(signal.reason, "LLM review aborted"));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReasonToError(signal?.reason, "LLM review aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
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

function isRetryableStatus(status: unknown): boolean {
  return typeof status === "number" && (status === 408 || status === 409 || status === 429 || status >= 500);
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

function getAnthropicClient(): Anthropic {
  return new Anthropic({
    maxRetries: 0,
  });
}

async function reviewWithAnthropic(
  payload: PRAnalysisPayload,
  opts: { signal?: AbortSignal } = {},
): Promise<CodeReviewModelReview> {
  const content = renderReviewPayload(payload);
  let lastError: unknown;

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    const { signal, cleanup } = composeAbortSignal(
      LLM_CALL_TIMEOUT_MS,
      opts.signal,
      "Anthropic code-review call timed out",
    );

    try {
      const response = await getAnthropicClient().messages.create(
        {
          model: "claude-opus-4-7",
          max_tokens: 1200,
          system: [
            {
              type: "text",
              text: PRIMARY_REVIEW_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [ANTHROPIC_TOOL],
          tool_choice: { type: "tool", name: ANTHROPIC_TOOL.name },
          messages: [{ role: "user", content }],
        },
        { signal },
      );

      const toolUse = response.content.find(
        (block): block is Extract<typeof block, { type: "tool_use" }> =>
          block.type === "tool_use" && block.name === ANTHROPIC_TOOL.name,
      );
      if (!toolUse) {
        throw new Error(
          `Claude returned no ${ANTHROPIC_TOOL.name} tool call (stop_reason=${response.stop_reason})`,
        );
      }

      return normalizeModelReview(
        "anthropic",
        "claude-opus-4-7",
        toolUse.input as Record<string, unknown>,
      );
    } catch (error) {
      lastError = error;
      if (signal.aborted) {
        throw abortReasonToError(signal.reason, "Anthropic code-review call aborted");
      }
      if (!isRetryableAnthropicError(error) || attempt === LLM_MAX_ATTEMPTS) break;
      await sleep(1000 * Math.pow(2, attempt - 1), opts.signal);
    } finally {
      cleanup();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Anthropic review failed: ${String(lastError)}`);
}

function getOpenAiModel(): string {
  return process.env.CODE_REVIEW_OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
}

function getOpenAiMaxOutputTokens(): number {
  const raw = process.env.CODE_REVIEW_OPENAI_MAX_OUTPUT_TOKENS?.trim();
  if (!raw) return OPENAI_DEFAULT_MAX_OUTPUT_TOKENS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return OPENAI_DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(2000, Math.min(32_000, Math.trunc(parsed)));
}

function parseReasoningEffort(
  raw: string | undefined,
  fallback: ReasoningEffort,
): ReasoningEffort {
  switch (raw) {
    case "none":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return raw;
    default:
      return fallback;
  }
}

function getOpenAiReasoningEffort(): ReasoningEffort {
  const raw = process.env.CODE_REVIEW_OPENAI_REASONING_EFFORT?.trim();
  switch (raw) {
    case "none":
    case "minimal":
    case "low":
    case "medium":
      return raw;
    default:
      return "medium";
  }
}

function getOpenAiEscalationReasoningEffort(): ReasoningEffort | null {
  const raw = process.env.CODE_REVIEW_OPENAI_ESCALATION_REASONING_EFFORT?.trim();
  if (!raw) return null;
  return parseReasoningEffort(raw, "high");
}

async function reviewWithOpenAi(
  payload: PRAnalysisPayload,
  opts: {
    signal?: AbortSignal;
    reasoningEffort?: ReasoningEffort;
    reviewRole?: "primary" | "escalation";
  } = {},
): Promise<CodeReviewModelReview> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  });
  const model = getOpenAiModel();
  const effort = opts.reasoningEffort ?? getOpenAiReasoningEffort();
  const content = renderReviewPayload(payload);
  let lastError: unknown;

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    const { signal, cleanup } = composeAbortSignal(
      LLM_CALL_TIMEOUT_MS,
      opts.signal,
      "OpenAI code-review call timed out",
    );

    try {
      const response = await client.responses.create(
        {
          model,
          instructions: PRIMARY_REVIEW_SYSTEM_PROMPT,
          input: content,
          reasoning: { effort },
          max_output_tokens: getOpenAiMaxOutputTokens(),
          text: {
            format: {
              type: "json_schema",
              name: "code_review",
              schema: REVIEW_OUTPUT_JSON_SCHEMA,
              strict: true,
            },
            verbosity: "low",
          },
        },
        { signal },
      );
      const raw = parseJsonObject(response.output_text);
      return normalizeModelReview(
        "openai",
        opts.reviewRole === "escalation"
          ? `${model} (${effort} escalation)`
          : model,
        raw,
      );
    } catch (error) {
      lastError = error;
      if (signal.aborted) {
        throw abortReasonToError(signal.reason, "OpenAI code-review call aborted");
      }
      if (attempt === LLM_MAX_ATTEMPTS) break;
      const status = getErrorStatus(error);
      if (status !== null && !isRetryableStatus(status)) break;
      await sleep(1000 * Math.pow(2, attempt - 1), opts.signal);
    } finally {
      cleanup();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`OpenAI review failed: ${String(lastError)}`);
}

function measureDisagreement(
  primary: CodeReviewModelReview,
  adjudicated: CodeReviewModelReview,
): number {
  const deltas = [
    Math.abs(primary.technicalDifficulty - adjudicated.technicalDifficulty),
    Math.abs(primary.executionQuality - adjudicated.executionQuality),
    Math.abs(primary.testAdequacy - adjudicated.testAdequacy),
    Math.abs(primary.riskHandling - adjudicated.riskHandling),
    Math.abs(primary.reviewability - adjudicated.reviewability),
  ];
  const numericMean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
  const categoryPenalty = primary.category === adjudicated.category ? 0 : 0.5;
  const standoutPenalty = primary.standout === adjudicated.standout ? 0 : 0.5;
  return numericMean + categoryPenalty + standoutPenalty;
}

function deriveAgreementLevel(
  primary: CodeReviewModelReview,
  adjudicated: CodeReviewModelReview,
): ModelAgreementLevel {
  const disagreement = measureDisagreement(primary, adjudicated);
  if (disagreement <= 0.4) return "confirmed";
  if (disagreement <= 1.2) return "minor_adjustment";
  return "material_adjustment";
}

async function maybeEscalateMaterialDisagreement(
  payload: PRAnalysisPayload,
  rawModelReviews: CodeReviewModelReview[],
  agreementLevel: ModelAgreementLevel,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const escalationEffort = getOpenAiEscalationReasoningEffort();
  if (agreementLevel !== "material_adjustment" || escalationEffort === null) {
    return;
  }

  try {
    const escalation = await withProviderSlot("openai", () =>
      reviewWithOpenAi(payload, {
        ...opts,
        reasoningEffort: escalationEffort,
        reviewRole: "escalation",
      }),
    );
    rawModelReviews.push(escalation);
  } catch {
    // The initial two-model ensemble is still usable; escalation is an
    // optional refinement only when material disagreement is detected.
  }
}

function confidenceWeight(review: CodeReviewModelReview): number {
  return Math.max(1, review.analysisConfidencePct);
}

function weightedRubricScore(
  reviews: CodeReviewModelReview[],
  key:
    | "technicalDifficulty"
    | "executionQuality"
    | "testAdequacy"
    | "riskHandling"
    | "reviewability",
): number {
  const totalWeight = reviews.reduce(
    (sum, review) => sum + confidenceWeight(review),
    0,
  );
  const weighted = reviews.reduce(
    (sum, review) => sum + review[key] * confidenceWeight(review),
    0,
  );
  return Math.max(1, Math.min(5, Math.round(weighted / totalWeight)));
}

function highestConfidenceReview(
  reviews: CodeReviewModelReview[],
): CodeReviewModelReview {
  return [...reviews].sort(
    (a, b) => b.analysisConfidencePct - a.analysisConfidencePct,
  )[0];
}

function combineCaveats(reviews: CodeReviewModelReview[]): string[] {
  const caveats: string[] = [];
  for (const review of reviews) {
    const label =
      review.provider === "anthropic"
        ? "Claude"
        : review.provider === "openai"
          ? "GPT-5.4"
          : "Ensemble";
    for (const caveat of review.caveats) {
      const labelled = `${label}: ${caveat}`;
      if (!caveats.includes(labelled)) caveats.push(labelled);
      if (caveats.length >= 8) return caveats;
    }
  }
  return caveats;
}

function blendModelReviews(
  reviews: CodeReviewModelReview[],
): CodeReviewModelReview {
  if (reviews.length === 1) return reviews[0];

  const representative = highestConfidenceReview(reviews);
  const confidence = Math.round(
    reviews.reduce((sum, review) => sum + review.analysisConfidencePct, 0) /
      reviews.length,
  );

  return {
    provider: "ensemble",
    model: reviews.map((review) => review.model).join("+"),
    technicalDifficulty: weightedRubricScore(reviews, "technicalDifficulty"),
    executionQuality: weightedRubricScore(reviews, "executionQuality"),
    testAdequacy: weightedRubricScore(reviews, "testAdequacy"),
    riskHandling: weightedRubricScore(reviews, "riskHandling"),
    reviewability: weightedRubricScore(reviews, "reviewability"),
    analysisConfidencePct: confidence,
    category: representative.category,
    summary: representative.summary,
    caveats: combineCaveats(reviews),
    standout: representative.standout,
  };
}

export function computeOutcomeScore(payload: PRAnalysisPayload): number {
  let score = 75;

  score += Math.min(10, payload.review.approvalCount * 4);
  score -= Math.min(16, payload.review.changeRequestCount * 8);
  score -= Math.min(15, payload.review.commitsAfterFirstReview * 4);
  score -= Math.min(12, Math.max(0, payload.review.reviewRounds - 1) * 6);
  score -= Math.min(8, payload.review.reviewCommentCount * 0.5);
  if (payload.review.revertWithin14d) score -= 35;
  if (payload.review.revertWithin14d) score = Math.min(score, 40);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Run Claude and GPT-5.4 as independent reviewers. The canonical row stores a
 * confidence-weighted ensemble score; individual model reads stay in rawJson.
 */
export async function analysePR(
  payload: PRAnalysisPayload,
  opts: { signal?: AbortSignal } = {},
): Promise<CodeReviewAnalysis> {
  const [anthropicResult, openAiResult] = await Promise.allSettled([
    withProviderSlot("anthropic", () => reviewWithAnthropic(payload, opts)),
    withProviderSlot("openai", () => reviewWithOpenAi(payload, opts)),
  ]);

  const rawModelReviews: CodeReviewModelReview[] = [];
  const failures: string[] = [];

  if (anthropicResult.status === "fulfilled") {
    rawModelReviews.push(anthropicResult.value);
  } else {
    failures.push(
      anthropicResult.reason instanceof Error
        ? anthropicResult.reason.message
        : String(anthropicResult.reason),
    );
  }

  if (openAiResult.status === "fulfilled") {
    rawModelReviews.push(openAiResult.value);
  } else {
    failures.push(
      openAiResult.reason instanceof Error
        ? openAiResult.reason.message
        : String(openAiResult.reason),
    );
  }

  if (rawModelReviews.length === 0) {
    throw new Error(`All code-review model calls failed: ${failures.join("; ")}`);
  }

  let agreementLevel: ModelAgreementLevel = "single_model";
  if (rawModelReviews.length >= 2) {
    agreementLevel = deriveAgreementLevel(rawModelReviews[0], rawModelReviews[1]);
    await maybeEscalateMaterialDisagreement(
      payload,
      rawModelReviews,
      agreementLevel,
      opts,
    );
  }

  const finalReview = blendModelReviews(rawModelReviews);

  return {
    ...finalReview,
    complexity: finalReview.technicalDifficulty,
    quality: finalReview.executionQuality,
    primarySurface: payload.primarySurface,
    secondOpinionUsed: rawModelReviews.length > 1,
    secondOpinionReasons: [],
    agreementLevel,
    outcomeScore: computeOutcomeScore(payload),
    rawModelReviews,
  };
}

/**
 * Enrich a previously stored Claude-only review with a fresh GPT-5.4 read.
 * Used when a historical 4.7 backfill already exists; OpenAI must succeed so
 * the new rubric row really is an ensemble rather than a recached old result.
 */
export async function analysePRWithExistingAnthropicReview(
  payload: PRAnalysisPayload,
  existingAnthropicReview: CodeReviewModelReview,
  opts: { signal?: AbortSignal } = {},
): Promise<CodeReviewAnalysis> {
  const anthropicReview = {
    ...existingAnthropicReview,
    provider: "anthropic" as const,
    model: existingAnthropicReview.model || "claude-opus-4-7",
  };
  const openAiReview = await withProviderSlot("openai", () =>
    reviewWithOpenAi(payload, opts),
  );
  const rawModelReviews: CodeReviewModelReview[] = [
    anthropicReview,
    openAiReview,
  ];
  const agreementLevel = deriveAgreementLevel(anthropicReview, openAiReview);
  await maybeEscalateMaterialDisagreement(
    payload,
    rawModelReviews,
    agreementLevel,
    opts,
  );
  const finalReview = blendModelReviews(rawModelReviews);

  return {
    ...finalReview,
    complexity: finalReview.technicalDifficulty,
    quality: finalReview.executionQuality,
    primarySurface: payload.primarySurface,
    secondOpinionUsed: true,
    secondOpinionReasons: [],
    agreementLevel,
    outcomeScore: computeOutcomeScore(payload),
    rawModelReviews,
  };
}
