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

import { analysePR } from "../code-review-analyser";
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

describe("analysePR", () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    anthropicCreate.mockReset();
    openaiCreate.mockReset();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it("returns the primary Anthropic review when no OpenAI second opinion is configured", async () => {
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

  it("uses OpenAI as an adjudicator when the primary review is low-confidence", async () => {
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
    openaiCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
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
      }),
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
    expect(result.secondOpinionReasons).toContain("truncated_diff");
    expect(result.executionQuality).toBe(3);
    expect(result.agreementLevel).not.toBe("single_model");
  });

  it("throws when Claude omits the required tool call", async () => {
    anthropicCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I don't want to score this." }],
    });
    await expect(analysePR(makePayload())).rejects.toThrow(/submit_review/);
  });
});
