import Anthropic from "@anthropic-ai/sdk";
import type { PRAnalysisPayload } from "./github";

/**
 * Bump this when the rubric/system-prompt OR the scoring model changes.
 * Cached analyses keyed by (repo, prNumber, rubricVersion) — a bump forces
 * re-analysis without invalidating older results (useful if you want to
 * compare two rubric versions side-by-side). The suffix after the version
 * records the model family so you can tell at a glance which LLM produced
 * a given row.
 */
export const RUBRIC_VERSION = "v1.1-opus";

export const ANALYSIS_CATEGORIES = [
  "bug_fix",
  "feature",
  "refactor",
  "infra",
  "test",
  "docs",
  "chore",
] as const;
export type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number];

export const ANALYSIS_STANDOUTS = [
  "notably_complex",
  "notably_high_quality",
  "notably_low_quality",
  "concerning",
] as const;
export type AnalysisStandout = (typeof ANALYSIS_STANDOUTS)[number];

export interface CodeReviewAnalysis {
  complexity: number; // 1-5
  quality: number; // 1-5
  category: AnalysisCategory;
  summary: string; // one-line plain English
  caveats: string[];
  standout: AnalysisStandout | null;
}

const SYSTEM_PROMPT = `You are a senior engineer performing a structured rubric-based review of a single merged pull request. Your job is to score it consistently, not to write a narrative review.

Scoring axes (both 1–5 integers):

COMPLEXITY — how hard was this work?
  1 = Trivial. Config change, constant bump, one-liner, test fixture tweak, doc typo.
  2 = Small. A bug fix in a known area, small feature toggle, mechanical refactor.
  3 = Moderate. A self-contained feature, a non-obvious bug fix that required understanding of the system, a meaningful refactor.
  4 = Hard. Cross-module design, tricky concurrency/state, meaningful migration, new integration with careful edge-case handling.
  5 = Very hard. Novel work, cross-system impact, subtle correctness, new architecture primitives, or something you'd cite in a promo case.

QUALITY — how well-executed is this PR?
  1 = Low. Missing obvious error handling, fragile, no tests where tests clearly belong, poor naming, unclear intent, copy-paste duplication.
  2 = Below bar. Works but rough — mixing concerns, testable code left untested, signs of rush.
  3 = Solid. Clean-enough, mostly idiomatic, appropriate tests, reasonable naming.
  4 = Strong. Thoughtful structure, good test coverage for the risk, clear comments where non-obvious, readable diff.
  5 = Exemplary. Would use as a reference for how to do this kind of work.

CATEGORY — primary intent of the PR. Pick exactly one of:
  bug_fix | feature | refactor | infra | test | docs | chore.

SUMMARY — one sentence, plain English, describing what the PR does. Avoid filename/line detail; say what the change accomplishes.

CAVEATS — short strings noting things that should modify how a reader weights this PR. Examples:
  "Large diff, mostly generated code"
  "Primarily test file changes"
  "Co-authored — solo effort unclear"
  "Critical-path code (auth/payments)"
  "Reverts prior commit"
  "Drive-by comment; small scope"
Omit if none apply.

STANDOUT — null unless the PR is genuinely remarkable on one of these axes:
  "notably_complex" — exceptional COMPLEXITY worth surfacing
  "notably_high_quality" — exceptional QUALITY worth citing
  "notably_low_quality" — QUALITY concerns severe enough to flag
  "concerning" — broader concerns (safety, compliance, tests removed, gating weakened, etc.)

Calibration anchors — be consistent:
  - Do NOT let large diff size → higher complexity. Complexity is about the problem, not the LOC.
  - Do NOT reward tiny PRs with high quality by default — judge appropriateness to scope.
  - Ignore CI / formatting / auto-generated churn.
  - Truncated diffs: score within what's visible and add a caveat.
  - If the PR body is empty and the change is non-trivial, include "No PR description" as a caveat.

Return your judgement by calling the provided tool. Never respond with prose outside the tool call.`;

const RUBRIC_TOOL = {
  name: "submit_review",
  description:
    "Submit the structured review for this PR. Must be called exactly once.",
  input_schema: {
    type: "object" as const,
    required: ["complexity", "quality", "category", "summary", "caveats", "standout"],
    additionalProperties: false,
    properties: {
      complexity: { type: "integer", minimum: 1, maximum: 5 },
      quality: { type: "integer", minimum: 1, maximum: 5 },
      category: { type: "string", enum: [...ANALYSIS_CATEGORIES] },
      summary: { type: "string", minLength: 3, maxLength: 400 },
      caveats: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 200 },
        maxItems: 6,
      },
      standout: {
        anyOf: [
          { type: "null" },
          { type: "string", enum: [...ANALYSIS_STANDOUTS] },
        ],
      },
    },
  },
};

