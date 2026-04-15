/**
 * Data loaders for the Delivery page. Wraps the Swarmia API client, shapes
 * results for the UI, and swallows errors into a structured empty state so the
 * page renders even when the token is missing or the API is down.
 */
import * as Sentry from "@sentry/nextjs";
import {
  getDora,
  getDoraForRange,
  getInvestmentBalance,
  getPullRequestMetrics,
  getPullRequestMetricsForRange,
  isSwarmiaConfigured,
  type InvestmentCategory,
  type SwarmiaDora,
  type SwarmiaTeamPrMetrics,
  type SwarmiaTimeframe,
} from "@/lib/integrations/swarmia";

export type LoaderStatus = "ok" | "not_configured" | "error";

export interface LoaderResult<T> {
  status: LoaderStatus;
  data: T | null;
  errorMessage?: string;
}

async function safeLoad<T>(
  label: string,
  fn: () => Promise<T>
): Promise<LoaderResult<T>> {
  if (!isSwarmiaConfigured()) {
    return { status: "not_configured", data: null };
  }
  try {
    const data = await fn();
    return { status: "ok", data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { loader: `swarmia:${label}` } });
    return { status: "error", data: null, errorMessage: message };
  }
}

// ---------------------------------------------------------------------------
// DORA scorecard
// ---------------------------------------------------------------------------

export interface DoraScorecard {
  /** Last-30d headline figures (what the metric cards display). */
  current: SwarmiaDora;
  /** 90d baseline, used for the "vs 90d" delta chip. */
  comparison: SwarmiaDora | null;
}

export async function getDoraScorecard(): Promise<LoaderResult<DoraScorecard>> {
  return safeLoad("dora", async () => {
    const [current, comparison] = await Promise.all([
      getDora("last_30_days"),
      getDora("last_90_days"),
    ]);
    if (!current) throw new Error("Swarmia DORA returned no rows");
    return { current, comparison };
  });
}

// ---------------------------------------------------------------------------
// DORA trend — 12 weekly data points for sparklines
// ---------------------------------------------------------------------------

export interface DoraTrendPoint {
  /** ISO week start (Monday), YYYY-MM-DD. */
  weekStart: string;
  deploymentFrequencyPerDay: number;
  changeLeadTimeMinutes: number;
  changeFailureRatePercent: number;
  meanTimeToRecoveryMinutes: number;
}

export interface DoraTrend {
  /** Oldest first; sparklines expect ascending time. */
  weeks: DoraTrendPoint[];
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Return the Monday of the ISO week containing `d`, in UTC.
 * JS Sunday=0 → Monday=1, so we shift by ((day+6) % 7) days.
 */
function startOfIsoWeek(d: Date): Date {
  const day = d.getUTCDay();
  const offset = (day + 6) % 7;
  return addDays(d, -offset);
}

export async function getDoraTrend(weeks = 12): Promise<LoaderResult<DoraTrend>> {
  return safeLoad("dora-trend", async () => {
    // Last N complete ISO weeks ending with the one containing today.
    const thisMonday = startOfIsoWeek(new Date());
    const ranges: Array<{ start: Date; end: Date }> = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = addDays(thisMonday, -7 * i);
      const end = addDays(start, 6);
      ranges.push({ start, end });
    }
    const results = await Promise.all(
      ranges.map(({ start, end }) => getDoraForRange(isoDate(start), isoDate(end)))
    );
    const points: DoraTrendPoint[] = ranges.map(({ start }, i) => {
      const r = results[i];
      return {
        weekStart: isoDate(start),
        deploymentFrequencyPerDay: r?.deploymentFrequencyPerDay ?? 0,
        changeLeadTimeMinutes: r?.changeLeadTimeMinutes ?? 0,
        changeFailureRatePercent: r?.changeFailureRatePercent ?? 0,
        meanTimeToRecoveryMinutes: r?.meanTimeToRecoveryMinutes ?? 0,
      };
    });
    return { weeks: points };
  });
}

// ---------------------------------------------------------------------------
// DORA bands — industry thresholds (Accelerate / DevOps Research)
// ---------------------------------------------------------------------------

export type DoraBand = "elite" | "high" | "medium" | "low";

export interface DoraBandInfo {
  band: DoraBand;
  label: string;
}

export function classifyDeployFrequency(perDay: number): DoraBandInfo {
  if (perDay >= 1) return { band: "elite", label: "Elite" };
  if (perDay >= 1 / 7) return { band: "high", label: "High" };
  if (perDay >= 1 / 30) return { band: "medium", label: "Medium" };
  return { band: "low", label: "Low" };
}

