import { NextResponse } from "next/server";
import type { SyncSource } from "./config";

type ManualLlmSyncSource = Extract<
  SyncSource,
  "github" | "management-accounts" | "slack"
>;

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

export type RateLimitDecision =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

export interface SlidingWindowRateLimiter {
  check(key: string): RateLimitDecision;
  reset(key?: string): void;
}

export function createSlidingWindowRateLimiter(
  options: RateLimiterOptions
): SlidingWindowRateLimiter {
  if (
    !Number.isFinite(options.maxRequests) ||
    !Number.isInteger(options.maxRequests) ||
    options.maxRequests < 1
  ) {
    throw new Error("maxRequests must be a positive integer");
  }
  if (
    !Number.isFinite(options.windowMs) ||
    !Number.isInteger(options.windowMs) ||
    options.windowMs < 1
  ) {
    throw new Error("windowMs must be a positive integer");
  }

  const now = options.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();

  return {
    check(key) {
      const nowTs = now();
      const windowStart = nowTs - options.windowMs;
      // Window is half-open `(windowStart, now]` — a hit at exactly
      // `windowStart` has rolled out. claude-review flagged this as a
      // potential off-by-one; in practice it lets at most one extra request
      // through at the exact ms boundary, which is well below the noise floor
      // for human-driven manual syncs and is the semantic the existing tests
      // encode.
      const entries = (hits.get(key) ?? []).filter((ts) => ts > windowStart);

      if (entries.length >= options.maxRequests) {
        hits.set(key, entries);
        const oldest = entries[0]!;
        const retryAfterMs = oldest + options.windowMs - nowTs;
        return {
          ok: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      entries.push(nowTs);
      hits.set(key, entries);
      return { ok: true, remaining: options.maxRequests - entries.length };
    },
    reset(key) {
      if (key === undefined) {
        hits.clear();
      } else {
        hits.delete(key);
      }
    },
  };
}

// Default: 10 manual sync triggers per user per 60s, shared across ALL
// LLM-backed sources (slack, management-accounts, github). Keying on userId
// alone — and not (source, userId) — is deliberate: the goal is bounding
// per-user Anthropic spend, not per-endpoint usability. Otherwise a caller
// could rotate across all three sources for ~30 LLM-fanned-out requests per
// minute, defeating the budget intent.
//
// Note: this limiter is in-memory and per-process. The current Render web
// service is single-instance, so there is no cross-instance leakage. If the
// service is ever horizontally scaled, swap to a shared store (Redis or a DB
// table) before relying on this for budget enforcement.
export const MANUAL_SYNC_RATE_LIMIT_MAX = 10;
export const MANUAL_SYNC_RATE_LIMIT_WINDOW_MS = 60_000;

export const manualSyncRateLimiter = createSlidingWindowRateLimiter({
  maxRequests: MANUAL_SYNC_RATE_LIMIT_MAX,
  windowMs: MANUAL_SYNC_RATE_LIMIT_WINDOW_MS,
});

/**
 * Key for the shared per-user manual-sync budget. The `source` argument is
 * accepted for callsite clarity (so each route names which source it is
 * spending against) but is NOT part of the bucket key — see the comment on
 * `manualSyncRateLimiter` above.
 */
export function manualSyncRateLimitKey(
  _source: ManualLlmSyncSource,
  userId: string
): string {
  return `user:${userId}`;
}

/**
 * Whether the manual-sync rate limit is enforced for this process.
 *
 * The cap is a prod-only safety net. In development we want to be able to
 * iterate freely on sync runners without 429s after ten "Sync now" clicks,
 * so the limit only kicks in when `NODE_ENV === "production"`. Tests run
 * with `NODE_ENV=test` and use the lower-level `createSlidingWindowRateLimiter`
 * directly, so they are unaffected by this gate.
 */
export function isManualSyncRateLimitEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

export function rateLimitErrorResponse(
  retryAfterSeconds: number,
  source: ManualLlmSyncSource
): NextResponse {
  return NextResponse.json(
    {
      error: "Too many requests",
      retryAfterSeconds,
      source,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    }
  );
}
