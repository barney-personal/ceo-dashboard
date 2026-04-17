import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAddBreadcrumb } = vi.hoisted(() => ({
  mockAddBreadcrumb: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: mockAddBreadcrumb,
}));

import {
  _resetSlackRateLimitBuckets,
  acquireSlackRateLimitToken,
} from "../slack-rate-limit";

describe("acquireSlackRateLimitToken", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T00:00:00.000Z"));
    _resetSlackRateLimitBuckets();
    mockAddBreadcrumb.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through immediately for untracked methods", async () => {
    await acquireSlackRateLimitToken("auth.test");
    await acquireSlackRateLimitToken("conversations.info");
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it("serves up to the Tier 3 capacity without waiting", async () => {
    for (let i = 0; i < 50; i++) {
      await acquireSlackRateLimitToken("conversations.history");
    }
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it("blocks and emits a breadcrumb when the bucket is empty", async () => {
    for (let i = 0; i < 50; i++) {
      await acquireSlackRateLimitToken("conversations.history");
    }

    const pending = acquireSlackRateLimitToken("conversations.history");
    let settled = false;
    pending.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "rate_limit.slack_local",
        data: expect.objectContaining({
          method: "conversations.history",
          waitMs: 60_000 / 50,
        }),
      }),
    );

    await vi.advanceTimersByTimeAsync(60_000 / 50);
    await pending;
    expect(settled).toBe(true);
  });

  it("caps sustained conversations.history throughput at 50/min", async () => {
    const completedAt: number[] = [];
    const start = Date.now();
    const N = 200;

    const all = Promise.all(
      Array.from({ length: N }, async () => {
        await acquireSlackRateLimitToken("conversations.history");
        completedAt.push(Date.now() - start);
      }),
    );

    // Advance 4 minutes — enough to complete 200 tokens at 50/min
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await all;

    expect(completedAt).toHaveLength(N);
    // First 50 are immediate; remaining 150 should be spaced at 1200ms each.
    const lastCompletion = completedAt[completedAt.length - 1];
    // 150 tokens * 1200ms = 180_000ms — within a small tolerance
    expect(lastCompletion).toBeGreaterThanOrEqual(150 * 1200 - 5);
    expect(lastCompletion).toBeLessThanOrEqual(150 * 1200 + 5);
  });

  it("applies the Tier 4 100/min limit to users.info independently", async () => {
    for (let i = 0; i < 100; i++) {
      await acquireSlackRateLimitToken("users.info");
    }
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();

    const pending = acquireSlackRateLimitToken("users.info");
    let settled = false;
    pending.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "rate_limit.slack_local",
        data: expect.objectContaining({
          method: "users.info",
          waitMs: 60_000 / 100,
        }),
      }),
    );

    await vi.advanceTimersByTimeAsync(60_000 / 100);
    await pending;
    expect(settled).toBe(true);
  });

  it("keeps per-method buckets isolated", async () => {
    for (let i = 0; i < 50; i++) {
      await acquireSlackRateLimitToken("conversations.history");
    }
    // files.list shares the Tier 3 quota in Slack but has its own local bucket.
    await acquireSlackRateLimitToken("files.list");
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });
});
