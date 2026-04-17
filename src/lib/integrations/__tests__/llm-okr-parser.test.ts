/**
 * Regression tests for LLM OKR parser timeout behaviour.
 *
 * The key invariant: a stuck Anthropic API call cannot keep the sync worker
 * alive indefinitely.  `llmParseOkrUpdate` must abort within LLM_CALL_TIMEOUT_MS
 * even if the SDK never resolves — this is the non-cooperative-await bound
 * required by M3 of the resilience audit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK before the module under test is imported.
// vi.hoisted ensures the mock container exists before vi.mock factories run
// and before module-level `new Anthropic()` instantiates the class.
// ---------------------------------------------------------------------------
const mockMessages = vi.hoisted(() => ({ create: vi.fn() }));
const mockSentry = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = mockMessages;
    },
  };
});

vi.mock("@sentry/nextjs", () => mockSentry);

import { llmParseOkrUpdate, llmParseOkrUpdates } from "../llm-okr-parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a promise that never resolves unless `signal` fires an abort event. */
function neverResolves(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      // The Anthropic SDK throws APIUserAbortError on abort; we replicate that
      // shape here so the handler in llmParseOkrUpdate sees `signal.aborted`.
      reject(new Error("Request was aborted."));
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("llmParseOkrUpdate timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMessages.create.mockReset();
    mockSentry.addBreadcrumb.mockReset();
    mockSentry.captureMessage.mockReset();
    mockSentry.captureException.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts a non-cooperative LLM call after 90 s and throws a descriptive error", async () => {
    // Simulate the SDK never returning — only resolves when the AbortSignal fires.
    mockMessages.create.mockImplementation(
      (_params: unknown, opts: { signal?: AbortSignal }) => {
        if (!opts?.signal) {
          // If no signal is passed the call hangs forever — this path should
          // never be reached once the fix is in place.
          return new Promise(() => {});
        }
        return neverResolves(opts.signal);
      }
    );

    const parsePromise = llmParseOkrUpdate(
      "some message",
      "#okr-channel (Growth pillar)",
      "fake system prompt"
    );

    // Advance timers to just before the timeout — should still be pending.
    await vi.advanceTimersByTimeAsync(89_999);
    // Verify it hasn't resolved or rejected yet.
    let settled = false;
    parsePromise.then(() => { settled = true; }).catch(() => { settled = true; });
    await Promise.resolve(); // flush microtasks
    expect(settled).toBe(false);

    // Advance past the 90 s timeout — AbortController fires.
    await vi.advanceTimersByTimeAsync(2);

    await expect(parsePromise).rejects.toThrow(
      /LLM OKR parse timed out after 90s/
    );
  });

  it("honors an external sync-budget abort before the local timeout elapses", async () => {
    mockMessages.create.mockImplementation(
      (_params: unknown, opts: { signal?: AbortSignal }) => {
        if (!opts?.signal) {
          return new Promise(() => {});
        }
        return neverResolves(opts.signal);
      }
    );

    const controller = new AbortController();
    const parsePromise = llmParseOkrUpdate(
      "some message",
      "#okr-channel (Growth pillar)",
      "fake system prompt",
      { signal: controller.signal }
    );

    controller.abort(new Error("Slack sync exceeded its execution budget"));

    await expect(parsePromise).rejects.toThrow(
      /Slack sync exceeded its execution budget/
    );
  });

  it("retries once after a 429 response and succeeds on the next attempt", async () => {
    const retryableError = Object.assign(new Error("rate limited"), {
      status: 429,
      type: "rate_limit_error",
    });

    mockMessages.create
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "null" }],
      });

    const parsePromise = llmParseOkrUpdate(
      "short message",
      "#channel",
      "system prompt"
    );

    await Promise.resolve();
    expect(mockMessages.create).toHaveBeenCalledTimes(1);
    expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "llm-okr-parser",
        message: "Retrying Claude OKR parse after retryable failure",
        data: expect.objectContaining({
          attempt: 1,
          nextAttempt: 2,
          backoffMs: 1_000,
          reason: "status_429",
        }),
      })
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(mockMessages.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(parsePromise).resolves.toBeNull();
    expect(mockMessages.create).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable failures", async () => {
    const nonRetryableError = Object.assign(new Error("upstream failed"), {
      status: 500,
      type: "api_error",
    });
    mockMessages.create.mockRejectedValueOnce(nonRetryableError);

    await expect(
      llmParseOkrUpdate("short message", "#channel", "system prompt")
    ).rejects.toBe(nonRetryableError);

    expect(mockMessages.create).toHaveBeenCalledTimes(1);
    expect(mockSentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(mockSentry.captureException).toHaveBeenCalledWith(
      nonRetryableError,
      expect.objectContaining({
        tags: { integration: "llm-okr-parser" },
        extra: { operation: "messages.create" },
      })
    );
  });

  it("stops retry backoff immediately when the sync signal aborts", async () => {
    const retryableError = Object.assign(new Error("overloaded"), {
      status: 529,
      error: { type: "overloaded_error" },
    });
    mockMessages.create.mockRejectedValueOnce(retryableError);

    const controller = new AbortController();
    const parsePromise = llmParseOkrUpdate(
      "short message",
      "#channel",
      "system prompt",
      { signal: controller.signal }
    );

    await Promise.resolve();
    expect(mockMessages.create).toHaveBeenCalledTimes(1);

    controller.abort(new Error("Slack sync exceeded its execution budget"));

    await expect(parsePromise).rejects.toThrow(
      /Slack sync exceeded its execution budget/
    );
    expect(mockMessages.create).toHaveBeenCalledTimes(1);
  });

  it("clears the abort timer when the LLM call succeeds normally", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "null" }],
    });

    const result = await llmParseOkrUpdate(
      "short message",
      "#channel",
      "system prompt"
    );

    // null is a valid response (not an OKR update)
    expect(result).toBeNull();

    // Advance well past the timeout — no unhandled rejection should fire.
    await vi.advanceTimersByTimeAsync(120_000);
  });

  it("parses a batch response into index-aligned OKR results", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              squadName: "Growth",
              tldr: "first summary",
              krs: [{ objective: "Objective 1", name: "KR1", rag: "green", metric: "100%" }],
            },
            null,
            {
              squadName: "Product",
              tldr: "third summary",
              krs: [{ objective: "Objective 3", name: "KR3", rag: "amber", metric: null }],
            },
          ]),
        },
      ],
    });

    await expect(
      llmParseOkrUpdates(
        [
          { messageText: "message-1", channelContext: "#growth\nAuthor: Alice" },
          { messageText: "message-2", channelContext: "#growth\nAuthor: Bob" },
          { messageText: "message-3", channelContext: "#product\nAuthor: Carol" },
        ],
        "system prompt"
      )
    ).resolves.toEqual([
      {
        squadName: "Growth",
        tldr: "first summary",
        krs: [{ objective: "Objective 1", name: "KR1", rag: "green", metric: "100%" }],
      },
      null,
      {
        squadName: "Product",
        tldr: "third summary",
        krs: [{ objective: "Objective 3", name: "KR3", rag: "amber", metric: null }],
      },
    ]);

    expect(mockMessages.create).toHaveBeenCalledTimes(1);
    expect(mockMessages.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining("Message 2"),
          }),
        ],
      })
    );
  });

  it("drops only the invalid element from an otherwise valid batch response", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              squadName: "Growth",
              tldr: "valid summary",
              krs: [{ objective: "Objective 1", name: "KR1", rag: "green", metric: "100%" }],
            },
            { squadName: "   ", tldr: "bad summary", krs: [] },
            {
              squadName: "Product",
              tldr: "mixed summary",
              krs: [
                { objective: "Objective 3", name: "KR3", rag: "red", metric: "20%" },
                { objective: "", name: "KR4", rag: "amber", metric: "10%" },
              ],
            },
          ]),
        },
      ],
    });

    await expect(
      llmParseOkrUpdates(
        [
          { messageText: "message-1", channelContext: "#growth\nAuthor: Alice" },
          { messageText: "message-2", channelContext: "#growth\nAuthor: Bob" },
          { messageText: "message-3", channelContext: "#product\nAuthor: Carol" },
        ],
        "system prompt"
      )
    ).resolves.toEqual([
      {
        squadName: "Growth",
        tldr: "valid summary",
        krs: [{ objective: "Objective 1", name: "KR1", rag: "green", metric: "100%" }],
      },
      null,
      {
        squadName: "Product",
        tldr: "mixed summary",
        krs: [{ objective: "Objective 3", name: "KR3", rag: "red", metric: "20%" }],
      },
    ]);

    expect(mockMessages.create).toHaveBeenCalledTimes(1);
    expect(mockSentry.captureMessage).toHaveBeenCalledWith(
      "Dropped invalid OKR key result from Claude response",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          invalidFields: ["objective"],
        }),
      })
    );
  });

  it("falls back to single-message parsing when the batch payload is unusable", async () => {
    mockMessages.create
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({ not: "an array" }) }],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              squadName: "Growth",
              tldr: "first summary",
              krs: [{ objective: "Objective 1", name: "KR1", rag: "green", metric: "100%" }],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "null" }],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              squadName: "Product",
              tldr: "third summary",
              krs: [{ objective: "Objective 3", name: "KR3", rag: "amber", metric: null }],
            }),
          },
        ],
      });

    await expect(
      llmParseOkrUpdates(
        [
          { messageText: "message-1", channelContext: "#growth\nAuthor: Alice" },
          { messageText: "message-2", channelContext: "#growth\nAuthor: Bob" },
          { messageText: "message-3", channelContext: "#product\nAuthor: Carol" },
        ],
        "system prompt"
      )
    ).resolves.toEqual([
      {
        squadName: "Growth",
        tldr: "first summary",
        krs: [{ objective: "Objective 1", name: "KR1", rag: "green", metric: "100%" }],
      },
      null,
      {
        squadName: "Product",
        tldr: "third summary",
        krs: [{ objective: "Objective 3", name: "KR3", rag: "amber", metric: null }],
      },
    ]);

    expect(mockMessages.create).toHaveBeenCalledTimes(4);
    expect(mockSentry.captureMessage).toHaveBeenCalledWith(
      "Falling back to single-message OKR parsing after unusable batch payload",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          operation: "parseBatchResponse",
          reason: "wrong_top_level_shape",
          batchSize: 3,
        }),
      })
    );
  });

  it("returns null when the parsed envelope is missing a non-empty squad name", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({ squadName: "   ", tldr: "summary", krs: [] }),
        },
      ],
    });

    await expect(
      llmParseOkrUpdate("message", "#channel", "system prompt")
    ).resolves.toBeNull();
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();
  });

  it("distinguishes malformed non-null envelopes from true nulls via the callback and Sentry", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({ squadName: "Growth", krs: "not-an-array" }),
        },
      ],
    });

    const onEnvelopeValidationFailure = vi.fn();

    await expect(
      llmParseOkrUpdate("message", "#channel", "system prompt", {
        onEnvelopeValidationFailure,
      })
    ).resolves.toBeNull();

    expect(onEnvelopeValidationFailure).toHaveBeenCalledTimes(1);
    expect(onEnvelopeValidationFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        boundary: "okr_parse_envelope",
        issuePaths: expect.arrayContaining(["krs"]),
      })
    );
    expect(mockSentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ExternalValidationError",
        boundary: "okr_parse_envelope",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "llm-okr-parser",
          validation_boundary: "okr_parse_envelope",
          validation_source: "anthropic",
        }),
      })
    );
  });

  it("does not fire onEnvelopeValidationFailure when Claude returns a literal JSON null", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "null" }],
    });

    const onEnvelopeValidationFailure = vi.fn();

    await expect(
      llmParseOkrUpdate("message", "#channel", "system prompt", {
        onEnvelopeValidationFailure,
      })
    ).resolves.toBeNull();

    expect(onEnvelopeValidationFailure).not.toHaveBeenCalled();
    expect(mockSentry.captureException).not.toHaveBeenCalled();
  });

  it("drops invalid KRs, warns with failing fields, and preserves valid rows", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            squadName: "Growth",
            tldr: "summary",
            krs: [
              {
                objective: "Objective 1",
                name: "KR1",
                rag: "green",
                metric: "100%",
              },
              {
                objective: "",
                name: "KR2",
                rag: "amber",
                metric: "80%",
              },
              {
                objective: "Objective 3",
                name: "KR3",
                rag: "blue",
                metric: 42,
              },
            ],
          }),
        },
      ],
    });

    await expect(
      llmParseOkrUpdate("message", "#channel", "system prompt")
    ).resolves.toEqual({
      squadName: "Growth",
      tldr: "summary",
      krs: [
        {
          objective: "Objective 1",
          name: "KR1",
          rag: "green",
          metric: "100%",
        },
      ],
    });

    expect(mockSentry.captureMessage).toHaveBeenCalledTimes(2);
    expect(mockSentry.captureMessage).toHaveBeenNthCalledWith(
      1,
      "Dropped invalid OKR key result from Claude response",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          invalidFields: ["objective"],
          rawPayloadPreview: expect.any(String),
        }),
      })
    );
    expect(mockSentry.captureMessage).toHaveBeenNthCalledWith(
      2,
      "Dropped invalid OKR key result from Claude response",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          invalidFields: ["rag", "metric"],
          rawPayloadPreview: expect.any(String),
        }),
      })
    );
  });

  it("returns an empty KR list when the envelope is valid but every KR fails validation", async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            squadName: "Growth",
            tldr: "summary",
            krs: [{ objective: "", name: "", rag: "green", metric: null }],
          }),
        },
      ],
    });

    await expect(
      llmParseOkrUpdate("message", "#channel", "system prompt")
    ).resolves.toEqual({
      squadName: "Growth",
      tldr: "summary",
      krs: [],
    });
    expect(mockSentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});