export function classifyChangeLeadTime(minutes: number): DoraBandInfo {
  const hours = minutes / 60;
  if (hours < 24) return { band: "elite", label: "Elite" };
  if (hours < 24 * 7) return { band: "high", label: "High" };
  if (hours < 24 * 30) return { band: "medium", label: "Medium" };
  return { band: "low", label: "Low" };
}

export function classifyChangeFailureRate(percent: number): DoraBandInfo {
  if (percent <= 5) return { band: "elite", label: "Elite" };
  if (percent <= 15) return { band: "high", label: "High" };
  if (percent <= 30) return { band: "medium", label: "Medium" };
  return { band: "low", label: "Low" };
}

export function classifyMttr(minutes: number): DoraBandInfo {
  const hours = minutes / 60;
  if (hours < 1) return { band: "elite", label: "Elite" };
  if (hours < 24) return { band: "high", label: "High" };
  if (hours < 24 * 7) return { band: "medium", label: "Medium" };
  return { band: "low", label: "Low" };
}

// ---------------------------------------------------------------------------
// Per-pillar weekly trend — one row per pillar × week for cycle time / review
// rate / throughput sparklines. One Swarmia call returns all pillars for the
// week, so 12 weeks = 12 API calls total.
// ---------------------------------------------------------------------------

export interface PillarTrendWeek {
  weekStart: string;
  cycleTimeHours: number;
  reviewRatePercent: number;
  prsPerWeek: number;
}

export interface PillarTrend {
  pillar: string;
  /** 12 weeks ordered oldest → newest. */
  weeks: PillarTrendWeek[];
}

export interface PillarTrends {
  pillars: PillarTrend[];
}

export async function getPillarWeeklyTrend(
  weeks = 12
): Promise<LoaderResult<PillarTrends>> {
  return safeLoad("pillar-weekly-trend", async () => {
    const thisMonday = startOfIsoWeek(new Date());
    const ranges: Array<{ start: Date; end: Date }> = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = addDays(thisMonday, -7 * i);
      ranges.push({ start, end: addDays(start, 6) });
    }

    // Fetch all weeks in parallel. Each response has one row per pillar-level
    // team (parentTeam === "") plus one row per squad-level team.
    const weekResults = await Promise.all(
      ranges.map(async ({ start, end }) => {
        const rows = await getPullRequestMetricsForRange(
          isoDate(start),
          isoDate(end)
        );
        return { weekStart: isoDate(start), rows };
      })
    );

    // Pivot: collect all pillar names that appear anywhere, then for each
    // pillar assemble its per-week series (missing weeks → 0).
    const pillarNames = new Set<string>();
    for (const { rows } of weekResults) {
      for (const r of rows) {
        if (r.parentTeam === "") pillarNames.add(r.team);
      }
    }

    const pillars: PillarTrend[] = [...pillarNames].sort().map((name) => {
      const weekData: PillarTrendWeek[] = weekResults.map(
        ({ weekStart, rows }) => {
          const row = rows.find((r) => r.parentTeam === "" && r.team === name);
          return {
            weekStart,
            cycleTimeHours: row ? row.cycleTimeSeconds / 3600 : 0,
            reviewRatePercent: row?.reviewRatePercent ?? 0,
            prsPerWeek: row?.prsMergedPerWeek ?? 0,
          };
        }
      );
      return { pillar: name, weeks: weekData };
    });

    return { pillars };
  });
}

// ---------------------------------------------------------------------------
// Pillar "movers" — biggest week-over-4-week changes across pillars
// ---------------------------------------------------------------------------

export type MoverMetric = "Cycle time" | "Review rate" | "PRs / week";

export interface PillarMover {
  pillar: string;
  metric: MoverMetric;
  valueNow: number;
  valuePrev: number;
  deltaPercent: number;
  /** "improved" or "worsened" — already accounts for lower-is-better. */
  direction: "improved" | "worsened";
}

