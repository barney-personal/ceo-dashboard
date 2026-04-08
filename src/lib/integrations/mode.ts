import { gunzipSync } from "zlib";

const MODE_BASE_URL = "https://app.mode.com/api";

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
    throw new Error(
      "Missing Mode config: MODE_API_TOKEN, MODE_API_SECRET, and MODE_WORKSPACE are required"
    );
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

async function modeRequest<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const config = getConfig();
  const url = `${MODE_BASE_URL}/${config.workspace}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(config),
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mode API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch a JSON endpoint that may be gzipped (used for query result content).
 */
async function modeRequestJson<T>(path: string): Promise<T> {
  const config = getConfig();
  const url = `${MODE_BASE_URL}/${config.workspace}${path}`;
  const res = await fetch(url, {
    headers: {
      ...authHeaders(config),
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mode API error ${res.status}: ${body}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  // Mode may or may not gzip the response — try decompressing, fall back to plain
  let text: string;
  try {
    text = gunzipSync(buffer).toString("utf-8");
  } catch {
    text = buffer.toString("utf-8");
  }

  return JSON.parse(text) as T;
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

export async function getReport(reportToken: string): Promise<ModeReport> {
  return modeRequest<ModeReport>(`/reports/${reportToken}`);
}

/**
 * Get the latest successful run for a report.
 */
export async function getLatestRun(
  reportToken: string
): Promise<ModeRun | null> {
  const result = await modeRequest<{
    _embedded: { report_runs: ModeRun[] };
  }>(`/reports/${reportToken}/runs`);

  const runs = result._embedded.report_runs;
  const succeeded = runs.find((r) => r.state === "succeeded");
  return succeeded ?? null;
}

/**
 * Get all query runs from a report run.
 */
export async function getQueryRuns(
  reportToken: string,
  runToken: string
): Promise<ModeQueryRun[]> {
  const result = await modeRequest<{
    _embedded: { query_runs: ModeQueryRun[] };
  }>(`/reports/${reportToken}/runs/${runToken}/query_runs`);
  return result._embedded.query_runs;
}

/**
 * Get the report-level query definitions (to get query names).
 */
export async function getReportQueries(
  reportToken: string
): Promise<ModeQuery[]> {
  const result = await modeRequest<{
    _embedded: { queries: ModeQuery[] };
  }>(`/reports/${reportToken}/queries`);
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
  maxRows: number = 10000
): Promise<Record<string, unknown>[]> {
  return modeRequestJson<Record<string, unknown>[]>(
    `/reports/${reportToken}/runs/${runToken}/query_runs/${queryRunToken}/results/content.json?limit=${maxRows}`
  );
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
