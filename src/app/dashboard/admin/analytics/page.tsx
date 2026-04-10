import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { ColumnChart } from "@/components/charts/column-chart";
import {
  getDashboardDAU,
  getDashboardRetention,
  getPageViewsBySection,
} from "@/lib/data/dashboard-usage";
import { BarChart3, Eye, TrendingUp } from "lucide-react";

const CohortHeatmap = dynamic(
  () =>
    import("@/components/charts/cohort-heatmap").then((m) => m.CohortHeatmap),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
    ),
  }
);

const TreemapChart = dynamic(
  () =>
    import("@/components/charts/treemap-chart").then((m) => m.TreemapChart),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
    ),
  }
);

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/50 bg-card/50">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) redirect("/dashboard");

  const [dau, retention, sectionViews] = await Promise.all([
    getDashboardDAU(),
    getDashboardRetention(),
    getPageViewsBySection(),
  ]);

  const hasAnyData = dau.length > 0 || retention.length > 0 || sectionViews.length > 0;

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Analytics"
        description="Dashboard usage, retention, and most visited sections"
      />

      {!hasAnyData && (
        <EmptyState
          icon={BarChart3}
          title="No usage data yet"
          description="Page views are tracked automatically as people use the dashboard. Check back in a day or two once the team has visited a few pages."
        />
      )}

      {hasAnyData && (
        <>
          {/* ── Daily Active Users ── */}
          <section className="space-y-6">
            <SectionDivider
              title="Daily Active Users"
              subtitle="Distinct users visiting the dashboard each day"
            />
            {dau.length > 0 ? (
              <ColumnChart
                data={dau}
                title="DAU"
                subtitle="Last 90 days"
                yLabel="Users"
                yFormatType="number"
                color="#3b3bba"
              />
            ) : (
              <EmptyState
                icon={TrendingUp}
                title="No daily activity data yet"
                description="DAU data will appear once users start visiting the dashboard. Each distinct user per day counts as one active user."
              />
            )}
          </section>

          {/* ── Retention ── */}
          <section className="space-y-6">
            <SectionDivider
              title="Weekly Retention"
              subtitle="What percentage of users return in subsequent weeks after their first visit"
            />
            {retention.length > 0 ? (
              <CohortHeatmap
                data={retention}
                periodLabel="Week"
                title="Retention Cohorts"
                subtitle="By week of first visit"
              />
            ) : (
              <EmptyState
                icon={TrendingUp}
                title="Not enough data for retention"
                description="Retention cohorts need at least two weeks of data to show meaningful patterns. Check back soon."
              />
            )}
          </section>

          {/* ── Most Viewed Sections ── */}
          <section className="space-y-6">
            <SectionDivider
              title="Most Viewed Sections"
              subtitle="Where users spend their time across the dashboard (last 30 days)"
            />
            {sectionViews.length > 0 ? (
              <TreemapChart
                data={sectionViews.map((s) => ({
                  label: s.label,
                  value: s.views,
                }))}
                title="Page Views by Section"
                subtitle="Last 30 days"
              />
            ) : (
              <EmptyState
                icon={Eye}
                title="No section data yet"
                description="Section view data will populate as users navigate through different areas of the dashboard."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
