import dynamic from "next/dynamic";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";

const CohortHeatmap = dynamic(
  () =>
    import("@/components/charts/cohort-heatmap").then((m) => m.CohortHeatmap),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
    ),
  }
);
import { formatCompact, formatPercent } from "@/lib/format/number";
import {
  getActiveUsersSeries,
  getEngagementSeries,
  getMauRetentionCohorts,
  getLatestMAU,
  getLatestWauMau,
  getLatestM11Retention,
} from "@/lib/data/chart-data";
import {
  getLatestTerminalSyncRun,
  resolveModeStaleReason,
} from "@/lib/data/mode";
import { getModeReportLink } from "@/lib/integrations/mode-config";

export default async function ProductPage() {
  const [
    activeUsers,
    engagement,
    retentionCohorts,
    latestMAU,
    latestWauMau,
    latestM11,
    latestSyncRun,
  ] = await Promise.all([
    getActiveUsersSeries(),
    getEngagementSeries(),
    getMauRetentionCohorts(),
    getLatestMAU(),
    getLatestWauMau(),
    getLatestM11Retention(),
    getLatestTerminalSyncRun("mode"),
  ]);

  const activeUsersChartsEmptyReason = resolveModeStaleReason(
    activeUsers.mau.length === 0,
    latestSyncRun,
    "Sync the App Active Users report to view charts"
  );
  const activeUsersEngagementEmptyReason = resolveModeStaleReason(
    engagement.length === 0,
    latestSyncRun,
    "Sync the App Active Users report to view engagement"
  );
  const retentionEmptyReason = resolveModeStaleReason(
    retentionCohorts.length === 0,
    latestSyncRun,
    "Sync the App Retention report to view MAU retention cohorts"
  );

  const modeUrlKpis = getModeReportLink("unit-economics", "kpis");
  const modeUrlActiveUsers = getModeReportLink("product", "active-users");
  const modeUrlRetention = getModeReportLink("product", "retention");

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Product"
        description="Active users, engagement, and retention"
      />

      {/* Hero strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="MAU"
          value={latestMAU != null ? formatCompact(latestMAU) : "—"}
          subtitle={
            latestMAU != null ? "monthly, App Active Users" : "awaiting data"
          }
          modeUrl={modeUrlActiveUsers}
          delay={0}
        />
        <MetricCard
          label="M11 Retention"
          value={latestM11 != null ? formatPercent(latestM11) : "—"}
          subtitle={
            latestM11 != null ? "latest cohort with M11 data" : "awaiting data"
          }
          modeUrl={modeUrlRetention}
          delay={50}
        />
        <MetricCard
          label="WAU / MAU"
          value={latestWauMau != null ? `${latestWauMau.toFixed(1)}%` : "—"}
          subtitle={
            latestWauMau != null ? "last complete month" : "awaiting data"
          }
          modeUrl={modeUrlActiveUsers}
          delay={100}
        />
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
              {activeUsersChartsEmptyReason}
            </p>
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2">
          <ModeEmbed
            url={modeUrlActiveUsers}
            title="App Active Users"
            subtitle="View in Mode"
          />
          <ModeEmbed
            url={modeUrlKpis}
            title="Strategic Finance KPIs"
            subtitle="View in Mode"
          />
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
            title="WAU / MAU"
            subtitle="Monthly trend"
            yLabel="%"
            yFormatType="percent"
            zoomY
            modeUrl={modeUrlActiveUsers}
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              {activeUsersEngagementEmptyReason}
            </p>
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2">
          <ModeEmbed
            url={modeUrlActiveUsers}
            title="App Active Users"
            subtitle="View in Mode"
          />
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
            modeUrl={modeUrlRetention}
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              {retentionEmptyReason}
            </p>
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2">
          <ModeEmbed
            url={modeUrlRetention}
            title="App Retention"
            subtitle="View in Mode"
          />
        </div>
      </section>
    </div>
  );
}