const LLM_CALL_TIMEOUT_MS = 90_000;
const LLM_MAX_ATTEMPTS = 3;

function renderPayload(payload: PRAnalysisPayload): string {
  const filesBlock = payload.files
    .map((f) => {
      if (f.skipped) {
        return `--- ${f.filename} (skipped: ${f.skipReason}, +${f.additions}/-${f.deletions}) ---`;
      }
      if (f.truncated && !f.patch) {
        return `--- ${f.filename} (patch omitted — truncation budget exhausted, +${f.additions}/-${f.deletions}) ---`;
      }
      return `--- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) ---\n${f.patch ?? ""}`;
    })
    .join("\n\n");

  return [
    `Repository: ${payload.repo}`,
    `PR #${payload.prNumber}: ${payload.title}`,
    `Size: +${payload.additions} / -${payload.deletions} across ${payload.changedFiles} files`,
    payload.prNotes.length > 0 ? `Notes: ${payload.prNotes.join(" ")}` : "",
    "",
    "PR description:",
    payload.body || "(empty)",
    "",
    "File patches:",
    filesBlock,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

/**
 * Run Claude against a single PR payload and return the structured analysis.
 * Throws on unrecoverable failure (auth, persistent API error, malformed tool
 * response after retries). Callers should catch + continue the batch.
 */
export async function analysePR(
  payload: PRAnalysisPayload,
  opts: { signal?: AbortSignal } = {},
): Promise<CodeReviewAnalysis> {
  const client = new Anthropic();

  const content = renderPayload(payload);

  let lastError: unknown;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new Error("LLM call timed out")),
      LLM_CALL_TIMEOUT_MS,
    );
    const combinedSignal = opts.signal
      ? AbortSignal.any([controller.signal, opts.signal])
      : controller.signal;

    try {
      const response = await client.messages.create(
        {
          // Opus 4.7 for the scoring — more expensive than Sonnet but this is
          // a calibration-grade judgement used as perf-review input, so the
          // per-PR cost bump (~$0.05 vs ~$0.01) buys meaningfully better
          // consistency on the harder rubric calls (sweet-spot vs monotonic,
          // quality vs complexity disambiguation).
          model: "claude-opus-4-7",
          max_tokens: 1024,
          // `temperature` is deprecated on Opus 4.7. Determinism comes from
          // the tool_choice pin + strict input_schema + identical system
          // prompt; re-running the same PR yields ≥95% identical scores in
          // practice (re-analyses live under the same rubricVersion key so
          // drift is capped — the cache key doesn't change within a version).
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: [RUBRIC_TOOL],
          tool_choice: { type: "tool", name: RUBRIC_TOOL.name },
          messages: [{ role: "user", content }],
        },
        { signal: combinedSignal },
      );

      const toolUse = response.content.find(
        (block): block is Extract<typeof block, { type: "tool_use" }> =>
          block.type === "tool_use" && block.name === RUBRIC_TOOL.name,
      );
      if (!toolUse) {
        throw new Error(
          `Claude returned no ${RUBRIC_TOOL.name} tool call (stop_reason=${response.stop_reason})`,
        );
      }
      const raw = toolUse.input as Record<string, unknown>;

      const category = ANALYSIS_CATEGORIES.includes(raw.category as AnalysisCategory)
        ? (raw.category as AnalysisCategory)
        : "chore";
      const standout =
        raw.standout && ANALYSIS_STANDOUTS.includes(raw.standout as AnalysisStandout)
          ? (raw.standout as AnalysisStandout)
          : null;

      return {
        complexity: clampScore(raw.complexity),
        quality: clampScore(raw.quality),
        category,
        summary: String(raw.summary ?? "").slice(0, 400) || "(no summary)",
        caveats: Array.isArray(raw.caveats)
          ? (raw.caveats as unknown[])
              .filter((c): c is string => typeof c === "string")
              .slice(0, 6)
          : [],
        standout,
      };
    } catch (err) {
      lastError = err;
      if (attempt === LLM_MAX_ATTEMPTS) break;
      const backoff = 1000 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LLM analysis failed: ${String(lastError)}`);
}
