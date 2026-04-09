import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCaptureException, mockCaptureMessage } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
}));

import { downloadSlackFile } from "../slack-files";
import { getChannelName } from "../slack";

describe("Slack transport resilience", () => {
  const originalToken = process.env.SLACK_BOT_TOKEN;

  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.SLACK_BOT_TOKEN = originalToken;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockCaptureException.mockClear();
    mockCaptureMessage.mockClear();
  });

  it("retries Slack API calls after rate limiting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "1" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channel: { id: "C123", name: "finance" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const promise = getChannelName("C123");
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toBe("finance");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries Slack file downloads on transient server errors", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("temporarily unavailable", {
          status: 503,
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const promise = downloadSlackFile("https://files.slack.test/example");
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails immediately on Slack HTTP auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("invalid token", {
        status: 401,
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getChannelName("C123")).rejects.toThrow(
      "Slack API authentication failed, check SLACK_BOT_TOKEN"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Slack API authentication failed, check SLACK_BOT_TOKEN",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "slack",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          status: 401,
          source: "http",
        }),
      })
    );
  });

  it("fails immediately on Slack download auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("forbidden", {
        status: 403,
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadSlackFile("https://files.slack.test/example")
    ).rejects.toThrow("Slack API authentication failed, check SLACK_BOT_TOKEN");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Slack API authentication failed, check SLACK_BOT_TOKEN",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "slack",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          status: 403,
          source: "http",
        }),
      })
    );
  });

  it("fails immediately on Slack envelope auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: "invalid_auth",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getChannelName("C123")).rejects.toThrow(
      "Slack API authentication failed, check SLACK_BOT_TOKEN"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Slack API authentication failed, check SLACK_BOT_TOKEN",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "slack",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          method: "conversations.info",
          code: "invalid_auth",
          source: "envelope",
        }),
      })
    );
  });

  it("getChannelName does not capture to Sentry on HTTP 404 (invalid channel config)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("channel not found", { status: 404 })
    );

    vi.stubGlobal("fetch", fetchMock);

    const error = await getChannelName("CBAD").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Invalid channel config must not produce an exception-level Sentry event —
    // validateSlackChannels() emits the warning-level signal instead.
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("getChannelName does not capture to Sentry on channel_not_found envelope (invalid channel config)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: "channel_not_found" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const error = await getChannelName("CBAD").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/channel_not_found/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Invalid channel config must not produce an exception-level Sentry event —
    // validateSlackChannels() emits the warning-level signal instead.
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
