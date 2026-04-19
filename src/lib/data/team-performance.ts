import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubEmployeeMap, githubPrs } from "@/lib/db/schema";
import {
  getLatestSlackMembersSnapshot,
  type SlackMemberRow,
} from "./slack-members";
import { getPerformanceData } from "./performance";
import type { ManagerReport } from "./managers";

export type TrendDirection = "up" | "flat" | "down";

export interface TeamMemberRow {
  email: string;
  name: string;
  jobTitle: string | null;
  function: string | null;
  level: string | null;
  startDate: string | null;

  /** Absolute engagement score 0–100; null if no Slack match. */
  slackEngagement: number | null;
  /** Percentile of engagement within this person's function (0–1). */
  slackFunctionPercentile: number | null;
  /** Raw slack user ID (for linking). */
  slackUserId: string | null;

  /** Latest perf rating (1–5). */
  latestRating: number | null;
  /** Previous cycle's rating (1–5). */
  priorRating: number | null;
  /** Trend based on last two rated cycles. */
  ratingTrend: TrendDirection;
  /** Percentile within same function (0–1), based on avg rating across cycles. */
  ratingFunctionPercentile: number | null;

  /** True if the person has any GitHub activity in the window. */
  isEngineer: boolean;
  impactTotal: number | null;
  /** (recent 3 months) / (prior 3 months), so -0.25 = 25% drop. null if insufficient data. */
  impactTrend: number | null;
  impactTrendDirection: TrendDirection | null;
  /** Percentile of total impact within the company's engineer cohort (0–1). */
  impactCompanyPercentile: number | null;

  /** Squad (from Current FTEs join — available on SlackMemberRow). */
  squad: string | null;
  pillar: string | null;

  /** Raised when the member meets any alert criterion. */
  alerts: Alert[];
}

export type AlertKind =
  | "engagement_bottom_quartile"
  | "rating_dropped"
  | "rating_bottom_quartile"
  | "impact_trending_down";

export interface Alert {
  kind: AlertKind;
  message: string;
}

export interface TeamPerformance {
  managerEmail: string;
  rows: TeamMemberRow[];
  /** Count of reports with ≥1 alert. */
  alertingCount: number;
  /** Company-wide cohort sizes used for percentile context. */
  cohortSizes: {
    slackByFunction: Record<string, number>;
    ratingsByFunction: Record<string, number>;
    impactCompany: number;
  };
  windowStart: Date | null;
  windowEnd: Date | null;
}

/** -0.25 → a 25% drop from prior 3m to recent 3m. */
const IMPACT_TREND_RED_THRESHOLD = -0.25;

const DAY_MS = 86_400_000;

