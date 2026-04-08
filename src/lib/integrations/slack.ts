export const SLACK_API = "https://slack.com/api";
const SLACK_REQUEST_TIMEOUT_MS = 15_000;
const SLACK_DOWNLOAD_TIMEOUT_MS = 45_000;
const SLACK_MAX_RETRIES = 3;
const RETRYABLE_SLACK_ERRORS = new Set([
  "internal_error",
  "fatal_error",
  "request_timeout",
  "service_unavailable",
  "ratelimited",
]);

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN");
  return token;
}

function getRetryDelayMs(attempt: number): number {
  const baseMs = 500 * 2 ** (attempt - 1);
  return baseMs + Math.floor(Math.random() * 250);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("timed out"))
  );
}

function isRetryableSlackStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableSlackEnvelope(data: {
  ok?: boolean;
  error?: string;
}): boolean {
  return data.ok === false && !!data.error && RETRYABLE_SLACK_ERRORS.has(data.error);
}

function composeSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  timeoutMessage?: string
): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let didTimeout = false;
  const onAbort = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error(timeoutMessage ?? "Slack request timed out"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onAbort);
      }
    },
    timedOut: () => didTimeout,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackFetch(
  input: string,
  init: RequestInit,
  opts: {
    timeoutMs: number;
    maxRetries?: number;
    timeoutMessage: string;
  }
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= (opts.maxRetries ?? SLACK_MAX_RETRIES); attempt++) {
    const { signal, cleanup, timedOut } = composeSignal(
      opts.timeoutMs,
      init.signal ?? undefined,
      opts.timeoutMessage
    );

    try {
      const res = await fetch(input, {
        ...init,
        signal,
      });

      if (isRetryableSlackStatus(res.status) && attempt < (opts.maxRetries ?? SLACK_MAX_RETRIES)) {
        const retryAfterSeconds = Number(res.headers.get("retry-after"));
        const delayMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : getRetryDelayMs(attempt);
        lastError = new Error(`Slack API error ${res.status}`);
        await sleep(delayMs);
        continue;
      }

      return res;
    } catch (error) {
      if (signal.aborted && !timedOut()) {
        if (signal.reason instanceof Error) {
          throw signal.reason;
        }

        throw new Error("Slack request was aborted");
      }

      const retryable =
        (timedOut() && isAbortError(error)) ||
        (error instanceof Error &&
          /fetch failed|ECONNRESET|EAI_AGAIN|socket hang up/i.test(error.message));

      if (retryable && attempt < (opts.maxRetries ?? SLACK_MAX_RETRIES)) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw error;
    } finally {
      cleanup();
    }
  }

  throw lastError ?? new Error("Slack request failed");
}

export async function slackApiRequest<T>(
  method: string,
  params?: Record<string, string>,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
  } = {}
): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  let lastEnvelopeError: Error | null = null;
  const maxRetries = opts.maxRetries ?? SLACK_MAX_RETRIES;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      if (opts.signal.reason instanceof Error) {
        throw opts.signal.reason;
      }

      throw new Error(`Slack ${method} request was aborted`);
    }

    const res = await slackFetch(
      url.toString(),
      {
        headers: { Authorization: `Bearer ${getToken()}` },
        signal: opts.signal,
      },
      {
        timeoutMs: opts.timeoutMs ?? SLACK_REQUEST_TIMEOUT_MS,
        maxRetries,
        timeoutMessage: `Slack ${method} timed out after ${
          opts.timeoutMs ?? SLACK_REQUEST_TIMEOUT_MS
        }ms`,
      }
    );

    if (!res.ok) {
      throw new Error(`Slack API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) {
      const error = new Error(`Slack API error: ${data.error}`);
      if (isRetryableSlackEnvelope(data) && attempt < maxRetries) {
        lastEnvelopeError = error;
        await sleep(getRetryDelayMs(attempt));
        continue;
      }
      throw error;
    }

    return data;
  }

  throw lastEnvelopeError ?? new Error(`Slack ${method} request failed`);
}

export async function slackDownloadRequest(
  url: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
  } = {}
): Promise<Response> {
  return slackFetch(
    url,
    {
      headers: { Authorization: `Bearer ${getToken()}` },
      signal: opts.signal,
    },
    {
      timeoutMs: opts.timeoutMs ?? SLACK_DOWNLOAD_TIMEOUT_MS,
      maxRetries: opts.maxRetries ?? SLACK_MAX_RETRIES,
      timeoutMessage: `Slack file download timed out after ${
        opts.timeoutMs ?? SLACK_DOWNLOAD_TIMEOUT_MS
      }ms`,
    }
  );
}

export interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  type: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
}

interface ConversationsHistoryResponse {
  ok: boolean;
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
}

interface ConversationsInfoResponse {
  ok: boolean;
  channel: { name: string; id: string };
}

interface UsersInfoResponse {
  ok: boolean;
  user: { real_name: string; profile: { display_name: string } };
}

/**
 * Fetch full message history from a channel, paginating through all pages.
 * Returns messages in chronological order (oldest first).
 */
export async function getChannelHistory(
  channelId: string,
  oldest?: string,
  latest?: string,
  opts: { signal?: AbortSignal } = {}
): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      channel: channelId,
      limit: "100",
    };
    if (oldest) params.oldest = oldest;
    if (latest) params.latest = latest;
    if (cursor) params.cursor = cursor;

    const data = await slackApiRequest<ConversationsHistoryResponse>(
      "conversations.history",
      params,
      { signal: opts.signal }
    );

    allMessages.push(...data.messages);
    cursor = data.has_more
      ? data.response_metadata?.next_cursor
      : undefined;
  } while (cursor);

  // Slack returns newest first, reverse to chronological
  return allMessages.reverse();
}

/**
 * Fetch all replies in a thread, excluding the parent message.
 */
export async function getThreadReplies(
  channelId: string,
  threadTs: string,
  opts: { signal?: AbortSignal } = {}
): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      channel: channelId,
      ts: threadTs,
      limit: "100",
    };
    if (cursor) params.cursor = cursor;

    const data = await slackApiRequest<ConversationsHistoryResponse>(
      "conversations.replies",
      params,
      { signal: opts.signal }
    );

    allMessages.push(...data.messages);
    cursor = data.has_more
      ? data.response_metadata?.next_cursor
      : undefined;
  } while (cursor);

  // conversations.replies includes the parent as the first message — skip it
  return allMessages.slice(1);
}

/**
 * Get channel name by ID.
 */
export async function getChannelName(
  channelId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<string> {
  const data = await slackApiRequest<ConversationsInfoResponse>(
    "conversations.info",
    { channel: channelId },
    { signal: opts.signal }
  );
  return data.channel.name;
}

/**
 * Get user display name by ID.
 */
const userNameCache = new Map<string, string>();

export async function getUserName(
  userId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!;

  try {
    const data = await slackApiRequest<UsersInfoResponse>("users.info", {
      user: userId,
    }, { signal: opts.signal });
    const name =
      data.user.profile.display_name || data.user.real_name || userId;
    userNameCache.set(userId, name);
    return name;
  } catch (error) {
    if (opts.signal?.aborted) {
      if (opts.signal.reason instanceof Error) {
        throw opts.signal.reason;
      }

      throw error;
    }

    return userId;
  }
}
