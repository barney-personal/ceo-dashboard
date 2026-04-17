import * as Sentry from "@sentry/nextjs";
import type { ZodType } from "zod";
import {
  ModeEnvelopeValidationError,
  modeQueriesEnvelopeSchema,
  modeQueryRunsEnvelopeSchema,
  modeReportRunsEnvelopeSchema,
} from "@/lib/validation/mode-envelope";
import type { ModeRowAggregator } from "./mode-config";

const MODE_BASE_URL = "https://app.mode.com/api";
const MODE_METADATA_TIMEOUT_MS = 30_000;
const MODE_RESULTS_TIMEOUT_MS = 120_000;
const MODE_HEALTH_TIMEOUT_MS = 5_000;
const MODE_MAX_RESULT_BYTES = 25 * 1024 * 1024;
const MODE_MAX_RETRIES = 3;
const MODE_AUTH_ERROR_MESSAGE =
  "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler";

interface ModeConfig {
  token: string;
  secret: string;
  workspace: string;
}

function getConfig(): ModeConfig {
  const token = process.env.MODE_API_TOKEN;
  const secret = process.env.MODE_API_SECRET;
  const workspace = process.env.MODE_WORKSPACE;

  if (!token || !secret || !workspace) {
    const error = new Error(
      "Missing Mode config: MODE_API_TOKEN, MODE_API_SECRET, and MODE_WORKSPACE are required",
    );
    Sentry.captureException(error, {
      tags: { integration: "mode" },
      extra: { operation: "getConfig" },
    });
    throw error;
  }

  return { token, secret, workspace };
}

function authHeaders(config: ModeConfig): HeadersInit {
  const encoded = Buffer.from(`${config.token}:${config.secret}`).toString(
    "base64",
  );
  return {
    Authorization: `Basic ${encoded}`,
    Accept: "application/hal+json",
  };
}

class ModeAuthError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(MODE_AUTH_ERROR_MESSAGE);
    this.name = "ModeAuthError";
    this.status = status;
  }
}

function captureModeAuthError(input: {
  path: string;
  requestType: "metadata" | "query-result";
  status: number;
  body: string;
}): never {
  const error = new ModeAuthError(input.status);
  Sentry.captureException(error, {
    level: "error",
    tags: { integration: "mode", auth_failure: "true" },
    extra: {
      path: input.path,
      requestType: input.requestType,
      status: input.status,
      responseBody: input.body,
    },
  });
  throw error;
}

function composeSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  timeoutMessage?: string,
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
    controller.abort(new Error(timeoutMessage ?? "Mode request timed out"));
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

async function modeRequest<T>(
  path: string,
  options: RequestInit & { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const config = getConfig();
  const url = `${MODE_BASE_URL}/${config.workspace}${path}`;
  const { signal: parentSignal, timeoutMs, ...requestInit } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MODE_MAX_RETRIES; attempt++) {
    const { signal, cleanup, timedOut } = composeSignal(
      timeoutMs ?? MODE_METADATA_TIMEOUT_MS,
      parentSignal,
      "Mode request timed out",
    );

    try {
      const res = await fetch(url, {
        ...requestInit,
        signal,
        headers: {
          ...authHeaders(config),
          ...(requestInit.headers ?? {}),
        },
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) {
          captureModeAuthError({
            path,
            requestType: "metadata",
            status: res.status,
            body,
          });
        }
        const error = new Error(`Mode API error ${res.status}: ${body}`);
        if (
          attempt < MODE_MAX_RETRIES &&
          (res.status === 429 || res.status >= 500)
        ) {
          lastError = error;
          if (res.status === 429) {
            const { waitMs } = getModeRateLimitDelay({
              headers: res.headers,
              attempt,
              path,
            });
            await sleep(waitMs);
          } else {
            await sleep(getRetryDelayMs(attempt));
          }
          continue;
        }
        throw error;
      }

      return res.json() as Promise<T>;
    } catch (error) {
      if (signal.aborted) {
        if (timedOut()) {
          throw new Error("Mode request timed out");
        }

        if (signal.reason instanceof Error) {
          throw signal.reason;
        }

        throw new Error("Mode request was aborted");
      }

      if (error instanceof ModeAuthError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableModeError(message);
      if (attempt < MODE_MAX_RETRIES && retryable) {
        lastError = error instanceof Error ? error : new Error(message);
        await sleep(getRetryDelayMs(attempt));
        continue;
      }
      Sentry.captureException(error, {
        tags: { integration: "mode" },
        extra: { path, attempt, requestType: "metadata" },
      });
      throw error;
    } finally {
      cleanup();
    }
  }

  const terminalError = lastError ?? new Error("Mode request failed");
  Sentry.captureException(terminalError, {
    tags: { integration: "mode" },
    extra: { path, requestType: "metadata" },
  });
  throw terminalError;
}

function isRetryableModeError(message: string): boolean {
  return (
    message.includes("timed out") ||
    message.includes("aborted") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("ECONNRESET") ||
    message.includes("EAI_AGAIN")
  );
}

function getRetryDelayMs(attempt: number): number {
  const baseMs = 500 * 2 ** (attempt - 1);
  return baseMs + Math.floor(Math.random() * 250);
}

function parseRetryAfterDelayMs(headerValue: string | null): number | null {
  const retryAfterSeconds = Number(headerValue);
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return null;
  }

  return retryAfterSeconds * 1000;
}

