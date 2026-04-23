// Backtest the three candidate attrition models against actual monthly
// exits over a held-out window.
//
// Design:
//   1. Cutoff date = today − HOLDOUT months. Fit each candidate curve
//      on data available before the cutoff only.
//   2. For each month in the held-out window:
//      - Snapshot the active FTE set at month-start (tenures known from
//        Employee start/term dates).
//      - Predicted exits = Σ (1 − S(tenure+1)/S(tenure)) over active FTEs,
//        using each model's curve.
//      - Actual exits = count of terminations whose date falls in the month.
//   3. Report MAE, RMSE, bias per model across the held-out months.
//
// No hire rate needed — we're testing how well each curve predicts the
// exit count from a KNOWN active tenure mix, which isolates the survival
// curve's accuracy from every other assumption.
//
// Usage: doppler run -- npx tsx scripts/backtest-attrition-curves.ts

import { getAttritionData } from "@/lib/data/attrition";
import type { Employee } from "@/lib/data/attrition-utils";
import {
  buildSurvivalCurve,
  buildSurvivalCurveRecencyWeighted,
  buildSurvivalFromRollingRates,
  type SurvivalCurve,
} from "@/lib/data/headcount-planning";

const DAYS_PER_MONTH = 30.44;
const HOLDOUT_MONTHS = 6;
const MAX_TENURE_MONTHS = 120;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function monthEnd(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59));
}

function tenureMonthsAt(employee: Employee, at: Date): number {
  const start = new Date(employee.startDate);
  if (!Number.isFinite(start.getTime())) return 0;
  return Math.max(
    0,
    Math.floor((at.getTime() - start.getTime()) / (DAYS_PER_MONTH * 86400000)),
  );
}

function activeAtMonthStart(
  employees: Employee[],
  month: string,
): { employee: Employee; tenure: number }[] {
  const start = monthStart(month);
  return employees
    .filter((e) => {
      const empStart = new Date(e.startDate);
      if (!Number.isFinite(empStart.getTime()) || empStart > start) return false;
      if (e.terminationDate) {
        const term = new Date(e.terminationDate);
        if (!Number.isFinite(term.getTime())) return false;
        if (term < start) return false;
      }
      return true;
    })
    .map((e) => ({ employee: e, tenure: tenureMonthsAt(e, start) }));
}

function actualExitsInMonth(employees: Employee[], month: string): number {
  const start = monthStart(month);
  const end = monthEnd(month);
  return employees.filter((e) => {
    if (!e.terminationDate) return false;
    const t = new Date(e.terminationDate);
    if (!Number.isFinite(t.getTime())) return false;
    return t >= start && t <= end;
  }).length;
}

/** Predict total exits in a month given its starting-active set + curve. */
function predictExits(
  active: { tenure: number }[],
  curve: SurvivalCurve,
): number {
  const S = (t: number) =>
    curve.survival[Math.min(Math.max(t, 0), curve.survival.length - 1)];
  let sum = 0;
  for (const a of active) {
    const sNow = S(a.tenure);
    const sNext = S(a.tenure + 1);
    if (sNow > 0) sum += 1 - sNext / sNow;
  }
  return sum;
}

/**
 * Reconstruct Mode rolling-12m tenure rates from the Employee list as of a
 * given cutoff. Matches Mode's methodology: leavers in last 12m bucketed
 * by tenure-at-exit / average L12m headcount in that bucket.
 */
function computeRollingRatesAsOf(
  employees: Employee[],
  cutoff: Date,
): { under1yrAnnual: number; over1yrAnnual: number } {
  const windowStart = new Date(cutoff.getTime());
  windowStart.setUTCFullYear(windowStart.getUTCFullYear() - 1);
  // Leavers in L12m: those who terminated in [windowStart, cutoff).
  let sub1Leavers = 0;
  let over1Leavers = 0;
  for (const e of employees) {
    if (!e.terminationDate) continue;
    const term = new Date(e.terminationDate);
    if (!Number.isFinite(term.getTime())) continue;
    if (term < windowStart || term >= cutoff) continue;
    const tenureAtExit =
      (term.getTime() - new Date(e.startDate).getTime()) /
      (DAYS_PER_MONTH * 86400000);
    if (tenureAtExit < 12) sub1Leavers += 1;
    else over1Leavers += 1;
  }
  // Avg HC L12m by bucket: integrate monthly
  let sub1HcMonths = 0;
  let over1HcMonths = 0;
  const monthCount = 12;
  for (let i = 0; i < monthCount; i++) {
    const d = new Date(windowStart.getTime());
    d.setUTCMonth(d.getUTCMonth() + i);
    for (const e of employees) {
      const start = new Date(e.startDate);
      if (!Number.isFinite(start.getTime()) || start > d) continue;
      if (e.terminationDate) {
        const term = new Date(e.terminationDate);
        if (!Number.isFinite(term.getTime()) || term < d) continue;
      }
      const tenure = (d.getTime() - start.getTime()) / (DAYS_PER_MONTH * 86400000);
      if (tenure < 12) sub1HcMonths += 1;
      else over1HcMonths += 1;
    }
  }
  const avgSub1 = sub1HcMonths / monthCount;
  const avgOver1 = over1HcMonths / monthCount;
  return {
    under1yrAnnual: avgSub1 > 0 ? sub1Leavers / avgSub1 : 0,
    over1yrAnnual: avgOver1 > 0 ? over1Leavers / avgOver1 : 0,
  };
}

