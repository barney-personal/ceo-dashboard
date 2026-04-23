// Per-TP productivity analysis: for each currently-active Talent Partner,
// compute their post-ramp (excluding first 2 months) monthly hire rate.
//
// The team forecast anchored in this view answers: "if these specific 17
// people hire at their post-ramp steady-state rate, what do we expect?"
//
// Usage: doppler run -- npx tsx scripts/per-tp-analysis.ts

import { getTalentData } from "@/lib/data/talent";
import {
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  currentMonthKey,
  sumToTeamMonthly,
} from "@/lib/data/talent-utils";

const RAMP_MONTHS = 2;
const MIN_POST_RAMP_MONTHS = 3; // below this, we don't trust the estimate

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  return Math.sqrt(
    xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1),
  );
}

interface TpProfile {
  recruiter: string;
  firstHireMonth: string | null;
  tenureMonths: number;
  postRampMonths: number;
  postRampMean: number;
  postRampTrimmedMean: number; // drop top/bottom point
  postRampStd: number;
  recent3moMean: number;
  recent6moMean: number;
  lastMonth: number;
}

function profileTp(
  recruiter: string,
  monthly: { month: string; hires: number }[],
  currentMonth: string,
): TpProfile {
  // Drop partial current month — unfair to include 3-week-old data.
  const completed =
    monthly.length > 0 && monthly[monthly.length - 1].month === currentMonth
      ? monthly.slice(0, -1)
      : monthly;

  // First hire month = proxy for tenure start. Not perfect (someone could
  // have been at Cleo a couple weeks before first hire) but within the
  // resolution of monthly data, it's as good as we get without HR start dates.
  const firstHireIdx = completed.findIndex((m) => m.hires > 0);
  if (firstHireIdx === -1) {
    return {
      recruiter,
      firstHireMonth: null,
      tenureMonths: 0,
      postRampMonths: 0,
      postRampMean: 0,
      postRampTrimmedMean: 0,
      postRampStd: 0,
      recent3moMean: 0,
      recent6moMean: 0,
      lastMonth: 0,
    };
  }

  const firstHireMonth = completed[firstHireIdx].month;
  const tenureSlice = completed.slice(firstHireIdx);
  // Drop the first RAMP_MONTHS months of post-hire data.
  const postRamp = tenureSlice.slice(RAMP_MONTHS);
  const postRampHires = postRamp.map((m) => m.hires);

  // Trimmed mean: drop the single highest point to robust against spikes.
  const sorted = [...postRampHires].sort((a, b) => a - b);
  const trimmedSlice = sorted.length > 3 ? sorted.slice(0, -1) : sorted;

  const recent3 = postRampHires.slice(-3);
  const recent6 = postRampHires.slice(-6);

  return {
    recruiter,
    firstHireMonth,
    tenureMonths: tenureSlice.length,
    postRampMonths: postRamp.length,
    postRampMean: mean(postRampHires),
    postRampTrimmedMean: mean(trimmedSlice),
    postRampStd: std(postRampHires),
    recent3moMean: mean(recent3),
    recent6moMean: mean(recent6),
    lastMonth: completed[completed.length - 1]?.hires ?? 0,
  };
}