function getModeRateLimitDelay(input: {
  headers: Headers;
  attempt: number;
  path: string;
}): { waitMs: number; source: "retry-after" | "backoff" } {
  const retryAfterDelayMs = parseRetryAfterDelayMs(
    input.headers.get("retry-after"),
  );
  const waitMs = retryAfterDelayMs ?? getRetryDelayMs(input.attempt);
  const source = retryAfterDelayMs === null ? "backoff" : "retry-after";

  Sentry.addBreadcrumb({
    category: "rate_limit.mode",
    message: "Retrying Mode request after rate limit",
    level: "info",
    data: {
      waitMs,
      path: input.path,
      attempt: input.attempt,
      source,
    },
  });

  return { waitMs, source };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBodyWithLimit<T>(
  res: Response,
  maxBytes: number,
): Promise<{ data: T; bytesRead: number }> {
  if (!res.body) {
    throw new Error("Mode response body is empty");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      throw new Error(
        `Mode result exceeded ${Math.round(maxBytes / 1024 / 1024)}MB response limit`,
      );
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();

  return {
    data: JSON.parse(text) as T,
    bytesRead,
  };
}

/**
 * Fetch a JSON endpoint that may be gzipped (used for query result content).
 */
async function modeRequestJson<T>(
  path: string,
  opts: {
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ data: T; bytesRead: number }> {
  const config = getConfig();
  const url = `${MODE_BASE_URL}/${config.workspace}${path}`;
  const timeoutMs = opts.timeoutMs ?? MODE_RESULTS_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MODE_MAX_RESULT_BYTES;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MODE_MAX_RETRIES; attempt++) {
    const { signal, cleanup, timedOut } = composeSignal(
      timeoutMs,
      opts.signal,
      "Mode query result request timed out",
    );

    try {
      const res = await fetch(url, {
        signal,
        headers: {
          ...authHeaders(config),
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) {
          captureModeAuthError({
            path,
            requestType: "query-result",
            status: res.status,
            body,
          });
        }
        const error = new Error(`Mode API error ${res.status}: ${body}`);
        if (
          attempt < MODE_MAX_RETRIES &&
          (res.status === 429 || res.status >= 500)
        ) {
          lastError = error;
          if (res.status === 429) {
            const { waitMs } = getModeRateLimitDelay({
              headers: res.headers,
              attempt,
              path,
            });
            await sleep(waitMs);
          } else {
            await sleep(getRetryDelayMs(attempt));
          }
          continue;
        }
        throw error;
      }

      return await readJsonBodyWithLimit<T>(res, maxBytes);
    } catch (error) {
      if (signal.aborted) {
        if (timedOut()) {
          throw new Error("Mode query result request timed out");
        }

        if (signal.reason instanceof Error) {
          throw signal.reason;
        }

        throw new Error("Mode query result request was aborted");
      }

      if (error instanceof ModeAuthError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableModeError(message);
      if (attempt < MODE_MAX_RETRIES && retryable) {
        lastError = error instanceof Error ? error : new Error(message);
        await sleep(getRetryDelayMs(attempt));
        continue;
      }
      Sentry.captureException(error, {
        tags: { integration: "mode" },
        extra: { path, attempt, requestType: "query-result" },
      });
      throw error;
    } finally {
      cleanup();
    }
  }

  const terminalError = lastError ?? new Error("Mode JSON request failed");
  Sentry.captureException(terminalError, {
    tags: { integration: "mode" },
    extra: { path, requestType: "query-result" },
  });
  throw terminalError;
}

// --- Types ---

export interface ModeReport {
  token: string;
  name: string;
  description: string;
}

export interface ModeRun {
  token: string;
  state: string;
  created_at: string;
}

export interface ModeQueryRun {
  token: string;
  state: string;
  _links: {
    query: { href: string };
    result: { href: string };
  };
}

export interface ModeQuery {
  token: string;
  name: string;
}

function validateModeEnvelope<T>(
  schema: ZodType<T>,
  envelope: string,
  path: string,
  raw: unknown,
): T {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");

  const error = new ModeEnvelopeValidationError(envelope, issues);
  Sentry.captureException(error, {
    level: "error",
    tags: { integration: "mode", mode_envelope_invalid: "true" },
    extra: {
      path,
      envelope,
      issues,
    },
  });
  throw error;
}

// --- API Methods ---

export async function getReport(
  reportToken: string,
  opts?: { signal?: AbortSignal },
): Promise<ModeReport> {
  return modeRequest<ModeReport>(`/reports/${reportToken}`, opts);
}

/**
 * Get the latest successful run for a report.
 */
export async function getLatestRun(
  reportToken: string,
  opts?: { signal?: AbortSignal },
): Promise<ModeRun | null> {
  const path = `/reports/${reportToken}/runs`;
  const raw = await modeRequest<unknown>(path, opts);
  const result = validateModeEnvelope(
    modeReportRunsEnvelopeSchema,
    "report_runs",
    path,
    raw,
  );

  const runs = result._embedded.report_runs;
  const succeeded = runs.find((r) => r.state === "succeeded");
  return succeeded ?? null;
}

/**
 * Get all query runs from a report run.
 */
export async function getQueryRuns(
  reportToken: string,
  runToken: string,
  opts?: { signal?: AbortSignal },
): Promise<ModeQueryRun[]> {
  const path = `/reports/${reportToken}/runs/${runToken}/query_runs`;
  const raw = await modeRequest<unknown>(path, opts);
  const result = validateModeEnvelope(
    modeQueryRunsEnvelopeSchema,
    "query_runs",
    path,
    raw,
  );
  return result._embedded.query_runs;
}

/**
 * Get the report-level query definitions (to get query names).
 */
export async function getReportQueries(
  reportToken: string,
  opts?: { signal?: AbortSignal },
): Promise<ModeQuery[]> {
  const path = `/reports/${reportToken}/queries`;
  const raw = await modeRequest<unknown>(path, opts);
  const result = validateModeEnvelope(
    modeQueriesEnvelopeSchema,
    "queries",
    path,
    raw,
  );
  return result._embedded.queries;
}

/**
 * Fetch query result content as JSON rows.
 * Mode returns gzipped JSON arrays of objects with named columns.
 */
export async function getQueryResultContent(
  reportToken: string,
  runToken: string,
  queryRunToken: string,
  maxRows: number = 1000,
  opts?: { signal?: AbortSignal; maxBytes?: number },
): Promise<{ rows: Record<string, unknown>[]; responseBytes: number }> {
  const { data, bytesRead } = await modeRequestJson<Record<string, unknown>[]>(
    `/reports/${reportToken}/runs/${runToken}/query_runs/${queryRunToken}/results/content.json?limit=${maxRows}`,
    opts,
  );

  return {
    rows: data,
    responseBytes: bytesRead,
  };
}

/**
 * Minimal RFC 4180 CSV row reader. Designed for incremental feeding of byte
 * chunks from a streaming response — push bytes via `push`, then either
 * `flushRecord()` per complete record returned by `push`, or call `end` for
 * the final pending record.
 *
 * Handles:
 *  - quoted fields with escaped quotes (`""`)
 *  - embedded commas / newlines inside quoted fields
 *  - CRLF and LF line terminators
 *
 * Does NOT handle: alternative delimiters, BOM stripping (Mode does not emit
 * a BOM on its CSV exports — verified empirically), or multi-byte field
 * separators. Sufficient for Mode result CSVs.
 */
class StreamingCsvParser {
  private readonly decoder = new TextDecoder("utf-8");
  private buffer = "";
  private field = "";
  private record: string[] = [];
  private inQuotes = false;
  private prevWasQuote = false;
  private prevWasCR = false;

  /**
   * Push a byte chunk into the parser and yield any records that completed
   * during this chunk.
   */
  push(chunk: Uint8Array): string[][] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  /**
   * Signal end-of-stream. Yields the final pending record if one is buffered
   * (i.e. the file did not end with a newline).
   */
  end(): string[][] {
    this.buffer += this.decoder.decode();
    const records = this.drain();
    if (this.field.length > 0 || this.record.length > 0) {
      this.record.push(this.field);
      records.push(this.record);
      this.field = "";
      this.record = [];
    }
    return records;
  }

  private drain(): string[][] {
    const out: string[][] = [];
    const buf = this.buffer;
    let i = 0;
    while (i < buf.length) {
      const ch = buf[i];

      if (this.inQuotes) {
        if (this.prevWasQuote) {
          this.prevWasQuote = false;
          if (ch === '"') {
            // Escaped quote inside quoted field.
            this.field += '"';
            i++;
            continue;
          }
          // Closing quote — fall through to non-quoted branch with this ch.
          this.inQuotes = false;
        } else if (ch === '"') {
          this.prevWasQuote = true;
          i++;
          continue;
        } else {
          this.field += ch;
          i++;
          continue;
        }
      }

      if (ch === '"') {
        this.inQuotes = true;
        this.prevWasQuote = false;
        i++;
        continue;
      }

      if (ch === ",") {
        this.record.push(this.field);
        this.field = "";
        i++;
        this.prevWasCR = false;
        continue;
      }

      if (ch === "\r") {
        this.record.push(this.field);
        this.field = "";
        out.push(this.record);
        this.record = [];
        this.prevWasCR = true;
        i++;
        continue;
      }

      if (ch === "\n") {
        if (this.prevWasCR) {
          // CRLF — already emitted on \r.
          this.prevWasCR = false;
          i++;
          continue;
        }
        this.record.push(this.field);
        this.field = "";
        out.push(this.record);
        this.record = [];
        i++;
        continue;
      }

      this.prevWasCR = false;
      this.field += ch;
      i++;
    }

    this.buffer = "";
    return out;
  }
}

/**
 * Stream a Mode query result as CSV and feed each row through `aggregator`.
 *
 * The whole point is to avoid buffering the response in memory: for the
 * weekly retention dataset the JSON variant exceeds 200 MB, but the
 * aggregated result is only ~1.4k rows. We download the CSV, parse it
 * incrementally, and let the aggregator collapse rows on the fly.
 *
 * Returns the finalized rows and the total bytes streamed (for parity with
 * the buffered path's `responseBytes` accounting).
 */
export async function streamQueryResultAndAggregate<TState>(
  reportToken: string,
  runToken: string,
  queryRunToken: string,
  aggregator: ModeRowAggregator<TState>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{
  rows: Record<string, unknown>[];
  responseBytes: number;
  sourceRowCount: number;
}> {
  const config = getConfig();
  const path = `/reports/${reportToken}/runs/${runToken}/query_runs/${queryRunToken}/results/content.csv`;
  const url = `${MODE_BASE_URL}/${config.workspace}${path}`;
  const timeoutMs = opts.timeoutMs ?? MODE_RESULTS_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MODE_MAX_RETRIES; attempt++) {
    const { signal, cleanup, timedOut } = composeSignal(
      timeoutMs,
      opts.signal,
      "Mode query result request timed out",
    );

    try {
      const res = await fetch(url, {
        signal,
        headers: {
          ...authHeaders(config),
          Accept: "text/csv",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) {
          captureModeAuthError({
            path,
            requestType: "query-result",
            status: res.status,
            body,
          });
        }
        const error = new Error(`Mode API error ${res.status}: ${body}`);
        if (
          attempt < MODE_MAX_RETRIES &&
          (res.status === 429 || res.status >= 500)
        ) {
          lastError = error;
          if (res.status === 429) {
            const { waitMs } = getModeRateLimitDelay({
              headers: res.headers,
              attempt,
              path,
            });
            await sleep(waitMs);
          } else {
            await sleep(getRetryDelayMs(attempt));
          }
          continue;
        }
        throw error;
      }

      if (!res.body) {
        throw new Error("Mode response body is empty");
      }

      const parser = new StreamingCsvParser();
      const reader = res.body.getReader();
      let bytesRead = 0;
      let header: string[] | null = null;
      let state = aggregator.initial();
      let sourceRowCount = 0;

      const consumeRecord = (record: string[]) => {
        if (!header) {
          header = record;
          return;
        }
        const row: Record<string, string> = {};
        for (let c = 0; c < header.length; c++) {
          row[header[c]] = record[c] ?? "";
        }
        sourceRowCount++;
        state = aggregator.reduce(state, row);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytesRead += value.byteLength;
        const records = parser.push(value);
        for (const rec of records) consumeRecord(rec);
      }

      const trailing = parser.end();
      for (const rec of trailing) consumeRecord(rec);

      if (!header) {
        throw new Error("Mode CSV stream contained no header row");
      }

      return {
        rows: aggregator.finalize(state),
        responseBytes: bytesRead,
        sourceRowCount,
      };
    } catch (error) {
      if (signal.aborted) {
        if (timedOut()) {
          throw new Error("Mode query result request timed out");
        }

        if (signal.reason instanceof Error) {
          throw signal.reason;
        }

        throw new Error("Mode query result request was aborted");
      }

      if (error instanceof ModeAuthError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableModeError(message);
      if (attempt < MODE_MAX_RETRIES && retryable) {
        lastError = error instanceof Error ? error : new Error(message);
        await sleep(getRetryDelayMs(attempt));
        continue;
      }
      Sentry.captureException(error, {
        tags: { integration: "mode" },
        extra: { path, attempt, requestType: "query-result-stream" },
      });
      throw error;
    } finally {
      cleanup();
    }
  }

  const terminalError = lastError ?? new Error("Mode CSV stream request failed");
  Sentry.captureException(terminalError, {
    tags: { integration: "mode" },
    extra: { path, requestType: "query-result-stream" },
  });
  throw terminalError;
}

export async function getModeJsonWithLimit<T>(
  path: string,
  opts?: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal },
): Promise<{ data: T; bytesRead: number }> {
  return modeRequestJson<T>(path, opts);
}

export async function checkModeHealth(opts: {
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<void> {
  const config = getConfig();
  const { signal, cleanup, timedOut } = composeSignal(
    opts.timeoutMs ?? MODE_HEALTH_TIMEOUT_MS,
    opts.signal,
    "Mode health check timed out",
  );

  try {
    const res = await fetch(`${MODE_BASE_URL}/${config.workspace}`, {
      signal,
      headers: authHeaders(config),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 || res.status === 403) {
        captureModeAuthError({
          path: "",
          requestType: "metadata",
          status: res.status,
          body,
        });
      }

      throw new Error(`Mode health check failed with status ${res.status}: ${body}`);
    }
  } catch (error) {
    if (signal.aborted) {
      if (timedOut()) {
        throw new Error("Mode health check timed out");
      }

      if (signal.reason instanceof Error) {
        throw signal.reason;
      }

      throw new Error("Mode health check was aborted");
    }

    throw error;
  } finally {
    cleanup();
  }
}

/**
 * Extract the query token from a query run's query link.
 * Link format: /api/{workspace}/reports/{report}/queries/{queryToken}
 */
export function extractQueryToken(queryRun: ModeQueryRun): string {
  const href = queryRun._links.query.href;
  const parts = href.split("/");
  return parts[parts.length - 1];
}
