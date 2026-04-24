import { PageHeader } from "@/components/dashboard/page-header";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { AiUsageDashboard } from "@/components/dashboard/ai-usage-dashboard";
import { AiUsageMetricCard } from "@/components/dashboard/ai-usage-metric-card";
import {
  DataStateBanner,
  UnavailablePage,
} from "@/components/dashboard/page-data-boundary";
import { resolveDataState, safeLoad } from "@/lib/data/data-state";
import {
  buildTopModelTrends,
  buildUserMonthlyTrends,
  getAiUsageData,
  getTrailingWeeklyTotals,
  summariseTotals,
} from "@/lib/data/ai-usage";
import { getActiveEmployees } from "@/lib/data/people";
import {
  getLatestTerminalSyncRun,
  resolveModeStaleReason,
} from "@/lib/data/mode";
import { getModeReportLink } from "@/lib/integrations/mode-config";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getRequiredRoleForDashboardPermission, requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";

const CLAUDE_DATA_START_ISO = "2026-03-23";

export default async function PeopleAiUsagePage() {
  await requireDashboardPermission("dashboard.people.aiUsage");

  // The leaderboard can link through to /dashboard/people/${slug}. Only
  // render those links when the viewer can actually reach the profile page.
  // Everyone else still sees the same data, just without dead-end links.
  let canViewProfiles = false;
  try {
    const [role, requiredRole] = await Promise.all([
      getCurrentUserRole(),
      getRequiredRoleForDashboardPermission("people.profile"),
    ]);
    canViewProfiles = hasAccess(role, requiredRole);
  } catch {
    // Clerk hiccup → degrade to non-linking names rather than breaking.
  }

  const [usageResult, employeesResult, latestSyncRunResult] = await Promise.all(
    [
      safeLoad(() => getAiUsageData(), {
        weeklyByCategory: [],
        weeklyByModel: [],
        monthlyByModel: [],
        monthlyByUser: [],
        syncedAt: null,
        missing: ["Query 1", "Query 3", "MoM Usage", "Overall Data"],
      }),
      safeLoad(() => getActiveEmployees(), {
        employees: [],
        partTimeChampions: [],
        unassigned: [],
        contractors: [],
        allRows: [],
        lastSync: null,
      }),
      safeLoad(() => getLatestTerminalSyncRun("mode"), null),
    ],
  );

  const firstUnavailable =
    usageResult.error ??
    employeesResult.error ??
    latestSyncRunResult.error ??
    null;

  const usage = usageResult.data;
  const employees = employeesResult.data;
  const latestSyncRun = latestSyncRunResult.data;

  const hasAnyData =
    usage.weeklyByCategory.length > 0 ||
    usage.monthlyByUser.length > 0 ||
    usage.monthlyByModel.length > 0;

  const pageState = resolveDataState({
    source: "mode",
    hasData: hasAnyData,
    latestSyncRun,
    error: firstUnavailable,
  });

  if (pageState.kind === "unavailable") {
    return (
      <UnavailablePage
        title="AI Usage"
        description="Claude and Cursor spend across the company, broken down by model and engineer."
        dataTitle="AI Model Usage data from Mode Analytics"
        lastSyncedAt={pageState.lastSyncedAt}
        containerClassName="space-y-6"
      />
    );
  }

  const totals = summariseTotals(usage);
  const modeUrl = getModeReportLink("people", "ai-usage");
  const userTrendsMap = buildUserMonthlyTrends(usage, 6);
  const userTrendsRecord = Object.fromEntries(userTrendsMap);
  const modelTrends = buildTopModelTrends(usage, 9);
  const weeklyTotals = getTrailingWeeklyTotals(usage, 12);
  const weeklySparkValues = weeklyTotals.map((w) => w.cost);

  const allPeople = [
    ...employees.employees,
    ...employees.unassigned,
    ...employees.partTimeChampions,
    ...employees.contractors,
  ];
  const peopleByEmail = new Map<
    string,
    {
      name: string;
      jobTitle: string | null;
      squad: string | null;
      pillar: string | null;
    }
  >();
  for (const person of allPeople) {
    if (!person.email) continue;
    peopleByEmail.set(person.email.toLowerCase(), {
      name: person.name,
      jobTitle: person.jobTitle || null,
      squad: person.squad || null,
      pillar: person.pillar || null,
    });
  }
  const peopleList = [...peopleByEmail.entries()].map(([email, person]) => ({
    email,
    ...person,
  }));

  const monthDelta =
    totals.priorMonthCost > 0
      ? ((totals.latestMonthCost - totals.priorMonthCost) /
          totals.priorMonthCost) *
        100
      : null;
  const trailing30Delta =
    totals.prior30DayCost > 0
      ? ((totals.trailing30DayCost - totals.prior30DayCost) /
          totals.prior30DayCost) *
        100
      : null;
  const userDelta =
    totals.priorMonthUsers > 0
      ? ((totals.latestMonthUsers - totals.priorMonthUsers) /
          totals.priorMonthUsers) *
        100
      : null;

  const emptyReason = resolveModeStaleReason(
    !hasAnyData,
    latestSyncRun,
    "Sync the AI Model Usage Dashboard report to populate this page.",
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="AI Usage"
        description="Claude and Cursor spend across the company, broken down by model and engineer."
      />

      <DataStateBanner
        pageState={pageState}
        title="AI Model Usage data from Mode Analytics"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AiUsageMetricCard
          label="Trailing 30 days"
          value={formatCurrency(totals.trailing30DayCost)}
          deltaPct={trailing30Delta}
          subtitle={
            totals.prior30DayCost > 0
              ? `vs ${formatCurrency(totals.prior30DayCost)} prior 30d`
              : "first month of data"
          }
          modeUrl={modeUrl}
          sparkline={weeklySparkValues}
        />
        <AiUsageMetricCard
          label={`${formatMonth(totals.latestMonthStart)} spend`}
          value={formatCurrency(totals.latestMonthCost)}
          deltaPct={monthDelta}
          subtitle={
            totals.priorMonthCost > 0
              ? `vs ${formatCurrency(totals.priorMonthCost)} last month`
              : undefined
          }
          modeUrl={modeUrl}
          sparkline={weeklySparkValues}
        />
        <AiUsageMetricCard
          label="Active users (this month)"
          value={totals.latestMonthUsers.toString()}
          deltaPct={userDelta}
          higherIsBetter
          subtitle={
            totals.priorMonthUsers > 0
              ? `${totals.priorMonthUsers} last month`
              : "distinct emails"
          }
          modeUrl={modeUrl}
        />
        <AiUsageMetricCard
          label={`Week of ${formatMonth(totals.latestWeekStart, "short-day")}`}
          value={formatCurrency(totals.latestWeekCost)}
          deltaPct={null}
          subtitle="latest complete week"
          modeUrl={modeUrl}
          sparkline={weeklySparkValues}
          sparklineColor="#7c3aed"
        />
      </div>

      {hasAnyData ? (
        <AiUsageDashboard
          weeklyByCategory={usage.weeklyByCategory}
          monthlyByModel={usage.monthlyByModel}
          monthlyByUser={usage.monthlyByUser}
          userTrends={userTrendsRecord}
          modelTrends={modelTrends}
          people={peopleList}
          claudeDataStart={CLAUDE_DATA_START_ISO}
          canViewProfiles={canViewProfiles}
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/50">
          <p className="text-sm text-muted-foreground">{emptyReason}</p>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Source
        </h3>
        <ModeEmbed
          url={modeUrl}
          title="AI Model Usage Dashboard"
          subtitle="View in Mode"
        />
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function formatMonth(
  iso: string | null,
  variant: "month-year" | "short-day" = "month-year",
): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00Z`);
  if (variant === "short-day") {
    return date.toLocaleDateString("en-GB", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