function percentileOf(value: number, allSorted: number[]): number | null {
  if (allSorted.length === 0) return null;
  // lower bound (first index >= value)
  let lo = 0;
  let hi = allSorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (allSorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  // average-rank style: account for ties
  let hi2 = allSorted.length;
  let lo2 = 0;
  while (lo2 < hi2) {
    const mid = (lo2 + hi2) >>> 1;
    if (allSorted[mid]! <= value) lo2 = mid + 1;
    else hi2 = mid;
  }
  const avgRank = (lo + lo2 - 1) / 2;
  return allSorted.length > 1 ? avgRank / (allSorted.length - 1) : 0;
}

function trendFromRatio(ratio: number | null): TrendDirection | null {
  if (ratio === null) return null;
  if (ratio <= IMPACT_TREND_RED_THRESHOLD) return "down";
  if (ratio >= 0.1) return "up";
  return "flat";
}

function ratingTrendFrom(
  latest: number | null,
  prior: number | null,
): TrendDirection {
  if (latest === null || prior === null) return "flat";
  if (latest < prior) return "down";
  if (latest > prior) return "up";
  return "flat";
}

/**
 * Build a team-performance snapshot for a given manager email. Reuses the
 * latest Slack snapshot, Mode performance data, and a window-scoped GitHub
 * aggregation; computes percentiles within each person's function as the
 * relative-comparison cohort.
 */
export async function getTeamPerformance(
  managerEmail: string,
  reports: ManagerReport[],
): Promise<TeamPerformance> {
  const lowerReports = reports.map((r) => ({
    ...r,
    email: r.email.toLowerCase(),
  }));
  const reportEmails = new Set(lowerReports.map((r) => r.email));

  const [slackSnap, perfData] = await Promise.all([
    getLatestSlackMembersSnapshot(),
    getPerformanceData().catch(() => null),
  ]);

  // Map all slack rows by email for percentile cohort computations
  const slackByEmail = new Map<string, SlackMemberRow>();
  if (slackSnap) {
    for (const r of slackSnap.rows) {
      if (r.employeeEmail) slackByEmail.set(r.employeeEmail, r);
    }
  }

  // Engagement cohort by function (non-service, non-deactivated, non-guest,
  // score > 0). Matches the ranking population used in the composite.
  const slackEngagementByFunction = new Map<string, number[]>();
  const allSlackEngagement: number[] = [];
  if (slackSnap) {
    for (const r of slackSnap.rows) {
      if (r.isGuest || r.isDeactivated || r.isServiceAccount) continue;
      if (r.engagementScore === 0) continue;
      const func = r.function ?? "Unknown";
      const arr = slackEngagementByFunction.get(func) ?? [];
      arr.push(r.engagementScore);
      slackEngagementByFunction.set(func, arr);
      allSlackEngagement.push(r.engagementScore);
    }
    for (const arr of slackEngagementByFunction.values()) arr.sort((a, b) => a - b);
    allSlackEngagement.sort((a, b) => a - b);
  }

  // Rating cohort by function: average rating across cycles per person
  const ratingByEmail = new Map<
    string,
    { latest: number | null; prior: number | null; avg: number | null; name: string; func: string }
  >();
  if (perfData) {
    for (const p of perfData.people) {
      const rated = p.ratings.filter((r) => r.rating !== null);
      if (rated.length === 0) continue;
      const avg = rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length;
      const latest = rated[rated.length - 1]?.rating ?? null;
      const prior =
        rated.length >= 2 ? rated[rated.length - 2]?.rating ?? null : null;
      ratingByEmail.set(p.email.toLowerCase(), {
        latest,
        prior,
        avg,
        name: p.name,
        func: (p.function as string) || "Unknown",
      });
    }
  }
  const ratingAvgByFunction = new Map<string, number[]>();
  for (const e of ratingByEmail.values()) {
    if (e.avg === null) continue;
    const arr = ratingAvgByFunction.get(e.func) ?? [];
    arr.push(e.avg);
    ratingAvgByFunction.set(e.func, arr);
  }
  for (const arr of ratingAvgByFunction.values()) arr.sort((a, b) => a - b);

  // Engineering impact cohort, scoped to the Slack window (or last 12mo fallback).
  // Trend compares two equal-length 90-day windows: the most recent 90 days
  // ("recent") against the 90 days immediately before that ("prior"). Earlier
  // history (beyond 180 days) is still included in `total` for the absolute
  // score, but doesn't affect the trend calculation.
  const now = new Date();
  const windowStart = slackSnap?.windowStart ?? new Date(now.getTime() - 365 * DAY_MS);
  const windowEnd = slackSnap?.windowEnd ?? now;
  const recentStart = new Date(windowEnd.getTime() - 90 * DAY_MS);
  const priorStart = new Date(windowEnd.getTime() - 180 * DAY_MS);

  const impactRows = await db.execute<{
    email: string | null;
    login: string;
    total_impact: number;
    recent_impact: number;
    prior_impact: number;
  }>(sql`
    WITH monthly AS (
      SELECT
        date_trunc('month', ${githubPrs.mergedAt})::date AS month,
        ${githubPrs.authorLogin} AS author_login,
        COUNT(*)::int AS prs,
        COALESCE(SUM(${githubPrs.additions} + ${githubPrs.deletions}), 0)::bigint AS lines
      FROM ${githubPrs}
      LEFT JOIN ${githubEmployeeMap} ON ${githubEmployeeMap.githubLogin} = ${githubPrs.authorLogin}
      WHERE ${githubPrs.mergedAt} >= ${windowStart.toISOString()}
        AND ${githubPrs.mergedAt} < ${windowEnd.toISOString()}
        AND COALESCE(${githubEmployeeMap.isBot}, false) = false
      GROUP BY 1, 2
    ),
    scored AS (
      SELECT
        month,
        author_login,
        ROUND(prs * LOG(2.0, 1.0 + lines::numeric / prs))::int AS impact
      FROM monthly
    )
    SELECT
      gem.employee_email AS email,
      s.author_login AS login,
      SUM(s.impact)::int AS total_impact,
      SUM(CASE WHEN s.month >= ${recentStart.toISOString()} THEN s.impact ELSE 0 END)::int AS recent_impact,
      SUM(CASE WHEN s.month >= ${priorStart.toISOString()} AND s.month < ${recentStart.toISOString()} THEN s.impact ELSE 0 END)::int AS prior_impact
    FROM scored s
    LEFT JOIN ${githubEmployeeMap} gem ON gem.github_login = s.author_login
    GROUP BY 1, 2
  `);

  interface ImpactRow {
    email: string | null;
    login: string;
    total: number;
    recent: number;
    prior: number;
  }
  const impactByEmail = new Map<string, ImpactRow>();
  const allImpact: number[] = [];
  for (const r of impactRows) {
    const row: ImpactRow = {
      email: r.email ? r.email.toLowerCase() : null,
      login: r.login,
      total: Number(r.total_impact) || 0,
      recent: Number(r.recent_impact) || 0,
      prior: Number(r.prior_impact) || 0,
    };
    if (row.email) impactByEmail.set(row.email, row);
    if (row.total > 0) allImpact.push(row.total);
  }
  allImpact.sort((a, b) => a - b);

  // Build per-report rows
  const rows: TeamMemberRow[] = lowerReports.map((report) => {
    const slack = slackByEmail.get(report.email) ?? null;
    const rating = ratingByEmail.get(report.email) ?? null;
    const impact = impactByEmail.get(report.email) ?? null;

    const func = report.function ?? rating?.func ?? slack?.function ?? "Unknown";
    const slackFnCohort = slackEngagementByFunction.get(func) ?? [];
    const ratingFnCohort = ratingAvgByFunction.get(func) ?? [];

    const slackEngagement = slack?.engagementScore ?? null;
    const slackFunctionPercentile =
      slackEngagement !== null && slackEngagement > 0
        ? percentileOf(slackEngagement, slackFnCohort)
        : null;

    const latestRating = rating?.latest ?? null;
    const priorRating = rating?.prior ?? null;
    const ratingFunctionPercentile =
      rating?.avg !== null && rating?.avg !== undefined
        ? percentileOf(rating.avg, ratingFnCohort)
        : null;
    const ratingTrend = ratingTrendFrom(latestRating, priorRating);

    const isEngineer = impact !== null && impact.total > 0;
    const impactTotal = impact?.total ?? null;
    const impactTrend =
      impact && impact.prior > 0
        ? (impact.recent - impact.prior) / impact.prior
        : null;
    const impactTrendDirection = trendFromRatio(impactTrend);
    const impactCompanyPercentile =
      impact && impact.total > 0 ? percentileOf(impact.total, allImpact) : null;

    const alerts: Alert[] = [];
    if (
      slackFunctionPercentile !== null &&
      slackFunctionPercentile <= 0.25
    ) {
      alerts.push({
        kind: "engagement_bottom_quartile",
        message: `Slack engagement in bottom 25% of ${func}`,
      });
    }
    if (
      latestRating !== null &&
      priorRating !== null &&
      latestRating < priorRating
    ) {
      alerts.push({
        kind: "rating_dropped",
        message: `Rating dropped from ${priorRating} to ${latestRating}`,
      });
    }
    if (
      ratingFunctionPercentile !== null &&
      ratingFunctionPercentile <= 0.25
    ) {
      alerts.push({
        kind: "rating_bottom_quartile",
        message: `Average rating in bottom 25% of ${func}`,
      });
    }
    if (
      impactTrendDirection === "down" &&
      impactTrend !== null &&
      impact !== null &&
      impact.prior > 50 // suppress noisy micro-drops for low-volume contributors
    ) {
      alerts.push({
        kind: "impact_trending_down",
        message: `Impact dropped ${Math.round(Math.abs(impactTrend) * 100)}% vs prior 3 months`,
      });
    }

    return {
      email: report.email,
      name: report.name,
      jobTitle: report.jobTitle,
      function: func,
      level: report.level,
      startDate: report.startDate,
      slackEngagement,
      slackFunctionPercentile,
      slackUserId: slack?.slackUserId ?? null,
      latestRating,
      priorRating,
      ratingTrend,
      ratingFunctionPercentile,
      isEngineer,
      impactTotal,
      impactTrend,
      impactTrendDirection,
      impactCompanyPercentile,
      squad: slack?.squad ?? null,
      pillar: slack?.pillar ?? report.pillar,
      alerts,
    };
  });

  const cohortSizes = {
    slackByFunction: Object.fromEntries(
      Array.from(slackEngagementByFunction.entries()).map(([k, v]) => [k, v.length]),
    ),
    ratingsByFunction: Object.fromEntries(
      Array.from(ratingAvgByFunction.entries()).map(([k, v]) => [k, v.length]),
    ),
    impactCompany: allImpact.length,
  };

  return {
    managerEmail: managerEmail.toLowerCase(),
    rows,
    alertingCount: rows.filter((r) => r.alerts.length > 0).length,
    cohortSizes,
    windowStart: slackSnap?.windowStart ?? null,
    windowEnd: slackSnap?.windowEnd ?? null,
  };
}

