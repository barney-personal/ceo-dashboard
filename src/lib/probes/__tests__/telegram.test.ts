// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { sendTelegram, type TelegramResult } from "../telegram";

const FAKE_TOKEN = "123456:ABC-DEF";
const FAKE_CHAT_ID = "99887766";

describe("sendTelegram", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubEnv("TELEGRAM_BOT_TOKEN", FAKE_TOKEN);
    vi.stubEnv("TELEGRAM_PROBE_CHAT_ID", FAKE_CHAT_ID);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("sends message and returns ok on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
    });

    const result = await sendTelegram("test alert message");

    expect(result).toEqual<TelegramResult>({
      ok: true,
      messageId: 42,
    });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe(
      `https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`
    );
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe(FAKE_CHAT_ID);
    expect(body.text).toBe("test alert message");
    expect(body.parse_mode).toBe("HTML");
  });

  it("returns skipped when TELEGRAM_BOT_TOKEN is missing", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");

    const result = await sendTelegram("should not send");

    expect(result).toEqual<TelegramResult>({
      ok: false,
      skipped: true,
      reason: "missing config",
    });
  });

  it("returns skipped when TELEGRAM_PROBE_CHAT_ID is missing", async () => {
    vi.stubEnv("TELEGRAM_PROBE_CHAT_ID", "");

    const result = await sendTelegram("should not send");

    expect(result).toEqual<TelegramResult>({
      ok: false,
      skipped: true,
      reason: "missing config",
    });
  });

  it("returns error result on fetch failure without throwing", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await sendTelegram("alert during outage");

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("error");
    if (!result.ok && "error" in result) {
      expect(result.error).toContain("network down");
    }
  });

  it("returns error result on non-ok HTTP response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({ ok: false, description: "Forbidden: bot blocked" }),
    });

    const result = await sendTelegram("alert to blocked bot");

    expect(result.ok).toBe(false);
    if (!result.ok && "error" in result) {
      expect(result.error).toContain("403");
    }
  });

  it("uses fallback token when provided and primary fails", async () => {
    const fallbackToken = "fallback:XYZ-999";

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes(FAKE_TOKEN)) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.resolve({ ok: false, description: "Bad Gateway" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ ok: true, result: { message_id: 99 } }),
      });
    });

    vi.stubEnv("TELEGRAM_FALLBACK_BOT_TOKEN", fallbackToken);

    const result = await sendTelegram("critical alert");

    expect(result).toEqual<TelegramResult>({
      ok: true,
      messageId: 99,
    });
    expect(callCount).toBe(2);
  });
});
