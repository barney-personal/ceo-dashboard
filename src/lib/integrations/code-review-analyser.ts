import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type { PRAnalysisPayload } from "./github";
import {
  ADJUDICATION_SYSTEM_PROMPT,
  PRIMARY_REVIEW_SYSTEM_PROMPT,
  REVIEW_OUTPUT_JSON_SCHEMA,
  type CodeReviewAnalysis,
  type CodeReviewModelReview,
  type ModelAgreementLevel,
  type SecondOpinionReason,
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

function hasOpenAiSecondOpinion(): boolean {
  return (
    process.env.CODE_REVIEW_ENABLE_OPENAI_SECOND_OPINION !== "0" &&
    !!process.env.OPENAI_API_KEY
  );
}

function getOpenAiModel(): string {
  return process.env.CODE_REVIEW_OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
}

function getOpenAiReasoningEffort(): ReasoningEffort {
  const raw = process.env.CODE_REVIEW_OPENAI_REASONING_EFFORT?.trim();
  switch (raw) {
    case "none":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return raw;
    default:
      return "xhigh";
  }
}

async function adjudicateWithOpenAi(
  payload: PRAnalysisPayload,
  primary: CodeReviewModelReview,
  opts: { signal?: AbortSignal } = {},
): Promise<CodeReviewModelReview> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  });
  const model = getOpenAiModel();
  const content = renderReviewPayload(payload, { primaryReview: primary });
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
          instructions: ADJUDICATION_SYSTEM_PROMPT,
          input: content,
          reasoning: { effort: getOpenAiReasoningEffort() },
        },
        { signal },
      );
      const raw = parseJsonObject(response.output_text);
      return normalizeModelReview("openai", model, raw);
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
    : new Error(`OpenAI adjudication failed: ${String(lastError)}`);
}

function getSecondOpinionReasons(
  payload: PRAnalysisPayload,
  primary: CodeReviewModelReview,
): SecondOpinionReason[] {
  if (!hasOpenAiSecondOpinion()) return [];

  const reasons: SecondOpinionReason[] = [];
  if (payload.files.some((file) => file.truncated)) reasons.push("truncated_diff");
  if (
    payload.changedFiles >= 20 ||
    payload.additions + payload.deletions >= 2000 ||
    payload.review.commitCount >= 12
  ) {
    reasons.push("large_pr");
  }
  if (primary.analysisConfidencePct < 72) reasons.push("low_confidence");
  if (primary.standout === "concerning" || primary.executionQuality <= 2) {
    reasons.push("concerning_flag");
  }
  if (
    payload.review.changeRequestCount >= 2 ||
    payload.review.reviewRounds >= 3 ||
    payload.review.commitsAfterFirstReview >= 3
  ) {
    reasons.push("review_churn");
  }
  if (payload.review.revertWithin14d) reasons.push("revert_signal");

  return [...new Set(reasons)];
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

function mergeConfirmedConfidence(
  primary: CodeReviewModelReview,
  adjudicated: CodeReviewModelReview,
): CodeReviewModelReview {
  return {
    ...primary,
    analysisConfidencePct: Math.min(
      100,
      Math.round((primary.analysisConfidencePct + adjudicated.analysisConfidencePct) / 2),
    ),
  };
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
 * Run the primary Anthropic review, then optionally invoke OpenAI as a
 * selective adjudicator when the PR looks ambiguous, truncated, or otherwise
 * high-impact enough to justify a second opinion.
 */
export async function analysePR(
  payload: PRAnalysisPayload,
  opts: { signal?: AbortSignal } = {},
): Promise<CodeReviewAnalysis> {
  const primary = await reviewWithAnthropic(payload, opts);
  const secondOpinionReasons = getSecondOpinionReasons(payload, primary);

  let finalReview = primary;
  let agreementLevel: ModelAgreementLevel = "single_model";
  const rawModelReviews: CodeReviewModelReview[] = [primary];

  if (secondOpinionReasons.length > 0) {
    try {
      const adjudicated = await adjudicateWithOpenAi(payload, primary, opts);
      rawModelReviews.push(adjudicated);
      agreementLevel = deriveAgreementLevel(primary, adjudicated);
      finalReview =
        agreementLevel === "confirmed"
          ? mergeConfirmedConfidence(primary, adjudicated)
          : adjudicated;
    } catch (error) {
      console.warn("OpenAI adjudication failed; using primary review", error);
    }
  }

  return {
    ...finalReview,
    complexity: finalReview.technicalDifficulty,
    quality: finalReview.executionQuality,
    primarySurface: payload.primarySurface,
    secondOpinionUsed: rawModelReviews.length > 1,
    secondOpinionReasons,
    agreementLevel,
    outcomeScore: computeOutcomeScore(payload),
    rawModelReviews,
  };
}
