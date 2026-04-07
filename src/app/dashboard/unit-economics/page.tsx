import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { getUnitEconomicsMetrics } from "@/lib/data/metrics";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default async function UnitEconomicsPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const metrics = await getUnitEconomicsMetrics().catch(() => null);

  const kpiCharts = getChartEmbeds("unit-economics", "kpis");
  const conversionCharts = getChartEmbeds("unit-economics", "conversion");
  const cacCharts = getChartEmbeds("unit-economics", "cac");
  const retentionCharts = getChartEmbeds("unit-economics", "retention");
  const cogsCharts = getChartEmbeds("unit-economics", "cogs");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Unit Economics"
        description="Customer lifetime value and acquisition costs"
      />

      {/* Headline metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="36M LTV" value={metrics?.ltv ?? "—"} subtitle={metrics?.ltv ? "per user" : "awaiting data"} delay={0} />
        <MetricCard label="Blended CPA" value={metrics?.cpa ?? "—"} subtitle={metrics?.cpa ? "all channels" : "awaiting data"} delay={50} />
        <MetricCard label="LTV:CAC" value={metrics?.ltvCac ?? "—"} subtitle={metrics?.ltvCac ? "ratio" : "awaiting data"} delay={100} />
        <MetricCard label="Contribution Margin" value={metrics?.contributionMargin ?? "—"} subtitle={metrics?.contributionMargin ? "after COGs" : "awaiting data"} delay={150} />
      </div>

      {/* KPIs */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Strategic Finance KPIs
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "ARPU", value: metrics?.arpu },
              { label: "Gross Margin", value: metrics?.grossMargin },
              { label: "M11+ CVR", value: metrics?.cvr },
              { label: "MAU", value: metrics?.mau },
              { label: "Revenue", value: metrics?.revenue },
              { label: "LTV:CAC", value: metrics?.ltvCac },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border/50 bg-card px-3 py-2 shadow-warm">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{item.label}</p>
                <p className="font-display text-lg text-foreground">{item.value ?? "—"}</p>
              </div>
            ))}
          </div>
          {kpiCharts.map((chart) => (
            <ModeEmbed key={chart.url} url={chart.url} title={chart.title} />
          ))}
        </div>
      </div>

      {/* Conversion */}
      {conversionCharts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Conversion
          </h3>
          <div className="grid gap-4 lg:grid-cols-1">
            {conversionCharts.map((chart) => (
              <ModeEmbed key={chart.url} url={chart.url} title={chart.title} />
            ))}
          </div>
        </div>
      )}

      {/* CAC / Growth Marketing */}
      {cacCharts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Customer Acquisition Cost
          </h3>
          <div className="grid gap-4 lg:grid-cols-1">
            {cacCharts.map((chart) => (
              <ModeEmbed key={chart.url} url={chart.url} title={chart.title} />
            ))}
          </div>
        </div>
      )}

      {/* Retention */}
      {retentionCharts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Retention
          </h3>
          <div className="grid gap-4 lg:grid-cols-1">
            {retentionCharts.map((chart) => (
              <ModeEmbed key={chart.url} url={chart.url} title={chart.title} />
            ))}
          </div>
        </div>
      )}

      {/* COGs / Arrears */}
      {cogsCharts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            COGs / Arrears
          </h3>
          <div className="grid gap-4 lg:grid-cols-1">
            {cogsCharts.map((chart) => (
              <ModeEmbed key={chart.url} url={chart.url} title={chart.title} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
