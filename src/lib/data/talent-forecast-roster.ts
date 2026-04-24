// Bottom-up roster forecast — TP direct output only.
//
// Motivation: the team-level trend model weights every past month equally,
// including contributions from TPs who've since left, sourcers who got
// attribution, and ramp-up months of people who'd just joined. When the CEO
// asks "what will my Talent Partners deliver next month?" they want a
// forecast rooted in the *current roster's current productivity*, not in
// who-attributed-what 18 months ago.
//
// This module implements:
//   - Tenure estimation per TP (first-hire-month proxy, since HR start dates
//     aren't wired in yet).
//   - Post-ramp windowing (drop first N months per TP to strip ramp-up noise).
//   - Per-TP forecasting via EWMA (half-life 3 months) over post-ramp history
//     — weights recent months heavily, adapts as productivity shifts.
//   - Team aggregation = Σ per-TP EWMA productivity. NO non-roster gap:
//     sourcer-, manager-, and departed-TP-attributed hires are intentionally
//     excluded because Lucy doesn't own them and they don't reflect the
//     current roster's capacity.
//
// The model is domain-constrained by design: if Lucy's roster wouldn't ramp
// further, the forecast doesn't either. If a new TP joins, the forecast grows
// when they come out of ramp — not before.

import { addMonths } from "./talent-utils";
import type { MonthlyHires, RecruiterHistory } from "./talent-utils";

export const DEFAULT_RAMP_MONTHS = 2;
export const DEFAULT_MIN_POST_RAMP_MONTHS = 3;
export const DEFAULT_EWMA_HALF_LIFE_MONTHS = 3;

export interface TpProductivityProfile {
  recruiter: string;
  firstHireMonth: string | null;
  tenureMonths: number;
  postRampMonths: number;
  /** EWMA over post-ramp monthly hires (half-life = 3 months by default).
   *  Captures recent shifts in productivity — if a TP's output has cooled
   *  in the last quarter, EWMA reflects that quickly while still smoothing
   *  out single-month spikes. */
  productivity: number;
  /** Mean over all post-ramp months, for reference / display alongside. */
  postRampMean: number;
  /** Exponentially-weighted standard deviation — paired scale estimate. */
  productivityStd: number;
  /** True if this TP has >= minPostRampMonths of post-ramp data. */
  eligible: boolean;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Exponentially-weighted mean over a time-ordered series `xs` (oldest →
 * newest). Half-life `h` months: the point h months ago carries half the
 * weight of the most recent observation.
 */
function ewmaMean(xs: number[], halfLifeMonths: number): number {
  if (xs.length === 0) return 0;
  const lambda = Math.log(2) / halfLifeMonths;
  let weightSum = 0;
  let weightedSum = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = Math.exp(-lambda * (xs.length - 1 - i));
    weightSum += w;
    weightedSum += w * xs[i];
  }
  return weightSum === 0 ? 0 : weightedSum / weightSum;
}

/** Exponentially-weighted std dev paired with `ewmaMean`. */
function ewmaStd(xs: number[], halfLifeMonths: number): number {
  if (xs.length < 2) return 0;
  const mu = ewmaMean(xs, halfLifeMonths);
  const lambda = Math.log(2) / halfLifeMonths;
  let weightSum = 0;
  let weightedSq = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = Math.exp(-lambda * (xs.length - 1 - i));
    weightSum += w;
    weightedSq += w * (xs[i] - mu) ** 2;
  }
  return weightSum === 0 ? 0 : Math.sqrt(weightedSq / weightSum);
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
  /** EWMA half-life in months. Default 3 — ~quarterly responsiveness. */
  ewmaHalfLifeMonths?: number;
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
  const halfLife = options.ewmaHalfLifeMonths ?? DEFAULT_EWMA_HALF_LIFE_MONTHS;
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
    productivity: ewmaMean(postRampHires, halfLife),
    postRampMean: mean(postRampHires),
    productivityStd: ewmaStd(postRampHires, halfLife),
    eligible: postRamp.length >= minPostRamp,
  };
}

export interface RosterForecastOptions extends ProfileOptions {
  /** Z-score for the interval. Default: 1.28 (80% band). */
  zScore?: number;
}

export interface RosterForecastResult {
  forecast: { month: string; low: number; mid: number; high: number }[];
  contributors: TpProductivityProfile[];
  /** Sum of per-TP EWMA productivity = point forecast per month. */
  teamMeanMonthly: number;
  /** Aggregate scale: Σ per-TP EWMA std in quadrature. */
  teamSigmaMonthly: number;
}

/**
 * TP-only roster forecast.
 *
 * Point forecast each month = Σ per-TP EWMA productivity (half-life 3mo on
 * their post-ramp history). Flat projection: the domain prior is "current
 * roster doesn't ramp further." Hires from sourcers, managers, departed
 * TPs, and alias mismatches are intentionally excluded — they're not
 * reproducible output from today's roster.
 *
 * Eligible TPs (≥minPostRampMonths post-ramp months): EWMA uses their full
 * post-ramp history with half-life decay toward recent.
 * Ineligible TPs (still in ramp): contribute their partial post-ramp EWMA
 * if they have any data, else 0.
 *
 * 80% interval is z × √(Σ per-TP σ²). Between-TP independence is assumed
 * (slight under-estimate when market conditions shift everyone together).
 */
export function forecastFromRoster(
  histories: RecruiterHistory[],
  activeRecruiters: string[],
  startMonth: string,
  throughMonth: string,
  options: RosterForecastOptions = {},
): RosterForecastResult {
  const z = options.zScore ?? 1.28;

  const byName = new Map(histories.map((h) => [h.recruiter, h]));
  const contributors = activeRecruiters.map((recruiter) =>
    profileTp(
      byName.get(recruiter) ?? { recruiter, monthly: [] },
      options,
    ),
  );

  const teamMean = contributors.reduce((s, c) => s + c.productivity, 0);
  const teamVar = contributors.reduce(
    (s, c) => s + c.productivityStd ** 2,
    0,
  );
  const teamStd = Math.sqrt(teamVar);
  const halfWidth = z * teamStd;

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
      low: Math.max(0, teamMean - halfWidth),
      mid: teamMean,
      high: teamMean + halfWidth,
    });
    cursor = addMonths(cursor, 1);
  }

  return {
    forecast,
    contributors,
    teamMeanMonthly: teamMean,
    teamSigmaMonthly: teamStd,
  };
}
