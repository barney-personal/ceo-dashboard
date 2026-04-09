const GRANOLA_API = "https://public-api.granola.ai/v1";
const GRANOLA_REQUEST_TIMEOUT_MS = 30_000;
const GRANOLA_MAX_RETRIES = 3;

function getRetryDelayMs(attempt: number): number {
  const baseMs = 500 * 2 ** (attempt - 1);
  return baseMs + Math.floor(Math.random() * 250);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function granolaRequest<T>(
  path: string,
  opts: {
    token: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
    params?: Record<string, string>;
  }
): Promise<T> {
  const url = new URL(`${GRANOLA_API}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  const maxRetries = opts.maxRetries ?? GRANOLA_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? GRANOLA_REQUEST_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason instanceof Error
        ? opts.signal.reason
        : new Error("Granola request was aborted");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`Granola request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    const onParentAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      if (isRetryableStatus(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : getRetryDelayMs(attempt);
        lastError = new Error(`Granola API error ${res.status}`);
        await sleep(delayMs);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Granola API error ${res.status}: ${await res.text()}`);
      }

      return (await res.json()) as T;
    } catch (error) {
      if (controller.signal.aborted && opts.signal?.aborted) {
        throw opts.signal.reason instanceof Error
          ? opts.signal.reason
          : new Error("Granola request was aborted");
      }

      const retryable =
        error instanceof Error &&
        /timed out|fetch failed|ECONNRESET|EAI_AGAIN|socket hang up/i.test(error.message);

      if (retryable && attempt < maxRetries) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      opts.signal?.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastError ?? new Error("Granola request failed");
}

// ---------------------------------------------------------------------------
// Types — matches Granola public API (https://docs.granola.ai)
// ---------------------------------------------------------------------------

export interface GranolaAttendee {
  name?: string;
  email: string;
}

export interface GranolaCalendarEvent {
  event_title?: string;
  organiser?: string;
  invitees?: { email: string }[];
  calendar_event_id?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
}

export interface GranolaTranscriptEntry {
  speaker_source: string;
  text: string;
}

export interface GranolaNote {
  id: string;
  title: string;
  owner?: { name: string; email: string };
  summary_text?: string;
  summary_markdown?: string;
  attendees?: GranolaAttendee[];
  calendar_event?: GranolaCalendarEvent;
  created_at: string;
  updated_at?: string;
  transcript?: GranolaTranscriptEntry[];
}

export interface GranolaNoteListResponse {
  notes: GranolaNote[];
  hasMore: boolean;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Public API — all require a token parameter
// ---------------------------------------------------------------------------

export async function listNotes(
  opts: {
    token: string;
    createdAfter?: string;
    cursor?: string;
    signal?: AbortSignal;
  }
): Promise<GranolaNoteListResponse> {
  const params: Record<string, string> = {};
  if (opts.createdAfter) params.created_after = opts.createdAfter;
  if (opts.cursor) params.cursor = opts.cursor;

  return granolaRequest<GranolaNoteListResponse>("/notes", {
    token: opts.token,
    params,
    signal: opts.signal,
  });
}

export async function getNote(
  noteId: string,
  opts: { token: string; includeTranscript?: boolean; signal?: AbortSignal }
): Promise<GranolaNote> {
  const params: Record<string, string> = {};
  if (opts.includeTranscript) params.include = "transcript";

  return granolaRequest<GranolaNote>(`/notes/${noteId}`, {
    token: opts.token,
    params,
    signal: opts.signal,
  });
}

export async function getAllNotesSince(
  createdAfter: string,
  opts: { token: string; signal?: AbortSignal }
): Promise<GranolaNote[]> {
  const all: GranolaNote[] = [];
  let cursor: string | undefined;

  do {
    const page = await listNotes({
      token: opts.token,
      createdAfter,
      cursor,
      signal: opts.signal,
    });
    all.push(...page.notes);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return all;
}
