import type { PRAnalysisPayload } from "./github";

export const RUBRIC_VERSION = "v3.0-claude47-gpt54-ensemble";

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

export const CODE_REVIEW_SURFACES = [
  "frontend",
  "backend",
  "data",
  "infra",
  "mobile",
  "mixed",
] as const;
export type CodeReviewSurface = (typeof CODE_REVIEW_SURFACES)[number];

export const MODEL_AGREEMENT_LEVELS = [
  "single_model",
  "confirmed",
  "minor_adjustment",
  "material_adjustment",
] as const;
export type ModelAgreementLevel = (typeof MODEL_AGREEMENT_LEVELS)[number];

export const SECOND_OPINION_REASONS = [
  "truncated_diff",
  "large_pr",
  "low_confidence",
  "concerning_flag",
  "review_churn",
  "revert_signal",
] as const;
export type SecondOpinionReason = (typeof SECOND_OPINION_REASONS)[number];

export type ReviewProvider = "anthropic" | "openai" | "ensemble";

export interface CodeReviewModelReview {
  provider: ReviewProvider;
  model: string;
  technicalDifficulty: number; // 1-5
  executionQuality: number; // 1-5
  testAdequacy: number; // 1-5
  riskHandling: number; // 1-5
  reviewability: number; // 1-5
  analysisConfidencePct: number; // 0-100
  category: AnalysisCategory;
  summary: string;
  caveats: string[];
  standout: AnalysisStandout | null;
}

export interface CodeReviewAnalysis extends CodeReviewModelReview {
  complexity: number;
  quality: number;
  primarySurface: CodeReviewSurface;
  secondOpinionUsed: boolean;
  secondOpinionReasons: SecondOpinionReason[];
  agreementLevel: ModelAgreementLevel;
  outcomeScore: number;
  rawModelReviews: CodeReviewModelReview[];
}

export const REVIEW_OUTPUT_JSON_SCHEMA = {
  type: "object",
  required: [
    "technicalDifficulty",
    "executionQuality",
    "testAdequacy",
    "riskHandling",
    "reviewability",
    "analysisConfidencePct",
    "category",
    "summary",
    "caveats",
    "standout",
  ],
  additionalProperties: false,
  properties: {
    technicalDifficulty: { type: "integer", minimum: 1, maximum: 5 },
    executionQuality: { type: "integer", minimum: 1, maximum: 5 },
    testAdequacy: { type: "integer", minimum: 1, maximum: 5 },
    riskHandling: { type: "integer", minimum: 1, maximum: 5 },
    reviewability: { type: "integer", minimum: 1, maximum: 5 },
    analysisConfidencePct: { type: "integer", minimum: 0, maximum: 100 },
    category: { type: "string", enum: [...ANALYSIS_CATEGORIES] },
    summary: { type: "string", minLength: 3, maxLength: 400 },
    caveats: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 200 },
      maxItems: 8,
    },
    standout: {
      anyOf: [
        { type: "null" },
        { type: "string", enum: [...ANALYSIS_STANDOUTS] },
      ],
    },
  },
} as const;

export const PRIMARY_REVIEW_SYSTEM_PROMPT = `You are a senior engineer performing a structured rubric-based review of one merged pull request.

Your job is calibration-grade scoring, not narrative feedback. Judge what shipped, how well it was executed, and how much confidence to place in the visible evidence.

Return one JSON object with these fields:
- technicalDifficulty: 1-5
- executionQuality: 1-5
- testAdequacy: 1-5
- riskHandling: 1-5
- reviewability: 1-5
- analysisConfidencePct: integer 0-100
- category: bug_fix | feature | refactor | infra | test | docs | chore
- summary: one plain-English sentence
- caveats: short strings that explain weighting or uncertainty
- standout: null | notably_complex | notably_high_quality | notably_low_quality | concerning

Scoring guidance:

TECHNICAL DIFFICULTY
1 = trivial change or obvious one-liner
2 = small, localised fix or mechanical change
3 = moderate feature/fix/refactor with some system understanding
4 = hard cross-module or correctness-sensitive work
5 = unusually hard work with deep system impact or subtle failure modes

EXECUTION QUALITY
1 = weak / below bar
2 = rough, rushed, or fragile
3 = solid and acceptable
4 = strong and thoughtful
5 = exemplary reference-quality execution

TEST ADEQUACY
1 = clearly under-tested for the risk
2 = some testing but meaningfully short
3 = adequate for the scope
4 = strong coverage for the real risks
5 = especially thorough and well-targeted

RISK HANDLING
1 = obvious migration / rollback / safety gaps
2 = limited risk mitigation
3 = reasonable safeguards for the scope
4 = strong handling of edge cases, rollout, or backwards compatibility
5 = unusually careful risk management

REVIEWABILITY
1 = very hard to review; scope or description obscures the change
2 = reviewable but rough
3 = acceptable review surface
4 = cleanly shaped and easy to reason about
5 = exceptionally reviewable PR hygiene

ANALYSIS CONFIDENCE
Lower confidence when the diff is truncated, large parts are generated, authorship is unclear, the PR body is empty on a non-trivial change, or the visible evidence does not fully support strong judgement.

Calibration anchors:
- Do not let LOC alone inflate technicalDifficulty.
- Do not reward tiny PRs with very high executionQuality by default.
- Judge tests relative to risk, not relative to diff size.
- Use objective review/outcome metadata as context, but do not let one review thread dominate the whole assessment.
- If the evidence is partial, say so in caveats and lower analysisConfidencePct.
- Use standout="concerning" for serious concerns such as safety regression risk, tests removed without justification, or execution substantially below the expected bar for the change.

Return JSON only.`;

