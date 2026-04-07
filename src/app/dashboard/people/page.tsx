import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { BarChart } from "@/components/charts/bar-chart";
import { PeopleDirectory } from "@/components/dashboard/people-directory";
import { getHeadcountByDepartment } from "@/lib/data/chart-data";
import { getChartEmbeds } from "@/lib/integrations/mode-config";
import {
  getActiveEmployees,
  getPeopleMetrics,
  groupByPillarAndSquad,
  getTenureDistribution,
} from "@/lib/data/people";

export default async function PeoplePage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [{ employees, allRows, lastSync }, deptData] = await Promise.all([
    getActiveEmployees().catch(() => ({
      employees: [],
      allRows: [] as Record<string, unknown>[],
      lastSync: null as Date | null,
    })),
    getHeadcountByDepartment().catch(() => []),
  ]);

  const metrics = getPeopleMetrics(employees, allRows);
  const tenureData = getTenureDistribution(employees);
  const byPillar = groupByPillarAndSquad(employees);
  const headcountCharts = getChartEmbeds("people", "headcount");

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

  const modeUrl = "https://app.mode.com/cleoai/reports/c458b52ceb68";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="People"
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
      {tenureData.some((d) => d.value > 0) && (
        <BarChart
          data={tenureData}
          title="Tenure Distribution"
          subtitle={`${metrics.total} employees`}
          modeUrl={modeUrl}
        />
      )}

      {/* Team directory */}
      {employees.length > 0 && (
        <PeopleDirectory pillars={serializedPillars} />
      )}

      {/* Mode report links */}
      {headcountCharts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Mode Reports
          </h3>
          {headcountCharts.map((chart) => (
            <ModeEmbed
              key={chart.url}
              url={chart.url}
              title={chart.title}
              subtitle="View in Mode"
            />
          ))}
        </div>
      )}
    </div>
  );
}
