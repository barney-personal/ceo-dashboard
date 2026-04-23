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
import type { MonthlyHires } from "./talent-utils";

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
