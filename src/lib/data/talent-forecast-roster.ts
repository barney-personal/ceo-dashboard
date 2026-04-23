// Bottom-up roster forecast.
//
// Motivation: the team-level trend model treats every past month equally,
// including contributions from TPs who've since left, sourcers who got
// attribution, and ramp-up months of people who'd just joined. When the CEO
// asks "what will next month look like?" they want a forecast rooted in the
// *current roster*, not in what the team looked like 18 months ago.
//
// This module implements:
//   - Tenure estimation per TP (first-hire-month proxy, since HR start dates
//     aren't wired in yet).
//   - Post-ramp windowing (drop first N months per TP to strip ramp-up noise).
//   - Per-TP forecasting (trailing-mean or EWMA of post-ramp history).
//   - Team aggregation = Σ per-TP forecast + a "non-roster" gap that captures
//     historically-observed hires attributed to sourcers, managers, and
//     recently-departed TPs.
//
// The model is domain-constrained by design: if Lucy's roster wouldn't ramp
// further, the forecast doesn't either. If a new TP joins, the forecast grows
// when they come out of ramp — not before.

import { addMonths } from "./talent-utils";
import type { MonthlyHires, RecruiterHistory } from "./talent-utils";

export const DEFAULT_RAMP_MONTHS = 2;
export const DEFAULT_MIN_POST_RAMP_MONTHS = 3;

