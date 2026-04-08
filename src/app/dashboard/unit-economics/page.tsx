import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { getUnitEconomicsMetrics } from "@/lib/data/metrics";
import { getLtvTimeSeries, getWeeklyCpaSeries } from "@/lib/data/chart-data";

export default async function UnitEconomicsPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [metrics, ltvSeries, cpaSeries] = await Promise.all([
    getUnitEconomicsMetrics().catch(() => null),
    getLtvTimeSeries().catch(() => []),
    getWeeklyCpaSeries().catch(() => []),
  ]);

  const modeUrl = "https://app.mode.com/cleoai/reports/11c3172037ac";

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

      {/* Weekly paid CPA */}
      {cpaSeries.length > 0 ? (
        <LineChart
          series={cpaSeries}
          title="Paid CPA"
          subtitle="Weekly"
          yLabel="CPA ($)"
          yFormatType="currency"
          modeUrl="https://app.mode.com/cleoai/reports/774f14224dd9"
        />
      ) : (
        <div className="rounded-xl border border-border/60 bg-card px-5 py-10 text-center shadow-warm">
          <p className="text-sm text-muted-foreground">CPA chart awaiting data sync</p>
        </div>
      )}
    </div>
  );
}
