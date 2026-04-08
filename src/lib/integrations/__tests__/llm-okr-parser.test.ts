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

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = mockMessages;
    },
  };
});

import { llmParseOkrUpdate } from "../llm-okr-parser";

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
});
