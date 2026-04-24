import { describe, expect, it, vi } from "vitest";

import {
  exponentialBackoffMs,
  parseRateLimitResetMs,
  parseRetryAfterMs,
  resolveRateLimitDelay,
} from "../http-retry";

const NOW_MS = Date.parse("2026-04-24T12:00:00.000Z");

describe("parseRetryAfterMs", () => {
  it("parses numeric delay-seconds into milliseconds", () => {
    expect(parseRetryAfterMs("2", NOW_MS)).toBe(2000);
    expect(parseRetryAfterMs("1.5", NOW_MS)).toBe(1500);
  });

  it("parses HTTP-date values into delay milliseconds", () => {
    expect(parseRetryAfterMs("Fri, 24 Apr 2026 12:00:02 GMT", NOW_MS)).toBe(
      2000,
    );
  });

  it("clamps past HTTP-date values to immediate retry", () => {
    expect(parseRetryAfterMs("Fri, 24 Apr 2026 11:59:59 GMT", NOW_MS)).toBe(0);
  });

  it("returns null for missing, blank, and invalid headers", () => {
    expect(parseRetryAfterMs(null, NOW_MS)).toBeNull();
    expect(parseRetryAfterMs("", NOW_MS)).toBeNull();
    expect(parseRetryAfterMs("not-a-date", NOW_MS)).toBeNull();
  });

  it("keeps non-positive numeric headers unusable", () => {
    expect(parseRetryAfterMs("0", NOW_MS)).toBeNull();
    expect(parseRetryAfterMs("-1", NOW_MS)).toBeNull();
  });
});

describe("parseRateLimitResetMs", () => {
  it("parses provider reset epoch seconds into delay milliseconds", () => {
    expect(parseRateLimitResetMs("1777032002", NOW_MS)).toBe(2000);
  });

  it("clamps past reset values to zero by default", () => {
    expect(parseRateLimitResetMs("1777031999", NOW_MS)).toBe(0);
  });

  it("supports a provider-specific minimum reset delay", () => {
    expect(
      parseRateLimitResetMs("1777031999", NOW_MS, { minimumDelayMs: 1000 }),
    ).toBe(1000);
  });

  it("returns null for missing, non-numeric, and non-positive reset headers", () => {
    expect(parseRateLimitResetMs(null, NOW_MS)).toBeNull();
    expect(parseRateLimitResetMs("not-a-number", NOW_MS)).toBeNull();
    expect(parseRateLimitResetMs("0", NOW_MS)).toBeNull();
  });
});

describe("resolveRateLimitDelay", () => {
  it("prefers Retry-After over provider reset headers", () => {
    const result = resolveRateLimitDelay({
      headers: new Headers({
        "retry-after": "3",
        "x-ratelimit-reset": "1777032010",
      }),
      attempt: 1,
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ waitMs: 3000, source: "retry-after" });
  });

  it("uses provider reset headers when Retry-After is absent", () => {
    const result = resolveRateLimitDelay({
      headers: new Headers({ "x-ratelimit-reset": "1777032004" }),
      attempt: 1,
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ waitMs: 4000, source: "x-ratelimit-reset" });
  });

  it("uses a backoff fallback when no usable headers are present", () => {
    const fallbackDelayMs = vi.fn().mockReturnValue(750);

    const result = resolveRateLimitDelay({
      headers: new Headers({ "retry-after": "bad" }),
      attempt: 2,
      nowMs: NOW_MS,
      fallbackDelayMs,
    });

    expect(result).toEqual({ waitMs: 750, source: "backoff" });
    expect(fallbackDelayMs).toHaveBeenCalledWith(2);
  });
});

describe("exponentialBackoffMs", () => {
  it("matches the shared 500ms exponential backoff with 0-249ms jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.996);

    expect(exponentialBackoffMs(3)).toBe(2249);

    vi.restoreAllMocks();
  });
});
