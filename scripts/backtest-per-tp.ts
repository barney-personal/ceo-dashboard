// Backtest the roster-anchored forecast against only currently-active TPs,
// respecting each TP's individual tenure and discounting their first 2 months.
//
// What's different from the team-total backtest:
//   - Training data at each historical month T includes only post-ramp data
//     from TPs who are STILL at Cleo today (excludes departed TPs).
//   - Actual at T+h includes only hires from those same TPs (not team total).
//   - Per-TP errors are summed to get team-level error.
//
// Usage: doppler run -- npx tsx scripts/backtest-per-tp.ts

import { getTalentData } from "@/lib/data/talent";
import {
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  currentMonthKey,
  addMonths,
} from "@/lib/data/talent-utils";
import {
  DEFAULT_RAMP_MONTHS,
  postRampSlice,
} from "@/lib/data/talent-forecast-roster";
import type { MonthlyHires } from "@/lib/data/talent-utils";

// ---- per-TP forecasting models (univariate on their own post-ramp series) ----

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

type TpForecaster = (postRampHistory: number[]) => number;

const tpModels: { name: string; f: TpForecaster }[] = [
  { name: "allPostRampMean", f: (h) => mean(h) },
  { name: "trailing3", f: (h) => mean(h.slice(-3)) },
  { name: "trailing6", f: (h) => mean(h.slice(-6)) },
  { name: "trailing9", f: (h) => mean(h.slice(-9)) },
  {
    name: "ewma_hl3",
    f: (h) => {
      if (h.length === 0) return 0;
      const lambda = Math.log(2) / 3;
      let w = 0, s = 0;
      for (let i = 0; i < h.length; i++) {
        const weight = Math.exp(-lambda * (h.length - 1 - i));
        w += weight;
        s += weight * h[i];
      }
      return w === 0 ? 0 : s / w;
    },
  },
  {
    name: "median",
    f: (h) => {
      if (h.length === 0) return 0;
      const s = [...h].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
    },
  },
];

interface PerTpCut {
  tp: string;
  originMonth: string;
  horizon: number;
  train: number[];
  actual: number; // at origin + horizon
}

