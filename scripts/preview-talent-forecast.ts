// Preview the talent hire forecast against live DB data.
// Usage: doppler run -- npx tsx scripts/preview-talent-forecast.ts

import { getTalentData } from "@/lib/data/talent";
import {
  aggregateHiresByRecruiterMonth,
  currentMonthKey,
  sumToTeamMonthly,
} from "@/lib/data/talent-utils";
import {
  forecastTeamHires,
  totalForecastOverRange,
} from "@/lib/data/talent-forecast";

async function main() {
  const data = await getTalentData();
  const histories = aggregateHiresByRecruiterMonth(data.hireRows);
  const teamActual = sumToTeamMonthly(histories);
  const now = currentMonthKey();

  const { forecast, fit } = forecastTeamHires(teamActual, "2027-12", {
    trainingMonths: 12,
    currentMonth: now,
  });

  console.log("Fit:", fit);

  console.log("\nLast 6 months of actuals:");
  for (const m of teamActual.slice(-6)) {
    console.log(`  ${m.month}  → ${m.hires.toFixed(1)}`);
  }

  console.log("\nForecast (low / mid / high) through Dec 2027:");
  for (const m of forecast) {
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
