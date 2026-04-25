import { describe, expect, it } from "vitest";

import {
  createSlidingWindowRateLimiter,
  manualSyncRateLimitKey,
} from "@/lib/sync/rate-limit";

describe("createSlidingWindowRateLimiter", () => {
  it("allows requests up to the configured window limit", () => {
    const limiter = createSlidingWindowRateLimiter({
      maxRequests: 2,
      windowMs: 1_000,
      now: () => 100,
    });

    expect(limiter.check("user:a")).toEqual({ ok: true, remaining: 1 });
    expect(limiter.check("user:a")).toEqual({ ok: true, remaining: 0 });
    expect(limiter.check("user:a")).toEqual({
      ok: false,
      retryAfterSeconds: 1,
    });
  });

  it("isolates counters per user but shares budget across sources", () => {
    const limiter = createSlidingWindowRateLimiter({
      maxRequests: 1,
      windowMs: 1_000,
      now: () => 100,
    });

    // user_a's first slack request consumes their per-user budget
    expect(limiter.check(manualSyncRateLimitKey("slack", "user_a")).ok).toBe(
      true
    );
    // user_a's second request — even on a different source — must hit the
    // SAME bucket. This is the codex-bot finding: keying on (source, userId)
    // would let user_a get 1 request per source, defeating the budget intent.
    expect(limiter.check(manualSyncRateLimitKey("slack", "user_a")).ok).toBe(
      false
    );
    expect(
      limiter.check(manualSyncRateLimitKey("management-accounts", "user_a")).ok
    ).toBe(false);
    expect(limiter.check(manualSyncRateLimitKey("github", "user_a")).ok).toBe(
      false
    );
    // Different user → fresh bucket.
    expect(limiter.check(manualSyncRateLimitKey("slack", "user_b")).ok).toBe(
      true
    );
  });

  it("expires hits after the sliding window elapses", () => {
    let now = 1_000;
    const limiter = createSlidingWindowRateLimiter({
      maxRequests: 2,
      windowMs: 1_000,
      now: () => now,
    });

    expect(limiter.check("user:a").ok).toBe(true);
    now = 1_500;
    expect(limiter.check("user:a").ok).toBe(true);
    now = 1_999;
    expect(limiter.check("user:a")).toEqual({
      ok: false,
      retryAfterSeconds: 1,
    });
    now = 2_000;
    expect(limiter.check("user:a")).toEqual({ ok: true, remaining: 0 });
  });

  it("supports resetting one key or all keys", () => {
    const limiter = createSlidingWindowRateLimiter({
      maxRequests: 1,
      windowMs: 1_000,
      now: () => 100,
    });

    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("b").ok).toBe(true);

    limiter.reset("a");
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("b").ok).toBe(false);

    limiter.reset();
    expect(limiter.check("b").ok).toBe(true);
  });

  it("validates limiter options", () => {
    expect(() =>
      createSlidingWindowRateLimiter({ maxRequests: 0, windowMs: 1_000 })
    ).toThrow("maxRequests must be a positive integer");
    expect(() =>
      createSlidingWindowRateLimiter({ maxRequests: 1.5, windowMs: 1_000 })
    ).toThrow("maxRequests must be a positive integer");
    expect(() =>
      createSlidingWindowRateLimiter({ maxRequests: 1, windowMs: 0 })
    ).toThrow("windowMs must be a positive integer");
    expect(() =>
      createSlidingWindowRateLimiter({ maxRequests: 1, windowMs: 1.5 })
    ).toThrow("windowMs must be a positive integer");
  });
});
