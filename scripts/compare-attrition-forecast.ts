// Compare our attrition / retention computations vs the Talent team's.
//
// Team's inputs (from HC Analysis prior to T2.xlsx, HC Forecast - update):
//   - <1yr tenure annualized attrition: 33.9%
//   - >1yr tenure annualized attrition: 40.5%
//   - Total monthly attrition: 3.16%
//
// They're pulling rolling-12-month rates from Mode, bucketed by tenure.
// We (a) compute the same rolling-12m rates from the same Mode data, and
// (b) cross-check against our KM survival curve.
//
// Usage: doppler run -- npx tsx scripts/compare-attrition-forecast.ts

import { getAttritionData } from "@/lib/data/attrition";
import { buildSurvivalCurve } from "@/lib/data/headcount-planning";

function annualFromMonthly(m: number): number {
  return 1 - Math.pow(1 - m, 12);
}

function monthlyFromAnnual(a: number): number {
  return 1 - Math.pow(1 - a, 1 / 12);
}

async function main() {
  const { rollingAttrition, employees } = await getAttritionData();

  // Team's reference numbers
  const TEAM_LT1Y = 0.339;
  const TEAM_GT1Y = 0.405;
  const TEAM_TOTAL_MONTHLY = 0.03156;

  console.log(`\n=== Team forecast reference ===`);
  console.log(`  <1yr attrition (annual): ${(TEAM_LT1Y * 100).toFixed(1)}%  →  monthly hazard ${(monthlyFromAnnual(TEAM_LT1Y) * 100).toFixed(2)}%`);
  console.log(`  >1yr attrition (annual): ${(TEAM_GT1Y * 100).toFixed(1)}%  →  monthly hazard ${(monthlyFromAnnual(TEAM_GT1Y) * 100).toFixed(2)}%`);
  console.log(`  Total monthly:           ${(TEAM_TOTAL_MONTHLY * 100).toFixed(2)}%  →  annualized ${(annualFromMonthly(TEAM_TOTAL_MONTHLY) * 100).toFixed(1)}%`);

  // --- (a) Rolling-12m from Mode — same source the team uses ---
  console.log(`\n=== Our rolling-12m attrition rates (same Mode source) ===`);
  console.log(`Mode's rollingAttrition rows, grouped by tenure bucket...`);

  // Pick the latest reporting period and compute leaversL12m / avgHeadcountL12m
  // per tenure bucket across all departments.
  const periods = [...new Set(rollingAttrition.map((r) => r.reportingPeriod))].sort();
  const latestPeriod = periods[periods.length - 1];
  console.log(`  Latest reporting period: ${latestPeriod}`);
  const latest = rollingAttrition.filter((r) => r.reportingPeriod === latestPeriod);

  const byTenure = new Map<string, { leavers: number; hc: number }>();
  for (const r of latest) {
    const key = r.tenure || "(blank)";
    const prev = byTenure.get(key) ?? { leavers: 0, hc: 0 };
    prev.leavers += r.leaversL12m;
    prev.hc += r.avgHeadcountL12m;
    byTenure.set(key, prev);
  }
  const buckets = [...byTenure.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  console.log(`  tenure bucket`.padEnd(28) + "leaversL12m".padStart(13) + "avgHCL12m".padStart(11) + "rate".padStart(8));
  for (const [bucket, { leavers, hc }] of buckets) {
    const rate = hc > 0 ? leavers / hc : NaN;
    console.log(`  ${bucket.padEnd(26)}${leavers.toFixed(1).padStart(13)}${hc.toFixed(1).padStart(11)}${(rate * 100).toFixed(1).padStart(7)}%`);
  }

  // Collapse into <1yr vs >1yr to match the team's two buckets. Mode tenure
  // labels at Cleo: e.g. "0-3m", "3-6m", "6-9m", "9-12m", "1-2y", "2+y" —
  // we'll detect which contain a dash and "y" (years) or "m" (months).
  function isSub1Year(bucket: string): boolean | null {
    const b = bucket.toLowerCase().trim();
    if (b.startsWith("<") || b.includes("< 1") || b.includes("<1")) return true;
    if (b.startsWith(">") || b.includes("> 1") || b.includes(">1")) return false;
    if (b.includes("1+") || b.includes("1 +")) return false;
    if (/m\b/i.test(bucket)) return true;
    return null;
  }

  let sub1Leavers = 0, sub1Hc = 0, over1Leavers = 0, over1Hc = 0;
  const unknown: string[] = [];
  for (const [bucket, { leavers, hc }] of buckets) {
    const sub = isSub1Year(bucket);
    if (sub === true) {
      sub1Leavers += leavers;
      sub1Hc += hc;
    } else if (sub === false) {
      over1Leavers += leavers;
      over1Hc += hc;
    } else {
      unknown.push(bucket);
    }
  }
  const sub1Rate = sub1Hc > 0 ? sub1Leavers / sub1Hc : NaN;
  const over1Rate = over1Hc > 0 ? over1Leavers / over1Hc : NaN;
  console.log(`\n  Collapsed into <1yr vs >1yr buckets:`);
  console.log(`  <1yr:  ${sub1Leavers.toFixed(0)} leavers / ${sub1Hc.toFixed(0)} avg HC  →  ${(sub1Rate * 100).toFixed(1)}% (team says ${(TEAM_LT1Y * 100).toFixed(1)}%)`);
  console.log(`  >1yr:  ${over1Leavers.toFixed(0)} leavers / ${over1Hc.toFixed(0)} avg HC  →  ${(over1Rate * 100).toFixed(1)}% (team says ${(TEAM_GT1Y * 100).toFixed(1)}%)`);
  if (unknown.length > 0) {
    console.log(`  (unclassified: ${unknown.join(", ")})`);
  }

  // --- (b) Our KM survival curve — first-principles from individual tenures ---
  const curve = buildSurvivalCurve(employees);
  const S = (t: number) => curve.survival[Math.min(t, curve.survival.length - 1)];
  const year1 = 1 - S(12);
  const year2Cond = 1 - S(24) / S(12);
  // Compute year-2+ as: for all tenures > 12mo, the probability of leaving in the next 12mo
  // Simplest: S(24)/S(12) → 1 - that = attrition from 12-24mo given survived 12mo.
  // For a more accurate >1yr figure, weight by tenure distribution of >1yr employees.
  console.log(`\n=== Our KM survival curve (first-principles) ===`);
  console.log(`  S(12) = ${S(12).toFixed(3)}  →  year-1 attrition = ${(year1 * 100).toFixed(1)}%`);
  console.log(`  S(24)/S(12) = ${(S(24) / S(12)).toFixed(3)}  →  year-2 conditional on year-1 survival = ${(year2Cond * 100).toFixed(1)}%`);
  console.log(`  S(36) = ${S(36).toFixed(3)}  →  year-3+ cumulative if started today = ${(100 * (1 - S(36))).toFixed(1)}%`);

  // Blended monthly from KM: what's our implied team-total monthly?
  // Apply current HC mix: % <1yr * monthly_hazard_<1yr + % >1yr * monthly_hazard_>1yr
  // Using Mode's latest <1yr vs >1yr headcount proportions from the rolling attrition data.
  const totalHc = sub1Hc + over1Hc;
  const sub1Frac = totalHc > 0 ? sub1Hc / totalHc : 0.5;
  const over1Frac = 1 - sub1Frac;
  const ourMonthlyLt1 = monthlyFromAnnual(sub1Rate);
  const ourMonthlyGt1 = monthlyFromAnnual(over1Rate);
  const ourBlended = sub1Frac * ourMonthlyLt1 + over1Frac * ourMonthlyGt1;
  console.log(`\n  Implied team-total monthly from Mode rolling rates: ${(ourBlended * 100).toFixed(2)}%`);
  console.log(`  Team says: ${(TEAM_TOTAL_MONTHLY * 100).toFixed(2)}%`);

  // Back-test: what would each model have predicted for recent months?
  // The team's constant-rate model and our tenure-stratified both annualized;
  // a quick apples-to-apples is to compare forecasted churn at today's HC
  // against actual 12-month churn.
  const actualAnnualRate =
    totalHc > 0 ? (sub1Leavers + over1Leavers) / totalHc : NaN;
  console.log(`\n=== Apples-to-apples at today's HC mix ===`);
  console.log(`  Actual L12m annual attrition (all tenures, latest period): ${(actualAnnualRate * 100).toFixed(1)}%`);
  console.log(`  Team's implied annual (from 3.16% monthly): ${(annualFromMonthly(TEAM_TOTAL_MONTHLY) * 100).toFixed(1)}%`);
  console.log(`  Our blended annual (<1yr × ${(sub1Frac * 100).toFixed(0)}% + >1yr × ${(over1Frac * 100).toFixed(0)}%): ${(annualFromMonthly(ourBlended) * 100).toFixed(1)}%`);

  // Summary: who's closer?
  console.log(`\n=== Verdict ===`);
  const teamError = Math.abs(
    annualFromMonthly(TEAM_TOTAL_MONTHLY) - actualAnnualRate,
  );
  const ourError = Math.abs(annualFromMonthly(ourBlended) - actualAnnualRate);
  console.log(`  |team − actual|: ${(teamError * 100).toFixed(1)}pp`);
  console.log(`  |ours − actual|: ${(ourError * 100).toFixed(1)}pp`);
  if (teamError < ourError) {
    console.log(`  Team is closer.`);
  } else {
    console.log(`  Ours is closer.`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
