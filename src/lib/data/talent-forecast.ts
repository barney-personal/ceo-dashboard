// Hire forecast model for the talent dashboard.
//
// Approach: linear regression (OLS) on the last N complete months of
// team-total monthly hires. Point estimate is the trend line; bounds are
// the standard prediction interval ±1.28·SE (≈ 80% coverage). SE grows with
// horizon because of the `(x - x̄)²` term in the prediction formula —
// uncertainty widens the further out we project.
//
// Deliberate simplifications:
//  - We don't model seasonality. Three years of data with one Sep-2025 dip
//    isn't enough to fit a reliable 12-month cycle; the residual σ captures
//    the variance instead.
//  - We fit on last N months only. Using all history would flatten the
//    trend as the team scales; the last year reflects current capacity.
//  - We don't cap by recruiter capacity. The team is hiring at ~40/mo with
//    ~17 active TPs; extrapolation past 60/mo would require capacity
//    modelling we're choosing not to do yet.
//
// Present both the number AND the assumption to the user so they can calibrate.

import { addMonths } from "./talent-utils";
import type { MonthlyHires, RecruiterHistory } from "./talent-utils";

function monthDelta(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export interface MonthlyForecast {
  month: string; // YYYY-MM
  /** P10 — ~10% chance of being this low or lower. */
  low: number;
  /** P50 — the trend-line projection; most likely value. */
  mid: number;
  /** P90 — ~10% chance of being this high or higher. */
  high: number;
}

export interface ForecastModelFit {
  /** Slope in hires-per-month added each month. */
  slopePerMonth: number;
  /** Value at t=0 in the training window (first month of the fit). */
  intercept: number;
  /** Residual standard deviation of the fit, σ. */
  sigma: number;
  /** Number of training months used. */
  trainingMonths: number;
  /** First and last month of the training window. */
  trainingWindow: { from: string; to: string };
}

export interface ForecastResult {
  forecast: MonthlyForecast[];
  fit: ForecastModelFit | null;
}

export interface ForecastOptions {
  /** Training window — how many recent complete months to fit on. */
  trainingMonths?: number;
  /** Z-score for the prediction interval. Defaults to 1.28 (80% band). */
  zScore?: number;
  /**
   * If set, treat a final history entry matching this YYYY-MM as the
   * in-progress current month and exclude it from the fit; the forecast
   * still starts at the month after the last *observed* month (i.e. the
   * partial month is bridged by the dashed projection in the chart).
   */
  currentMonth?: string;
}

function fitLinearRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; sigma: number; meanX: number; sumXXdev: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let sumXXdev = 0;
  let sumXYdev = 0;
  for (let i = 0; i < n; i++) {
    sumXXdev += (xs[i] - meanX) ** 2;
    sumXYdev += (xs[i] - meanX) * (ys[i] - meanY);
  }
  if (sumXXdev === 0) return null; // all xs equal — shouldn't happen but guard

  const slope = sumXYdev / sumXXdev;
  const intercept = meanY - slope * meanX;

  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    sse += (ys[i] - pred) ** 2;
  }
  // Use n-2 degrees of freedom (slope + intercept).
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));

  return { slope, intercept, sigma, meanX, sumXXdev };
}

/**
 * Build the P10/P50/P90 forecast for a monthly team hires series from
 * `startMonth` (inclusive of the first projection, which is the month after
 * the last observed month) forward through `throughMonth` (inclusive).
 */
export function forecastTeamHires(
  history: MonthlyHires[],
  throughMonth: string,
  options: ForecastOptions = {},
): ForecastResult {
  const trainingMonths = options.trainingMonths ?? 12;
  const z = options.zScore ?? 1.28;
  const currentMonth = options.currentMonth;

  if (history.length === 0) return { forecast: [], fit: null };

  // Drop partial current month if flagged — we don't want it dragging the fit.
  const sorted = [...history].sort((a, b) => a.month.localeCompare(b.month));
  const last = sorted[sorted.length - 1];
  if (!last) return { forecast: [], fit: null };

  const completed =
    currentMonth && last.month === currentMonth ? sorted.slice(0, -1) : sorted;
  if (completed.length < 3) return { forecast: [], fit: null };

  const window = completed.slice(-trainingMonths);
  const xs = window.map((_, i) => i);
  const ys = window.map((m) => m.hires);
  const fit = fitLinearRegression(xs, ys);
  if (!fit) return { forecast: [], fit: null };

  // Forecast always starts the month after the last observed entry in history
  // — so when the final entry is a partial current month, the projection
  // picks up from next month and the chart keeps showing the partial actual
  // alongside it rather than overwriting it.
  const forecastStart = addMonths(last.month, 1);
  const windowFirstMonth = window[0].month;
  const result: MonthlyForecast[] = [];
  let cursor = forecastStart;
  while (cursor <= throughMonth) {
    // x is the month distance from the first training month, so even when
    // we've skipped a partial current month the forecast stays on the same
    // x-axis as the trend line.
    const x = monthDelta(windowFirstMonth, cursor);
    const mid = fit.slope * x + fit.intercept;
    // Standard prediction-interval formula for simple linear regression.
    const se =
      fit.sigma *
      Math.sqrt(
        1 + 1 / window.length + (x - fit.meanX) ** 2 / fit.sumXXdev,
      );
    const halfWidth = z * se;
    result.push({
      month: cursor,
      low: Math.max(0, mid - halfWidth),
      mid: Math.max(0, mid),
      high: mid + halfWidth,
    });
    cursor = addMonths(cursor, 1);
  }

  return {
    forecast: result,
    fit: {
      slopePerMonth: fit.slope,
      intercept: fit.intercept,
      sigma: fit.sigma,
      trainingMonths: window.length,
      trainingWindow: {
        from: window[0].month,
        to: window[window.length - 1].month,
      },
    },
  };
}

