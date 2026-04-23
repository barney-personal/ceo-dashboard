// Preview the headcount planning projection against live DB data.
// Usage: doppler run -- npx tsx scripts/preview-headcount-plan.ts

import { getTalentData } from "@/lib/data/talent";
import { getAttritionData } from "@/lib/data/attrition";
import {
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  currentMonthKey,
  addMonths,
  sumToTeamMonthly,
} from "@/lib/data/talent-utils";
import { forecastFromRoster } from "@/lib/data/talent-forecast-roster";
import {
  projectHeadcount,
  projectFromCohorts,
  buildSurvivalFromRollingRates,
  buildSurvivalCurve,
} from "@/lib/data/headcount-planning";
import { buildEmployeeRetentionCohorts } from "@/lib/data/attrition-utils";

async function main() {
  const [talent, attrition] = await Promise.all([
    getTalentData(),
    getAttritionData(),
  ]);

  const histories = aggregateHiresByRecruiterMonth(talent.hireRows);
  const now = currentMonthKey();
  const summaries = buildRecruiterSummaries(
    histories,
    talent.targets,
    now,
    talent.employmentByRecruiter,
  );
  const activeTpNames = summaries
    .filter(
      (s) => s.employment.status !== "departed" && s.role === "talent_partner",
    )
    .map((s) => s.recruiter);
  const teamActual = sumToTeamMonthly(histories);
  const latest = teamActual[teamActual.length - 1]?.month ?? null;
  const forecastStart = addMonths(latest ?? now, 1);
  const hireForecast = forecastFromRoster(
    histories,
    activeTpNames,
    forecastStart,
    "2027-12",
    { currentMonth: now },
  );
  const first = hireForecast.forecast[0];
  const scenarios = first
    ? { low: first.low, mid: first.mid, high: first.high }
    : { low: 0, mid: 0, high: 0 };

  console.log(`Hire scenarios (monthly, flat): P10=${scenarios.low.toFixed(1)} P50=${scenarios.mid.toFixed(1)} P90=${scenarios.high.toFixed(1)}`);
  console.log(`FTE observations (attrition): ${attrition.employees.length}`);

  // Compute Mode rolling rates the way the page does.
  const periods = [...new Set(attrition.rollingAttrition.map((r) => r.reportingPeriod))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestRows = attrition.rollingAttrition.filter((r) => r.reportingPeriod === latestPeriod);
  let sub1Leavers = 0, sub1Hc = 0, over1Leavers = 0, over1Hc = 0;
  for (const r of latestRows) {
    const b = r.tenure.toLowerCase().trim();
    const isSub = b.startsWith("<") || b.includes("< 1") || b.includes("<1") || /m\b/i.test(r.tenure);
    if (isSub) {
      sub1Leavers += r.leaversL12m;
      sub1Hc += r.avgHeadcountL12m;
    } else {
      over1Leavers += r.leaversL12m;
      over1Hc += r.avgHeadcountL12m;
    }
  }
  const rollingRates = {
    under1yrAnnual: sub1Hc > 0 ? sub1Leavers / sub1Hc : 0.34,
    over1yrAnnual: over1Hc > 0 ? over1Leavers / over1Hc : 0.4,
  };
  console.log(`\nMode rolling rates: <1yr=${(rollingRates.under1yrAnnual * 100).toFixed(1)}% · >1yr=${(rollingRates.over1yrAnnual * 100).toFixed(1)}%`);
  const productionCurve = buildSurvivalFromRollingRates(rollingRates);
  console.log(`Production survival curve (Mode rolling):`);
  for (const t of [0, 3, 6, 9, 12, 18, 24, 36]) {
    console.log(`  S(${t.toString().padStart(3)}) = ${productionCurve.survival[t].toFixed(3)}`);
  }

  const projection = projectHeadcount(attrition.employees, "2027-12", {
    hireScenarios: scenarios,
    survivalCurve: productionCurve,
  });

  const kmCurve = buildSurvivalCurve(attrition.employees);
  const kmProjection = projectHeadcount(attrition.employees, "2027-12", {
    hireScenarios: scenarios,
    survivalCurve: kmCurve,
  });

  console.log(`\nStarting headcount: ${projection.startingHeadcount}`);
  console.log(`Survival curve n=${projection.survivalCurve.n}, extrapolation beyond tenure ${projection.survivalCurve.extrapolationCutoff}`);
  console.log(`\nSurvival curve (first 24 months):`);
  for (let t = 0; t <= 24; t += 3) {
    const s = projection.survivalCurve.survival[t];
    console.log(`  S(${t.toString().padStart(3)}) = ${s.toFixed(3)} · n_risk=${projection.survivalCurve.atRisk[t]} · events=${projection.survivalCurve.events[t]}`);
  }

  console.log(`\nHistorical (last 6 months):`);
  for (const h of projection.actual.slice(-6)) {
    console.log(`  ${h.month} · ${h.headcount} FTEs`);
  }

  console.log(`\nProjection — quarterly snapshots:`);
  console.log("month".padEnd(10) + "low".padStart(7) + "mid".padStart(7) + "high".padStart(7) + "hires".padStart(8) + "exits".padStart(8) + "net".padStart(7));
  for (const m of projection.projection) {
    const [y, mo] = m.month.split("-");
    if (!["03", "06", "09", "12"].includes(mo)) continue;
    console.log(
      m.month.padEnd(10) +
        m.low.toFixed(0).padStart(7) +
        m.mid.toFixed(0).padStart(7) +
        m.high.toFixed(0).padStart(7) +
        m.hires.toFixed(1).padStart(8) +
        m.departures.toFixed(1).padStart(8) +
        (m.netChange >= 0 ? "+" : "") +
        m.netChange.toFixed(1).padStart(m.netChange >= 0 ? 6 : 7),
    );
  }

  const dec26 = projection.projection.find((m) => m.month === "2026-12");
  const dec27 = projection.projection.find((m) => m.month === "2027-12");
  const kmDec26 = kmProjection.projection.find((m) => m.month === "2026-12");
  const kmDec27 = kmProjection.projection.find((m) => m.month === "2027-12");
  console.log(`\nProduction (Mode rolling-12m) headline:`);
  console.log(`  Today:        ${projection.startingHeadcount}`);
  console.log(`  Dec 2026:     ${dec26?.mid.toFixed(0)} (P10–P90: ${dec26?.low.toFixed(0)}–${dec26?.high.toFixed(0)})`);
  console.log(`  Dec 2027:     ${dec27?.mid.toFixed(0)} (P10–P90: ${dec27?.low.toFixed(0)}–${dec27?.high.toFixed(0)})`);
  console.log(`\nKM (diagnostic) headline:`);
  console.log(`  Today:        ${kmProjection.startingHeadcount}`);
  console.log(`  Dec 2026:     ${kmDec26?.mid.toFixed(0)}`);
  console.log(`  Dec 2027:     ${kmDec27?.mid.toFixed(0)}`);
  console.log(`\nΔ (KM − Production):`);
  console.log(`  Dec 2026: ${kmDec26 && dec26 ? (kmDec26.mid - dec26.mid).toFixed(0) : "—"}`);
  console.log(`  Dec 2027: ${kmDec27 && dec27 ? (kmDec27.mid - dec27.mid).toFixed(0) : "—"}`);

  // Cohort-based projection — cross-check.
  const cohorts = buildEmployeeRetentionCohorts(attrition.employees);
  const today = new Date();
  const currentQuarterStart = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      Math.floor(today.getUTCMonth() / 3) * 3,
      1,
    ),
  );
  const currentQuarterActiveCount = attrition.employees.filter((e) => {
    const start = new Date(e.startDate);
    if (!Number.isFinite(start.getTime()) || start < currentQuarterStart) return false;
    if (e.terminationDate) {
      const term = new Date(e.terminationDate);
      if (Number.isFinite(term.getTime()) && term <= today) return false;
    }
    return true;
  }).length;
  console.log(`Current-quarter active joiners (not in cohorts): ${currentQuarterActiveCount}`);
  const cohortProjection = projectFromCohorts(
    cohorts,
    projection.survivalCurve,
    "2027-12",
    { hireScenarios: scenarios, currentQuarterActiveCount },
  );
  console.log(`\nCohort-based headline:`);
  console.log(`  Today (Σ cohorts × observed retention): ${cohortProjection.startingHeadcount.toFixed(0)}`);
  const coDec26 = cohortProjection.projection.find((m) => m.month === "2026-12");
  const coDec27 = cohortProjection.projection.find((m) => m.month === "2027-12");
  console.log(`  Dec 2026: ${coDec26?.mid.toFixed(0)}`);
  console.log(`  Dec 2027: ${coDec27?.mid.toFixed(0)}`);

  console.log(`\nDelta (cohort − KM):`);
  console.log(`  Today:    ${(cohortProjection.startingHeadcount - projection.startingHeadcount).toFixed(1)}`);
  console.log(`  Dec 2026: ${coDec26 && dec26 ? (coDec26.mid - dec26.mid).toFixed(1) : "—"}`);
  console.log(`  Dec 2027: ${coDec27 && dec27 ? (coDec27.mid - dec27.mid).toFixed(1) : "—"}`);

  console.log(`\nStationarity check · retention by cohort at common ages:`);
  for (const s of cohortProjection.stationarityByAge) {
    if (s.byCohort.length < 2) continue;
    const vals = s.byCohort.map((c) => c.retention);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const spread = max - min;
    console.log(
      `  age=${s.ageMonths}mo  n=${s.byCohort.length}  range=${(min * 100).toFixed(0)}%–${(max * 100).toFixed(0)}%  spread=${(spread * 100).toFixed(0)}pp`,
    );
    for (const c of s.byCohort) {
      console.log(
        `    ${c.cohort.padEnd(10)} ${(c.retention * 100).toFixed(0).padStart(3)}%  (n=${c.cohortSize})`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
