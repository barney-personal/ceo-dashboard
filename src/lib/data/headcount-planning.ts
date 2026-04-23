// Headcount planning = hires forecast - churn forecast, rolled forward
// month by month.
//
// Model:
//   HC(t+k) = Σ_{currentFTEs} [ S(tenure_i + k) / S(tenure_i) ]
//           + Σ_{h=1..k} hires(h) × S(k - h)
// where S(t) is the empirical survival function: the probability an FTE is
// still at the company t months after starting, estimated by Kaplan-Meier
// from all historical FTEs (terminated + right-censored at their current
// tenure for still-active employees).
//
// Why KM and not a flat attrition rate?
//   - Attrition is strongly tenure-dependent (early-tenure churn dominates),
//     so a single annualised rate systematically mis-predicts both the
//     first year (too low) and long-tenured retention (too low too — many
//     people plateau).
//   - KM uses ALL data, including currently-employed FTEs (censored), which
//     doubles our effective sample vs only counting leavers.
//   - It drops out as the right mathematical object: future headcount is
//     literally Σ P(still-employed-at-t) summed across everyone.
//
// Uncertainty:
//   - Hire forecast carries its own P10/P50/P90 from the roster-anchored
//     model (see forecastFromRoster).
//   - We apply the three hire scenarios to the same point-estimate survival
//     curve. This under-represents retention sampling error but is fine
//     for a horizon-length the retention data actually supports.

import { addMonths } from "./talent-utils";
import type { Employee, RetentionCohort } from "./attrition-utils";

const DAYS_PER_MONTH = 30.44;

export interface SurvivalCurve {
  /** S(t) for tenure t in months. Length = months + 1. S[0] = 1. */
  survival: number[];
  /** n_t at each tenure — useful for interval estimation + diagnostics. */
  atRisk: number[];
  /** d_t at each tenure. */
  events: number[];
  /** Months beyond which the curve is extrapolated by carry-forward. */
  extrapolationCutoff: number;
  /** Total FTE observations used to fit. */
  n: number;
}

export interface HeadcountForecastOptions {
  /** If provided, use these three hire scenarios instead of a point
   *  estimate. Each is hires-per-month applied flat across the horizon. */
  hireScenarios?: { low: number; mid: number; high: number };
  /** Point-estimate hires per month. Used if hireScenarios not provided. */
  hiresPerMonth?: number;
  /** Reference date for "today". Defaults to new Date(). */
  asOf?: Date;
  /** Maximum months for survival curve lookup. Default: 120. */
  maxTenureMonths?: number;
  /** If provided, use this pre-built curve instead of fitting KM on the
   *  Employee list. The caller is responsible for providing a curve with
   *  at least `maxTenureMonths + 1` entries. */
  survivalCurve?: SurvivalCurve;
}

export interface MonthlyHeadcount {
  month: string;
  /** Low scenario: headcount under the P10 hire forecast. */
  low: number;
  /** Mid scenario: headcount under the P50 hire forecast. */
  mid: number;
  /** High scenario: headcount under the P90 hire forecast. */
  high: number;
  /** Expected hires in this month (from the forecast, mid scenario). */
  hires: number;
  /** Expected departures in this month (mid scenario). */
  departures: number;
  /** Net change in headcount this month (hires - departures, mid). */
  netChange: number;
}

