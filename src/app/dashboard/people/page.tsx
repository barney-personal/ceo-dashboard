import dynamic from "next/dynamic";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { BarChart } from "@/components/charts/bar-chart";

const DivergingBarChart = dynamic(
  () =>
    import("@/components/charts/diverging-bar-chart").then(
      (m) => m.DivergingBarChart
    ),
  {
    loading: () => (
      <div className="h-80 animate-pulse rounded-lg bg-muted/40" />
    ),
  }
);
import { PeopleDirectory } from "@/components/dashboard/people-directory";
import { getHeadcountByDepartment } from "@/lib/data/chart-data";
import { getModeEmptyStateReason } from "@/lib/data/mode";
import {
  getChartEmbeds,
  getModeReportLink,
} from "@/lib/integrations/mode-config";
import {
  getActiveEmployees,
  getPeopleMetrics,
  groupByPillarAndSquad,
  getTenureDistribution,
  getMonthlyJoinersAndDepartures,
} from "@/lib/data/people";

export default async function PeopleOrgPage() {
  const [{ employees, allRows }, deptData, headcountEmptyReason] = await Promise.all([
    getActiveEmployees(),
    getHeadcountByDepartment(),
    getModeEmptyStateReason({
      section: "people",
      category: "headcount",
      emptyReason: "Sync the Headcount SSoT Dashboard report to view org charts",
    }),
  ]);

  const metrics = getPeopleMetrics(employees, allRows);
  const tenureData = getTenureDistribution(employees);
  const byPillar = groupByPillarAndSquad(employees);
  const headcountCharts = getChartEmbeds("people", "headcount");
  const monthlyMovement = getMonthlyJoinersAndDepartures(allRows, 36);
  const hasTenureData = tenureData.some((d) => d.value > 0);
  const hasMonthlyMovement = monthlyMovement.joiners.some((d) => d.value > 0);
  const hasAnyVisualData =
    deptData.length > 0 || hasTenureData || hasMonthlyMovement;

  // Serialize for client component (strip email/manager — not needed in directory UI)
  const serializedPillars = byPillar.map((pillar) => ({
    name: pillar.name,
    count: pillar.count,
    isProduct: pillar.isProduct,
    squads: pillar.squads.map((sq) => ({
      name: sq.name,
      people: sq.people.map((p) => ({
        name: p.name,
        jobTitle: p.jobTitle,
        level: p.level,
        squad: p.squad,
        function: p.function,
        location: p.location,
        tenureMonths: p.tenureMonths,
      })),
    })),
  }));

  const modeUrl = getModeReportLink("people", "headcount");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Org"
        description="Headcount, team structure, and workforce metrics"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Headcount"
          value={metrics.total > 0 ? metrics.total.toString() : "—"}
          subtitle={metrics.total > 0 ? "active employees" : "awaiting data"}
          modeUrl={modeUrl}
          delay={0}
        />
        <MetricCard
          label="Departments"
          value={metrics.departments > 0 ? metrics.departments.toString() : "—"}
          subtitle={metrics.departments > 0 ? "functions" : "awaiting data"}
          modeUrl={modeUrl}
          delay={50}
        />
        <MetricCard
          label="New Hires"
          value={metrics.total > 0 ? metrics.newHiresThisMonth.toString() : "—"}
          subtitle={
            metrics.total > 0
              ? `this month (${metrics.newHiresLastMonth} last month)`
              : "awaiting data"
          }
          modeUrl={modeUrl}
          delay={100}
        />
        <MetricCard
          label="Avg Tenure"
          value={
            metrics.total > 0
              ? metrics.averageTenureMonths >= 12
                ? `${(metrics.averageTenureMonths / 12).toFixed(1)}y`
                : `${metrics.averageTenureMonths}mo`
              : "—"
          }
          subtitle={
            metrics.total > 0
              ? `${metrics.attritionLast90Days} departures (90d)`
              : "awaiting data"
          }
          modeUrl={modeUrl}
          delay={150}
        />
      </div>

      {/* Department bar chart */}
      {deptData.length > 0 && (
        <BarChart
          data={deptData}
          title="Headcount by Department"
          subtitle={`${metrics.total} total`}
          modeUrl={modeUrl}
        />
      )}

      {/* Tenure distribution */}
      {hasTenureData && (
        <BarChart
          data={tenureData}
          title="Tenure Distribution"
          subtitle={`${metrics.total} employees`}
          modeUrl={modeUrl}
        />
      )}

      {/* Joiners & departures — diverging from zero */}
      {hasMonthlyMovement && (
        <DivergingBarChart
          data={monthlyMovement.joiners.map((j, i) => ({
            date: j.date,
            positive: j.value,
            negative: monthlyMovement.departures[i].value,
          }))}
          title="Joiners & Departures"
          subtitle="last 3 years, monthly"
          modeUrl={modeUrl}
        />
      )}

      {!hasAnyVisualData && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/50">
          <p className="text-sm text-muted-foreground">{headcountEmptyReason}</p>
        </div>
      )}

      {/* Team directory */}
      {employees.length > 0 && <PeopleDirectory pillars={serializedPillars} />}

      {/* Source links */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Sources
        </h3>
        <ModeEmbed
          url="https://docs.google.com/spreadsheets/d/1NChFRIbocVFvMsqSF00MLnAlPAC5thVai7yR88KU4yA/edit?usp=sharing"
          title="Org Chart"
          subtitle="View in Google Sheets"
        />
        {headcountCharts.map((chart) => (
          <ModeEmbed
            key={chart.url}
            url={chart.url}
            title={chart.title}
            subtitle="View in Mode"
          />
        ))}
      </div>
    </div>
  );
}
