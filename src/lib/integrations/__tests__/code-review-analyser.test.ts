import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK to return a controllable tool_use response.
const messagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: messagesCreate };
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
    mergeSha: "abc",
    additions: 100,
    deletions: 20,
    changedFiles: 3,
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

function mockToolUseResponse(input: Record<string, unknown>) {
  messagesCreate.mockResolvedValueOnce({
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
  beforeEach(() => {
    messagesCreate.mockReset();
  });

  it("returns a valid analysis from a well-formed tool_use response", async () => {
    mockToolUseResponse({
      complexity: 3,
      quality: 4,
      category: "feature",
      summary: "Adds a feature foo that does X.",
      caveats: ["Primarily test file changes"],
      standout: null,
    });
    const result = await analysePR(makePayload());
    expect(result).toEqual({
      complexity: 3,
      quality: 4,
      category: "feature",
      summary: "Adds a feature foo that does X.",
      caveats: ["Primarily test file changes"],
      standout: null,
    });
  });

  it("clamps scores outside 1..5 to the valid range", async () => {
    mockToolUseResponse({
      complexity: 9,
      quality: 0,
      category: "refactor",
      summary: "x",
      caveats: [],
      standout: null,
    });
    const result = await analysePR(makePayload());
    expect(result.complexity).toBe(5);
    expect(result.quality).toBe(1);
  });

  it("coerces unknown categories to 'chore'", async () => {
    mockToolUseResponse({
      complexity: 3,
      quality: 3,
      category: "something-made-up",
      summary: "x",
      caveats: [],
      standout: null,
    });
    const result = await analysePR(makePayload());
    expect(result.category).toBe("chore");
  });

  it("drops a standout value that isn't one of the known tags", async () => {
    mockToolUseResponse({
      complexity: 3,
      quality: 3,
      category: "feature",
      summary: "x",
      caveats: [],
      standout: "gold_star",
    });
    const result = await analysePR(makePayload());
    expect(result.standout).toBeNull();
  });

  it("retries then throws on persistent SDK failure", async () => {
    messagesCreate.mockRejectedValue(new Error("upstream timeout"));
    await expect(analysePR(makePayload())).rejects.toThrow(/upstream timeout/);
    // 3 attempts per the analyser's LLM_MAX_ATTEMPTS constant.
    expect(messagesCreate).toHaveBeenCalledTimes(3);
  });

  it("throws when the model omits the tool call", async () => {
    messagesCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I don't want to score this." }],
    });
    await expect(analysePR(makePayload())).rejects.toThrow(/submit_review/);
  });

  it("preserves prNotes and file-skip markers in the rendered prompt", async () => {
    mockToolUseResponse({
      complexity: 2,
      quality: 3,
      category: "chore",
      summary: "ok",
      caveats: [],
      standout: null,
    });
    await analysePR(
      makePayload({
        prNotes: ["Diff was truncated (5 files partially elided)"],
        files: [
          {
            filename: "package-lock.json",
            status: "modified",
            additions: 2000,
            deletions: 100,
            patch: null,
            truncated: false,
            skipped: true,
            skipReason: "npm lockfile",
          },
        ],
      }),
    );
    const sentMessage = messagesCreate.mock.calls[0][0].messages[0].content as string;
    expect(sentMessage).toContain("Diff was truncated");
    expect(sentMessage).toContain("package-lock.json (skipped");
  });
});
