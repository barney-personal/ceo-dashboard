import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
