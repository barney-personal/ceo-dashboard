import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { AiUsageDashboard } from "@/components/dashboard/ai-usage-dashboard";
import {
  DataStateBanner,
  UnavailablePage,
} from "@/components/dashboard/page-data-boundary";
import { resolveDataState, safeLoad } from "@/lib/data/data-state";
import { getAiUsageData, summariseTotals } from "@/lib/data/ai-usage";
import { getActiveEmployees } from "@/lib/data/people";
import {
  getLatestTerminalSyncRun,
  resolveModeStaleReason,
} from "@/lib/data/mode";
import { getModeReportLink } from "@/lib/integrations/mode-config";

export default async function PeopleAiUsagePage() {
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

  // Map user email → person name/squad/pillar so the page can display
  // nice "who is this?" metadata instead of raw emails.
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
        <MetricCard
          label="Spend (all time)"
          value={formatCurrency(totals.totalCost)}
          subtitle={`${formatTokens(totals.totalTokens)} tokens`}
          modeUrl={modeUrl}
        />
        <MetricCard
          label={`${formatMonth(totals.latestMonthStart)} spend`}
          value={formatCurrency(totals.latestMonthCost)}
          change={
            monthDelta != null
              ? `${monthDelta > 0 ? "+" : ""}${monthDelta.toFixed(0)}% MoM`
              : undefined
          }
          trend={
            monthDelta == null
              ? undefined
              : monthDelta > 3
                ? "up"
                : monthDelta < -3
                  ? "down"
                  : "flat"
          }
          subtitle={
            totals.priorMonthCost > 0
              ? `vs ${formatCurrency(totals.priorMonthCost)} prior month`
              : "first month of data"
          }
          modeUrl={modeUrl}
          delay={50}
        />
        <MetricCard
          label="Active users (last month)"
          value={totals.totalUsers.toString()}
          subtitle="distinct emails"
          modeUrl={modeUrl}
          delay={100}
        />
        <MetricCard
          label={`Week of ${formatMonth(totals.latestWeekStart, "short-day")}`}
          value={formatCurrency(totals.latestWeekCost)}
          subtitle="latest complete week"
          modeUrl={modeUrl}
          delay={150}
        />
      </div>

      {hasAnyData ? (
        <AiUsageDashboard
          weeklyByCategory={usage.weeklyByCategory}
          weeklyByModel={usage.weeklyByModel}
          monthlyByModel={usage.monthlyByModel}
          monthlyByUser={usage.monthlyByUser}
          people={peopleList}
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

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  return value.toLocaleString();
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
