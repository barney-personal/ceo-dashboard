import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { HeadcountPlanningClient } from "@/components/dashboard/headcount-planning-client";
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
import {
  buildEmployeeRetentionCohorts,
  classifyTenureBucket,
} from "@/lib/data/attrition-utils";

const FORECAST_THROUGH = "2027-12";

/**
 * Collapse Mode's rollingAttrition rows (latest reporting period, summed
 * across departments) into the two tenure buckets the team uses in their
 * HC forecast: <1yr and >1yr.
 */
function computeRollingRates(
  rollingAttrition: {
    reportingPeriod: string;
    tenure: string;
    leaversL12m: number;
    avgHeadcountL12m: number;
  }[],
): { under1yrAnnual: number; over1yrAnnual: number } {
  if (rollingAttrition.length === 0) {
    return { under1yrAnnual: 0.34, over1yrAnnual: 0.4 }; // fallback priors
  }
  const periods = [...new Set(rollingAttrition.map((r) => r.reportingPeriod))].sort();
  const latest = periods[periods.length - 1];
  const rows = rollingAttrition.filter((r) => r.reportingPeriod === latest);
  let sub1Leavers = 0, sub1Hc = 0, over1Leavers = 0, over1Hc = 0;
  for (const r of rows) {
    const cls = classifyTenureBucket(r.tenure);
    if (cls === "sub1yr") {
      sub1Leavers += r.leaversL12m;
      sub1Hc += r.avgHeadcountL12m;
    } else if (cls === "over1yr") {
      over1Leavers += r.leaversL12m;
      over1Hc += r.avgHeadcountL12m;
    }
    // Unknown buckets are dropped — better than silently coercing.
  }
  return {
    under1yrAnnual: sub1Hc > 0 ? sub1Leavers / sub1Hc : 0.34,
    over1yrAnnual: over1Hc > 0 ? over1Leavers / over1Hc : 0.4,
  };
}

export default async function HeadcountPlanningPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [talent, attrition] = await Promise.all([
    getTalentData(),
    getAttritionData(),
  ]);

  // Hire forecast comes from the roster-anchored talent model.
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
      (s) =>
        s.employment.status !== "departed" && s.role === "talent_partner",
    )
    .map((s) => s.recruiter);
  const teamActual = sumToTeamMonthly(histories);
  const latest = teamActual[teamActual.length - 1]?.month ?? null;
  const forecastStart = addMonths(latest ?? now, 1);
  const hireForecast = forecastFromRoster(
    histories,
    activeTpNames,
    forecastStart,
    FORECAST_THROUGH,
    { currentMonth: now },
  );

  // Use the flat P10/P50/P90 band as three hire scenarios for the projection.
  const firstForecastMonth = hireForecast.forecast[0];
  const scenarios = firstForecastMonth
    ? {
        low: firstForecastMonth.low,
        mid: firstForecastMonth.mid,
        high: firstForecastMonth.high,
      }
    : { low: 0, mid: 0, high: 0 };

  // Production attrition source: Mode's rolling-12m tenure-bucketed rates.
  // Matches Lucy's team's methodology and tracks current conditions (unlike
  // pooled KM which averages 3 years of cohort data). For the latest
  // reporting period, collapse Mode's buckets into <1yr vs >1yr.
  const rollingRates = computeRollingRates(attrition.rollingAttrition);
  const productionCurve = buildSurvivalFromRollingRates(rollingRates);

  const projection = projectHeadcount(attrition.employees, FORECAST_THROUGH, {
    hireScenarios: scenarios,
    survivalCurve: productionCurve,
  });

  // Diagnostic: pooled KM survival curve from individual FTE tenures.
  // Kept for the cross-check section so readers can see how the pooled
  // historical curve differs from the rolling-12m team-standard curve.
  const kmCurve = buildSurvivalCurve(attrition.employees);
  const kmProjection = projectHeadcount(attrition.employees, FORECAST_THROUGH, {
    hireScenarios: scenarios,
    survivalCurve: kmCurve,
  });

  // Parallel projection using cohort retention curves (consumer-app
  // "projected DAU from cohort retention" approach). Each past cohort
  // anchors at its observed retention; forward decay uses the KM curve.
  const cohorts = buildEmployeeRetentionCohorts(attrition.employees);
  // Count active FTEs who joined in the current quarter — they're excluded
  // from cohorts (incomplete quarter) but need to be counted for today's
  // cohort-based headcount.
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
    if (!Number.isFinite(start.getTime()) || start < currentQuarterStart)
      return false;
    if (e.terminationDate) {
      const term = new Date(e.terminationDate);
      if (Number.isFinite(term.getTime()) && term <= today) return false;
    }
    return true;
  }).length;
  const cohortProjection = projectFromCohorts(
    cohorts,
    projection.survivalCurve,
    FORECAST_THROUGH,
    { hireScenarios: scenarios, currentQuarterActiveCount },
  );

  const isEmpty =
    attrition.employees.length === 0 || talent.hireRows.length === 0;

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Headcount planning"
        description="Monthly FTE headcount projection through Dec 2027, combining the roster-anchored hire forecast with a Kaplan-Meier retention curve fit to historical FTE tenure."
      />

      <HeadcountPlanningClient
        projection={projection}
        kmProjection={kmProjection}
        cohortProjection={cohortProjection}
        rollingRates={rollingRates}
        hireScenarios={scenarios}
        activeTpCount={activeTpNames.length}
        emptyReason={
          isEmpty
            ? "No data yet — sync the Mode 'Attrition Tracker' and 'Talent' reports."
            : null
        }
      />
    </div>
  );
}
