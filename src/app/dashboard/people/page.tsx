import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { DepartmentDrilldown } from "@/components/dashboard/department-drilldown";
import { JoinersLeaversDrilldown } from "@/components/dashboard/joiners-leavers-drilldown";
import { TenureDrilldown } from "@/components/dashboard/tenure-drilldown";
import { PeopleDirectory } from "@/components/dashboard/people-directory";
import { HcViewToggle, type HcView } from "@/components/dashboard/hc-view-toggle";
import { PlannedOrgBreakdown } from "@/components/dashboard/planned-org-breakdown";
import {
  DataStateBanner,
  UnavailablePage,
} from "@/components/dashboard/page-data-boundary";
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
import {
  getHcPlan,
  reconcileHcPlanByPillar,
} from "@/lib/data/hc-plan";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";

export default async function PeopleOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireDashboardPermission("dashboard.people");

  const params = await searchParams;
  const view: HcView = params.view === "planned" ? "planned" : "current";

  const [employeesResult, deptDataResult, latestSyncRunResult] =
    await Promise.all([
      safeLoad(() => getActiveEmployees(), {
        employees: [],
        partTimeChampions: [],
        unassigned: [],
        contractors: [],
        allRows: [],
        lastSync: null,
      }),
      safeLoad(() => getHeadcountByDepartment(), []),
      safeLoad(() => getLatestTerminalSyncRun("mode"), null),
    ]);

  const firstUnavailable =
    employeesResult.error ?? deptDataResult.error ?? latestSyncRunResult.error;

  const { employees, partTimeChampions, unassigned, contractors, allRows } =
    employeesResult.data;
  // For the planned-view reconciliation only, strip Customer Success so its
  // baseline matches the sheet's CS-stripped numbers. Current view stays on
  // the unfiltered Mode data so the existing Headcount card / Department
  // chart / Tenure distribution don't silently drop CS people.
  const isCs = (fn: string) =>
    fn === "Customer Success" || fn.startsWith("Customer Success,");
  const employeesNoCs = employees.filter((p) => !isCs(p.function));
  const unassignedNoCs = unassigned.filter((p) => !isCs(p.function));
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
      <UnavailablePage
        title="Org"
        description="Headcount, team structure, and workforce metrics"
        dataTitle="Org data from Mode Analytics"
        lastSyncedAt={pageState.lastSyncedAt}
        containerClassName="space-y-6"
      />
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

  const hcPlan = getHcPlan();
  // Reconcile sheet deltas against live Mode pillar counts so "Today" matches
  // the current view's headcount and planned = today + hires (not sheet's
  // own baseline, which differs from Mode by ~50 people from snapshot drift).
  // Use the CS-stripped Mode data so the baseline matches the sheet's
  // CS-stripped numbers; include unassigned as their own pseudo-pillar so
  // totals match the directory count of (employees + unassigned).
  const byPillarNoCs = groupByPillarAndSquad(employeesNoCs);
  const modePillarsForReconcile = byPillarNoCs.map((p) => ({
    name: p.name,
    count: p.count,
  }));
  if (unassignedNoCs.length > 0) {
    modePillarsForReconcile.push({
      name: "Unassigned",
      count: unassignedNoCs.length,
    });
  }
  // Engineering (Temp) is a sheet-only holding squad for new engineers
  // awaiting permanent assignment. Mode counts those people under their
  // destination pillar, so register it as a Mode pseudo-pillar with count=0
  // to avoid double-counting while still showing its incoming hires inline.
  modePillarsForReconcile.push({ name: "Engineering (Temp)", count: 0 });
  const reconciled = reconcileHcPlanByPillar(modePillarsForReconcile);
  const hcPlanTotals = reconciled.totals;
  const reconciledPillars = reconciled.pillars;
  const unmatchedDepartments = reconciled.unmatchedSheetDepartments;
  const futureHires =
    hcPlanTotals.hiredOfferOut + hcPlanTotals.inPipeline + hcPlanTotals.t2Hire;
  const engTempPillar = reconciledPillars.find(
    (p) => p.pillar === "Engineering (Temp)"
  );
  const engTempPlanned = engTempPillar?.totalHc ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Org"
        description="Headcount, team structure, and workforce metrics"
      >
        <HcViewToggle current={view} />
      </PageHeader>

      <DataStateBanner
        pageState={pageState}
        title="Org data from Mode Analytics"
      />

      {view === "current" && (
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
      )}

      {view === "planned" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Today"
            value={hcPlanTotals.currentEmployees.toString()}
            subtitle="active employees"
            delay={0}
          />
          <MetricCard
            label="Planned"
            value={hcPlanTotals.totalHc.toString()}
            change={`+${futureHires}`}
            trend="up"
            subtitle="incl. pipeline + T2"
            delay={50}
          />
          <MetricCard
            label="Hired / Offer out"
            value={hcPlanTotals.hiredOfferOut.toString()}
            subtitle="signed, not yet started"
            delay={100}
          />
          <MetricCard
            label="Pipeline + T2"
            value={(hcPlanTotals.inPipeline + hcPlanTotals.t2Hire).toString()}
            subtitle={`${hcPlanTotals.inPipeline} active · ${hcPlanTotals.t2Hire} T2 plan`}
            delay={150}
          />
        </div>
      )}

      {view === "planned" && (
        <PlannedOrgBreakdown
          departments={reconciledPillars.map((p) => ({
            department: p.pillar,
            teams: p.teams,
            currentEmployees: p.currentEmployees,
            hiredOfferOut: p.hiredOfferOut,
            inPipeline: p.inPipeline,
            t2Hire: p.t2Hire,
            totalHc: p.totalHc,
          }))}
          totals={hcPlanTotals}
          snapshotDate={hcPlan.snapshotDate}
          source={hcPlan.source}
        />
      )}

      {view === "planned" && (
        <div className="rounded-xl border border-border/60 bg-card/50 p-6 shadow-warm">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            How these numbers are calculated
          </h3>

          <div className="mt-4 space-y-4 text-sm leading-relaxed text-foreground/80">
            <p>
              The <strong>Today</strong> count for each pillar is the live FTE
              headcount from the Mode <em>Headcount SSoT</em> report at the
              time the page loads. It includes only employees with{" "}
              <code className="rounded bg-muted/60 px-1 py-0.5 text-xs">
                employmentType = FTE
              </code>{" "}
              and a pillar/squad assignment. It excludes{" "}
              {partTimeChampions.length} part-time Customer Champions (Mode{" "}
              <code className="rounded bg-muted/60 px-1 py-0.5 text-xs">CS</code>{" "}
              employment type), {contractors.length} contractors (
              <code className="rounded bg-muted/60 px-1 py-0.5 text-xs">
                Contractor
              </code>{" "}
              type), and any employee whose <em>function</em> is &ldquo;Customer
              Success&rdquo;. The {unassigned.length} person without a
              pillar/squad is shown under the <em>Unassigned</em> row so totals
              still match the current view&apos;s headcount.
            </p>

            <p>
              The <strong>Hired / Offer out</strong>,{" "}
              <strong>In pipeline</strong>, and <strong>T2 hire</strong> columns
              come from the{" "}
              <a
                href={hcPlan.source}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
              >
                HC Analysis prior to T2
              </a>{" "}
              spreadsheet, <strong>{hcPlan.sourceTab}</strong> tab, snapshot
              taken <strong>
                {new Date(hcPlan.snapshotDate).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              . That tab contains 80 team-level rows; this view sums them by
              department and joins each department to a Mode pillar by
              normalised name (lowercase, punctuation stripped). All Customer
              Success rows in the sheet are dropped to mirror the Mode-side
              exclusion (3 rows, 19 future hires removed).
            </p>

            <p>
              <strong>Engineering (Temp)</strong> is a holding squad for newly
              hired engineers awaiting permanent assignment. Mode SSoT already
              counts the engineers currently in the pool under their
              destination pillar, so to avoid double-counting this view shows
              Engineering (Temp) with <strong>Today = 0</strong> and{" "}
              <strong>Planned = {engTempPlanned}</strong> (the new hires
              entering the pool).
              When those engineers are assigned to a permanent pillar, both
              Mode and the sheet will reflect the move.
            </p>

            <div>
              <p className="font-semibold text-foreground">
                To reconcile a single pillar manually:
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  Switch to the <em>Current</em> view and find that pillar
                  card in the Team Directory — the <em>X people</em> count is
                  this view&apos;s &ldquo;Today&rdquo; number for the pillar.
                </li>
                <li>
                  Open the source sheet, filter the{" "}
                  <em>HC working sheet (Latest)</em> tab to rows where{" "}
                  <code className="rounded bg-muted/60 px-1 py-0.5 text-xs">
                    Department Name
                  </code>{" "}
                  matches the pillar (case- and punctuation-insensitive), and
                  sum each of the <em>Hired / Offer Out</em>,{" "}
                  <em>In Pipeline</em>, and <em>T2 hire</em> columns.
                </li>
                <li>
                  The pillar row here should equal: Team Directory count +
                  sum of those three sheet columns.
                </li>
              </ol>
            </div>

            <div>
              <p className="font-semibold text-foreground">
                Headline totals on this view:
              </p>
              <ul className="mt-2 space-y-1 pl-5 [&>li]:list-disc">
                <li>
                  <strong>Today {hcPlanTotals.currentEmployees}</strong> = sum
                  of every Mode pillar&apos;s FTE count after the exclusions
                  above.
                </li>
                <li>
                  <strong>
                    Future hires +{futureHires}
                  </strong>{" "}
                  = {hcPlanTotals.hiredOfferOut} hired/offer out +{" "}
                  {hcPlanTotals.inPipeline} in pipeline + {hcPlanTotals.t2Hire}{" "}
                  T2 hire, summed across all included sheet rows.
                </li>
                <li>
                  <strong>Planned {hcPlanTotals.totalHc}</strong> = Today +
                  Future hires.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {view === "planned" && unmatchedDepartments.length > 0 && (
        <details className="rounded-xl border border-amber-500/40 bg-amber-50/40 px-5 py-3">
          <summary className="cursor-pointer select-none text-sm text-amber-900">
            <span className="font-medium">
              {unmatchedDepartments.length} sheet department
              {unmatchedDepartments.length === 1 ? "" : "s"} didn&apos;t match a Mode pillar
            </span>
            <span className="ml-1.5 text-amber-900/70">
              — their hires are still counted in totals but not attributed to a pillar
            </span>
          </summary>
          <ul className="mt-3 space-y-1 text-xs text-amber-900/80">
            {unmatchedDepartments.map((d) => (
              <li key={d.department} className="flex items-center justify-between">
                <span>{d.department}</span>
                <span className="font-mono tabular-nums">
                  +{d.hiredOfferOut + d.inPipeline + d.t2Hire} planned
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Department bar chart with job-title drilldown (includes unassigned — they have valid functions) */}
      {view === "current" && (employees.length > 0 || unassigned.length > 0) && (
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
      {view === "current" && hasTenureData && (
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
      {view === "current" && hasMonthlyMovement && (
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

      {view === "current" && !hasAnyVisualData && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/50">
          <p className="text-sm text-muted-foreground">{headcountEmptyReason}</p>
        </div>
      )}

      {/* Team directory */}
      {view === "current" && employees.length > 0 && (
        <PeopleDirectory pillars={serializedPillars} />
      )}

      {/* Unassigned — no pillar/squad, not Customer Operations */}
      {view === "current" && unassigned.length > 0 && (
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
      {view === "current" && partTimeChampions.length > 0 && (
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

      {/* Contractors — collapsible, excluded from metrics */}
      {view === "current" && contractors.length > 0 && (
        <details className="rounded-xl border border-border/60 bg-card shadow-warm">
          <summary className="cursor-pointer select-none px-5 py-3 text-sm text-muted-foreground hover:text-foreground">
            <span className="font-medium">{contractors.length} contractors</span>
            <span className="ml-1.5 text-muted-foreground/50">— not included in headcount</span>
          </summary>
          <div className="divide-y divide-border/30 border-t border-border/30">
            {contractors.map((p) => (
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
