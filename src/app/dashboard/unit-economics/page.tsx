import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { getUnitEconomicsMetrics } from "@/lib/data/metrics";
import { getLtvTimeSeries, getCpaSeries } from "@/lib/data/chart-data";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default async function UnitEconomicsPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [metrics, ltvSeries, cpaSeries] = await Promise.all([
    getUnitEconomicsMetrics().catch(() => null),
    getLtvTimeSeries().catch(() => []),
    getCpaSeries().catch(() => []),
  ]);

  const modeUrl = "https://app.mode.com/cleoai/reports/11c3172037ac";

  const allEmbeds = [
    { label: "Strategic Finance KPIs", charts: getChartEmbeds("unit-economics", "kpis") },
    { label: "Conversion", charts: getChartEmbeds("unit-economics", "conversion") },
    { label: "Retention", charts: getChartEmbeds("unit-economics", "retention") },
    { label: "COGs / Arrears", charts: getChartEmbeds("unit-economics", "cogs") },
    { label: "Growth Marketing", charts: getChartEmbeds("unit-economics", "cac") },
  ].filter((g) => g.charts.length > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        title="Unit Economics"
        description="Customer lifetime value and acquisition costs"
      />

      {/* Hero strip — executive summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="36M LTV" value={metrics?.ltv ?? "—"} subtitle={metrics?.ltv ? "per user" : "awaiting data"} modeUrl={modeUrl} delay={0} />
        <MetricCard label="Blended CPA" value={metrics?.cpa ?? "—"} subtitle={metrics?.cpa ? "all channels" : "awaiting data"} modeUrl={modeUrl} delay={50} />
        <MetricCard label="LTV:CAC" value={metrics?.ltvCac ?? "—"} subtitle={metrics?.ltvCac ? "ratio" : "awaiting data"} modeUrl={modeUrl} delay={100} />
      </div>

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
        <div className="rounded-xl border border-border/60 bg-card px-5 py-10 text-center shadow-warm">
          <p className="text-sm text-muted-foreground">LTV chart awaiting data sync</p>
        </div>
      )}

      {/* Paid CPA over time */}
      {cpaSeries.length > 0 ? (
        <LineChart
          series={cpaSeries}
          title="Paid CPA"
          subtitle="Over time"
          yLabel="CPA ($)"
          yFormatType="currency"
          modeUrl="https://app.mode.com/cleoai/reports/774f14224dd9"
        />
      ) : (
        <div className="rounded-xl border border-border/60 bg-card px-5 py-10 text-center shadow-warm">
          <p className="text-sm text-muted-foreground">CPA chart awaiting data sync</p>
        </div>
      )}

      {/* Mode dashboard links */}
      {allEmbeds.length > 0 && (
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Mode Dashboards
          </p>
          {allEmbeds.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
              <div className="grid gap-2 lg:grid-cols-2">
                {group.charts.map((chart) => (
                  <ModeEmbed key={chart.url} url={chart.url} title={chart.title} subtitle="View in Mode" />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
