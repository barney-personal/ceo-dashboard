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
  console.log(`  Per-TP average: ${(roster.teamMeanMonthly / activeTps.length).toFixed(2)} hires/TP/mo`);
  console.log(`  Team σ (quadrature): ${roster.teamSigmaMonthly.toFixed(1)}`);
  console.log(`  Next 6 months (P10 / P50 / P90):`);
  for (const m of roster.forecast) {
    console.log(
      `    ${m.month}  [${m.low.toFixed(1).padStart(5)}, ${m.mid
        .toFixed(1)
        .padStart(5)}, ${m.high.toFixed(1).padStart(5)}]`,
    );
  }
  console.log(`\n  Per-TP contributions (sorted by EWMA productivity):`);
  console.log(
    "    recruiter".padEnd(30) +
      "postRamp".padStart(10) +
      "EWMA".padStart(8) +
      "mean".padStart(8) +
      "σ".padStart(7) +
      "eligible".padStart(11),
  );
  for (const c of [...roster.contributors].sort(
    (a, b) => b.productivity - a.productivity,
  )) {
    console.log(
      `    ${c.recruiter.padEnd(28)}${c.postRampMonths.toString().padStart(10)}${c.productivity
        .toFixed(2)
        .padStart(8)}${c.postRampMean.toFixed(2).padStart(8)}${c.productivityStd
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

  // TP-only recent actual — sum of active-TP hires in the last 3 completed months.
  const activeSet = new Set(activeTps.map((s) => s.recruiter));
  const byName = new Map(histories.map((h) => [h.recruiter, h.monthly]));
  const recent3Months = completed.slice(-3).map((m) => m.month);
  const tpRecent3 =
    recent3Months.reduce((sum, month) => {
      let monthTotal = 0;
      for (const tp of activeTps) {
        const mh = byName.get(tp.recruiter)?.find((x) => x.month === month);
        monthTotal += mh?.hires ?? 0;
      }
      return sum + monthTotal;
    }, 0) / 3;

  // Recent actuals.
  const recent3 = mean(completed.slice(-3).map((m) => m.hires));
  const recent6 = mean(completed.slice(-6).map((m) => m.hires));

  console.log(`\n=== Head-to-head ===`);
  console.log(`  Team total recent 3mo:                      ${recent3.toFixed(1)} hires/mo (includes non-TP attribution)`);
  console.log(`  TP-only recent 3mo (17 active):             ${tpRecent3.toFixed(1)} hires/mo (= ${(tpRecent3 / activeTps.length).toFixed(2)}/TP)`);
  console.log(`  Lucy's implied forecast (17 × 1.6):         27.2 hires/mo (= 1.60/TP)`);
  console.log(`  Roster-anchored EWMA (new production):      ${roster.teamMeanMonthly.toFixed(1)} hires/mo (= ${(roster.teamMeanMonthly / activeTps.length).toFixed(2)}/TP)  ←`);
  console.log(`  Capacity-aware trailing-3 (reference):      ${capacity.teamMeanMonthly.toFixed(1)} hires/mo (= ${(capacity.teamMeanMonthly / activeTps.length).toFixed(2)}/TP)`);

  const vsLucy = roster.teamMeanMonthly - 27.2;
  const vsTpActual = roster.teamMeanMonthly - tpRecent3;
  console.log(
    `\n  Δ vs Lucy:         ${vsLucy >= 0 ? "+" : ""}${vsLucy.toFixed(1)} hires/mo (${((vsLucy / 27.2) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Δ vs TP-only recent: ${vsTpActual >= 0 ? "+" : ""}${vsTpActual.toFixed(1)} hires/mo (${((vsTpActual / tpRecent3) * 100).toFixed(0)}%)`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