async function main() {
  const data = await getTalentData();
  const histories = aggregateHiresByRecruiterMonth(data.hireRows);
  const teamActual = sumToTeamMonthly(histories);
  const now = currentMonthKey();

  const last = teamActual[teamActual.length - 1]?.month;
  const completed = last === now ? teamActual.slice(0, -1) : teamActual;

  const summaries = buildRecruiterSummaries(
    histories,
    data.targets,
    now,
    data.employmentByRecruiter,
  );
  const activeTps = summaries.filter(
    (s) => s.employment.status !== "departed" && s.role === "talent_partner",
  );
  console.log(`\n=== Active Talent Partners: ${activeTps.length} ===`);

  const byName = new Map(histories.map((h) => [h.recruiter, h.monthly]));

  const profiles: TpProfile[] = activeTps.map((s) =>
    profileTp(s.recruiter, byName.get(s.recruiter) ?? [], now),
  );

  // Rank by post-ramp mean.
  profiles.sort((a, b) => b.postRampMean - a.postRampMean);

  console.log(
    "\nrecruiter".padEnd(26) +
      "firstHire".padStart(11) +
      "tenure".padStart(8) +
      "postRamp".padStart(10) +
      "mean".padStart(7) +
      "trimmed".padStart(9) +
      "σ".padStart(6) +
      "rec3".padStart(6) +
      "rec6".padStart(6),
  );
  console.log("-".repeat(89));
  for (const p of profiles) {
    const flag =
      p.postRampMonths < MIN_POST_RAMP_MONTHS
        ? " ⚠ low-data"
        : p.postRampMonths < 6
          ? " ~"
          : "";
    console.log(
      p.recruiter.padEnd(26) +
        (p.firstHireMonth ?? "—").padStart(11) +
        p.tenureMonths.toString().padStart(8) +
        p.postRampMonths.toString().padStart(10) +
        p.postRampMean.toFixed(2).padStart(7) +
        p.postRampTrimmedMean.toFixed(2).padStart(9) +
        p.postRampStd.toFixed(2).padStart(6) +
        p.recent3moMean.toFixed(2).padStart(6) +
        p.recent6moMean.toFixed(2).padStart(6) +
        flag,
    );
  }

  // Aggregate views.
  const eligible = profiles.filter(
    (p) => p.postRampMonths >= MIN_POST_RAMP_MONTHS,
  );
  const ineligible = profiles.filter(
    (p) => p.postRampMonths < MIN_POST_RAMP_MONTHS,
  );

  console.log(`\n=== Team aggregates ===`);
  const sumMean = eligible.reduce((s, p) => s + p.postRampMean, 0);
  const sumTrimmed = eligible.reduce((s, p) => s + p.postRampTrimmedMean, 0);
  const sumRec3 = eligible.reduce((s, p) => s + p.recent3moMean, 0);
  const sumRec6 = eligible.reduce((s, p) => s + p.recent6moMean, 0);
  console.log(`  Σ post-ramp mean (all months, post-ramp):    ${sumMean.toFixed(1)} hires/mo`);
  console.log(`  Σ post-ramp trimmed-1 mean:                   ${sumTrimmed.toFixed(1)} hires/mo`);
  console.log(`  Σ recent-3mo mean (of post-ramp points):      ${sumRec3.toFixed(1)} hires/mo`);
  console.log(`  Σ recent-6mo mean (of post-ramp points):      ${sumRec6.toFixed(1)} hires/mo`);
  console.log(
    `  Eligible TPs (≥${MIN_POST_RAMP_MONTHS} post-ramp months): ${eligible.length} / ${profiles.length}`,
  );
  if (ineligible.length > 0) {
    console.log(
      `  Excluded: ${ineligible.map((p) => `${p.recruiter} (${p.postRampMonths}mo)`).join(", ")}`,
    );
  }

  // Context: team-total actuals.
  const recent3Team = mean(completed.slice(-3).map((m) => m.hires));
  const recent6Team = mean(completed.slice(-6).map((m) => m.hires));
  const recent12Team = mean(completed.slice(-12).map((m) => m.hires));
  console.log(`\n=== Recent team-total actuals (context) ===`);
  console.log(`  Last 3mo team actual:  ${recent3Team.toFixed(1)} hires/mo`);
  console.log(`  Last 6mo team actual:  ${recent6Team.toFixed(1)} hires/mo`);
  console.log(`  Last 12mo team actual: ${recent12Team.toFixed(1)} hires/mo`);

  const nonRosterGap = recent3Team - sumRec3;
  console.log(
    `\n  Gap (team actual − Σ per-TP): ${nonRosterGap.toFixed(1)} hires/mo`,
  );
  console.log(
    `  (Non-TP hires: departed TPs before they left, sourcers, managers, placeholder rows.)`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