async function main() {
  const data = await getTalentData();
  const histories = aggregateHiresByRecruiterMonth(data.hireRows);
  const now = currentMonthKey();

  const summaries = buildRecruiterSummaries(
    histories,
    data.targets,
    now,
    data.employmentByRecruiter,
  );
  const activeTps = summaries
    .filter(
      (s) => s.employment.status !== "departed" && s.role === "talent_partner",
    )
    .map((s) => s.recruiter);
  console.log(`Active TPs: ${activeTps.length}`);

  const byName = new Map(histories.map((h) => [h.recruiter, h.monthly]));

  // Build per-TP post-ramp series keyed by calendar month.
  const postRampByTp = new Map<string, MonthlyHires[]>();
  for (const tp of activeTps) {
    const mh = byName.get(tp) ?? [];
    // Drop partial current month.
    const completed =
      mh.length > 0 && mh[mh.length - 1].month === now ? mh.slice(0, -1) : mh;
    postRampByTp.set(tp, postRampSlice(completed, DEFAULT_RAMP_MONTHS));
  }

  // Generate all per-TP CV cuts. For each TP, slide origin from their 3rd
  // post-ramp month (need ≥ 3 training points) to the last post-ramp month
  // minus horizon.
  const HORIZONS = [1, 3, 6];
  const MIN_TP_TRAIN = 3;
  const cuts: PerTpCut[] = [];
  for (const [tp, postRamp] of postRampByTp.entries()) {
    if (postRamp.length < MIN_TP_TRAIN + 1) continue;
    for (let i = MIN_TP_TRAIN; i < postRamp.length; i++) {
      const origin = postRamp[i - 1].month;
      const trainSlice = postRamp.slice(0, i).map((m) => m.hires);
      for (const h of HORIZONS) {
        if (i - 1 + h < postRamp.length) {
          cuts.push({
            tp,
            originMonth: origin,
            horizon: h,
            train: trainSlice,
            actual: postRamp[i - 1 + h].hires,
          });
        }
      }
    }
  }
  console.log(`Total CV cuts across TPs: ${cuts.length}`);

  // Evaluate each per-TP model.
  console.log("\n=== Per-TP model comparison ===");
  console.log(
    "model".padEnd(22) +
      "h".padStart(3) +
      "n".padStart(5) +
      "MAE".padStart(7) +
      "RMSE".padStart(7) +
      "bias".padStart(7),
  );
  console.log("-".repeat(22 + 3 + 5 + 7 + 7 + 7));
  for (const m of tpModels) {
    for (const h of HORIZONS) {
      const cutsH = cuts.filter((c) => c.horizon === h);
      if (cutsH.length === 0) continue;
      const errs = cutsH.map((c) => {
        const pred = m.f(c.train);
        return { err: c.actual - pred, actual: c.actual, pred };
      });
      const mae = mean(errs.map((e) => Math.abs(e.err)));
      const rmse = Math.sqrt(mean(errs.map((e) => e.err ** 2)));
      const bias = mean(errs.map((e) => e.err));
      console.log(
        m.name.padEnd(22) +
          h.toString().padStart(3) +
          cutsH.length.toString().padStart(5) +
          mae.toFixed(2).padStart(7) +
          rmse.toFixed(2).padStart(7) +
          bias.toFixed(2).padStart(7),
      );
    }
  }

  // Team-level aggregation. For each calendar month T, sum per-TP predictions
  // and compare to sum of per-TP actuals for TPs with valid cuts at T.
  console.log("\n=== Team-level aggregation (sum of per-TP predictions at each month) ===");
  console.log(
    "model".padEnd(22) +
      "h".padStart(3) +
      "monthsCovered".padStart(14) +
      "team MAE".padStart(10) +
      "team RMSE".padStart(11) +
      "team bias".padStart(11),
  );
  console.log("-".repeat(22 + 3 + 14 + 10 + 11 + 11));
  for (const m of tpModels) {
    for (const h of HORIZONS) {
      const byMonth = new Map<string, { pred: number; actual: number; n: number }>();
      for (const c of cuts) {
        if (c.horizon !== h) continue;
        const forecastMonth = addMonths(c.originMonth, h);
        const pred = m.f(c.train);
        const prev = byMonth.get(forecastMonth);
        if (prev) {
          prev.pred += pred;
          prev.actual += c.actual;
          prev.n += 1;
        } else {
          byMonth.set(forecastMonth, { pred, actual: c.actual, n: 1 });
        }
      }
      const entries = [...byMonth.values()];
      if (entries.length === 0) continue;
      const errs = entries.map((e) => e.actual - e.pred);
      const mae = mean(errs.map((e) => Math.abs(e)));
      const rmse = Math.sqrt(mean(errs.map((e) => e ** 2)));
      const bias = mean(errs);
      console.log(
        m.name.padEnd(22) +
          h.toString().padStart(3) +
          entries.length.toString().padStart(14) +
          mae.toFixed(2).padStart(10) +
          rmse.toFixed(2).padStart(11) +
          bias.toFixed(2).padStart(11),
      );
    }
  }

  // Trace: for the winning model at h=1, show sum-of-predictions vs sum-of-
  // actuals per month so we can see where the model over/under-predicts.
  const winner =
    tpModels.find((m) => m.name === "trailing6") ?? tpModels[0];
  console.log(`\n=== Trace: ${winner.name} at h=1 ===`);
  const traceByMonth = new Map<string, { pred: number; actual: number; n: number }>();
  for (const c of cuts) {
    if (c.horizon !== 1) continue;
    const forecastMonth = addMonths(c.originMonth, 1);
    const pred = winner.f(c.train);
    const prev = traceByMonth.get(forecastMonth);
    if (prev) {
      prev.pred += pred;
      prev.actual += c.actual;
      prev.n += 1;
    } else {
      traceByMonth.set(forecastMonth, { pred, actual: c.actual, n: 1 });
    }
  }
  const sortedMonths = [...traceByMonth.keys()].sort();
  console.log(
    "month".padEnd(10) +
      "nTPs".padStart(6) +
      "Σ pred".padStart(10) +
      "Σ actual".padStart(11) +
      "err".padStart(9),
  );
  for (const m of sortedMonths) {
    const e = traceByMonth.get(m)!;
    console.log(
      m.padEnd(10) +
        e.n.toString().padStart(6) +
        e.pred.toFixed(1).padStart(10) +
        e.actual.toFixed(1).padStart(11) +
        (e.actual - e.pred).toFixed(1).padStart(9),
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
