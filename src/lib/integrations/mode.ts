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
    "Content-Type": "application/json",
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

// --- Types ---

export interface ModeReport {
  token: string;
  name: string;
  description: string;
  _links: {
    runs: { href: string };
    queries: { href: string };
  };
}

export interface ModeRun {
  token: string;
  state: string; // 'enqueued' | 'running' | 'succeeded' | 'failed'
  _links: {
    result: { href: string };
    queries: { href: string };
  };
}

export interface ModeQuery {
  token: string;
  name: string;
  _links: {
    result: { href: string };
  };
}

export interface ModeQueryResult {
  token: string;
  columns: Array<{ name: string; type: string }>;
  content: unknown[][]; // Row data as arrays
}

// --- API Methods ---

export async function getReport(reportToken: string): Promise<ModeReport> {
  return modeRequest<ModeReport>(`/reports/${reportToken}`);
}

export async function runReport(reportToken: string): Promise<ModeRun> {
  return modeRequest<ModeRun>(`/reports/${reportToken}/runs`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getReportRun(
  reportToken: string,
  runToken: string
): Promise<ModeRun> {
  return modeRequest<ModeRun>(
    `/reports/${reportToken}/runs/${runToken}`
  );
}

export async function getRunQueries(
  reportToken: string,
  runToken: string
): Promise<ModeQuery[]> {
  const result = await modeRequest<{ _embedded: { queries: ModeQuery[] } }>(
    `/reports/${reportToken}/runs/${runToken}/query_runs`
  );
  return result._embedded.queries;
}

export async function getQueryResult(
  reportToken: string,
  runToken: string,
  queryToken: string
): Promise<{ columns: Array<{ name: string; type: string }>; rows: Record<string, unknown>[] }> {
  const result = await modeRequest<ModeQueryResult>(
    `/reports/${reportToken}/runs/${runToken}/query_runs/${queryToken}/result/content`
  );

  // Convert array-of-arrays into array-of-objects using column names
  const columns = result.columns;
  const rows = result.content.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });

  return { columns, rows };
}

/**
 * Run a report and wait for it to complete.
 * Polls every 2 seconds, times out after 2 minutes.
 */
export async function runReportAndWait(
  reportToken: string,
  timeoutMs = 120_000
): Promise<ModeRun> {
  const run = await runReport(reportToken);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getReportRun(reportToken, run.token);

    if (status.state === "succeeded") {
      return status;
    }

    if (status.state === "failed") {
      throw new Error(
        `Mode report run failed: ${reportToken}/${run.token}`
      );
    }

    // Wait 2 seconds before polling again
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(
    `Mode report run timed out after ${timeoutMs}ms: ${reportToken}/${run.token}`
  );
}
