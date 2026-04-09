import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAddBreadcrumb, mockCaptureException, mockCaptureMessage } =
  vi.hoisted(() => ({
    mockAddBreadcrumb: vi.fn(),
    mockCaptureException: vi.fn(),
    mockCaptureMessage: vi.fn(),
  }));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: mockAddBreadcrumb,
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
}));

import { downloadSlackFile } from "../slack-files";
import { checkSlackHealth, getChannelName } from "../slack";

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
    mockAddBreadcrumb.mockClear();
    mockCaptureException.mockClear();
    mockCaptureMessage.mockClear();
  });

  it("retries Slack API calls using Retry-After exactly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
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
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const promise = getChannelName("C123");

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "rate_limit.slack",
        data: expect.objectContaining({
          waitMs: 1_000,
          method: "conversations.info",
          attempt: 1,
          source: "retry-after",
          input: expect.stringContaining("/conversations.info?channel=C123"),
        }),
      }),
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toBe("finance");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to x-ratelimit-reset when Retry-After is absent", async () => {
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));

    const resetAtSeconds = Math.floor(Date.now() / 1000) + 2;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "x-ratelimit-reset": String(resetAtSeconds) },
        }),
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
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const promise = getChannelName("C123");

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "rate_limit.slack",
        data: expect.objectContaining({
          waitMs: 2_000,
          method: "conversations.info",
          attempt: 1,
          source: "x-ratelimit-reset",
          input: expect.stringContaining("/conversations.info?channel=C123"),
        }),
      }),
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
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
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
        }),
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
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getChannelName("C123")).rejects.toThrow(
      "Slack API returned 401 — check SLACK_BOT_TOKEN in Doppler",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Slack API returned 401 — check SLACK_BOT_TOKEN in Doppler",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "slack",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          input: expect.stringContaining("/conversations.info?channel=C123"),
          method: "conversations.info",
          status: 401,
          source: "http",
          responseBody: "invalid token",
        }),
      }),
    );
  });

  it("fails immediately on Slack download auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("forbidden", {
        status: 403,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadSlackFile("https://files.slack.test/example"),
    ).rejects.toThrow(
      "Slack API returned 401 — check SLACK_BOT_TOKEN in Doppler",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Slack API returned 401 — check SLACK_BOT_TOKEN in Doppler",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "slack",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          input: "https://files.slack.test/example",
          status: 403,
          source: "http",
          responseBody: "forbidden",
        }),
      }),
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
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getChannelName("C123")).rejects.toThrow(
      "Slack API returned 401 — check SLACK_BOT_TOKEN in Doppler",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Slack API returned 401 — check SLACK_BOT_TOKEN in Doppler",
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
      }),
    );
  });

  it("getChannelName does not capture to Sentry on HTTP 404 (invalid channel config)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("channel not found", { status: 404 }),
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
      new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
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

  it("fails Slack health checks on timeout without retrying", async () => {
    const fetchMock = vi.fn((_input, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const promise = checkSlackHealth();
    const rejection = expect(promise).rejects.toThrow(
      "Slack auth.test timed out after 5000ms",
    );

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
