import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { anthropicCreate, openaiCreate } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  openaiCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));

vi.mock("openai", () => ({
  default: class {
    responses = { create: openaiCreate };
  },
}));

import {
  analysePR,
  analysePRWithExistingAnthropicReview,
  computeOutcomeScore,
} from "../code-review-analyser";
import type { PRAnalysisPayload } from "../github";

function makePayload(
  overrides: Partial<PRAnalysisPayload> = {},
): PRAnalysisPayload {
  return {
    repo: "acme/api",
    prNumber: 42,
    title: "Add thing",
    body: "Does the thing",
    createdAt: "2026-04-20T10:00:00.000Z",
    mergedAt: "2026-04-21T10:00:00.000Z",
    mergeSha: "abc123",
    additions: 100,
    deletions: 20,
    changedFiles: 3,
    primarySurface: "backend",
    review: {
      approvalCount: 1,
      changeRequestCount: 0,
      reviewCommentCount: 2,
      conversationCommentCount: 1,
      reviewRounds: 1,
      timeToFirstReviewHours: 2,
      timeToMergeHours: 24,
      commitCount: 2,
      commitsAfterFirstReview: 0,
      revertWithin14d: false,
    },
    files: [
      {
        filename: "src/feature.ts",
        status: "modified",
        additions: 80,
        deletions: 10,
        patch: "@@ -1,3 +1,10 @@\n+function foo() {}\n",
        truncated: false,
        skipped: false,
      },
    ],
    prNotes: [],
    ...overrides,
  };
}

function mockAnthropicToolUse(input: Record<string, unknown>) {
  anthropicCreate.mockResolvedValueOnce({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        name: "submit_review",
        id: "tu_1",
        input,
      },
    ],
  });
}

function mockOpenAiReview(input: Record<string, unknown>) {
  openaiCreate.mockResolvedValueOnce({
    output_text: JSON.stringify(input),
  });
}

