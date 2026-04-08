import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { PermissionGate } from "@/components/dashboard/permission-gate";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { ArrowUpRight, Calculator, PoundSterling, BarChart3, Target, Users } from "lucide-react";
import Link from "next/link";
import { getUnitEconomicsMetrics, getHeadcountMetrics, formatCompact } from "@/lib/data/metrics";
import { getLatestLtvCacRatio, getLatestMAU } from "@/lib/data/chart-data";
import { getLatestARR } from "@/lib/data/management-accounts";

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
  const [metrics, headcount, ltvCacRatio, latestARR, latestMAU] =
    await Promise.all([
      getUnitEconomicsMetrics().catch(() => null),
      getHeadcountMetrics().catch(() => null),
      getLatestLtvCacRatio().catch(() => null),
      getLatestARR().catch(() => null),
      getLatestMAU().catch(() => null),
    ]);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
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
              description="LTV, CAC, ARPU, retention"
            />
          </PermissionGate>
          <PermissionGate role={role} requiredRole="ceo">
            <SectionLink
              href="/dashboard/financial"
              icon={PoundSterling}
              title="Financial"
              description="Management accounts, FP&A"
            />
          </PermissionGate>
          <PermissionGate role={role} requiredRole="leadership">
            <SectionLink
              href="/dashboard/product"
              icon={BarChart3}
              title="Product"
              description="Usage, activation, retention"
            />
          </PermissionGate>
          <SectionLink
            href="/dashboard/okrs"
            icon={Target}
            title="OKRs"
            description="Company, pillar, and squad objectives"
          />
          <PermissionGate role={role} requiredRole="leadership">
            <SectionLink
              href="/dashboard/people"
              icon={Users}
              title="People"
              description="Performance, engagement"
            />
          </PermissionGate>
        </div>
      </div>

      {/* Bottom detail cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PermissionGate role={role} requiredRole="leadership">
          <SectionCard
            title="Key Ratios"
            description="From Strategic Finance KPIs"
            action={
              <a
                href="https://app.mode.com/cleoai/reports/11c3172037ac"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Mode
                <ArrowUpRight className="h-3 w-3" />
              </a>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Gross Margin", value: metrics?.grossMargin },
                { label: "Contribution Margin", value: metrics?.contributionMargin },
                { label: "M11+ CVR", value: metrics?.cvr },
                { label: "Blended CPA", value: metrics?.cpa },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="font-display text-lg text-foreground">
                    {item.value ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        </PermissionGate>

        <SectionCard
          title="Recent Activity"
          description="Latest updates"
        >
          <div className="space-y-3">
            {[
              { text: "Mode data synced", time: "1.2M records across 8 reports", dot: "bg-positive" },
              { text: "Dashboard live", time: "Phase 1 complete", dot: "bg-primary" },
            ].map((activity) => (
              <div key={activity.text} className="flex items-start gap-3">
                <div className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${activity.dot}`} />
                <div className="flex-1">
                  <p className="text-sm text-foreground">{activity.text}</p>
                  <p className="text-xs text-muted-foreground">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
