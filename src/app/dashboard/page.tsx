import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { PermissionGate } from "@/components/dashboard/permission-gate";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { ArrowUpRight, Calculator, PoundSterling, BarChart3, Target, Users, Database, Clock, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { getHeadcountMetrics, formatCompact } from "@/lib/data/metrics";
import { getLatestLtvCacRatio, getLatestMAU } from "@/lib/data/chart-data";
import { getLatestARR } from "@/lib/data/management-accounts";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

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
  const [headcount, ltvCacRatio, latestARR, latestMAU, recentSyncs] =
    await Promise.all([
      getHeadcountMetrics().catch(() => null),
      getLatestLtvCacRatio().catch(() => null),
      getLatestARR().catch(() => null),
      getLatestMAU().catch(() => null),
      db
        .select()
        .from(syncLog)
        .orderBy(desc(syncLog.startedAt))
        .limit(10)
        .catch(() => []),
    ]);

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Overview"
        description="Key metrics across the business"
      />

      {/* Hero metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PermissionGate role={role} requiredRole="leadership">
          <MetricCard
            label="LTV:Paid CAC"
            value={ltvCacRatio != null ? `${ltvCacRatio.toFixed(2)}x` : "—"}
            subtitle={ltvCacRatio != null ? "weekly, LTV ÷ Paid CPA" : "awaiting data"}
            modeUrl="https://app.mode.com/cleoai/reports/774f14224dd9"
            delay={0}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="ceo">
          <MetricCard
            label="ARR"
            value={latestARR ? `$${formatCompact(latestARR.value)}` : "—"}
            subtitle={latestARR ? "management accounts" : "awaiting data"}
            delay={50}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="leadership">
          <MetricCard
            label="MAU"
            value={latestMAU != null ? formatCompact(latestMAU) : "—"}
            subtitle={latestMAU != null ? "daily, App Active Users" : "awaiting data"}
            modeUrl="https://app.mode.com/cleoai/reports/56f94e35c537"
            delay={100}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="leadership">
          <MetricCard
            label="Headcount"
            value={headcount?.total?.toString() ?? "—"}
            subtitle={headcount?.total ? "active employees" : "awaiting data"}
            modeUrl="https://app.mode.com/cleoai/reports/c458b52ceb68"
            delay={150}
          />
        </PermissionGate>
      </div>

      {/* Sections grid */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Sections
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PermissionGate role={role} requiredRole="leadership">
            <SectionLink
              href="/dashboard/unit-economics"
              icon={Calculator}
              title="Unit Economics"
              description="LTV:Paid CAC ratio, 36-month LTV by cohort, paid CPA trend, marketing spend and new user acquisition — all from Mode"
            />
          </PermissionGate>
          <PermissionGate role={role} requiredRole="ceo">
            <SectionLink
              href="/dashboard/financial"
              icon={PoundSterling}
              title="Financial"
              description="Embedded P&L Summary, Balance Sheet, Cash Flow, Treasury Dashboard, KPIs, and Headcount from Slack xlsx files"
            />
          </PermissionGate>
          <PermissionGate role={role} requiredRole="leadership">
            <SectionLink
              href="/dashboard/product"
              icon={BarChart3}
              title="Product"
              description="MAU, WAU, and DAU bar charts, WAU/MAU engagement trend, and MAU retention cohort heatmap"
            />
          </PermissionGate>
          <SectionLink
            href="/dashboard/okrs"
            icon={Target}
            title="OKRs"
            description="Key results by pillar and squad, parsed from Slack updates with RAG status indicators"
          />
          <PermissionGate role={role} requiredRole="leadership">
            <SectionLink
              href="/dashboard/people"
              icon={Users}
              title="People"
              description="Team directory with pillar and squad drill-down, headcount by department, joiners and departures from HiBob"
            />
          </PermissionGate>
        </div>
      </div>

      {/* Bottom detail cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Recent Sync Activity"
          description="Data pipeline status"
          action={
            <PermissionGate role={role} requiredRole="ceo">
              <Link
                href="/dashboard/admin/status"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Details
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </PermissionGate>
          }
        >
          <div className="space-y-2.5">
            {recentSyncs.length > 0 ? (
              recentSyncs.map((sync) => {
                const sourceLabels: Record<string, string> = {
                  mode: "Mode Analytics",
                  slack: "Slack OKRs",
                  "management-accounts": "Management Accounts",
                };
                const ago = Math.floor(
                  (Date.now() - sync.startedAt.getTime()) / 60000
                );
                const timeLabel =
                  ago < 60
                    ? `${ago}m ago`
                    : ago < 1440
                      ? `${Math.floor(ago / 60)}h ago`
                      : `${Math.floor(ago / 1440)}d ago`;

                return (
                  <div key={sync.id} className="flex items-center gap-3">
                    {sync.status === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
                    ) : sync.status === "error" ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-warning" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">
                        {sourceLabels[sync.source] ?? sync.source}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {sync.recordsSynced > 0 && (
                        <span>{sync.recordsSynced.toLocaleString()} records</span>
                      )}
                      <span>{timeLabel}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No sync activity yet</p>
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
                  detail: "Unit economics, product metrics, retention cohorts — synced every 4 hours",
                },
                {
                  icon: PoundSterling,
                  label: "Slack → Management Accounts",
                  detail: "Monthly xlsx files from #fyi-management_accounts, parsed server-side",
                },
                {
                  icon: Target,
                  label: "Slack → OKRs",
                  detail: "Key results parsed from pillar channels via Claude — synced every 2 hours",
                },
                {
                  icon: Users,
                  label: "HiBob",
                  detail: "Team directory, tenure, org structure from HR system",
                },
              ].map((source) => (
                <div key={source.label} className="flex items-start gap-2.5">
                  <source.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{source.label}</p>
                    <p className="text-xs text-muted-foreground">{source.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