describe("analysePR", () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalAnthropicConcurrency = process.env.CODE_REVIEW_ANTHROPIC_CONCURRENCY;
  const originalOpenAiConcurrency = process.env.CODE_REVIEW_OPENAI_CONCURRENCY;
  const originalReasoningEffort = process.env.CODE_REVIEW_OPENAI_REASONING_EFFORT;
  const originalMaxOutputTokens = process.env.CODE_REVIEW_OPENAI_MAX_OUTPUT_TOKENS;
  const originalEscalationEffort =
    process.env.CODE_REVIEW_OPENAI_ESCALATION_REASONING_EFFORT;

  beforeEach(() => {
    anthropicCreate.mockReset();
    openaiCreate.mockReset();
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODE_REVIEW_OPENAI_MAX_OUTPUT_TOKENS;
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalAnthropicConcurrency === undefined) {
      delete process.env.CODE_REVIEW_ANTHROPIC_CONCURRENCY;
    } else {
      process.env.CODE_REVIEW_ANTHROPIC_CONCURRENCY = originalAnthropicConcurrency;
    }
    if (originalOpenAiConcurrency === undefined) {
      delete process.env.CODE_REVIEW_OPENAI_CONCURRENCY;
    } else {
      process.env.CODE_REVIEW_OPENAI_CONCURRENCY = originalOpenAiConcurrency;
    }
    if (originalReasoningEffort === undefined) {
      delete process.env.CODE_REVIEW_OPENAI_REASONING_EFFORT;
    } else {
      process.env.CODE_REVIEW_OPENAI_REASONING_EFFORT = originalReasoningEffort;
    }
    if (originalMaxOutputTokens === undefined) {
      delete process.env.CODE_REVIEW_OPENAI_MAX_OUTPUT_TOKENS;
    } else {
      process.env.CODE_REVIEW_OPENAI_MAX_OUTPUT_TOKENS = originalMaxOutputTokens;
    }
    if (originalEscalationEffort === undefined) {
      delete process.env.CODE_REVIEW_OPENAI_ESCALATION_REASONING_EFFORT;
    } else {
      process.env.CODE_REVIEW_OPENAI_ESCALATION_REASONING_EFFORT =
        originalEscalationEffort;
    }
  });

  it("returns the Anthropic review when OpenAI is not configured", async () => {
    mockAnthropicToolUse({
      technicalDifficulty: 3,
      executionQuality: 4,
      testAdequacy: 4,
      riskHandling: 3,
      reviewability: 4,
      analysisConfidencePct: 81,
      category: "feature",
      summary: "Adds a feature foo that does X.",
      caveats: ["Primarily test file changes"],
      standout: null,
    });

    const result = await analysePR(makePayload());
    expect(result.technicalDifficulty).toBe(3);
    expect(result.executionQuality).toBe(4);
    expect(result.analysisConfidencePct).toBe(81);
    expect(result.secondOpinionUsed).toBe(false);
    expect(result.agreementLevel).toBe("single_model");
    expect(result.primarySurface).toBe("backend");
    expect(result.outcomeScore).toBeGreaterThan(0);
  });

  it("blends Anthropic and GPT-5.4 when both model reviews succeed", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    mockAnthropicToolUse({
      technicalDifficulty: 4,
      executionQuality: 2,
      testAdequacy: 2,
      riskHandling: 2,
      reviewability: 2,
      analysisConfidencePct: 40,
      category: "feature",
      summary: "Adds a feature under low-confidence evidence.",
      caveats: ["Diff was truncated"],
      standout: "concerning",
    });
    mockOpenAiReview({
      technicalDifficulty: 4,
      executionQuality: 3,
      testAdequacy: 3,
      riskHandling: 3,
      reviewability: 3,
      analysisConfidencePct: 74,
      category: "feature",
      summary: "Adds a feature with some rough edges but acceptable execution.",
      caveats: ["Primary review looked overly harsh on partial evidence"],
      standout: null,
    });

    const result = await analysePR(
      makePayload({
        files: [
          {
            filename: "src/feature.ts",
            status: "modified",
            additions: 80,
            deletions: 10,
            patch: null,
            truncated: true,
            skipped: false,
          },
        ],
      }),
    );

    expect(result.secondOpinionUsed).toBe(true);
    expect(result.secondOpinionReasons).toEqual([]);
    expect(result.provider).toBe("ensemble");
    expect(result.model).toBe("claude-opus-4-7+gpt-5.4");
    expect(result.executionQuality).toBe(3);
    expect(result.agreementLevel).toBe("material_adjustment");
    expect(result.rawModelReviews).toHaveLength(2);
    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        max_output_tokens: 8000,
      }),
      expect.any(Object),
    );
  });

  it("falls back to Claude when GPT-5.4 fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    mockAnthropicToolUse({
      technicalDifficulty: 4,
      executionQuality: 2,
      testAdequacy: 2,
      riskHandling: 2,
      reviewability: 2,
      analysisConfidencePct: 40,
      category: "feature",
      summary: "Adds a feature under low-confidence evidence.",
      caveats: ["Diff was truncated"],
      standout: "concerning",
    });
    openaiCreate.mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));

    const result = await analysePR(
      makePayload({
        files: [
          {
            filename: "src/feature.ts",
            status: "modified",
            additions: 80,
            deletions: 10,
            patch: null,
            truncated: true,
            skipped: false,
          },
        ],
      }),
    );

    expect(result.secondOpinionUsed).toBe(false);
    expect(result.secondOpinionReasons).toEqual([]);
    expect(result.executionQuality).toBe(2);
    expect(result.agreementLevel).toBe("single_model");
    expect(result.rawModelReviews).toHaveLength(1);
    expect(result.provider).toBe("anthropic");
  });

  it("optionally escalates material disagreement with a high-reasoning GPT-5.4 pass", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.CODE_REVIEW_OPENAI_ESCALATION_REASONING_EFFORT = "high";
    mockAnthropicToolUse({
      technicalDifficulty: 4,
      executionQuality: 2,
      testAdequacy: 2,
      riskHandling: 2,
      reviewability: 2,
      analysisConfidencePct: 40,
      category: "feature",
      summary: "Adds a feature under low-confidence evidence.",
      caveats: ["Diff was truncated"],
      standout: "concerning",
    });
    mockOpenAiReview({
      technicalDifficulty: 4,
      executionQuality: 4,
      testAdequacy: 4,
      riskHandling: 4,
      reviewability: 4,
      analysisConfidencePct: 74,
      category: "feature",
      summary: "GPT saw a solid feature change.",
      caveats: [],
      standout: null,
    });
    mockOpenAiReview({
      technicalDifficulty: 4,
      executionQuality: 3,
      testAdequacy: 3,
      riskHandling: 3,
      reviewability: 3,
      analysisConfidencePct: 88,
      category: "feature",
      summary: "High-reasoning escalation lands between the two reads.",
      caveats: [],
      standout: null,
    });

    const result = await analysePR(makePayload());

    expect(result.agreementLevel).toBe("material_adjustment");
    expect(result.rawModelReviews).toHaveLength(3);
    expect(result.rawModelReviews[2].model).toBe("gpt-5.4 (high escalation)");
    expect(openaiCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        max_output_tokens: 8000,
      }),
      expect.any(Object),
    );
  });

  it("allows a larger GPT-5.4 output budget through env configuration", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.CODE_REVIEW_OPENAI_MAX_OUTPUT_TOKENS = "16000";
    mockAnthropicToolUse({
      technicalDifficulty: 3,
      executionQuality: 3,
      testAdequacy: 3,
      riskHandling: 3,
      reviewability: 3,
      analysisConfidencePct: 80,
      category: "feature",
      summary: "Solid change.",
      caveats: [],
      standout: null,
    });
    mockOpenAiReview({
      technicalDifficulty: 3,
      executionQuality: 3,
      testAdequacy: 3,
      riskHandling: 3,
      reviewability: 3,
      analysisConfidencePct: 80,
      category: "feature",
      summary: "Solid change.",
      caveats: [],
      standout: null,
    });

    await analysePR(makePayload());

    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_output_tokens: 16000,
      }),
      expect.any(Object),
    );
  });

  it("enriches an existing Claude review by running only GPT-5.4", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    mockOpenAiReview({
      technicalDifficulty: 4,
      executionQuality: 4,
      testAdequacy: 4,
      riskHandling: 4,
      reviewability: 4,
      analysisConfidencePct: 86,
      category: "feature",
      summary: "GPT agrees this was a strong feature change.",
      caveats: [],
      standout: "notably_high_quality",
    });

    const result = await analysePRWithExistingAnthropicReview(makePayload(), {
      provider: "anthropic",
      model: "claude-opus-4-7",
      technicalDifficulty: 4,
      executionQuality: 4,
      testAdequacy: 3,
      riskHandling: 4,
      reviewability: 4,
      analysisConfidencePct: 82,
      category: "feature",
      summary: "Historical Claude read.",
      caveats: [],
      standout: "notably_high_quality",
    });

    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("ensemble");
    expect(result.model).toBe("claude-opus-4-7+gpt-5.4");
    expect(result.rawModelReviews).toHaveLength(2);
    expect(result.rawModelReviews[0].provider).toBe("anthropic");
    expect(result.rawModelReviews[1].provider).toBe("openai");
  });

  it("uses medium for the main GPT-5.4 pass even when a stale high-effort env is present", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.CODE_REVIEW_OPENAI_REASONING_EFFORT = "xhigh";
    mockAnthropicToolUse({
      technicalDifficulty: 3,
      executionQuality: 3,
      testAdequacy: 3,
      riskHandling: 3,
      reviewability: 3,
      analysisConfidencePct: 80,
      category: "feature",
      summary: "Solid change.",
      caveats: [],
      standout: null,
    });
    mockOpenAiReview({
      technicalDifficulty: 3,
      executionQuality: 3,
      testAdequacy: 3,
      riskHandling: 3,
      reviewability: 3,
      analysisConfidencePct: 80,
      category: "feature",
      summary: "Solid change.",
      caveats: [],
      standout: null,
    });

    await analysePR(makePayload());

    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: "medium" },
      }),
      expect.any(Object),
    );
  });

  it("falls back to GPT-5.4 when Claude fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    anthropicCreate.mockRejectedValue(new Error("Claude down"));
    mockOpenAiReview({
      technicalDifficulty: 3,
      executionQuality: 4,
      testAdequacy: 4,
      riskHandling: 4,
      reviewability: 4,
      analysisConfidencePct: 82,
      category: "feature",
      summary: "Adds a well-tested feature.",
      caveats: [],
      standout: null,
    });

    const result = await analysePR(makePayload());
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-5.4");
    expect(result.secondOpinionUsed).toBe(false);
    expect(result.rawModelReviews).toHaveLength(1);
  });

  it("throws only when both model providers fail", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    anthropicCreate.mockRejectedValue(new Error("Claude down"));
    openaiCreate.mockRejectedValue(new Error("GPT down"));

    await expect(analysePR(makePayload())).rejects.toThrow(/All code-review model calls failed/);
  });

  it("throws when Claude omits the required tool call", async () => {
    anthropicCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I don't want to score this." }],
    });
    await expect(analysePR(makePayload())).rejects.toThrow(/submit_review/);
  });

  it("honours provider-specific concurrency gates", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.CODE_REVIEW_ANTHROPIC_CONCURRENCY = "1";
    process.env.CODE_REVIEW_OPENAI_CONCURRENCY = "1";
    let activeAnthropic = 0;
    let maxAnthropic = 0;
    let activeOpenAi = 0;
    let maxOpenAi = 0;
    const delay = () => new Promise((resolve) => setTimeout(resolve, 10));

    anthropicCreate.mockImplementation(async () => {
      activeAnthropic++;
      maxAnthropic = Math.max(maxAnthropic, activeAnthropic);
      await delay();
      activeAnthropic--;
      return {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "submit_review",
            id: "tu_1",
            input: {
              technicalDifficulty: 3,
              executionQuality: 3,
              testAdequacy: 3,
              riskHandling: 3,
              reviewability: 3,
              analysisConfidencePct: 80,
              category: "feature",
              summary: "Solid change.",
              caveats: [],
              standout: null,
            },
          },
        ],
      };
    });
    openaiCreate.mockImplementation(async () => {
      activeOpenAi++;
      maxOpenAi = Math.max(maxOpenAi, activeOpenAi);
      await delay();
      activeOpenAi--;
      return {
        output_text: JSON.stringify({
          technicalDifficulty: 3,
          executionQuality: 3,
          testAdequacy: 3,
          riskHandling: 3,
          reviewability: 3,
          analysisConfidencePct: 80,
          category: "feature",
          summary: "Solid change.",
          caveats: [],
          standout: null,
        }),
      };
    });

    await Promise.all([
      analysePR(makePayload({ prNumber: 1 })),
      analysePR(makePayload({ prNumber: 2 })),
    ]);

    expect(maxAnthropic).toBe(1);
    expect(maxOpenAi).toBe(1);
    delete process.env.CODE_REVIEW_ANTHROPIC_CONCURRENCY;
    delete process.env.CODE_REVIEW_OPENAI_CONCURRENCY;
  });

  it("returns a neutral outcome score when review signals are absent", () => {
    const payload = makePayload({
      review: {
        approvalCount: 0,
        changeRequestCount: 0,
        reviewCommentCount: 0,
        conversationCommentCount: 0,
        reviewRounds: 0,
        timeToFirstReviewHours: 0,
        timeToMergeHours: 0,
        commitCount: 0,
        commitsAfterFirstReview: 0,
        revertWithin14d: false,
      },
    });

    expect(computeOutcomeScore(payload)).toBe(75);
  });

  it("caps reverted PR outcome scores at 40", () => {
    const payload = makePayload({
      review: {
        approvalCount: 3,
        changeRequestCount: 0,
        reviewCommentCount: 0,
        conversationCommentCount: 0,
        reviewRounds: 1,
        timeToFirstReviewHours: 1,
        timeToMergeHours: 12,
        commitCount: 3,
        commitsAfterFirstReview: 0,
        revertWithin14d: true,
      },
    });

    expect(computeOutcomeScore(payload)).toBe(40);
  });

  it("rewards smooth review outcomes and clamps heavily negative cases to zero", () => {
    const strongPayload = makePayload({
      review: {
        approvalCount: 3,
        changeRequestCount: 0,
        reviewCommentCount: 0,
        conversationCommentCount: 0,
        reviewRounds: 1,
        timeToFirstReviewHours: 1,
        timeToMergeHours: 12,
        commitCount: 3,
        commitsAfterFirstReview: 0,
        revertWithin14d: false,
      },
    });
    const poorPayload = makePayload({
      review: {
        approvalCount: 0,
        changeRequestCount: 8,
        reviewCommentCount: 99,
        conversationCommentCount: 0,
        reviewRounds: 8,
        timeToFirstReviewHours: 24,
        timeToMergeHours: 72,
        commitCount: 12,
        commitsAfterFirstReview: 9,
        revertWithin14d: true,
      },
    });

    expect(computeOutcomeScore(strongPayload)).toBeGreaterThan(80);
    expect(computeOutcomeScore(poorPayload)).toBe(0);
  });
});