export interface MonthRange {
  from: string;
  to: string;
}

export interface CapacityForecastOptions {
  /** Window for the per-person mean hire rate (trailing). Default: 3. */
  productivityWindowMonths?: number;
  /** Window for the per-person σ estimate. Default: 6. */
  sigmaWindowMonths?: number;
  /** Z-score for the interval. Default: 1.28 (80%). */
  zScore?: number;
  /**
   * Current month (YYYY-MM) — the final month of each person's history is
   * treated as partial and excluded from their productivity/σ windows.
   */
  currentMonth?: string;
}

export interface CapacityForecastResult {
  forecast: MonthlyForecast[];
  /** Per-recruiter monthly mean + σ. Same length & order as the input
   *  `activeRecruiters` list; names that had no history produce zero. */
  contributors: Array<{
    recruiter: string;
    monthsOfHistory: number;
    meanMonthlyHires: number;
    sigmaMonthly: number;
  }>;
  /** The summed team mean hires per month (mid of each forecast row). */
  teamMeanMonthly: number;
  /** Team-level σ per month, √(Σ σ_i²) assuming per-recruiter independence. */
  teamSigmaMonthly: number;
}

/**
 * Forecast team hires by summing each currently-active recruiter's trailing
 * monthly hire rate, projected flat across the horizon.
 *
 * This is the "capacity-aware" alternative to team-level linear regression.
 * It answers the question *"what will hires look like if the 17 TPs Lucy has
 * today keep hiring at their recent individual velocities?"* — a
 * conservative counter-factual that strips out the capacity that walked out
 * the door.
 *
 * Trade-offs vs linear regression:
 *  - Captures the current roster exactly — no ghost capacity from departed
 *    TPs.
 *  - Trailing-3 per person naturally reflects ramp for newcomers and steady
 *    state for tenured TPs.
 *  - Doesn't capture broader trend — assumes individual productivity stays
 *    flat for the forecast horizon. For ramping new joiners whose last 3
 *    months understate their eventual ceiling, this is conservative.
 *  - σ assumes independence between recruiters, which inflates the band
 *    slightly when the team is small; acceptable for an 80% CI.
 */
export function forecastFromActiveCapacity(
  histories: RecruiterHistory[],
  activeRecruiters: string[],
  startMonth: string,
  throughMonth: string,
  options: CapacityForecastOptions = {},
): CapacityForecastResult {
  const productivityWindow = options.productivityWindowMonths ?? 3;
  const sigmaWindow = options.sigmaWindowMonths ?? 6;
  const z = options.zScore ?? 1.28;
  const currentMonth = options.currentMonth;

  const byRecruiter = new Map(histories.map((h) => [h.recruiter, h]));

  const contributors = activeRecruiters.map((recruiter) => {
    const history = byRecruiter.get(recruiter);
    if (!history || history.monthly.length === 0) {
      return {
        recruiter,
        monthsOfHistory: 0,
        meanMonthlyHires: 0,
        sigmaMonthly: 0,
      };
    }
    const last = history.monthly[history.monthly.length - 1];
    const completed =
      currentMonth && last?.month === currentMonth
        ? history.monthly.slice(0, -1)
        : history.monthly;

    const prodSlice = completed.slice(-productivityWindow);
    const meanMonthlyHires =
      prodSlice.length === 0
        ? 0
        : prodSlice.reduce((s, m) => s + m.hires, 0) / prodSlice.length;

    const sigmaSlice = completed.slice(-sigmaWindow);
    let sigmaMonthly = 0;
    if (sigmaSlice.length >= 2) {
      const mu =
        sigmaSlice.reduce((s, m) => s + m.hires, 0) / sigmaSlice.length;
      const variance =
        sigmaSlice.reduce((s, m) => s + (m.hires - mu) ** 2, 0) /
        (sigmaSlice.length - 1);
      sigmaMonthly = Math.sqrt(variance);
    }

    return {
      recruiter,
      monthsOfHistory: completed.length,
      meanMonthlyHires,
      sigmaMonthly,
    };
  });

  const teamMeanMonthly = contributors.reduce(
    (s, c) => s + c.meanMonthlyHires,
    0,
  );
  const teamSigmaMonthly = Math.sqrt(
    contributors.reduce((s, c) => s + c.sigmaMonthly ** 2, 0),
  );

  const forecast: MonthlyForecast[] = [];
  let cursor = startMonth;
  while (cursor <= throughMonth) {
    const halfWidth = z * teamSigmaMonthly;
    forecast.push({
      month: cursor,
      low: Math.max(0, teamMeanMonthly - halfWidth),
      mid: teamMeanMonthly,
      high: teamMeanMonthly + halfWidth,
    });
    cursor = addMonths(cursor, 1);
  }

  return {
    forecast,
    contributors,
    teamMeanMonthly,
    teamSigmaMonthly,
  };
}

/**
 * Sum a forecast band across a date range (inclusive). Returns null when the
 * range contains no forecast months.
 */
export function totalForecastOverRange(
  forecast: MonthlyForecast[],
  range: MonthRange,
): { low: number; mid: number; high: number } | null {
  const slice = forecast.filter(
    (m) => m.month >= range.from && m.month <= range.to,
  );
  if (slice.length === 0) return null;
  return {
    low: slice.reduce((s, m) => s + m.low, 0),
    mid: slice.reduce((s, m) => s + m.mid, 0),
    high: slice.reduce((s, m) => s + m.high, 0),
  };
}