function runRollingOrigin(
  employees: Employee[],
  horizonMonths: number,
  cutoffsMonthsBack: number[],
): void {
  const now = new Date();
  const curMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const metrics: Record<string, { absErrs: number[]; biasSum: number; n: number }> = {};

  for (const monthsBack of cutoffsMonthsBack) {
    if (monthsBack < horizonMonths) continue; // not enough room for horizon
    const c = new Date(curMonthStart.getTime());
    c.setUTCMonth(c.getUTCMonth() - monthsBack);
    const km = buildSurvivalCurve(employees, {
      asOf: c,
      maxMonths: MAX_TENURE_MONTHS,
    });
    const modeRates = computeRollingRatesAsOf(employees, c);
    const mode = buildSurvivalFromRollingRates(modeRates, {
      maxMonths: MAX_TENURE_MONTHS,
    });
    const rw = [6, 9, 12, 18].map((hl) => ({
      label: `recencyKM(hl=${hl}mo)`,
      curve: buildSurvivalCurveRecencyWeighted(employees, {
        asOf: c,
        maxMonths: MAX_TENURE_MONTHS,
        halfLifeMonths: hl,
      }),
    }));
    const candidates: { label: string; curve: SurvivalCurve }[] = [
      { label: "Mode rolling-12m", curve: mode },
      { label: "Pooled KM", curve: km },
      ...rw,
    ];
    for (let i = 0; i < horizonMonths; i++) {
      const d = new Date(c.getTime());
      d.setUTCMonth(d.getUTCMonth() + i);
      const month = monthKey(d);
      const active = activeAtMonthStart(employees, month);
      const actualExits = actualExitsInMonth(employees, month);
      for (const cand of candidates) {
        const pred = predictExits(active, cand.curve);
        if (!metrics[cand.label]) {
          metrics[cand.label] = { absErrs: [], biasSum: 0, n: 0 };
        }
        metrics[cand.label].absErrs.push(Math.abs(pred - actualExits));
        metrics[cand.label].biasSum += pred - actualExits;
        metrics[cand.label].n += 1;
      }
    }
  }
  const sorted = Object.entries(metrics)
    .map(([label, m]) => ({
      label,
      mae: m.absErrs.reduce((s, x) => s + x, 0) / Math.max(1, m.absErrs.length),
      bias: m.biasSum / Math.max(1, m.n),
      n: m.n,
    }))
    .sort((a, b) => a.mae - b.mae);
  console.log(
    "  model".padEnd(24) +
      "MAE".padStart(7) +
      "bias".padStart(7) +
      "n obs".padStart(7),
  );
  for (const m of sorted) {
    console.log(
      "  " +
        m.label.padEnd(22) +
        m.mae.toFixed(2).padStart(7) +
        m.bias.toFixed(2).padStart(7) +
        m.n.toString().padStart(7),
    );
  }
}

