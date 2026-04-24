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

// Default: 10 manual sync triggers per user per 60s.
// Manual LLM-backed syncs are costly; this is generous for human operators
// but blocks accidental loops or scripted abuse.
export const MANUAL_SYNC_RATE_LIMIT_MAX = 10;
export const MANUAL_SYNC_RATE_LIMIT_WINDOW_MS = 60_000;

export const manualSyncRateLimiter = createSlidingWindowRateLimiter({
  maxRequests: MANUAL_SYNC_RATE_LIMIT_MAX,
  windowMs: MANUAL_SYNC_RATE_LIMIT_WINDOW_MS,
});

export function manualSyncRateLimitKey(
  source: ManualLlmSyncSource,
  userId: string
): string {
  return `${source}:${userId}`;
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
