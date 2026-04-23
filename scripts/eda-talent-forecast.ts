// Exploratory data analysis for the talent hire forecast.
// Answers: how many months? trend? seasonality? variance regime? outliers?
// Usage: doppler run -- npx tsx scripts/eda-talent-forecast.ts

import { getTalentData } from "@/lib/data/talent";
import {
  aggregateHiresByRecruiterMonth,
  currentMonthKey,
  sumToTeamMonthly,
} from "@/lib/data/talent-utils";

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1),
  );
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = q * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (idx - lo) * (s[hi] - s[lo]);
}

/** ACF estimator at lag k for a series. */
function autocorrelation(xs: number[], k: number): number {
  const n = xs.length;
  if (n <= k + 1) return NaN;
  const mu = mean(xs);
  let num = 0;
  let den = 0;
  for (let t = 0; t < n; t++) {
    den += (xs[t] - mu) ** 2;
    if (t + k < n) num += (xs[t] - mu) * (xs[t + k] - mu);
  }
  return den === 0 ? 0 : num / den;
}

async function main() {
  const data = await getTalentData();
  const histories = aggregateHiresByRecruiterMonth(data.hireRows);
  const teamActual = sumToTeamMonthly(histories);
  const currentMonth = currentMonthKey();

  // Drop partial current month from all EDA — it'd distort every stat.
  const lastMonth = teamActual[teamActual.length - 1]?.month;
  const completed =
    lastMonth === currentMonth ? teamActual.slice(0, -1) : teamActual;

  console.log("=== Team-level monthly hires ===");
  console.log(`Total months (completed): ${completed.length}`);
  if (completed.length === 0) {
    console.log("no data — abort");
    process.exit(0);
  }
  console.log(
    `Range: ${completed[0].month} → ${completed[completed.length - 1].month}`,
  );
  const ys = completed.map((m) => m.hires);
  console.log(`\nSummary stats (hires per month):`);
  console.log(`  mean      = ${mean(ys).toFixed(2)}`);
  console.log(`  std       = ${std(ys).toFixed(2)}`);
  console.log(`  median    = ${median(ys).toFixed(2)}`);
  console.log(`  min / max = ${Math.min(...ys)} / ${Math.max(...ys)}`);
  console.log(`  p10 / p90 = ${quantile(ys, 0.1).toFixed(1)} / ${quantile(ys, 0.9).toFixed(1)}`);

  // Trend via OLS on raw series
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const resid = ys.map((y, i) => y - (slope * i + intercept));
  const rmse = Math.sqrt(mean(resid.map((r) => r * r)));
  console.log(`\nLinear trend fit (OLS on full series):`);
  console.log(`  slope    = ${slope.toFixed(3)} hires/month added per month`);
  console.log(`  t=0      = ${intercept.toFixed(2)} (fitted value at ${completed[0].month})`);
  console.log(`  RMSE     = ${rmse.toFixed(2)}`);
  console.log(`  R²       = ${(1 - resid.reduce((s, r) => s + r * r, 0) / ys.reduce((s, y) => s + (y - my) ** 2, 0)).toFixed(3)}`);

  // Last-12 trailing mean vs earlier to check regime change
  if (n >= 24) {
    const firstHalf = ys.slice(0, Math.floor(n / 2));
    const secondHalf = ys.slice(Math.floor(n / 2));
    console.log(`\nRegime check (first half vs second half):`);
    console.log(`  first  ${firstHalf.length}mo: mean=${mean(firstHalf).toFixed(1)} std=${std(firstHalf).toFixed(1)}`);
    console.log(`  second ${secondHalf.length}mo: mean=${mean(secondHalf).toFixed(1)} std=${std(secondHalf).toFixed(1)}`);
  }

  // Autocorrelation (suggests seasonality if lag=12 is large positive)
  console.log(`\nAutocorrelation (residuals from linear trend):`);
  for (const k of [1, 2, 3, 6, 12]) {
    if (n <= k + 1) continue;
    const rho = autocorrelation(resid, k);
    console.log(`  lag ${k.toString().padStart(2)}: ρ = ${rho.toFixed(3)}`);
  }

  // Month-of-year seasonality (mean by calendar month)
  console.log(`\nMonth-of-year buckets (mean hires, detrended):`);
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < n; i++) {
    const m = parseInt(completed[i].month.split("-")[1], 10);
    buckets[m - 1].push(resid[i]); // detrended
  }
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  for (let i = 0; i < 12; i++) {
    const b = buckets[i];
    if (b.length === 0) continue;
    console.log(`  ${monthNames[i]} (n=${b.length}): mean detrended = ${mean(b).toFixed(2)}`);
  }

  // Print the full series
  console.log(`\nFull completed series:`);
  for (const m of completed) {
    const bar = "█".repeat(Math.max(1, Math.round(m.hires)));
    console.log(`  ${m.month}  ${m.hires.toFixed(1).padStart(5)}  ${bar}`);
  }

  // Per-recruiter summary
  console.log(`\n=== Per-recruiter ===`);
  console.log(`Recruiters with any hires: ${histories.length}`);
  const months = histories
    .map((h) => h.monthly.filter((m) => m.hires > 0).length)
    .sort((a, b) => b - a);
  console.log(`  months-with-hires  median=${median(months)}  p10=${quantile(months, 0.1).toFixed(0)}  p90=${quantile(months, 0.9).toFixed(0)}`);
  const totals = histories
    .map((h) => h.monthly.reduce((s, m) => s + m.hires, 0))
    .sort((a, b) => b - a);
  console.log(`  total hires        median=${median(totals).toFixed(1)}  p10=${quantile(totals, 0.1).toFixed(1)}  p90=${quantile(totals, 0.9).toFixed(1)}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