export const ADJUDICATION_SYSTEM_PROMPT = `You are acting as a second-opinion adjudicator for a structured PR review.

You will be given:
- the full PR evidence
- a primary model's structured review

Your task is not to average scores mechanically. Instead:
- confirm the primary review when it is directionally correct
- adjust it when the evidence supports a materially different judgement

Return one JSON object using the exact same schema as the primary reviewer.
If you mostly agree with the first review, keep the scores close and reflect that in summary/caveats/confidence.
If you materially disagree, return the scores you believe should be canonical based on the evidence.

Return JSON only.`;

export function clampRubricScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

export function clampConfidencePct(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 60;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function normalizeModelReview(
  provider: ReviewProvider,
  model: string,
  raw: Record<string, unknown>,
): CodeReviewModelReview {
  const category = ANALYSIS_CATEGORIES.includes(raw.category as AnalysisCategory)
    ? (raw.category as AnalysisCategory)
    : "chore";
  const standout =
    raw.standout && ANALYSIS_STANDOUTS.includes(raw.standout as AnalysisStandout)
      ? (raw.standout as AnalysisStandout)
      : null;

  return {
    provider,
    model,
    technicalDifficulty: clampRubricScore(raw.technicalDifficulty),
    executionQuality: clampRubricScore(raw.executionQuality),
    testAdequacy: clampRubricScore(raw.testAdequacy),
    riskHandling: clampRubricScore(raw.riskHandling),
    reviewability: clampRubricScore(raw.reviewability),
    analysisConfidencePct: clampConfidencePct(raw.analysisConfidencePct),
    category,
    summary: String(raw.summary ?? "").slice(0, 400) || "(no summary)",
    caveats: Array.isArray(raw.caveats)
      ? (raw.caveats as unknown[])
          .filter((c): c is string => typeof c === "string")
          .slice(0, 8)
      : [],
    standout,
  };
}

function renderFiles(payload: PRAnalysisPayload): string {
  return payload.files
    .map((f) => {
      if (f.skipped) {
        return `--- ${f.filename} (skipped: ${f.skipReason}, +${f.additions}/-${f.deletions}) ---`;
      }
      if (f.truncated && !f.patch) {
        return `--- ${f.filename} (patch omitted due to truncation budget, +${f.additions}/-${f.deletions}) ---`;
      }
      return `--- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) ---\n${f.patch ?? ""}`;
    })
    .join("\n\n");
}

export function renderReviewPayload(
  payload: PRAnalysisPayload,
  opts: {
    primaryReview?: CodeReviewModelReview;
  } = {},
): string {
  const processLines = [
    `Primary surface: ${payload.primarySurface}`,
    `Review rounds: ${payload.review.reviewRounds}`,
    `Approvals: ${payload.review.approvalCount}`,
    `Change requests: ${payload.review.changeRequestCount}`,
    `Review comments: ${payload.review.reviewCommentCount}`,
    `Conversation comments: ${payload.review.conversationCommentCount}`,
    `Commit count in PR: ${payload.review.commitCount}`,
    `Commits after first review: ${payload.review.commitsAfterFirstReview}`,
    payload.review.timeToFirstReviewHours === null
      ? "Time to first review: none"
      : `Time to first review: ${payload.review.timeToFirstReviewHours.toFixed(1)}h`,
    `Time to merge: ${payload.review.timeToMergeHours.toFixed(1)}h`,
    `Revert within 14d: ${payload.review.revertWithin14d ? "yes" : "no"}`,
  ];

  const primaryReviewBlock = opts.primaryReview
    ? [
        "",
        "Primary review to adjudicate:",
        JSON.stringify(
          {
            provider: opts.primaryReview.provider,
            model: opts.primaryReview.model,
            technicalDifficulty: opts.primaryReview.technicalDifficulty,
            executionQuality: opts.primaryReview.executionQuality,
            testAdequacy: opts.primaryReview.testAdequacy,
            riskHandling: opts.primaryReview.riskHandling,
            reviewability: opts.primaryReview.reviewability,
            analysisConfidencePct: opts.primaryReview.analysisConfidencePct,
            category: opts.primaryReview.category,
            summary: opts.primaryReview.summary,
            caveats: opts.primaryReview.caveats,
            standout: opts.primaryReview.standout,
          },
          null,
          2,
        ),
      ].join("\n")
    : "";

  return [
    `Repository: ${payload.repo}`,
    `PR #${payload.prNumber}: ${payload.title}`,
    `Merged at: ${payload.mergedAt}`,
    `Size: +${payload.additions} / -${payload.deletions} across ${payload.changedFiles} files`,
    payload.prNotes.length > 0 ? `Notes: ${payload.prNotes.join(" ")}` : "",
    "",
    "Process and outcome metadata:",
    processLines.join("\n"),
    "",
    "PR description:",
    payload.body || "(empty)",
    primaryReviewBlock,
    "",
    "File patches:",
    renderFiles(payload),
  ]
    .filter(Boolean)
    .join("\n");
}
