/**
 * Swarmia Export API client.
 *
 * Docs: https://help.swarmia.com/getting-started/integrations/data-export/export-api
 * Base: https://app.swarmia.com/api/v0
 *
 * Auth: bearer token from SWARMIA_API_TOKEN. Issued via Settings → API tokens.
 *
 * NOTE: This is a first-pass integration that fetches directly from Swarmia at
 * request time (cached by Next.js fetch for 4 hours). If the Delivery page
 * becomes a permanent fixture, migrate to the sync pipeline pattern used by
 * Mode/Slack — schema table, sync runner in `src/lib/sync/`, loader reads DB.
 */

const SWARMIA_BASE_URL = "https://app.swarmia.com/api/v0";

/** 4 hours — matches Mode's sync interval. */
const CACHE_SECONDS = 4 * 60 * 60;

export type SwarmiaTimeframe =
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "last_60_days"
  | "last_90_days"
  | "last_180_days"
  | "last_365_days";

export class SwarmiaConfigError extends Error {
  constructor() {
    super("SWARMIA_API_TOKEN is not configured");
    this.name = "SwarmiaConfigError";
  }
}

export class SwarmiaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string
  ) {
    super(message);
    this.name = "SwarmiaApiError";
  }
}

function getToken(): string {
  const token = process.env.SWARMIA_API_TOKEN;
  if (!token) throw new SwarmiaConfigError();
  return token;
}

export function isSwarmiaConfigured(): boolean {
  return Boolean(process.env.SWARMIA_API_TOKEN);
}

async function fetchSwarmia(
  path: string,
  params: Record<string, string | undefined> = {}
): Promise<string> {
  const url = new URL(`${SWARMIA_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getToken()}` },
    next: { revalidate: CACHE_SECONDS, tags: ["swarmia"] },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SwarmiaApiError(
      `Swarmia ${path} returned ${res.status}: ${body.slice(0, 200)}`,
      res.status,
      path
    );
  }

  return res.text();
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse Swarmia CSV into array of objects keyed by header.
 * Handles quoted fields containing commas (but not escaped quotes, which
 * Swarmia does not emit in observed data).
 */
export function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvRow(lines[0]);
  return lines
    .slice(1)
    // Skip blank lines — some exporters emit a trailing \n that would
    // otherwise become a row of empty strings.
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const cells = splitCsvRow(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      return row;
    });
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function toNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Typed endpoint wrappers
// ---------------------------------------------------------------------------

export interface SwarmiaDora {
  startDate: string;
  endDate: string;
  deploymentFrequencyPerDay: number;
  changeLeadTimeMinutes: number;
  averageTimeToDeployMinutes: number;
  changeFailureRatePercent: number;
  meanTimeToRecoveryMinutes: number;
  deploymentCount: number;
}

function parseDoraRow(row: Record<string, string>): SwarmiaDora {
  return {
    startDate: row["Start Date"],
    endDate: row["End Date"],
    deploymentFrequencyPerDay: toNumber(row["Deployment Frequency (per day)"]),
    changeLeadTimeMinutes: toNumber(row["Change Lead Time Minutes"]),
    averageTimeToDeployMinutes: toNumber(row["Average Time to Deploy Minutes"]),
    changeFailureRatePercent: toNumber(row["Change Failure Rate (%)"]),
    meanTimeToRecoveryMinutes: toNumber(row["Mean Time to Recovery Minutes"]),
    deploymentCount: toNumber(row["Deployment Count"]),
  };
}

export async function getDora(
  timeframe: SwarmiaTimeframe
): Promise<SwarmiaDora | null> {
  const csv = await fetchSwarmia("/reports/dora", { timeframe });
  const rows = parseCsv(csv);
  return rows[0] ? parseDoraRow(rows[0]) : null;
}

/** Fetch DORA for an arbitrary inclusive date range (YYYY-MM-DD). */
export async function getDoraForRange(
  startDate: string,
  endDate: string
): Promise<SwarmiaDora | null> {
  const csv = await fetchSwarmia("/reports/dora", { startDate, endDate });
  const rows = parseCsv(csv);
  return rows[0] ? parseDoraRow(rows[0]) : null;
}

export interface SwarmiaTeamPrMetrics {
  startDate: string;
  endDate: string;
  parentTeam: string;
  team: string;
  cycleTimeSeconds: number;
  reviewRatePercent: number;
  timeToFirstReviewSeconds: number;
  prsMergedPerWeek: number;
  mergeTimeSeconds: number;
  prsInProgress: number;
  contributors: number;
  inProgressTimeSeconds: number;
  reviewTimeSeconds: number;
}

function parsePrMetricsCsv(csv: string): SwarmiaTeamPrMetrics[] {
  return parseCsv(csv).map((row) => ({
    startDate: row["Start Date"],
    endDate: row["End Date"],
    parentTeam: row["Parent Team(s)"],
    team: row["Team"],
    cycleTimeSeconds: toNumber(row["Cycle Time (s)"]),
    reviewRatePercent: toNumber(row["Review Rate (%)"]),
    timeToFirstReviewSeconds: toNumber(row["Time to first review (s)"]),
    prsMergedPerWeek: toNumber(row["PRs merged / week"]),
    mergeTimeSeconds: toNumber(row["Merge Time (s)"]),
    prsInProgress: toNumber(row["PRs in Progress"]),
    contributors: toNumber(row["Contributors"]),
    inProgressTimeSeconds: toNumber(row["In Progress Time (s)"]),
    reviewTimeSeconds: toNumber(row["Review Time (s)"]),
  }));
}

export async function getPullRequestMetrics(
  timeframe: SwarmiaTimeframe
): Promise<SwarmiaTeamPrMetrics[]> {
  const csv = await fetchSwarmia("/reports/pullRequests", { timeframe });
  return parsePrMetricsCsv(csv);
}

/** Same as getPullRequestMetrics but for an arbitrary YYYY-MM-DD range. */
export async function getPullRequestMetricsForRange(
  startDate: string,
  endDate: string
): Promise<SwarmiaTeamPrMetrics[]> {
  const csv = await fetchSwarmia("/reports/pullRequests", { startDate, endDate });
  return parsePrMetricsCsv(csv);
}


export interface SwarmiaTeam {
  id: string;
  parentId: string | null;
  name: string;
  externalId: string | null;
  jiraProjectKeys?: string[];
  members: Array<{
    id: string;
    email: string;
    name: string;
    githubUsername: string | null;
  }>;
}

/**
 * Fetch the Swarmia team roster. Not wired into any page yet — kept here
 * because the members list contains authoritative GitHub↔email mappings
 * that are useful for validating `githubEmployeeMap` (populated by the LLM
 * matcher in #120). Any future caller should route through a leadership-
 * gated page.
 */
export async function getTeams(): Promise<SwarmiaTeam[]> {
  const body = await fetchSwarmia("/teams");
  try {
    const parsed = JSON.parse(body) as { teams?: SwarmiaTeam[] };
    return parsed.teams ?? [];
  } catch {
    throw new SwarmiaApiError(
      `Swarmia /teams returned non-JSON: ${body.slice(0, 120)}`,
      200,
      "/teams"
    );
  }
}