export interface HeadcountProjection {
  /** Actual historical monthly headcount, one entry per month from the
   *  earliest hire to the last completed month. */
  actual: { month: string; headcount: number }[];
  /** Projected monthly headcount through the target end month. */
  projection: MonthlyHeadcount[];
  /** Starting headcount used for the projection. */
  startingHeadcount: number;
  /** The survival curve that drove the projection. */
  survivalCurve: SurvivalCurve;
  /** For reference: the hire scenarios used. */
  hireScenarios: { low: number; mid: number; high: number };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function tenureMonths(startDate: string, endDate: Date): number {
  const start = new Date(startDate);
  if (!Number.isFinite(start.getTime())) return 0;
  return Math.max(
    0,
    Math.floor((endDate.getTime() - start.getTime()) / (DAYS_PER_MONTH * 86400000)),
  );
}

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Kaplan-Meier survival curve
// ---------------------------------------------------------------------------

/**
 * Kaplan-Meier survival function from FTE tenure data.
 *
 * Each employee contributes (observedTenure, eventFlag):
 *   - eventFlag = true: terminated → their tenure is when they left
 *   - eventFlag = false: right-censored → their tenure is how long they've
 *     been at the company so far
 *
 * S(0) = 1. For t >= 1:
 *   S(t) = S(t-1) × (1 - d_t / n_t)
 * where n_t = # at risk at start of month t (tenure ≥ t-1), and
 *       d_t = # events exactly at tenure t.
 *
 * For months beyond the max observed tenure, we carry the last estimate
 * forward (flat extrapolation). Because retention curves flatten at long
 * tenures this is a reasonable prior; for a very long forecast horizon it
 * would be worth replacing with a parametric tail.
 */
export function buildSurvivalCurve(
  employees: Employee[],
  options: { asOf?: Date; maxMonths?: number } = {},
): SurvivalCurve {
  const asOf = options.asOf ?? new Date();
  const maxMonths = options.maxMonths ?? 120;

  const observations: { tenure: number; event: boolean }[] = [];
  for (const emp of employees) {
    const start = new Date(emp.startDate);
    if (!Number.isFinite(start.getTime())) continue;
    const endDate = emp.terminationDate ? new Date(emp.terminationDate) : asOf;
    if (!Number.isFinite(endDate.getTime())) continue;
    // Skip employees whose termination date is in the future (garden leave
    // with a known end — they're still at risk right now).
    if (emp.terminationDate && endDate > asOf) {
      observations.push({ tenure: tenureMonths(emp.startDate, asOf), event: false });
      continue;
    }
    const t = Math.max(0, Math.floor((endDate.getTime() - start.getTime()) / (DAYS_PER_MONTH * 86400000)));
    observations.push({ tenure: t, event: emp.terminationDate !== null });
  }

  const survival = new Array(maxMonths + 1).fill(1);
  const atRisk = new Array(maxMonths + 1).fill(0);
  const events = new Array(maxMonths + 1).fill(0);
  let extrapolationCutoff = 0;

  for (let t = 1; t <= maxMonths; t++) {
    const n_t = observations.filter((o) => o.tenure >= t - 1).length;
    const d_t = observations.filter((o) => o.event && o.tenure === t).length;
    atRisk[t] = n_t;
    events[t] = d_t;
    if (n_t === 0) {
      survival[t] = survival[t - 1];
    } else {
      survival[t] = survival[t - 1] * (1 - d_t / n_t);
      extrapolationCutoff = t;
    }
  }

  return {
    survival,
    atRisk,
    events,
    extrapolationCutoff,
    n: observations.length,
  };
}

// ---------------------------------------------------------------------------
// Recency-weighted Kaplan-Meier
// ---------------------------------------------------------------------------

/**
 * Kaplan-Meier survival function with exponential time-decay weights on
 * events. An event that happened `monthsAgo` months before `asOf`
 * contributes weight `exp(-λ × monthsAgo)` with `λ = ln(2)/halfLifeMonths`,
 * so a half-life of 12 months means events a year ago count half as much
 * as events this month.
 *
 * Combines the best of pooled KM (monthly tenure granularity, 965-obs
 * sample, correct censoring) with the regime-tracking of Mode's rolling
 * window. In stable regimes it converges to pooled KM; in shifting
 * regimes it follows the current hazard while keeping older data as a
 * weak prior to reduce variance.
 *
 * The survival update is the standard weighted KM:
 *   S(t) = S(t-1) × (1 − Σw_i·1[event_i=1, tenure_i=t]
 *                      / Σw_j·1[tenure_j ≥ t-1])
 */
export function buildSurvivalCurveRecencyWeighted(
  employees: Employee[],
  options: {
    asOf?: Date;
    maxMonths?: number;
    halfLifeMonths?: number;
  } = {},
): SurvivalCurve {
  const asOf = options.asOf ?? new Date();
  const maxMonths = options.maxMonths ?? 120;
  const halfLife = options.halfLifeMonths ?? 12;
  const lambda = Math.log(2) / halfLife;

  // Per-tenure risk / event weight accumulators. We weight by the calendar
  // date at which each person was AT the given tenure — so an employee
  // currently at tenure 30 contributes recent weight for tenure 30, but
  // far-past weight for tenure 3 (when they were at tenure 3 three years
  // ago). This is the statistically correct time-decay KM; a one-weight-
  // per-observation approach biases the hazard because censored obs count
  // at full weight at every tenure they passed, regardless of when.
  const atRisk = new Array(maxMonths + 1).fill(0);
  const events = new Array(maxMonths + 1).fill(0);

  for (const emp of employees) {
    const start = new Date(emp.startDate);
    if (!Number.isFinite(start.getTime())) continue;

    let endDate: Date;
    let hasEvent: boolean;
    if (emp.terminationDate) {
      const term = new Date(emp.terminationDate);
      if (!Number.isFinite(term.getTime())) continue;
      if (term > asOf) {
        endDate = asOf;
        hasEvent = false;
      } else {
        endDate = term;
        hasEvent = true;
      }
    } else {
      endDate = asOf;
      hasEvent = false;
    }

    const lastTenure = Math.max(
      0,
      Math.floor(
        (endDate.getTime() - start.getTime()) / (DAYS_PER_MONTH * 86400000),
      ),
    );

    // For each tenure t they reached: they were at risk during month
    // `start + t`. Weight by recency of that calendar month.
    for (let t = 1; t <= Math.min(lastTenure, maxMonths); t++) {
      const calDate = new Date(start.getTime());
      calDate.setUTCMonth(calDate.getUTCMonth() + t);
      const monthsAgo = Math.max(
        0,
        (asOf.getTime() - calDate.getTime()) / (DAYS_PER_MONTH * 86400000),
      );
      const w = Math.exp(-lambda * monthsAgo);
      atRisk[t] += w;
      if (hasEvent && t === lastTenure) {
        events[t] += w;
      }
    }
  }

  const survival = new Array(maxMonths + 1).fill(1);
  let extrapolationCutoff = 0;

  for (let t = 1; t <= maxMonths; t++) {
    if (atRisk[t] === 0) {
      survival[t] = survival[t - 1];
    } else {
      survival[t] = survival[t - 1] * (1 - events[t] / atRisk[t]);
      extrapolationCutoff = t;
    }
  }

  return {
    survival,
    atRisk,
    events,
    extrapolationCutoff,
    n: employees.length,
  };
}

// ---------------------------------------------------------------------------
// Mode rolling-12m survival curve
// ---------------------------------------------------------------------------

export interface RollingAttritionRates {
  /** Annual attrition rate for employees with <1yr tenure (from Mode
   *  rolling-12m: leavers L12m in <1yr bucket / avg HC L12m in <1yr). */
  under1yrAnnual: number;
  /** Annual attrition rate for employees with >1yr tenure. */
  over1yrAnnual: number;
}

/**
 * Build a piecewise-constant survival curve from the tenure-bucketed annual
 * attrition rates that Lucy's team uses directly from Mode. Tenure months
 * 0–11 use the <1yr hazard; month 12 onwards uses the >1yr hazard. This
 * matches the team's methodology so the resulting headcount forecast lines
 * up with theirs.
 *
 * Annual rate `a` → monthly hazard `h = 1 − (1−a)^(1/12)` (compound).
 * S(t) = Π_{i=1..t} (1 − h_i).
 */
export function buildSurvivalFromRollingRates(
  rates: RollingAttritionRates,
  options: { maxMonths?: number } = {},
): SurvivalCurve {
  const maxMonths = options.maxMonths ?? 120;
  const under1 = Math.max(0, Math.min(1, rates.under1yrAnnual));
  const over1 = Math.max(0, Math.min(1, rates.over1yrAnnual));
  const hazardUnder = 1 - Math.pow(1 - under1, 1 / 12);
  const hazardOver = 1 - Math.pow(1 - over1, 1 / 12);
  const survival = new Array(maxMonths + 1).fill(1);
  for (let t = 1; t <= maxMonths; t++) {
    const h = t <= 12 ? hazardUnder : hazardOver;
    survival[t] = survival[t - 1] * (1 - h);
  }
  return {
    survival,
    atRisk: new Array(maxMonths + 1).fill(0),
    events: new Array(maxMonths + 1).fill(0),
    extrapolationCutoff: maxMonths,
    n: 0,
  };
}

// ---------------------------------------------------------------------------
// Backtest: evaluate survival curves on held-out monthly exits
// ---------------------------------------------------------------------------

export interface BacktestMetrics {
  /** Mean absolute error in exits/month across held-out months. */
  mae: number;
  /** Mean signed error (positive = over-predicts exits). */
  bias: number;
  /** Number of held-out months evaluated. */
  n: number;
}

function activeAtMonthStart(
  employees: Employee[],
  month: string,
): { tenure: number }[] {
  const [y, m] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const out: { tenure: number }[] = [];
  for (const e of employees) {
    const start = new Date(e.startDate);
    if (!Number.isFinite(start.getTime()) || start > monthStart) continue;
    if (e.terminationDate) {
      const term = new Date(e.terminationDate);
      if (!Number.isFinite(term.getTime()) || term < monthStart) continue;
    }
    const tenure = Math.max(
      0,
      Math.floor(
        (monthStart.getTime() - start.getTime()) /
          (DAYS_PER_MONTH * 86400000),
      ),
    );
    out.push({ tenure });
  }
  return out;
}

function exitsInMonth(employees: Employee[], month: string): number {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  let count = 0;
  for (const e of employees) {
    if (!e.terminationDate) continue;
    const t = new Date(e.terminationDate);
    if (!Number.isFinite(t.getTime())) continue;
    if (t >= start && t <= end) count += 1;
  }
  return count;
}

function predictExitsFromCurve(
  active: { tenure: number }[],
  curve: SurvivalCurve,
): number {
  const last = curve.survival.length - 1;
  let sum = 0;
  for (const a of active) {
    const tNow = Math.min(Math.max(a.tenure, 0), last);
    const tNext = Math.min(a.tenure + 1, last);
    const sNow = curve.survival[tNow];
    const sNext = curve.survival[tNext];
    if (sNow > 0) sum += 1 - sNext / sNow;
  }
  return sum;
}

/**
 * Rolling-origin backtest on a survival curve: for each of the last
 * `nCutoffs` months, fit the curve as-of that cutoff using `buildCurve`,
 * then predict exits for the following `horizonMonths` months and compare
 * to actuals. Returns MAE, bias, and n.
 */
export function backtestCurve(
  employees: Employee[],
  buildCurve: (asOf: Date) => SurvivalCurve,
  options: {
    cutoffsMonthsBack?: number[];
    horizonMonths?: number;
    asOf?: Date;
  } = {},
): BacktestMetrics {
  const asOf = options.asOf ?? new Date();
  const cutoffs = options.cutoffsMonthsBack ?? [3, 6, 9, 12, 15];
  const horizon = options.horizonMonths ?? 3;
  const curMonthStart = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1),
  );
  const errors: number[] = [];
  let biasSum = 0;

  for (const monthsBack of cutoffs) {
    const cutoff = new Date(curMonthStart.getTime());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsBack);
    const curve = buildCurve(cutoff);
    for (let i = 0; i < horizon; i++) {
      const d = new Date(cutoff.getTime());
      d.setUTCMonth(d.getUTCMonth() + i);
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const active = activeAtMonthStart(employees, month);
      const actual = exitsInMonth(employees, month);
      const pred = predictExitsFromCurve(active, curve);
      errors.push(Math.abs(pred - actual));
      biasSum += pred - actual;
    }
  }
  const n = errors.length;
  return {
    mae: n > 0 ? errors.reduce((s, x) => s + x, 0) / n : NaN,
    bias: n > 0 ? biasSum / n : NaN,
    n,
  };
}