async function main() {
  const { employees } = await getAttritionData();
  console.log(`Total FTE observations: ${employees.length}`);

  // Find the latest completed month in the data.
  const terminatedMonths = employees
    .map((e) => e.terminationDate)
    .filter((t): t is string => !!t)
    .map((t) => new Date(t))
    .filter((d) => Number.isFinite(d.getTime()));
  const latestTerm = new Date(
    Math.max(...terminatedMonths.map((d) => d.getTime())),
  );
  // Cutoff = start of held-out window (today − HOLDOUT months, snapped to
  // month start, then walk forward).
  const now = new Date();
  // Held-out window: last HOLDOUT completed months before current month.
  // E.g. if today is 2026-04-23, held-out = 2025-10 .. 2026-03.
  const curMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const heldOutStart = new Date(curMonthStart.getTime());
  heldOutStart.setUTCMonth(heldOutStart.getUTCMonth() - HOLDOUT_MONTHS);
  const heldOutMonths: string[] = [];
  for (let i = 0; i < HOLDOUT_MONTHS; i++) {
    const d = new Date(heldOutStart.getTime());
    d.setUTCMonth(d.getUTCMonth() + i);
    heldOutMonths.push(monthKey(d));
  }
  const cutoff = new Date(heldOutStart.getTime());
  console.log(`\nHeld-out months: ${heldOutMonths.join(", ")}`);
  console.log(`Cutoff (models fit only on data before): ${cutoff.toISOString()}`);
  console.log(`Latest termination in data: ${latestTerm.toISOString().slice(0, 10)}`);

  // Actual exits per held-out month (ground truth).
  const actual = heldOutMonths.map((m) => ({
    month: m,
    exits: actualExitsInMonth(employees, m),
  }));
  const totalActual = actual.reduce((s, r) => s + r.exits, 0);
  console.log(`\nActual exits in held-out window: ${totalActual} (avg ${(totalActual / HOLDOUT_MONTHS).toFixed(1)}/mo)`);
  for (const r of actual) {
    console.log(`  ${r.month}: ${r.exits}`);
  }

  // Fit each candidate curve as of `cutoff` — only use data available then.
  // Pooled KM.
  const kmCurve = buildSurvivalCurve(employees, {
    asOf: cutoff,
    maxMonths: MAX_TENURE_MONTHS,
  });
  // Recency-weighted KM with a few half-lives.
  const rwCurves = [6, 9, 12, 18].map((halfLifeMonths) => ({
    label: `recencyKM(hl=${halfLifeMonths}mo)`,
    curve: buildSurvivalCurveRecencyWeighted(employees, {
      asOf: cutoff,
      maxMonths: MAX_TENURE_MONTHS,
      halfLifeMonths,
    }),
  }));
  // Mode rolling-12m reconstructed at cutoff.
  const modeRates = computeRollingRatesAsOf(employees, cutoff);
  const modeCurve = buildSurvivalFromRollingRates(modeRates, {
    maxMonths: MAX_TENURE_MONTHS,
  });

  console.log(`\nMode rolling rates @ cutoff: <1yr=${(modeRates.under1yrAnnual * 100).toFixed(1)}% · >1yr=${(modeRates.over1yrAnnual * 100).toFixed(1)}%`);

  const candidates: { label: string; curve: SurvivalCurve }[] = [
    { label: "Mode rolling-12m", curve: modeCurve },
    { label: "Pooled KM", curve: kmCurve },
    ...rwCurves,
  ];

  console.log(`\n=== S(t) at key tenures (fit @ cutoff) ===`);
  console.log(
    "model".padEnd(22) +
      "S(3)".padStart(8) +
      "S(6)".padStart(8) +
      "S(12)".padStart(8) +
      "S(18)".padStart(8) +
      "S(24)".padStart(8) +
      "S(36)".padStart(8),
  );
  for (const { label, curve } of candidates) {
    const s = (t: number) => curve.survival[t].toFixed(3);
    console.log(
      label.padEnd(22) +
        s(3).padStart(8) +
        s(6).padStart(8) +
        s(12).padStart(8) +
        s(18).padStart(8) +
        s(24).padStart(8) +
        s(36).padStart(8),
    );
  }

  // Evaluate: for each model, predict exits in each held-out month.
  console.log(`\n=== Per-month predicted vs actual exits ===`);
  const headerCells = ["month".padEnd(9), "actual".padStart(7)].concat(
    candidates.map((c) => c.label.padStart(22)),
  );
  console.log(headerCells.join(" | "));
  const results: Record<string, number[]> = {};
  for (const c of candidates) results[c.label] = [];
  const actuals: number[] = [];

  for (const month of heldOutMonths) {
    const active = activeAtMonthStart(employees, month);
    const actualExits = actualExitsInMonth(employees, month);
    actuals.push(actualExits);
    const cells = [
      month.padEnd(9),
      actualExits.toString().padStart(7),
    ];
    for (const c of candidates) {
      const predicted = predictExits(active, c.curve);
      results[c.label].push(predicted);
      cells.push(`${predicted.toFixed(1).padStart(18)} (${(predicted - actualExits).toFixed(1).padStart(2)})`);
    }
    console.log(cells.join(" | "));
  }

  // Aggregate metrics per model.
  console.log(`\n=== Metrics (over ${HOLDOUT_MONTHS}mo held-out window) ===`);
  console.log(
    "model".padEnd(22) +
      "MAE".padStart(7) +
      "RMSE".padStart(7) +
      "bias".padStart(7) +
      "total pred".padStart(13) +
      "vs actual".padStart(12),
  );
  const totalsActual = actuals.reduce((s, x) => s + x, 0);

  const metrics = candidates.map((c) => {
    const preds = results[c.label];
    const errs = preds.map((p, i) => p - actuals[i]);
    const absErrs = errs.map(Math.abs);
    const mae = absErrs.reduce((s, x) => s + x, 0) / absErrs.length;
    const rmse = Math.sqrt(errs.reduce((s, x) => s + x * x, 0) / errs.length);
    const bias = errs.reduce((s, x) => s + x, 0) / errs.length;
    const totalPred = preds.reduce((s, x) => s + x, 0);
    return { label: c.label, mae, rmse, bias, totalPred };
  });
  metrics.sort((a, b) => a.mae - b.mae);
  for (const m of metrics) {
    console.log(
      m.label.padEnd(22) +
        m.mae.toFixed(2).padStart(7) +
        m.rmse.toFixed(2).padStart(7) +
        m.bias.toFixed(2).padStart(7) +
        m.totalPred.toFixed(1).padStart(13) +
        `${(m.totalPred - totalsActual >= 0 ? "+" : "")}${(m.totalPred - totalsActual).toFixed(1)}`.padStart(12),
    );
  }

  console.log(`\n=== Single-cutoff verdict ===`);
  const winner = metrics[0];
  console.log(`  Winner by MAE: ${winner.label} (MAE=${winner.mae.toFixed(2)})`);
  console.log(`  Runner-up: ${metrics[1].label} (MAE=${metrics[1].mae.toFixed(2)})`);

  // -----------------------------------------------------------------------
  // Rolling-origin robustness check at multiple horizons.
  // Mode rolling-12m has a short-horizon advantage: recent pre-cutoff months
  // are autocorrelated with the near-future target months. Testing 3/6/12
  // month horizons separates genuine predictive power from that
  // autocorrelation "trick".
  // -----------------------------------------------------------------------
  for (const horizonMonths of [3, 6, 12]) {
    console.log(`\n=== Rolling-origin at ${horizonMonths}-month horizon (5 cutoffs) ===`);
    runRollingOrigin(employees, horizonMonths, [3, 6, 9, 12, 15]);
  }
  console.log(`\n=== Rolling-origin at 3-month horizon (5 cutoffs) — headline ===`);
  const cutoffsMonthsBack = [3, 6, 9, 12, 15];
  const rollingMetrics: Record<
    string,
    { absErrs: number[]; biasSum: number; n: number }
  > = {};
  for (const c of candidates) {
    rollingMetrics[c.label] = { absErrs: [], biasSum: 0, n: 0 };
  }
  // Also track the different half-lives as-of each cutoff.
  for (const monthsBack of cutoffsMonthsBack) {
    const c = new Date(curMonthStart.getTime());
    c.setUTCMonth(c.getUTCMonth() - monthsBack);
    const months: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(c.getTime());
      d.setUTCMonth(d.getUTCMonth() + i);
      months.push(monthKey(d));
    }
    // Fit as of cutoff
    const km2 = buildSurvivalCurve(employees, { asOf: c, maxMonths: MAX_TENURE_MONTHS });
    const modeRates2 = computeRollingRatesAsOf(employees, c);
    const mode2 = buildSurvivalFromRollingRates(modeRates2, { maxMonths: MAX_TENURE_MONTHS });
    const rwCurves2 = [6, 9, 12, 18].map((hl) => ({
      label: `recencyKM(hl=${hl}mo)`,
      curve: buildSurvivalCurveRecencyWeighted(employees, {
        asOf: c,
        maxMonths: MAX_TENURE_MONTHS,
        halfLifeMonths: hl,
      }),
    }));
    const cutoffCandidates: { label: string; curve: SurvivalCurve }[] = [
      { label: "Mode rolling-12m", curve: mode2 },
      { label: "Pooled KM", curve: km2 },
      ...rwCurves2,
    ];
    for (const month of months) {
      const active = activeAtMonthStart(employees, month);
      const actualExits = actualExitsInMonth(employees, month);
      for (const cand of cutoffCandidates) {
        const pred = predictExits(active, cand.curve);
        rollingMetrics[cand.label].absErrs.push(Math.abs(pred - actualExits));
        rollingMetrics[cand.label].biasSum += pred - actualExits;
        rollingMetrics[cand.label].n += 1;
      }
    }
  }
  console.log(
    "model".padEnd(22) +
      "MAE".padStart(7) +
      "bias".padStart(7) +
      "n obs".padStart(7),
  );
  const rollingSorted = Object.entries(rollingMetrics)
    .map(([label, m]) => ({
      label,
      mae: m.absErrs.reduce((s, x) => s + x, 0) / m.absErrs.length,
      bias: m.biasSum / m.n,
      n: m.n,
    }))
    .sort((a, b) => a.mae - b.mae);
  for (const m of rollingSorted) {
    console.log(
      m.label.padEnd(22) +
        m.mae.toFixed(2).padStart(7) +
        m.bias.toFixed(2).padStart(7) +
        m.n.toString().padStart(7),
    );
  }

  console.log(`\n=== Final verdict ===`);
  const overallWinner = rollingSorted[0];
  console.log(
    `  Most accurate across 15 held-out months: ${overallWinner.label} (MAE=${overallWinner.mae.toFixed(2)}, bias=${overallWinner.bias.toFixed(2)})`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
