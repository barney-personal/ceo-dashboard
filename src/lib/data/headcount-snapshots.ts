// Persist + retrieve monthly forecast snapshots so we can track how well
// our live forecast does against actuals as months elapse.
//
// Capture is idempotent per calendar month — first page-load of each month
// writes; subsequent loads no-op. No cron needed; the page itself is the
// trigger. If no one visits for a month we silently miss that snapshot,
// which is acceptable for a leadership dashboard.

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { headcountForecastSnapshots } from "@/lib/db/schema";
import type { MonthlyHeadcount } from "./headcount-planning";

export interface SnapshotInput {
  asOfMonth: string; // YYYY-MM
  startingHeadcount: number;
  hireScenarios: { low: number; mid: number; high: number };
  attritionRates: { under1yrAnnual: number; over1yrAnnual: number };
  projection: MonthlyHeadcount[];
}

export interface HeadcountForecastSnapshot extends SnapshotInput {
  id: number;
  capturedAt: Date;
}

function currentMonthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * If no snapshot exists for the current calendar month, persist one.
 * Idempotent — safe to call on every page load.
 */
export async function captureIfNeeded(input: SnapshotInput): Promise<{
  captured: boolean;
  asOfMonth: string;
}> {
  const existing = await db
    .select({ id: headcountForecastSnapshots.id })
    .from(headcountForecastSnapshots)
    .where(eq(headcountForecastSnapshots.asOfMonth, input.asOfMonth))
    .limit(1);
  if (existing.length > 0) {
    return { captured: false, asOfMonth: input.asOfMonth };
  }
  try {
    await db.insert(headcountForecastSnapshots).values({
      asOfMonth: input.asOfMonth,
      startingHeadcount: input.startingHeadcount,
      hireScenarios: input.hireScenarios,
      attritionRates: input.attritionRates,
      projection: input.projection,
    });
    return { captured: true, asOfMonth: input.asOfMonth };
  } catch (err) {
    // Unique constraint could race between check and insert — treat as
    // already-captured rather than surfacing an error to the page.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return { captured: false, asOfMonth: input.asOfMonth };
    }
    throw err;
  }
}

/** Fetch recent snapshots, newest first. Use for accuracy comparisons. */
export async function getRecentSnapshots(
  limit: number = 24,
): Promise<HeadcountForecastSnapshot[]> {
  const rows = await db
    .select()
    .from(headcountForecastSnapshots)
    .orderBy(desc(headcountForecastSnapshots.asOfMonth))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    asOfMonth: r.asOfMonth,
    capturedAt: r.capturedAt,
    startingHeadcount: r.startingHeadcount,
    hireScenarios: r.hireScenarios as SnapshotInput["hireScenarios"],
    attritionRates: r.attritionRates as SnapshotInput["attritionRates"],
    projection: r.projection as MonthlyHeadcount[],
  }));
}

/** Convenience — cheapest path to retrieve a single calendar month. */
export async function getSnapshotForMonth(
  month: string,
): Promise<HeadcountForecastSnapshot | null> {
  const rows = await db
    .select()
    .from(headcountForecastSnapshots)
    .where(eq(headcountForecastSnapshots.asOfMonth, month))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    asOfMonth: r.asOfMonth,
    capturedAt: r.capturedAt,
    startingHeadcount: r.startingHeadcount,
    hireScenarios: r.hireScenarios as SnapshotInput["hireScenarios"],
    attritionRates: r.attritionRates as SnapshotInput["attritionRates"],
    projection: r.projection as MonthlyHeadcount[],
  };
}

// ---------------------------------------------------------------------------
// Accuracy: compare snapshots' past forecasts to now-known actuals.
// ---------------------------------------------------------------------------

export interface ForecastHit {
  /** The target calendar month (YYYY-MM) that was forecasted and now has
   *  known actual HC. */
  targetMonth: string;
  /** Snapshot it came from (the as-of month that produced the forecast). */
  fromAsOfMonth: string;
  /** How many months ahead was this forecast when captured? */
  horizonMonths: number;
  /** P50 HC from the forecast, for the target month. */
  forecastedMid: number;
  /** P10 / P90 from the same forecast. */
  forecastedLow: number;
  forecastedHigh: number;
  /** Actual HC for the target month. */
  actual: number;
  /** actual − forecastedMid. Positive = reality exceeded forecast. */
  error: number;
  /** Whether actual fell within the P10–P90 band. */
  inBand: boolean;
}

export interface ForecastAccuracy {
  /** One hit per (snapshot, target) pair where target is now known. */
  hits: ForecastHit[];
  /** Latest snapshot in the DB; useful for "forecast captured X" label. */
  latestSnapshot: HeadcountForecastSnapshot | null;
  /** Aggregate MAE of the live forecast vs actuals across all hits. */
  mae: number | null;
  /** Aggregate bias (mean signed error). */
  bias: number | null;
  /** Fraction of hits where actual fell inside the P10–P90 band. Target: 0.8. */
  coverage80: number | null;
  /** Count of hits used in the metrics. */
  nHits: number;
}

/**
 * Compare every snapshot's projection to the now-known actuals from
 * `actualsByMonth`. For each target month that has both (a) an actual value
 * and (b) at least one snapshot that forecasted it, produce a ForecastHit.
 * Later snapshots overwrite earlier ones at the same target — we keep the
 * earliest, so "forecasted 6mo ahead" beats "forecasted 1mo ahead" for
 * accuracy-tracking purposes.
 *
 * If multiple horizons are desired, downstream callers can group by
 * `horizonMonths` themselves.
 */
export function computeForecastAccuracy(
  snapshots: HeadcountForecastSnapshot[],
  actualsByMonth: Map<string, number>,
): ForecastAccuracy {
  const hits: ForecastHit[] = [];
  for (const snap of snapshots) {
    for (const forecast of snap.projection) {
      const actual = actualsByMonth.get(forecast.month);
      if (actual == null) continue;
      const horizon = monthsBetween(snap.asOfMonth, forecast.month);
      if (horizon <= 0) continue;
      hits.push({
        targetMonth: forecast.month,
        fromAsOfMonth: snap.asOfMonth,
        horizonMonths: horizon,
        forecastedMid: forecast.mid,
        forecastedLow: forecast.low,
        forecastedHigh: forecast.high,
        actual,
        error: actual - forecast.mid,
        inBand: actual >= forecast.low && actual <= forecast.high,
      });
    }
  }
  if (hits.length === 0) {
    return {
      hits: [],
      latestSnapshot: snapshots[0] ?? null,
      mae: null,
      bias: null,
      coverage80: null,
      nHits: 0,
    };
  }
  const mae =
    hits.reduce((s, h) => s + Math.abs(h.error), 0) / hits.length;
  const bias = hits.reduce((s, h) => s + h.error, 0) / hits.length;
  const coverage80 =
    hits.reduce((s, h) => s + (h.inBand ? 1 : 0), 0) / hits.length;
  return {
    hits,
    latestSnapshot: snapshots[0] ?? null,
    mae,
    bias,
    coverage80,
    nHits: hits.length,
  };
}

function monthsBetween(fromYyyyMm: string, toYyyyMm: string): number {
  const [fy, fm] = fromYyyyMm.split("-").map(Number);
  const [ty, tm] = toYyyyMm.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export const _internals = { currentMonthKey, monthsBetween };
