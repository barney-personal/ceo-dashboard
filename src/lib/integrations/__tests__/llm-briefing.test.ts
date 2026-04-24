import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockMessages = vi.hoisted(() => ({ create: vi.fn() }));
const mockSentry = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = mockMessages;
  },
}));

vi.mock("@sentry/nextjs", () => mockSentry);

import { BRIEFING_MODEL, generateBriefing } from "../llm-briefing";

function makeContext() {
  return {
    person: {
      firstName: "Alice",
      fullName: "Alice Example",
      email: "alice@meetcleo.com",
      jobTitle: "Engineer",
      squad: "Chat",
      pillar: "Chat Pillar",
      function: "Engineering",
      tenureMonths: 12,
      role: "everyone" as const,
      directReportCount: 2,
    },
    company: {
      ltvPaidCacRatio: 3.2,
      mau: 123_456,
      headcount: 321,
      arrUsd: 12_300_000,
    },
    pillarOkrs: {
      total: 2,
      onTrack: 1,
      atRisk: 1,
      behind: 0,
      notStarted: 0,
      recent: [
        {
          squad: "Sibling Squad",
          objective: "Improve activation",
          kr: "KR1",
          status: "at_risk",
          actual: "12%",
          target: "20%",
          postedAtIso: "2026-04-23T08:00:00.000Z",
          isSameSquad: false,
        },
      ],
    },
    squadOkrs: {
      total: 1,
      onTrack: 0,
      atRisk: 1,
      behind: 0,
      notStarted: 0,
      recent: [
        {
          squad: "Chat",
          objective: "Improve activation",
          kr: "KR2",
          status: "at_risk",
          actual: "12%",
          target: "20%",
          postedAtIso: "2026-04-23T08:00:00.000Z",
          isSameSquad: true,
        },
      ],
    },
    squadShips: {
      windowDays: 14,
      squadName: "Chat",
      prCount: 12,
      authorCount: 4,
      top: [
        {
          repo: "cleo/app",
          title: "feat: referral flow v2",
          authorName: "Alice Example",
          mergedAtIso: "2026-04-22T12:00:00.000Z",
        },
      ],
    },
    managerFlags: {
      snapshotDate: "2026-04-22",
      totalReportsChecked: 3,
      flagged: [
        {
          name: "Direct Report",
          rank: 40,
          percentile: 8,
          confidenceHigh: 22,
          squad: "Chat",
          snapshotDate: "2026-04-22",
        },
      ],
    },
    meetings: {
      todayCount: 2,
      firstTitle: "Daily standup",
      firstStartTimeIso: "2026-04-23T10:00:00.000Z",
    },
    relevantDashboardSections: ["Overview", "Engineering", "OKRs"],
    generatedAtIso: "2026-04-23T09:00:00.000Z",
  };
}

function neverResolves(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new Error("Request was aborted."));
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockMessages.create.mockReset();
  mockSentry.addBreadcrumb.mockReset();
  mockSentry.captureException.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generateBriefing", () => {
  it("sends an adaptive-thinking request and returns the first text block", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        { type: "thinking", thinking: "Let me think" },
        { type: "text", text: "  Hello Alice. **MAU** is up.  " },
      ],
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        cache_read_input_tokens: 33,
        cache_creation_input_tokens: 44,
      },
    });

    const result = await generateBriefing(makeContext());

    expect(result).toEqual({
      text: "Hello Alice. **MAU** is up.",
      model: BRIEFING_MODEL,
      usage: {
        inputTokens: 11,
        outputTokens: 22,
        cacheReadTokens: 33,
        cacheCreationTokens: 44,
      },
    });

    expect(mockMessages.create).toHaveBeenCalledTimes(1);
    const [request, options] = mockMessages.create.mock.calls[0];
    expect(request).toMatchObject({
      model: "claude-opus-4-7",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: [
        expect.objectContaining({
          cache_control: { type: "ephemeral" },
        }),
      ],
    });
    expect(request.messages[0].content).toContain('"firstName": "Alice"');
    expect(request.messages[0].content).toContain('"isManager": true');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries once after a 429 and succeeds on the second attempt", async () => {
    const retryableError = Object.assign(new Error("rate limited"), {
      status: 429,
      type: "rate_limit_error",
    });

    mockMessages.create
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Recovered briefing" }],
        usage: {},
      });

    const promise = generateBriefing(makeContext());

    await Promise.resolve();
    expect(mockMessages.create).toHaveBeenCalledTimes(1);
    expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "llm-briefing",
        message: "Retrying briefing LLM call after retryable failure",
        data: expect.objectContaining({
          attempt: 1,
          nextAttempt: 2,
          backoffMs: 1_000,
        }),
      }),
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(mockMessages.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual(
      expect.objectContaining({ text: "Recovered briefing" }),
    );
    expect(mockMessages.create).toHaveBeenCalledTimes(2);
  });

  it("times out a non-cooperative SDK call after 45 seconds", async () => {
    mockMessages.create.mockImplementation(
      (_params: unknown, opts: { signal?: AbortSignal }) => {
        if (!opts?.signal) return new Promise(() => {});
        return neverResolves(opts.signal);
      },
    );

    const promise = generateBriefing(makeContext());
    const rejection = expect(promise).rejects.toThrow(/timed out after 45s/);

    await vi.advanceTimersByTimeAsync(45_001);

    await rejection;
    expect(mockSentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/timed out after 45s/),
      }),
      expect.objectContaining({
        tags: { integration: "llm-briefing" },
      }),
    );
  });

  it("throws when the model returns no text blocks", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: "thinking", thinking: "Only thinking" }],
      usage: {},
    });

    await expect(generateBriefing(makeContext())).rejects.toThrow(
      /returned no text content/,
    );
    expect(mockSentry.captureException).toHaveBeenCalled();
  });
});
