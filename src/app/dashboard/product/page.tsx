import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { CohortHeatmap } from "@/components/charts/cohort-heatmap";
import { getUnitEconomicsMetrics, formatCompact } from "@/lib/data/metrics";
import {
  getActiveUsersSeries,
  getEngagementSeries,
  getMauRetentionCohorts,
  getLatestMAU,
} from "@/lib/data/chart-data";

export default async function ProductPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [metrics, activeUsers, engagement, retentionCohorts, latestMAU] =
    await Promise.all([
      getUnitEconomicsMetrics().catch(() => null),
      getActiveUsersSeries().catch(() => ({ dau: [], wau: [], mau: [] })),
      getEngagementSeries().catch(() => []),
      getMauRetentionCohorts().catch(() => []),
      getLatestMAU().catch(() => null),
    ]);

  const modeUrlKpis = "https://app.mode.com/cleoai/reports/11c3172037ac";
  const modeUrlActiveUsers = "https://app.mode.com/cleoai/reports/56f94e35c537";
  const modeUrlRetention = "https://app.mode.com/cleoai/reports/5a033d810ddc";

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        title="Product"
        description="Active users, engagement, and retention"
      />

      {/* Hero strip */}
      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCard label="MAU" value={latestMAU != null ? formatCompact(latestMAU) : "—"} subtitle={latestMAU != null ? "daily, App Active Users" : "awaiting data"} modeUrl={modeUrlActiveUsers} delay={0} />
        <MetricCard label="M11+ CVR" value={metrics?.cvr ?? "—"} subtitle={metrics?.cvr ? "7D avg" : "awaiting data"} modeUrl={modeUrlKpis} delay={50} />
        <MetricCard label="M11 Retention" value="—" subtitle="awaiting data" modeUrl={modeUrlKpis} delay={100} />
        <MetricCard label="DAU/MAU" value="—" subtitle="awaiting data" modeUrl={modeUrlActiveUsers} delay={150} />
      </div>

      {/* ── Active Users ── */}
      <section className="space-y-6">
        <SectionDivider
          title="Active Users"
          subtitle="Monthly, weekly, and daily active users over time"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          {activeUsers.mau.length > 0 && (
            <ColumnChart
              data={activeUsers.mau}
              title="MAU"
              subtitle="Monthly avg"
              yLabel="Users"
              color="#3b3bba"
              modeUrl={modeUrlActiveUsers}
            />
          )}
          {activeUsers.wau.length > 0 && (
            <ColumnChart
              data={activeUsers.wau}
              title="WAU"
              subtitle="Weekly avg · last 26 weeks"
              yLabel="Users"
              color="#6366f1"
              modeUrl={modeUrlActiveUsers}
            />
          )}
          {activeUsers.dau.length > 0 && (
            <ColumnChart
              data={activeUsers.dau}
              title="DAU"
              subtitle="Daily · last 90 days"
              yLabel="Users"
              color="#8b5cf6"
              modeUrl={modeUrlActiveUsers}
            />
          )}
        </div>

        {activeUsers.mau.length === 0 && (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Sync the App Active Users report to view charts
            </p>
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2">
          <ModeEmbed url={modeUrlActiveUsers} title="App Active Users" subtitle="View in Mode" />
          <ModeEmbed url={modeUrlKpis} title="Strategic Finance KPIs" subtitle="View in Mode" />
        </div>
      </section>

      {/* ── Engagement ── */}
      <section className="space-y-6">
        <SectionDivider
          title="Engagement"
          subtitle="How frequently do users return?"
        />

        {engagement.length > 0 ? (
          <LineChart
            series={engagement}
            title="Engagement Ratios"
            subtitle="Monthly trend"
            yLabel="%"
            yFormatType="percent"
            modeUrl={modeUrlActiveUsers}
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Sync the App Active Users report to view engagement
            </p>
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2">
          <ModeEmbed url={modeUrlActiveUsers} title="App Active Users" subtitle="View in Mode" />
        </div>
      </section>

      {/* ── Retention ── */}
      <section className="space-y-6">
        <SectionDivider
          title="Retention"
          subtitle="How well do we retain MAUs over time?"
        />

        {retentionCohorts.length > 0 ? (
          <CohortHeatmap
            data={retentionCohorts}
            periodLabel="Month"
            title="MAU Retention"
            subtitle="Monthly cohort triangle"
            modeUrl="https://app.mode.com/cleoai/reports/5a033d810ddc"
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Sync the App Retention report to view MAU retention cohorts
            </p>
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2">
          <ModeEmbed url={modeUrlRetention} title="App Retention" subtitle="View in Mode" />
        </div>
      </section>
    </div>
  );
}
