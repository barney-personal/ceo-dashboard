// Preview the talent hire forecast against live DB data.
// Usage: doppler run -- npx tsx scripts/preview-talent-forecast.ts

import { getTalentData } from "@/lib/data/talent";
import {
  addMonths,
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  currentMonthKey,
  sumToTeamMonthly,
} from "@/lib/data/talent-utils";
import {
  forecastFromActiveCapacity,
  totalForecastOverRange,
} from "@/lib/data/talent-forecast";

async function main() {
  const data = await getTalentData();
  const histories = aggregateHiresByRecruiterMonth(data.hireRows);
  const teamActual = sumToTeamMonthly(histories);
  const now = currentMonthKey();

  const summaries = buildRecruiterSummaries(
    histories,
    data.targets,
    now,
    data.employmentByRecruiter,
  );
  const activeTps = summaries.filter(
    (s) => s.employment.status !== "departed" && s.role === "talent_partner",
  );
  console.log(`\nActive Talent Partners: ${activeTps.length}`);

  const latestMonth = teamActual[teamActual.length - 1]?.month ?? now;
  const forecastStart = addMonths(latestMonth, 1);

  const { forecast, contributors, teamMeanMonthly, teamSigmaMonthly } =
    forecastFromActiveCapacity(
      histories,
      activeTps.map((s) => s.recruiter),
      forecastStart,
      "2027-12",
      {
        productivityWindowMonths: 3,
        currentMonth: now,
      },
    );

  console.log(
    `\nTeam mean: ${teamMeanMonthly.toFixed(1)} hires/month · σ = ${teamSigmaMonthly.toFixed(2)}`,
  );
  console.log("\nPer-active-TP contribution:");
  for (const c of contributors.sort(
    (a, b) => b.meanMonthlyHires - a.meanMonthlyHires,
  )) {
    console.log(
      `  ${c.recruiter.padEnd(25)} mean=${c.meanMonthlyHires.toFixed(2).padStart(5)}  σ=${c.sigmaMonthly.toFixed(2).padStart(5)}  months=${c.monthsOfHistory}`,
    );
  }

  console.log("\nLast 6 months of actuals (context):");
  for (const m of teamActual.slice(-6)) {
    console.log(`  ${m.month}  → ${m.hires.toFixed(1)}`);
  }

  console.log("\nForecast (low / mid / high) — first 6 and last 3 months:");
  const sliced = [...forecast.slice(0, 6), ...forecast.slice(-3)];
  for (const m of sliced) {
    console.log(
      `  ${m.month}  →  [${m.low.toFixed(1).padStart(6)}, ${m.mid.toFixed(1).padStart(6)}, ${m.high.toFixed(1).padStart(6)}]`,
    );
  }

  console.log("\nRange totals:");
  for (const range of [
    { label: "2026 (H2 only)", from: "2026-05", to: "2026-12" },
    { label: "All of 2027", from: "2027-01", to: "2027-12" },
    {
      label: "Total next 20 months",
      from: forecast[0]?.month ?? "2026-05",
      to: "2027-12",
    },
  ]) {
    const total = totalForecastOverRange(forecast, range);
    if (!total) continue;
    console.log(
      `  ${range.label.padEnd(24)}  low=${total.low.toFixed(0).padStart(5)}  mid=${total.mid.toFixed(0).padStart(5)}  high=${total.high.toFixed(0).padStart(5)}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
