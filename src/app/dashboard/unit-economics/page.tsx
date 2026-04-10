import dynamic from "next/dynamic";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { AlertTriangle } from "lucide-react";
import {
  getLtvTimeSeries,
  getLtvCacRatioSeries,
  getQuery3Series,
  getSubscriptionRetentionCohorts,
} from "@/lib/data/chart-data";
import {
  getLatestTerminalSyncRun,
  resolveModeStaleReason,
} from "@/lib/data/mode";
import {
  getChartEmbeds,
  getModeReportLink,
} from "@/lib/integrations/mode-config";

const RetentionTriangle = dynamic(
  () =>
    import("@/components/charts/retention-triangle").then(
      (m) => m.RetentionTriangle,
    ),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
    ),
  },
);

function ChartPlaceholder({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="border-b border-border/50 px-5 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex h-48 items-center justify-center gap-3 p-5">
        <AlertTriangle className="h-5 w-5 text-warning" />
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}

export default async function UnitEconomicsPage() {
  const [ltvSeries, ltvCacRatio, q3, retentionTiers, latestSyncRun] =
    await Promise.all([
      getLtvTimeSeries(),
      getLtvCacRatioSeries(),
      getQuery3Series(),
      getSubscriptionRetentionCohorts(),
      getLatestTerminalSyncRun("mode"),
    ]);

  const anyKpisEmpty =
    ltvCacRatio.length === 0 ||
    ltvSeries.length === 0 ||
    q3.cpa.length === 0 ||
    q3.spend.length === 0 ||
    q3.users.length === 0;
  const kpisEmptyReason = resolveModeStaleReason(
    anyKpisEmpty,
    latestSyncRun,
    "No data — sync Mode 'Strategic Finance KPIs' report"
  );

  const modeUrl = getModeReportLink("unit-economics", "kpis");

  const allEmbeds = [
    {
      label: "Strategic Finance KPIs",
      charts: getChartEmbeds("unit-economics", "kpis"),
    },
    {
      label: "Conversion",
      charts: getChartEmbeds("unit-economics", "conversion"),
    },
    {
      label: "Retention",
      charts: getChartEmbeds("unit-economics", "retention"),
    },
    {
      label: "COGs / Arrears",
      charts: getChartEmbeds("unit-economics", "cogs"),
    },
    {
      label: "Growth Marketing",
      charts: getChartEmbeds("unit-economics", "cac"),
    },
  ].filter((g) => g.charts.length > 0);

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Unit Economics"
        description="Customer lifetime value and acquisition costs"
      />

      {/* LTV:Paid CAC ratio */}
      {ltvCacRatio.length > 0 ? (
        <LineChart
          series={ltvCacRatio}
          title="LTV:Paid CAC"
          subtitle="Weekly, LTV ÷ Paid CPA"
          yLabel="x"
          yFormatType="number"
          modeUrl={modeUrl}
        />
      ) : (
        <ChartPlaceholder title="LTV:Paid CAC" reason={kpisEmptyReason} />
      )}

      {/* LTV over time */}
      {ltvSeries.length > 0 ? (
        <ColumnChart
          data={ltvSeries}
          title="36-Month LTV"
          subtitle="By cohort month"
          yLabel="LTV ($)"
          yFormatType="currency"
          modeUrl={modeUrl}
        />
      ) : (
        <ChartPlaceholder title="36-Month LTV" reason={kpisEmptyReason} />
      )}

      {/* CPA — actual vs targets */}
      {q3.cpa.length > 0 ? (
        <LineChart
          series={q3.cpa}
          title="Paid CPA"
          subtitle="Weekly avg, actual vs targets"
          yLabel="$"
          yFormatType="currency"
          modeUrl={modeUrl}
        />
      ) : (
        <ChartPlaceholder title="Paid CPA" reason={kpisEmptyReason} />
      )}

      {/* Spend — actual vs targets */}
      {q3.spend.length > 0 ? (
        <LineChart
          series={q3.spend}
          title="Marketing Spend"
          subtitle="Weekly, actual vs targets"
          yLabel="$"
          yFormatType="currency"
          modeUrl={modeUrl}
        />
      ) : (
        <ChartPlaceholder title="Marketing Spend" reason={kpisEmptyReason} />
      )}

      {/* New users — actual vs targets */}
      {q3.users.length > 0 ? (
        <LineChart
          series={q3.users}
          title="New Bank Connected Users"
          subtitle="Weekly, actual vs targets"
          yLabel="Users"
          yFormatType="number"
          modeUrl={modeUrl}
        />
      ) : (
        <ChartPlaceholder
          title="New Bank Connected Users"
          reason={kpisEmptyReason}
        />
      )}

      {/* ── Subscription Retention ── */}
      <section className="space-y-6">
        <SectionDivider
          title="Subscription Retention"
          subtitle="How well do we retain paid subscribers over time?"
        />

        {retentionTiers.length > 0 &&
        retentionTiers.some((t) => t.data.length > 0) ? (
          <RetentionTriangle
            tiers={retentionTiers}
            periodLabel="Month"
            skipM0
            title="Paid Retention"
            subtitle="Monthly cohort triangle"
            modeUrl={getModeReportLink("unit-economics", "retention")}
          />
        ) : (
          <ChartPlaceholder
            title="Subscription Retention"
            reason={resolveModeStaleReason(
              true,
              latestSyncRun,
              "No data — sync the Retention report to view cohort triangles",
            )}
          />
        )}
      </section>

      {/* Mode dashboard links */}
      {allEmbeds.length > 0 && (
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Mode Dashboards
          </p>
          {allEmbeds.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              <div className="grid gap-2 lg:grid-cols-2">
                {group.charts.map((chart) => (
                  <ModeEmbed
                    key={chart.url}
                    url={chart.url}
                    title={chart.title}
                    subtitle="View in Mode"
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
