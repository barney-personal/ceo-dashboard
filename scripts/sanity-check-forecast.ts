// Sanity check: compare roster-anchored forecast vs recent actuals and the
// old capacity-aware view. Usage: doppler run -- npx tsx scripts/sanity-check-forecast.ts

import { getTalentData } from "@/lib/data/talent";
import {
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  currentMonthKey,
  sumToTeamMonthly,
} from "@/lib/data/talent-utils";
import { forecastFromActiveCapacity } from "@/lib/data/talent-forecast";
import { forecastFromRoster } from "@/lib/data/talent-forecast-roster";

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
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
  console.log(`\nActive TPs: ${activeTps.length}`);

  // Roster-anchored forecast (new production).
  const roster = forecastFromRoster(
    histories,
    activeTps.map((s) => s.recruiter),
    "2026-04",
    "2026-09",
    { currentMonth: now },
  );
  console.log(`\n=== Roster-anchored forecast (new production) ===`);
  console.log(`  Point (next 3mo avg): ${roster.teamMeanMonthly.toFixed(1)} hires/mo`);
  console.log(`  Non-roster gap: ${roster.nonRosterGap.toFixed(1)} hires/mo (σ=${roster.nonRosterGapScale.toFixed(1)})`);
  console.log(`  Team σ (quadrature): ${roster.teamSigmaMonthly.toFixed(1)}`);
  console.log(`  Next 6 months (P10 / P50 / P90):`);
  for (const m of roster.forecast) {
    console.log(
      `    ${m.month}  [${m.low.toFixed(1).padStart(5)}, ${m.mid
        .toFixed(1)
        .padStart(5)}, ${m.high.toFixed(1).padStart(5)}]`,
    );
  }
  console.log(`\n  Per-TP contributions:`);
  console.log(
    "    recruiter".padEnd(30) +
      "postRamp".padStart(10) +
      "median".padStart(9) +
      "mean".padStart(8) +
      "MAD".padStart(7) +
      "eligible".padStart(11),
  );
  for (const c of [...roster.contributors].sort((a, b) => b.median - a.median)) {
    console.log(
      `    ${c.recruiter.padEnd(28)}${c.postRampMonths.toString().padStart(10)}${c.median
        .toFixed(2)
        .padStart(9)}${c.postRampMean.toFixed(2).padStart(8)}${c.madScale
        .toFixed(2)
        .padStart(7)}${(c.eligible ? "yes" : "no").padStart(11)}`,
    );
  }

  // Old capacity-aware view (still rendered as "steady-state capacity" card).
  const capacity = forecastFromActiveCapacity(
    histories,
    activeTps.map((s) => s.recruiter),
    "2026-04",
    "2026-09",
    { productivityWindowMonths: 3, currentMonth: now },
  );

  // Recent actuals.
  const recent3 = mean(completed.slice(-3).map((m) => m.hires));
  const recent6 = mean(completed.slice(-6).map((m) => m.hires));

  console.log(`\n=== Head-to-head ===`);
  console.log(`  Recent 6mo team actual:                     ${recent6.toFixed(1)} hires/mo`);
  console.log(`  Recent 3mo team actual:                     ${recent3.toFixed(1)} hires/mo`);
  console.log(`  Capacity-aware (17 TPs × trailing-3):       ${capacity.teamMeanMonthly.toFixed(1)} hires/mo`);
  console.log(`  Roster-anchored (per-TP median + gap):      ${roster.teamMeanMonthly.toFixed(1)} hires/mo  ← new production`);

  const delta = roster.teamMeanMonthly - recent3;
  console.log(
    `\n  Δ (roster − recent-3): ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} hires/mo (${((delta / recent3) * 100).toFixed(0)}%)`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
