import { auth } from "@clerk/nextjs/server";
import { getCurrentUserRole, getImpersonation } from "@/lib/auth/roles.server";
import { PermissionGate } from "@/components/dashboard/permission-gate";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { TodayMeetings } from "@/components/dashboard/today-meetings";
import {
  ArrowUpRight,
  Calculator,
  PoundSterling,
  BarChart3,
  Target,
  Users,
  Database,
  Calendar,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { getHeadcountMetrics } from "@/lib/data/metrics";
import { getLatestLtvCacRatio, getLatestMAU } from "@/lib/data/chart-data";
import { getLatestARR } from "@/lib/data/management-accounts";
import { getRecentSyncRuns } from "@/lib/data/sync";
import { getMeetingsForRange } from "@/lib/data/meetings";
import { getUserGoogleAccessToken } from "@/lib/auth/google-token.server";
import { formatCompact } from "@/lib/format/number";
import { getModeReportLink } from "@/lib/integrations/mode-config";
import { getEffectiveSyncState } from "@/lib/sync/config";

function SectionLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card p-4 shadow-warm transition-all duration-200 hover:shadow-warm-lg"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary transition-colors group-hover:bg-primary/10">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-all group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

export default async function DashboardOverview() {
  const role = await getCurrentUserRole();
  const { userId: realUserId } = await auth();
  const impersonation = await getImpersonation();

  // Use the impersonated user's ID when active, otherwise the real user
  const effectiveUserId = impersonation?.userId ?? realUserId;

  const accessToken = effectiveUserId
    ? await getUserGoogleAccessToken(effectiveUserId)
    : null;

  // Today's date range for meetings
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  const [headcount, ltvCacRatio, latestARR, latestMAU, recentSyncs, todayMeetings] =
    await Promise.all([
      getHeadcountMetrics(),
      getLatestLtvCacRatio(),
      getLatestARR(),
      getLatestMAU(),
      getRecentSyncRuns(10),
      getMeetingsForRange(todayStart, todayEnd, {
        accessToken: accessToken ?? undefined,
        userId: effectiveUserId ?? undefined,
      }),
    ]);

  const todayData = todayMeetings[0] ?? null;

  const syncEntries = recentSyncs.map((sync) => {
    const sourceLabels: Record<string, string> = {
      mode: "Mode Analytics",
      slack: "Slack OKRs",
      "management-accounts": "Management Accounts",
      meetings: "Meetings",
    };
    return {
      id: sync.id,
      source: sourceLabels[sync.source] ?? sync.source,
      status: getEffectiveSyncState(sync, new Date()),
      recordsSynced: sync.recordsSynced,
      startedAt: sync.startedAt.toISOString(),
    };
  });

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Overview"
        description="Key metrics across the business"
      />

      {/* Hero metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PermissionGate role={role} requiredRole="everyone">
          <MetricCard
            label="LTV:Paid CAC"
            value={ltvCacRatio != null ? `${ltvCacRatio.toFixed(2)}x` : "—"}
            subtitle={
              ltvCacRatio != null ? "weekly, LTV ÷ Paid CPA" : "awaiting data"
            }
            modeUrl={getModeReportLink("unit-economics", "cac")}
            delay={0}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="leadership">
          <MetricCard
            label="ARR"
            value={latestARR ? `$${formatCompact(latestARR.value)}` : "—"}
            subtitle={latestARR ? "management accounts" : "awaiting data"}
            delay={50}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="everyone">
          <MetricCard
            label="MAU"
            value={latestMAU != null ? formatCompact(latestMAU) : "—"}
            subtitle={
              latestMAU != null ? "monthly, App Active Users" : "awaiting data"
            }
            modeUrl={getModeReportLink("product", "active-users")}
            delay={100}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="everyone">
          <MetricCard
            label="Headcount"
            value={headcount?.total?.toString() ?? "—"}
            subtitle={headcount?.total ? "active employees" : "awaiting data"}
            modeUrl={getModeReportLink("people", "headcount")}
            delay={150}
          />
        </PermissionGate>
      </div>

      {/* Today's meetings */}
      <TodayMeetings day={todayData} calendarConnected={!!accessToken} />

      {/* Sections grid */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Sections
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SectionLink
            href="/dashboard/unit-economics"
            icon={Calculator}
            title="Unit Economics"
            description="LTV:Paid CAC ratio, 36-month LTV by cohort, paid CPA trend, marketing spend and new user acquisition — all from Mode"
          />
          <PermissionGate role={role} requiredRole="leadership">
            <SectionLink
              href="/dashboard/financial"
              icon={PoundSterling}
              title="Financial"
              description="Embedded P&L Summary, Balance Sheet, Cash Flow, Treasury Dashboard, KPIs, and Headcount from Slack xlsx files"
            />
          </PermissionGate>
          <SectionLink
            href="/dashboard/product"
            icon={BarChart3}
            title="Product"
            description="MAU, WAU, and DAU bar charts, WAU/MAU engagement trend, and MAU retention cohort heatmap"
          />
          <SectionLink
            href="/dashboard/okrs"
            icon={Target}
            title="OKRs"
            description="Key results by pillar and squad, parsed from Slack updates with RAG status indicators"
          />
          <SectionLink
            href="/dashboard/meetings"
            icon={Calendar}
            title="Meetings"
            description="Your calendar, meeting notes from Granola, and pre-reads from Slack"
          />
          <SectionLink
            href="/dashboard/people"
            icon={Users}
            title="People"
            description="Team directory with pillar and squad drill-down, headcount by department, joiners and departures"
          />
        </div>
      </div>

      {/* Bottom detail cards — CEO only */}
      <PermissionGate role={role} requiredRole="ceo">
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Recent Sync Activity"
            description="Data pipeline status"
            action={
              <Link
                href="/dashboard/admin/status"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Details
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          >
            <div className="space-y-2.5">
              {syncEntries.length > 0 ? (
                syncEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3">
                    {entry.status === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
                    ) : entry.status === "partial" ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
                    ) : entry.status === "queued" ? (
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 text-warning" />
                    ) : entry.status === "abandoned" ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    ) : entry.status === "error" ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-warning" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{entry.source}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {entry.recordsSynced > 0 && (
                        <span>
                          {entry.recordsSynced.toLocaleString()} records
                        </span>
                      )}
                      <time dateTime={entry.startedAt}>
                        {new Date(entry.startedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No sync activity yet
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="About This Dashboard"
            description="Data sources and how it works"
          >
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="space-y-2">
                {[
                  {
                    icon: Database,
                    label: "Mode Analytics",
                    detail:
                      "Unit economics, product metrics, retention cohorts — synced every 4 hours",
                  },
                  {
                    icon: PoundSterling,
                    label: "Slack → Management Accounts",
                    detail:
                      "Monthly xlsx files from #fyi-management_accounts, parsed server-side",
                  },
                  {
                    icon: Target,
                    label: "Slack → OKRs",
                    detail:
                      "Key results parsed from pillar channels via Claude — synced every 2 hours",
                  },
                  {
                    icon: Calendar,
                    label: "Google Calendar + Granola",
                    detail:
                      "Per-user calendar events via OAuth, meeting notes from Granola API",
                  },
                  {
                    icon: Users,
                    label: "HiBob",
                    detail:
                      "Team directory, tenure, org structure from HR system",
                  },
                ].map((source) => (
                  <div key={source.label} className="flex items-start gap-2.5">
                    <source.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {source.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {source.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>
      </PermissionGate>
    </div>
  );
}
