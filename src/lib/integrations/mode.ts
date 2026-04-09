import * as Sentry from "@sentry/nextjs";

const MODE_BASE_URL = "https://app.mode.com/api";
const MODE_METADATA_TIMEOUT_MS = 30_000;
const MODE_RESULTS_TIMEOUT_MS = 120_000;
const MODE_MAX_RESULT_BYTES = 25 * 1024 * 1024;
const MODE_MAX_RETRIES = 3;
const MODE_AUTH_ERROR_MESSAGE =
  "Mode API authentication failed, check MODE_API_TOKEN";

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
      "Missing Mode config: MODE_API_TOKEN, MODE_API_SECRET, and MODE_WORKSPACE are required"
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
    "base64"
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
  options: RequestInit & { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const config = getConfig();
  const url = `${MODE_BASE_URL}/${config.workspace}${path}`;
  const { signal: parentSignal, timeoutMs, ...requestInit } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MODE_MAX_RETRIES; attempt++) {
    const { signal, cleanup, timedOut } = composeSignal(
      timeoutMs ?? MODE_METADATA_TIMEOUT_MS,
      parentSignal,
      "Mode request timed out"
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
          await sleep(getRetryDelayMs(attempt));
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBodyWithLimit<T>(
  res: Response,
  maxBytes: number
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
        `Mode result exceeded ${Math.round(maxBytes / 1024 / 1024)}MB response limit`
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
  } = {}
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
      "Mode query result request timed out"
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
          await sleep(getRetryDelayMs(attempt));
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

// --- API Methods ---

export async function getReport(
  reportToken: string,
  opts?: { signal?: AbortSignal }
): Promise<ModeReport> {
  return modeRequest<ModeReport>(`/reports/${reportToken}`, opts);
}

/**
 * Get the latest successful run for a report.
 */
export async function getLatestRun(
  reportToken: string,
  opts?: { signal?: AbortSignal }
): Promise<ModeRun | null> {
  const result = await modeRequest<{
    _embedded: { report_runs: ModeRun[] };
  }>(`/reports/${reportToken}/runs`, opts);

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
  opts?: { signal?: AbortSignal }
): Promise<ModeQueryRun[]> {
  const result = await modeRequest<{
    _embedded: { query_runs: ModeQueryRun[] };
  }>(`/reports/${reportToken}/runs/${runToken}/query_runs`, opts);
  return result._embedded.query_runs;
}

/**
 * Get the report-level query definitions (to get query names).
 */
export async function getReportQueries(
  reportToken: string,
  opts?: { signal?: AbortSignal }
): Promise<ModeQuery[]> {
  const result = await modeRequest<{
    _embedded: { queries: ModeQuery[] };
  }>(`/reports/${reportToken}/queries`, opts);
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
  opts?: { signal?: AbortSignal }
): Promise<{ rows: Record<string, unknown>[]; responseBytes: number }> {
  const { data, bytesRead } = await modeRequestJson<Record<string, unknown>[]>(
    `/reports/${reportToken}/runs/${runToken}/query_runs/${queryRunToken}/results/content.json?limit=${maxRows}`,
    opts
  );

  return {
    rows: data,
    responseBytes: bytesRead,
  };
}

export async function getModeJsonWithLimit<T>(
  path: string,
  opts?: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal }
): Promise<{ data: T; bytesRead: number }> {
  return modeRequestJson<T>(path, opts);
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