export interface PillarMovers {
  movers: PillarMover[];
  /** How the comparison was defined, so the UI can label it. */
  windowLabel: string;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pctChange(now: number, prev: number): number {
  if (!Number.isFinite(prev) || prev === 0) return 0;
  return ((now - prev) / prev) * 100;
}

/**
 * Compute the biggest pillar-level changes in the most recent week vs the
 * preceding 4 weeks (a "week-over-month" comparison that smooths noise).
 */
export function computePillarMovers(
  trends: PillarTrends,
  limit = 3,
  minPrevPrsPerWeek = 2
): PillarMovers {
  const candidates: PillarMover[] = [];

  for (const { pillar, weeks } of trends.pillars) {
    if (weeks.length < 5) continue;
    const last = weeks[weeks.length - 1];
    const prior = weeks.slice(-5, -1); // 4 preceding weeks

    // Skip pillars that were effectively dormant in the prior window — their
    // % deltas are noisy and not meaningful.
    const priorAvgPrs = mean(prior.map((w) => w.prsPerWeek));
    if (priorAvgPrs < minPrevPrsPerWeek) continue;

    const priorAvgCycle = mean(
      prior.map((w) => w.cycleTimeHours).filter((v) => v > 0)
    );
    const priorAvgReview = mean(
      prior.map((w) => w.reviewRatePercent).filter((v) => v > 0)
    );

    // Cycle time — lower is better.
    if (priorAvgCycle > 0 && last.cycleTimeHours > 0) {
      const delta = pctChange(last.cycleTimeHours, priorAvgCycle);
      candidates.push({
        pillar,
        metric: "Cycle time",
        valueNow: last.cycleTimeHours,
        valuePrev: priorAvgCycle,
        deltaPercent: delta,
        direction: delta < 0 ? "improved" : "worsened",
      });
    }

    // Review rate — higher is better.
    if (priorAvgReview > 0 && last.reviewRatePercent > 0) {
      const delta = pctChange(last.reviewRatePercent, priorAvgReview);
      candidates.push({
        pillar,
        metric: "Review rate",
        valueNow: last.reviewRatePercent,
        valuePrev: priorAvgReview,
        deltaPercent: delta,
        direction: delta > 0 ? "improved" : "worsened",
      });
    }

    // Throughput — higher is better.
    if (priorAvgPrs > 0 && last.prsPerWeek > 0) {
      const delta = pctChange(last.prsPerWeek, priorAvgPrs);
      candidates.push({
        pillar,
        metric: "PRs / week",
        valueNow: last.prsPerWeek,
        valuePrev: priorAvgPrs,
        deltaPercent: delta,
        direction: delta > 0 ? "improved" : "worsened",
      });
    }
  }

  // Biggest magnitude first, regardless of direction.
  candidates.sort(
    (a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent)
  );

  return {
    movers: candidates.slice(0, limit),
    windowLabel: "last week vs prior 4-week average",
  };
}

// ---------------------------------------------------------------------------
// Investment balance — last 6 months
// ---------------------------------------------------------------------------

export interface InvestmentSeries {
  /** One entry per month, oldest first. */
  months: Array<{
    /** First of month, e.g. "2026-03-01" — ready for LineChart x-axis. */
    date: string;
    /** Human label, e.g. "Mar 26". */
    label: string;
    byCategory: Record<InvestmentCategory, number>; // % of total FTE
    totalFteMonths: number;
  }>;
}

function firstOfMonth(year: number, monthIndex: number): string {
  const mm = String(monthIndex + 1).padStart(2, "0");
  return `${year}-${mm}-01`;
}

function lastOfMonth(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  return d.toISOString().slice(0, 10);
}

function monthLabel(date: Date): string {
  const month = date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${month} ${yy}`;
}

export async function getInvestmentSeries(): Promise<LoaderResult<InvestmentSeries>> {
  return safeLoad("investment", async () => {
    // Last 6 complete months, ending with the current month.
    const now = new Date();
    const months: Array<{ year: number; monthIndex: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push({ year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() });
    }

    const results = await Promise.all(
      months.map(({ year, monthIndex }) =>
        getInvestmentBalance(
          firstOfMonth(year, monthIndex),
          lastOfMonth(year, monthIndex)
        )
      )
    );

    return {
      months: months.map(({ year, monthIndex }, i) => {
        const rows = results[i];
        const total = rows.reduce((sum, r) => sum + r.fteMonths, 0);
        const byCategory: Record<InvestmentCategory, number> = {
          "New things": 0,
          "Improving things": 0,
          KTLO: 0,
          Uncategorized: 0,
        };
        for (const r of rows) {
          byCategory[r.category] = total > 0 ? (r.fteMonths / total) * 100 : 0;
        }
        const d = new Date(Date.UTC(year, monthIndex, 1));
        return {
          date: firstOfMonth(year, monthIndex),
          label: monthLabel(d),
          byCategory,
          totalFteMonths: total,
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Squad cycle-time leaderboard
// ---------------------------------------------------------------------------

export interface SquadLeaderboard {
  squads: Array<{
    squad: string;
    pillar: string;
    cycleTimeHours: number;
    prsPerWeek: number;
    reviewRatePercent: number;
    contributors: number;
  }>;
}

/**
 * Keep only squad-level rows (those with a non-empty parentTeam) and with at
 * least some PR activity. Pillar-level rows (empty parentTeam) are excluded
 * here — they go to the Pillar Velocity section.
 */
export async function getSquadLeaderboard(): Promise<LoaderResult<SquadLeaderboard>> {
  return safeLoad("squad-leaderboard", async () => {
    const rows = await getPullRequestMetrics("last_30_days");
    const squads = rows
      .filter((r) => r.parentTeam !== "" && r.cycleTimeSeconds > 0)
      .map((r) => ({
        squad: r.team,
        pillar: r.parentTeam,
        cycleTimeHours: r.cycleTimeSeconds / 3600,
        prsPerWeek: r.prsMergedPerWeek,
        reviewRatePercent: r.reviewRatePercent,
        contributors: r.contributors,
      }))
      .sort((a, b) => a.cycleTimeHours - b.cycleTimeHours);
    return { squads };
  });
}

// ---------------------------------------------------------------------------
// Pillar velocity
// ---------------------------------------------------------------------------

export interface PillarVelocity {
  pillars: Array<{
    pillar: string;
    cycleTimeHours: number;
    prsPerWeek: number;
    reviewRatePercent: number;
    contributors: number;
    prsInProgress: number;
  }>;
}

export async function getPillarVelocity(): Promise<LoaderResult<PillarVelocity>> {
  return safeLoad("pillar-velocity", async () => {
    const rows = await getPullRequestMetrics("last_30_days");
    // Pillar-level rows: parentTeam is empty.
    const pillars = rows
      .filter((r) => r.parentTeam === "")
      .map((r: SwarmiaTeamPrMetrics) => ({
        pillar: r.team,
        cycleTimeHours: r.cycleTimeSeconds / 3600,
        prsPerWeek: r.prsMergedPerWeek,
        reviewRatePercent: r.reviewRatePercent,
        contributors: r.contributors,
        prsInProgress: r.prsInProgress,
      }))
      .sort((a, b) => b.prsPerWeek - a.prsPerWeek);
    return { pillars };
  });
}

// ---------------------------------------------------------------------------
// Squad + Pillar lookup — used by the Engineering page's squad/pillar views
// to augment GitHub aggregates with Swarmia-only metrics (cycle time, review
// rate). Returns plain serializable objects so they can cross server→client.
// ---------------------------------------------------------------------------

export interface TeamSwarmiaMetrics {
  cycleTimeHours: number;
  reviewRatePercent: number;
  timeToFirstReviewHours: number;
  prsInProgress: number;
}

export interface SquadPillarLookup {
  /** Keyed by normalized team name (lowercased, trimmed). */
  squads: Record<string, TeamSwarmiaMetrics>;
  /** Keyed by normalized pillar name. */
  pillars: Record<string, TeamSwarmiaMetrics>;
}

export function normalizeTeamName(name: string | null | undefined): string {
  // HiBob appends " Squad" / " Team" to some squads (Bills Squad, Savings Squad,
  // Card Squad) where Swarmia uses the bare name. Strip the suffix so they match.
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/ (squad|team)$/, "");
}

/**
 * Map the engineering page's PeriodDays (30/90/180/360) onto a Swarmia preset.
 * Swarmia doesn't offer 360, so we round 180+ onto last_365_days.
 */
export function periodDaysToSwarmiaTimeframe(days: number): SwarmiaTimeframe {
  if (days <= 30) return "last_30_days";
  if (days <= 90) return "last_90_days";
  if (days <= 180) return "last_180_days";
  return "last_365_days";
}

export async function getSquadPillarMetrics(
  timeframe: SwarmiaTimeframe
): Promise<LoaderResult<SquadPillarLookup>> {
  return safeLoad("squad-pillar-lookup", async () => {
    const rows = await getPullRequestMetrics(timeframe);
    const squads: Record<string, TeamSwarmiaMetrics> = {};
    const pillars: Record<string, TeamSwarmiaMetrics> = {};
    for (const r of rows) {
      const metrics: TeamSwarmiaMetrics = {
        cycleTimeHours: r.cycleTimeSeconds / 3600,
        reviewRatePercent: r.reviewRatePercent,
        timeToFirstReviewHours: r.timeToFirstReviewSeconds / 3600,
        prsInProgress: r.prsInProgress,
      };
      const key = normalizeTeamName(r.team);
      if (!key) continue;
      // parentTeam empty → pillar-level row. Non-empty → squad-level.
      if (r.parentTeam === "") {
        pillars[key] = metrics;
      } else {
        squads[key] = metrics;
      }
    }
    return { squads, pillars };
  });
}
