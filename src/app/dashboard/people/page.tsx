import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { DepartmentDrilldown } from "@/components/dashboard/department-drilldown";
import { JoinersLeaversDrilldown } from "@/components/dashboard/joiners-leavers-drilldown";
import { TenureDrilldown } from "@/components/dashboard/tenure-drilldown";
import { PeopleDirectory } from "@/components/dashboard/people-directory";
import { DataStateCard } from "@/components/dashboard/data-state-card";
import { getHeadcountByDepartment } from "@/lib/data/chart-data";
import {
  getLatestTerminalSyncRun,
  resolveModeStaleReason,
} from "@/lib/data/mode";
import { resolveDataState, safeLoad } from "@/lib/data/data-state";
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
  getMonthlyMovementPeople,
} from "@/lib/data/people";

export default async function PeopleOrgPage() {
  const [employeesResult, deptDataResult, latestSyncRunResult] =
    await Promise.all([
      safeLoad(() => getActiveEmployees(), {
        employees: [],
        partTimeChampions: [],
        unassigned: [],
        allRows: [],
        lastSync: null,
      }),
      safeLoad(() => getHeadcountByDepartment(), []),
      safeLoad(() => getLatestTerminalSyncRun("mode"), null),
    ]);

  const firstUnavailable =
    employeesResult.error ?? deptDataResult.error ?? latestSyncRunResult.error;

  const { employees, partTimeChampions, unassigned, allRows } =
    employeesResult.data;
  const deptData = deptDataResult.data;
  const latestSyncRun = latestSyncRunResult.data;

  const pageState = resolveDataState({
    source: "mode",
    hasData: employees.length > 0 || unassigned.length > 0 || deptData.length > 0,
    latestSyncRun,
    error: firstUnavailable,
  });

  if (pageState.kind === "unavailable") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Org"
          description="Headcount, team structure, and workforce metrics"
        />
        <DataStateCard
          variant="unavailable"
          title="Org data from Mode Analytics"
          lastSyncedAt={pageState.lastSyncedAt}
        />
      </div>
    );
  }

  const allActive = [...employees, ...unassigned];
  const metrics = getPeopleMetrics(allActive, allRows);
  const tenureData = getTenureDistribution(allActive);
  const byPillar = groupByPillarAndSquad(employees);
  const headcountCharts = getChartEmbeds("people", "headcount");
  const monthlyMovement = getMonthlyJoinersAndDepartures(allRows, 36);
  const movementPeople = getMonthlyMovementPeople(allRows);
  const hasTenureData = tenureData.some((d) => d.value > 0);
  const hasMonthlyMovement = monthlyMovement.joiners.some((d) => d.value > 0);
  const hasAnyVisualData =
    deptData.length > 0 || hasTenureData || hasMonthlyMovement;

  const headcountEmptyReason = resolveModeStaleReason(
    !hasAnyVisualData,
    latestSyncRun,
    "Sync the Headcount SSoT Dashboard report to view org charts"
  );

  const serializedPillars = byPillar.map((pillar) => ({
    name: pillar.name,
    count: pillar.count,
    isProduct: pillar.isProduct,
    squads: pillar.squads.map((sq) => ({
      name: sq.name,
      people: sq.people.map((p) => ({
        name: p.name,
        email: p.email,
        jobTitle: p.jobTitle,
        level: p.level,
        squad: p.squad,
        pillar: p.pillar,
        function: p.function,
        manager: p.manager,
        startDate: p.startDate,
        location: p.location,
        tenureMonths: p.tenureMonths,
        employmentType: p.employmentType,
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

      {pageState.kind === "stale" ? (
        <DataStateCard
          variant="stale"
          title="Org data from Mode Analytics"
          lastSyncedAt={pageState.lastSyncedAt}
        />
      ) : null}

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

      {/* Department bar chart with job-title drilldown (includes unassigned — they have valid functions) */}
      {(employees.length > 0 || unassigned.length > 0) && (
        <DepartmentDrilldown
          employees={[...employees, ...unassigned].map((e) => ({
            name: e.name,
            email: e.email,
            jobTitle: e.jobTitle,
            level: e.level,
            function: e.function,
            squad: e.squad,
            pillar: e.pillar,
            manager: e.manager,
            startDate: e.startDate,
            location: e.location,
            tenureMonths: e.tenureMonths,
            employmentType: e.employmentType,
          }))}
          total={employees.length + unassigned.length}
          modeUrl={modeUrl}
        />
      )}

      {/* Tenure distribution with drilldown */}
      {hasTenureData && (
        <TenureDrilldown
          data={tenureData}
          employees={[...employees, ...unassigned].map((e) => ({
            name: e.name,
            email: e.email,
            jobTitle: e.jobTitle,
            level: e.level,
            function: e.function,
            squad: e.squad,
            pillar: e.pillar,
            manager: e.manager,
            startDate: e.startDate,
            location: e.location,
            tenureMonths: e.tenureMonths,
            employmentType: e.employmentType,
          }))}
          total={metrics.total}
          modeUrl={modeUrl}
        />
      )}

      {/* Joiners & departures — diverging from zero, with drilldown */}
      {hasMonthlyMovement && (
        <JoinersLeaversDrilldown
          chartData={monthlyMovement.joiners.map((j, i) => ({
            date: j.date,
            positive: j.value,
            negative: monthlyMovement.departures[i].value,
          }))}
          joiners={movementPeople.joiners}
          departures={movementPeople.departures}
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

      {/* Unassigned — no pillar/squad, not Customer Operations */}
      {unassigned.length > 0 && (
        <details className="rounded-xl border border-border/60 bg-card shadow-warm">
          <summary className="cursor-pointer select-none px-5 py-3 text-sm text-muted-foreground hover:text-foreground">
            <span className="font-medium">{unassigned.length} unassigned</span>
            <span className="ml-1.5 text-muted-foreground/50">— no pillar or squad assigned</span>
          </summary>
          <div className="divide-y divide-border/30 border-t border-border/30">
            {unassigned.map((p) => (
              <div
                key={p.email}
                className="flex items-center gap-3 px-5 py-2"
              >
                <span className="flex-1 min-w-0 text-sm text-foreground truncate">
                  {p.name}
                </span>
                {(p.jobTitle || p.level) && (
                  <span className="shrink-0 text-xs text-muted-foreground/60">
                    {[p.jobTitle, p.level].filter(Boolean).join(" · ")}
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground/60 tabular-nums">
                  {p.tenureMonths}mo
                </span>
                <span className="shrink-0 text-xs text-muted-foreground/60">
                  {p.function}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Part-time Customer Champions — collapsible, excluded from metrics */}
      {partTimeChampions.length > 0 && (
        <details className="rounded-xl border border-border/60 bg-card shadow-warm">
          <summary className="cursor-pointer select-none px-5 py-3 text-sm text-muted-foreground hover:text-foreground">
            <span className="font-medium">{partTimeChampions.length} part-time Customer Champions</span>
            <span className="ml-1.5 text-muted-foreground/50">— not included in headcount</span>
          </summary>
          <div className="divide-y divide-border/30 border-t border-border/30">
            {partTimeChampions.map((p) => (
              <div
                key={p.email}
                className="flex items-center gap-3 px-5 py-2"
              >
                <span className="flex-1 min-w-0 text-sm text-foreground truncate">
                  {p.name}
                </span>
                {(p.jobTitle || p.level) && (
                  <span className="shrink-0 text-xs text-muted-foreground/60">
                    {[p.jobTitle, p.level].filter(Boolean).join(" · ")}
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground/60 tabular-nums">
                  {p.tenureMonths}mo
                </span>
                <span className="shrink-0 text-xs text-muted-foreground/60">
                  {p.function}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

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