export interface TpProductivityProfile {
  recruiter: string;
  firstHireMonth: string | null;
  tenureMonths: number;
  postRampMonths: number;
  /** Median of post-ramp history. Robust to one-off spikes; chosen by
   *  per-TP backtest as the best point estimator (MAE 1.43 @ h=1, nearly
   *  unbiased). See scripts/backtest-per-tp.ts. */
  median: number;
  /** Mean over all post-ramp months, for reference / display. */
  postRampMean: number;
  /** MAD-based scale estimate ≈ σ under Gaussian assumptions. */
  madScale: number;
  /** True if this TP has >= minPostRampMonths of post-ramp data. */
  eligible: boolean;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
/** MAD scaled to ≈ σ under Gaussian assumptions. Robust scale estimator. */
function madScaled(xs: number[]): number {
  if (xs.length < 2) return 0;
  const med = median(xs);
  const absDev = xs.map((x) => Math.abs(x - med));
  return 1.4826 * median(absDev);
}

/**
 * Derive a post-ramp subseries from a TP's full zero-filled monthly history.
 * "Tenure start" ≈ first month with hires > 0 (proxy, since we don't have
 * HR start dates). We drop `rampMonths` entries after that to strip
 * ramp-up noise.
 */
export function postRampSlice(
  monthly: MonthlyHires[],
  rampMonths: number,
  upToMonthExclusive?: string,
): MonthlyHires[] {
  if (monthly.length === 0) return [];
  const clipped = upToMonthExclusive
    ? monthly.filter((m) => m.month < upToMonthExclusive)
    : monthly;
  const firstHireIdx = clipped.findIndex((m) => m.hires > 0);
  if (firstHireIdx === -1) return [];
  return clipped.slice(firstHireIdx + rampMonths);
}

export interface ProfileOptions {
  rampMonths?: number;
  minPostRampMonths?: number;
  /** If set, treat this YYYY-MM as the in-progress current month and exclude
   *  it from all profile calculations. */
  currentMonth?: string;
}

export function profileTp(
  history: RecruiterHistory,
  options: ProfileOptions = {},
): TpProductivityProfile {
  const rampMonths = options.rampMonths ?? DEFAULT_RAMP_MONTHS;
  const minPostRamp =
    options.minPostRampMonths ?? DEFAULT_MIN_POST_RAMP_MONTHS;
  const currentMonth = options.currentMonth;

  const completed = currentMonth
    ? history.monthly.filter((m) => m.month !== currentMonth)
    : history.monthly;
  const firstHireIdx = completed.findIndex((m) => m.hires > 0);
  const firstHireMonth =
    firstHireIdx === -1 ? null : completed[firstHireIdx].month;
  const tenure =
    firstHireIdx === -1 ? 0 : completed.length - firstHireIdx;
  const postRamp =
    firstHireIdx === -1 ? [] : completed.slice(firstHireIdx + rampMonths);
  const postRampHires = postRamp.map((m) => m.hires);

  return {
    recruiter: history.recruiter,
    firstHireMonth,
    tenureMonths: tenure,
    postRampMonths: postRamp.length,
    median: median(postRampHires),
    postRampMean: mean(postRampHires),
    madScale: madScaled(postRampHires),
    eligible: postRamp.length >= minPostRamp,
  };
}

export interface RosterForecastOptions extends ProfileOptions {
  /** Calibration window for the non-roster gap (team total − Σ active TP). */
  gapWindowMonths?: number;
  /** Z-score for the interval. Default: 1.28 (80% band). */
  zScore?: number;
}

export interface RosterForecastResult {
  forecast: { month: string; low: number; mid: number; high: number }[];
  contributors: TpProductivityProfile[];
  /** Historical median of (team total − Σ active TP contributions) over the
   *  calibration window. Captures hires attributable to sourcers, managers,
   *  and TPs not in the active roster. Projected flat forward. */
  nonRosterGap: number;
  /** MAD scale of the non-roster gap. */
  nonRosterGapScale: number;
  /** Sum of per-TP medians + non-roster gap = point forecast per month. */
  teamMeanMonthly: number;
  /** Aggregate scale combining per-TP MAD with non-roster gap MAD in
   *  quadrature. */
  teamSigmaMonthly: number;
}

/**
 * Roster-anchored forecast.
 *
 * Point forecast for each future month = Σ active-TP post-ramp medians +
 * non-roster gap. Median chosen over mean by per-TP backtest — more robust
 * to the occasional 12-hire spike month. Forecast is flat by design: the
 * domain prior (from the CEO) is "current roster won't ramp further."
 *
 * Eligible TPs (≥3 post-ramp months): contribute their post-ramp median.
 * Ineligible TPs (still in ramp): contribute median of whatever post-ramp
 * data they have — zero if they haven't got past month 2 of tenure. This
 * is conservative but honest: we can't predict what a TP will do before
 * they've done anything.
 *
 * 80% interval is z·σ where σ combines per-TP MAD and gap MAD in quadrature
 * (independence assumption across TPs; documented in methodology).
 */
export function forecastFromRoster(
  histories: RecruiterHistory[],
  activeRecruiters: string[],
  startMonth: string,
  throughMonth: string,
  options: RosterForecastOptions = {},
): RosterForecastResult {
  const gapWindow = options.gapWindowMonths ?? 6;
  const z = options.zScore ?? 1.28;

  const byName = new Map(histories.map((h) => [h.recruiter, h]));
  const contributors = activeRecruiters.map((recruiter) =>
    profileTp(
      byName.get(recruiter) ?? { recruiter, monthly: [] },
      options,
    ),
  );

  // Team median-sum: each TP contributes their post-ramp median. Ramp-phase
  // TPs with 0 post-ramp months contribute 0 (honest about uncertainty).
  const teamMedianSum = contributors.reduce((s, c) => s + c.median, 0);
  // Aggregate scale in quadrature — acceptable for small-team CIs; between-
  // TP correlation would widen this slightly.
  const teamVarMonthly = contributors.reduce(
    (s, c) => s + c.madScale ** 2,
    0,
  );

  // Non-roster gap calibration. At each of the recent `gapWindow` months we
  // compute (team total − Σ active-roster-TP hires). The residual captures:
  //   - departed TPs who still had hires in that month before leaving,
  //   - sourcers / hiring managers attributed a hire,
  //   - ramp-period hires from currently-active TPs (they're part of the
  //     team total but aren't captured by post-ramp contributions),
  //   - alias mismatches.
  // Using the MEDIAN of the gap series instead of the mean keeps it robust.
  const activeSet = new Set(activeRecruiters);
  const allMonths: string[] = [];
  {
    const seen = new Set<string>();
    for (const h of histories) for (const m of h.monthly) seen.add(m.month);
    allMonths.push(...[...seen].sort());
  }
  // Exclude the current partial month from the gap calibration.
  const calibrationMonths = options.currentMonth
    ? allMonths.filter((m) => m !== options.currentMonth)
    : allMonths;
  const recentMonths = calibrationMonths.slice(-gapWindow);
  const gapResiduals: number[] = [];
  for (const month of recentMonths) {
    let teamTotal = 0;
    let activeTotal = 0;
    for (const h of histories) {
      const m = h.monthly.find((x) => x.month === month);
      if (!m) continue;
      teamTotal += m.hires;
      if (activeSet.has(h.recruiter)) activeTotal += m.hires;
    }
    gapResiduals.push(teamTotal - activeTotal);
  }
  const nonRosterGap = median(gapResiduals);
  const nonRosterGapScale = madScaled(gapResiduals);

  const combinedMean = teamMedianSum + nonRosterGap;
  const combinedVar = teamVarMonthly + nonRosterGapScale ** 2;
  const combinedStd = Math.sqrt(combinedVar);
  const halfWidth = z * combinedStd;

  const forecast: {
    month: string;
    low: number;
    mid: number;
    high: number;
  }[] = [];
  let cursor = startMonth;
  while (cursor <= throughMonth) {
    forecast.push({
      month: cursor,
      low: Math.max(0, combinedMean - halfWidth),
      mid: combinedMean,
      high: combinedMean + halfWidth,
    });
    cursor = addMonths(cursor, 1);
  }

  return {
    forecast,
    contributors,
    nonRosterGap,
    nonRosterGapScale,
    teamMeanMonthly: combinedMean,
    teamSigmaMonthly: combinedStd,
  };
}
