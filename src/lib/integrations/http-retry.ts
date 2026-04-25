export type RateLimitDelaySource =
  | "retry-after"
  | "x-ratelimit-reset"
  | "backoff";

/**
 * Parse a `Retry-After` header into milliseconds.
 *
 * The header can be either delay-seconds or an HTTP date. Numeric zero and
 * negative values are treated as unusable to preserve the integrations'
 * previous retry behavior; past HTTP dates are valid and resolve to 0ms.
 */
export function parseRetryAfterMs(
  headerValue: string | null,
  nowMs: number = Date.now(),
): number | null {
  if (headerValue === null) {
    return null;
  }

  const value = headerValue.trim();
  if (value === "") {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * 1000 : null;
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return null;
  }

  return Math.max(0, dateMs - nowMs);
}

/**
 * Parse an `X-RateLimit-Reset` header (Unix epoch seconds) into a
 * millisecond delay from `nowMs`. Returns null if missing or non-numeric. The
 * result is clamped to `minimumDelayMs` so providers that require a small
 * cool-down after a stale reset timestamp can keep their previous behavior.
 */
export function parseRateLimitResetMs(
  headerValue: string | null,
  nowMs: number = Date.now(),
  options: { minimumDelayMs?: number } = {},
): number | null {
  const resetAtSeconds = headerValue != null ? Number(headerValue) : NaN;
  if (!Number.isFinite(resetAtSeconds) || resetAtSeconds <= 0) {
    return null;
  }

  return Math.max(options.minimumDelayMs ?? 0, resetAtSeconds * 1000 - nowMs);
}

/**
 * Exponential backoff with jitter: 500ms * 2^(attempt-1) + random(0-249)ms.
 */
export function exponentialBackoffMs(attempt: number): number {
  const baseMs = 500 * 2 ** (attempt - 1);
  return baseMs + Math.floor(Math.random() * 250);
}

/**
 * Determine the best wait time from HTTP rate-limit response headers.
 * Checks Retry-After, then X-RateLimit-Reset, then exponential backoff.
 */
export function resolveRateLimitDelay(input: {
  headers: Headers;
  attempt: number;
  nowMs?: number;
  minimumRateLimitResetDelayMs?: number;
  fallbackDelayMs?: (attempt: number) => number;
}): { waitMs: number; source: RateLimitDelaySource } {
  const retryAfterMs = parseRetryAfterMs(
    input.headers.get("retry-after"),
    input.nowMs,
  );
  if (retryAfterMs !== null) {
    return { waitMs: retryAfterMs, source: "retry-after" };
  }

  const resetMs = parseRateLimitResetMs(
    input.headers.get("x-ratelimit-reset"),
    input.nowMs,
    { minimumDelayMs: input.minimumRateLimitResetDelayMs },
  );
  if (resetMs !== null) {
    return { waitMs: resetMs, source: "x-ratelimit-reset" };
  }

  return {
    waitMs:
      input.fallbackDelayMs?.(input.attempt) ??
      exponentialBackoffMs(input.attempt),
    source: "backoff",
  };
}