// ---------------------------------------------------------------------------
// Historical headcount (actuals)
// ---------------------------------------------------------------------------

/**
 * Monthly FTE headcount across history, from each employee's start and
 * termination dates. Month m's headcount = # employees with start <= m
 * and (terminationDate is null OR terminationDate >= m+1). Employees who
 * leave during a month are counted in that month (they were present for
 * some of it).
 */
export function buildHistoricalHeadcount(
  employees: Employee[],
  options: { fromMonth?: string; toMonth?: string } = {},
): { month: string; headcount: number }[] {
  if (employees.length === 0) return [];
  const starts = employees
    .map((e) => new Date(e.startDate))
    .filter((d) => Number.isFinite(d.getTime()));
  if (starts.length === 0) return [];
  const earliest = new Date(Math.min(...starts.map((d) => d.getTime())));
  const from = options.fromMonth ?? monthKey(earliest);
  const to = options.toMonth ?? monthKey(new Date());

  const out: { month: string; headcount: number }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const [y, m] = cursor.split("-").map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0)); // last day of month
    let active = 0;
    for (const emp of employees) {
      const start = new Date(emp.startDate);
      if (!Number.isFinite(start.getTime())) continue;
      if (start > monthEnd) continue;
      if (emp.terminationDate) {
        const term = new Date(emp.terminationDate);
        if (!Number.isFinite(term.getTime())) continue;
        if (term < monthStart) continue;
      }
      active++;
    }
    out.push({ month: cursor, headcount: active });
    cursor = addMonths(cursor, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projection — the headline function
// ---------------------------------------------------------------------------

/**
 * Project monthly FTE headcount forward through `throughMonth`.
 *
 * Each currently-active FTE contributes a survival-weighted term based on
 * their current tenure: if they're at tenure 18 today, their contribution
 * 12 months from now is S(30) / S(18).
 *
 * Each month's predicted hires add a new cohort that decays by S(k) over
 * the months since hire.
 *
 * Three parallel trajectories come from the low/mid/high hire scenarios.
 */
export function projectHeadcount(
  employees: Employee[],
  throughMonth: string,
  options: HeadcountForecastOptions = {},
): HeadcountProjection {
  const asOf = options.asOf ?? new Date();
  const maxMonths = options.maxTenureMonths ?? 120;
  const curve =
    options.survivalCurve ??
    buildSurvivalCurve(employees, { asOf, maxMonths });

  const scenarios = options.hireScenarios ?? {
    low: options.hiresPerMonth ?? 0,
    mid: options.hiresPerMonth ?? 0,
    high: options.hiresPerMonth ?? 0,
  };

  // Starting set: employees currently still at the company.
  const activeNow = employees.filter((e) => {
    if (!e.terminationDate) return true;
    const t = new Date(e.terminationDate);
    return Number.isFinite(t.getTime()) && t > asOf;
  });
  const currentTenures = activeNow
    .map((e) => tenureMonths(e.startDate, asOf))
    .filter((t) => Number.isFinite(t) && t >= 0);
  const startingHeadcount = currentTenures.length;

  // Generate forecast months.
  const startMonth = addMonths(monthKey(asOf), 1);
  const months: string[] = [];
  let cursor = startMonth;
  while (cursor <= throughMonth) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  // For each future month k (1-indexed offset from now):
  //   survivalOfCurrent(k) = Σ_i S(tenure_i + k) / S(tenure_i)
  //   contributionOfNewHires(k) = Σ_{h=1..k} hires × S(k - h)
  function clampIdx(t: number): number {
    return Math.min(Math.max(t, 0), curve.survival.length - 1);
  }
  function S(t: number): number {
    return curve.survival[clampIdx(t)];
  }

  function projectFor(hiresPerMonth: number): MonthlyHeadcount[] {
    const out: MonthlyHeadcount[] = [];
    // Sum from current FTEs (reusable across months with closed-form recurrence
    // but simpler here to recompute — N×H is small).
    for (let k = 1; k <= months.length; k++) {
      let surviving = 0;
      for (const tNow of currentTenures) {
        const denom = S(tNow);
        if (denom <= 0) continue;
        surviving += S(tNow + k) / denom;
      }
      // New hires over h=1..k: hired at month h, tenure k-h at target month.
      let newJoiners = 0;
      for (let h = 1; h <= k; h++) {
        newJoiners += hiresPerMonth * S(k - h);
      }
      const hc = surviving + newJoiners;
      const prevHc =
        out.length === 0 ? startingHeadcount : out[out.length - 1].mid;
      const hires = hiresPerMonth;
      const netChange = hc - prevHc;
      const departures = hires - netChange;
      out.push({
        month: months[k - 1],
        low: hc,
        mid: hc,
        high: hc,
        hires,
        departures,
        netChange,
      });
    }
    return out;
  }

  const lowRun = projectFor(scenarios.low);
  const midRun = projectFor(scenarios.mid);
  const highRun = projectFor(scenarios.high);
  const projection: MonthlyHeadcount[] = midRun.map((m, i) => ({
    month: m.month,
    low: lowRun[i].mid,
    mid: m.mid,
    high: highRun[i].mid,
    hires: m.hires,
    departures: m.departures,
    netChange: m.netChange,
  }));

  const actual = buildHistoricalHeadcount(employees, {
    toMonth: monthKey(asOf),
  });

  return {
    actual,
    projection,
    startingHeadcount,
    survivalCurve: curve,
    hireScenarios: scenarios,
  };
}

// ---------------------------------------------------------------------------
// Cohort-based projection — the "consumer-app DAU" approach
// ---------------------------------------------------------------------------
//
// Instead of pooling all FTE tenure data into one KM curve, each hiring cohort
// carries its own observed retention. For future months we use:
//   - each cohort's OBSERVED retention at their current age (anchor),
//   - then decay forward using the pooled KM hazard (reverts to average).
//
// Why bother? The KM forecast is optimal if retention is stationary across
// cohorts. If recent cohorts churn faster or slower than historical average,
// cohort-based projection captures that; KM doesn't. Cross-comparing the two
// flags a non-stationarity you'd otherwise miss.
//
// For future hires (cohorts that don't exist yet) we fall back to the pooled
// KM curve — we have no cohort-specific data for them.

export interface CohortProjectionResult {
  /** Same shape as KM projection for drop-in comparison. */
  projection: MonthlyHeadcount[];
  startingHeadcount: number;
  /** Per-cohort breakdown — what each contributes to HC at today. */
  cohortBreakdown: {
    cohort: string;
    cohortSize: number;
    ageMonths: number;
    observedRetention: number;
    currentContribution: number;
  }[];
  /** Stationarity check: retention at common ages across cohorts. If the
   *  values drift substantially over time, the pooled KM is mis-specified. */
  stationarityByAge: {
    ageMonths: number;
    byCohort: { cohort: string; retention: number; cohortSize: number }[];
  }[];
  hireScenarios: { low: number; mid: number; high: number };
}

function parseQuarterKey(key: string): Date | null {
  const m = key.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  return new Date(Date.UTC(year, (q - 1) * 3, 1));
}

/**
 * Cohort-anchored projection: each existing cohort's contribution is pinned
 * to its observed retention; future retention drift applies the pooled
 * KM hazard. New-hire cohorts use pooled KM throughout.
 *
 * If `currentQuarterEmployees` is provided, those (employees who joined in
 * the current quarter and are therefore excluded from the quarterly cohort
 * build) are counted at 100% retention so today's cohort-based headcount
 * matches today's active-FTE count. Without this, cohort-based HC is low
 * by the size of the current-quarter cohort.
 */
export function projectFromCohorts(
  cohorts: RetentionCohort[],
  survivalCurve: SurvivalCurve,
  throughMonth: string,
  options: HeadcountForecastOptions & {
    currentQuarterActiveCount?: number;
  } = {},
): CohortProjectionResult {
  const asOf = options.asOf ?? new Date();
  const scenarios = options.hireScenarios ?? {
    low: options.hiresPerMonth ?? 0,
    mid: options.hiresPerMonth ?? 0,
    high: options.hiresPerMonth ?? 0,
  };

  const S = (t: number) => {
    const idx = Math.min(
      Math.max(Math.round(t), 0),
      survivalCurve.survival.length - 1,
    );
    return survivalCurve.survival[idx];
  };

  // Build per-cohort anchors. Each cohort's anchor = observed retention at
  // its latest quarterly snapshot. Because today's age may be further along
  // than the last snapshot (cohort data is quarterly, today is a specific
  // day), we forward-decay from the anchor to today's age using the pooled
  // hazard. This way the cohort-based "today" headcount is comparable to
  // actual active-FTE count.
  const cohortAnchors = cohorts
    .map((c) => {
      const start = parseQuarterKey(c.cohort);
      if (!start) return null;
      const ageMonths = Math.max(
        0,
        Math.floor((asOf.getTime() - start.getTime()) / (DAYS_PER_MONTH * 86400000)),
      );
      // Latest observed quarterly retention — filter nulls.
      let lastIdx = c.periods.length - 1;
      while (lastIdx >= 0 && c.periods[lastIdx] === null) lastIdx--;
      if (lastIdx < 0) return null;
      const observedRetention = c.periods[lastIdx] as number;
      const anchorAgeMonths = lastIdx * 3;
      // Decay from anchor age to current age using pooled hazard.
      const anchorDenom = S(anchorAgeMonths);
      const currentAgeDecay =
        anchorDenom > 0 ? S(ageMonths) / anchorDenom : 1;
      const currentContribution =
        c.cohortSize * observedRetention * currentAgeDecay;
      return {
        cohort: c.cohort,
        cohortSize: c.cohortSize,
        ageMonths,
        anchorAgeMonths,
        observedRetention,
        currentContribution,
      };
    })
    .filter(
      (v): v is NonNullable<typeof v> => v !== null,
    );

  const currentQuarterCount = options.currentQuarterActiveCount ?? 0;
  const startingHeadcount =
    cohortAnchors.reduce((s, c) => s + c.currentContribution, 0) +
    currentQuarterCount;

  const startMonth = addMonths(
    `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}`,
    1,
  );
  const months: string[] = [];
  let cursor = startMonth;
  while (cursor <= throughMonth) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  function projectForScenario(hiresPerMonth: number): MonthlyHeadcount[] {
    const out: MonthlyHeadcount[] = [];
    for (let k = 1; k <= months.length; k++) {
      // Existing-cohort contribution at month offset k (forward-decayed
      // from their observed quarterly anchor using pooled hazard).
      let fromCohorts = 0;
      for (const c of cohortAnchors) {
        const futureAge = c.ageMonths + k;
        const anchor = c.anchorAgeMonths;
        const denom = S(anchor);
        if (denom <= 0) continue;
        fromCohorts += c.cohortSize * c.observedRetention * (S(futureAge) / denom);
      }
      // Current-quarter joiners: anchored at 100% retention today (age ~
      // 1-3 months), forward-decayed by pooled hazard. Approximate their
      // current age at 1 month (midpoint of the current quarter).
      const currentQuarterAge = 1;
      const cqDenom = S(currentQuarterAge);
      const fromCurrentQuarter =
        cqDenom > 0
          ? currentQuarterCount * (S(currentQuarterAge + k) / cqDenom)
          : 0;
      // New-hire contribution uses pooled survival from each month of hire.
      let fromNewHires = 0;
      for (let h = 1; h <= k; h++) {
        fromNewHires += hiresPerMonth * S(k - h);
      }
      const hc = fromCohorts + fromCurrentQuarter + fromNewHires;
      const prevHc = out.length === 0 ? startingHeadcount : out[out.length - 1].mid;
      const netChange = hc - prevHc;
      out.push({
        month: months[k - 1],
        low: hc,
        mid: hc,
        high: hc,
        hires: hiresPerMonth,
        departures: hiresPerMonth - netChange,
        netChange,
      });
    }
    return out;
  }

  const low = projectForScenario(scenarios.low);
  const mid = projectForScenario(scenarios.mid);
  const high = projectForScenario(scenarios.high);
  const projection: MonthlyHeadcount[] = mid.map((m, i) => ({
    month: m.month,
    low: low[i].mid,
    mid: m.mid,
    high: high[i].mid,
    hires: m.hires,
    departures: m.departures,
    netChange: m.netChange,
  }));

  // Stationarity diagnostic: at common tenure ages, compare cohort
  // retentions side by side. Drift is the signal.
  const diagnosticAges = [3, 6, 9, 12, 15, 18];
  const stationarityByAge = diagnosticAges.map((ageMonths) => {
    const q = ageMonths / 3;
    return {
      ageMonths,
      byCohort: cohorts
        .map((c) => {
          const ret = c.periods[q];
          if (ret == null) return null;
          return {
            cohort: c.cohort,
            retention: ret,
            cohortSize: c.cohortSize,
          };
        })
        .filter(
          (v): v is { cohort: string; retention: number; cohortSize: number } =>
            v !== null,
        ),
    };
  });

  return {
    projection,
    startingHeadcount,
    cohortBreakdown: cohortAnchors,
    stationarityByAge,
    hireScenarios: scenarios,
  };
}
