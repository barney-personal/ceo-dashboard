import * as Sentry from "@sentry/nextjs";

// Per-minute quota for each Slack method we actively call. Maps to the
// documented tiers but hard-coded to avoid a runtime lookup:
//   Tier 3 (50/min): conversations.history, conversations.replies, files.list
//   Tier 4 (100/min): users.info
const METHOD_RATE_PER_MINUTE: Record<string, number> = {
  "conversations.history": 50,
  "conversations.replies": 50,
  "files.list": 50,
  "users.info": 100,
};

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  capacity: number;
  refillMsPerToken: number;
  queue: Promise<void>;
}

const buckets = new Map<string, Bucket>();

function getBucket(method: string): Bucket | null {
  const perMinute = METHOD_RATE_PER_MINUTE[method];
  if (!perMinute) return null;
  let bucket = buckets.get(method);
  if (!bucket) {
    bucket = {
      tokens: perMinute,
      lastRefillMs: Date.now(),
      capacity: perMinute,
      refillMsPerToken: 60_000 / perMinute,
      queue: Promise.resolve(),
    };
    buckets.set(method, bucket);
  }
  return bucket;
}

function refill(bucket: Bucket, nowMs: number): void {
  const elapsed = nowMs - bucket.lastRefillMs;
  if (elapsed <= 0) return;
  bucket.tokens = Math.min(
    bucket.capacity,
    bucket.tokens + elapsed / bucket.refillMsPerToken,
  );
  bucket.lastRefillMs = nowMs;
}

/**
 * Block until a token is available for `method`. Methods without a configured
 * rate pass through immediately. If the bucket is empty, emit one breadcrumb
 * and sleep just long enough for one token to become available; existing
 * Retry-After / retry logic still handles any remaining server-side 429s.
 */
export async function acquireSlackRateLimitToken(method: string): Promise<void> {
  const bucket = getBucket(method);
  if (!bucket) return;

  const acquire = bucket.queue.then(async () => {
    refill(bucket, Date.now());

    if (bucket.tokens < 1) {
      const waitMs = Math.ceil((1 - bucket.tokens) * bucket.refillMsPerToken);
      Sentry.addBreadcrumb({
        category: "rate_limit.slack_local",
        message: `Local token bucket blocked Slack ${method}`,
        level: "info",
        data: { method, waitMs, tokensAvailable: bucket.tokens },
      });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      refill(bucket, Date.now());
    }

    bucket.tokens = Math.max(0, bucket.tokens - 1);
  });

  bucket.queue = acquire.catch(() => {});
  await acquire;
}

/** Test-only: reset all in-process buckets. */
export function _resetSlackRateLimitBuckets(): void {
  buckets.clear();
}
