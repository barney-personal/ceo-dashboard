const GCAL_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GCAL_REQUEST_TIMEOUT_MS = 30_000;
const GCAL_MAX_RETRIES = 3;
const TOKEN_EXPIRY_BUFFER_MS = 30_000;

// ---------------------------------------------------------------------------
// OAuth token management
// ---------------------------------------------------------------------------

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google OAuth config: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN are required"
    );
  }
  return { clientId, clientSecret, refreshToken };
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    return cachedAccessToken;
  }

  const { clientId, clientSecret, refreshToken } = getOAuthConfig();

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedAccessToken;
}

function getCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID ?? "primary";
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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

async function gcalRequest<T>(
  path: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
    params?: Record<string, string>;
  } = {}
): Promise<T> {
  const url = new URL(`${GCAL_API}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  const maxRetries = opts.maxRetries ?? GCAL_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? GCAL_REQUEST_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason instanceof Error
        ? opts.signal.reason
        : new Error("Google Calendar request was aborted");
    }

    const accessToken = await getAccessToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`Google Calendar request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    const onParentAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      // If token expired mid-request, clear cache and retry
      if (res.status === 401 && attempt < maxRetries) {
        cachedAccessToken = null;
        tokenExpiresAt = 0;
        lastError = new Error("Google Calendar token expired, refreshing");
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      if (isRetryableStatus(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : getRetryDelayMs(attempt);
        lastError = new Error(`Google Calendar API error ${res.status}`);
        await sleep(delayMs);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Google Calendar API error ${res.status}: ${await res.text()}`);
      }

      return (await res.json()) as T;
    } catch (error) {
      if (controller.signal.aborted && opts.signal?.aborted) {
        throw opts.signal.reason instanceof Error
          ? opts.signal.reason
          : new Error("Google Calendar request was aborted");
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

  throw lastError ?? new Error("Google Calendar request failed");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  organizer?: boolean;
  self?: boolean;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  organizer?: { email: string; displayName?: string };
  attendees?: CalendarAttendee[];
  recurringEventId?: string;
  htmlLink?: string;
  status?: "confirmed" | "tentative" | "cancelled";
}

interface CalendarEventListResponse {
  items: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List events from a calendar within a time range.
 */
export async function listEvents(
  opts: {
    timeMin?: string; // ISO datetime
    timeMax?: string; // ISO datetime
    calendarId?: string;
    pageToken?: string;
    maxResults?: number;
    singleEvents?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<CalendarEventListResponse> {
  const calendarId = opts.calendarId ?? getCalendarId();
  const params: Record<string, string> = {
    singleEvents: String(opts.singleEvents ?? true),
    orderBy: "startTime",
  };
  if (opts.timeMin) params.timeMin = opts.timeMin;
  if (opts.timeMax) params.timeMax = opts.timeMax;
  if (opts.pageToken) params.pageToken = opts.pageToken;
  if (opts.maxResults) params.maxResults = String(opts.maxResults);

  return gcalRequest<CalendarEventListResponse>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { params, signal: opts.signal }
  );
}

/**
 * Get a single event by ID.
 */
export async function getEvent(
  eventId: string,
  opts: { calendarId?: string; signal?: AbortSignal } = {}
): Promise<CalendarEvent> {
  const calendarId = opts.calendarId ?? getCalendarId();
  return gcalRequest<CalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { signal: opts.signal }
  );
}

/**
 * Fetch all events in a time range, paginating through all pages.
 * Excludes cancelled events.
 */
export async function getAllEvents(
  timeMin: string,
  timeMax: string,
  opts: { calendarId?: string; signal?: AbortSignal } = {}
): Promise<CalendarEvent[]> {
  const all: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const page = await listEvents({
      timeMin,
      timeMax,
      calendarId: opts.calendarId,
      pageToken,
      maxResults: 250,
      singleEvents: true,
      signal: opts.signal,
    });
    all.push(...page.items.filter((e) => e.status !== "cancelled"));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return all;
}
