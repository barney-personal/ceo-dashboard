import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { LineChart } from "@/components/charts/line-chart";
import { getUnitEconomicsMetrics } from "@/lib/data/metrics";
import { getArpuMarginSeries, getMarginSeries, getPaybackSeries } from "@/lib/data/chart-data";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default async function UnitEconomicsPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [metrics, arpuSeries, marginSeries, paybackSeries] = await Promise.all([
    getUnitEconomicsMetrics().catch(() => null),
    getArpuMarginSeries().catch(() => []),
    getMarginSeries().catch(() => []),
    getPaybackSeries().catch(() => []),
  ]);

  const kpiCharts = getChartEmbeds("unit-economics", "kpis");
  const conversionCharts = getChartEmbeds("unit-economics", "conversion");
  const cacCharts = getChartEmbeds("unit-economics", "cac");
  const retentionCharts = getChartEmbeds("unit-economics", "retention");
  const cogsCharts = getChartEmbeds("unit-economics", "cogs");

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

      {/* ── Section 1: LTV ── */}
      <section className="space-y-6">
        <SectionDivider
          title="Customer Lifetime Value"
          subtitle="How much is a customer worth over their lifetime?"
          formula="LTV = ARPU × Lifetime (retention) × Margin (after COGs)"
        />

        {/* LTV component metrics */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "ARPU", value: metrics?.arpu },
            { label: "Gross Margin", value: metrics?.grossMargin },
            { label: "Contribution Margin", value: metrics?.contributionMargin },
            { label: "M11+ CVR", value: metrics?.cvr },
          ].map((item) => (
            <a key={item.label} href={modeUrl} target="_blank" rel="noopener noreferrer" className="group rounded-lg border border-border/50 bg-card px-3 py-2 shadow-warm transition-all hover:border-primary/30 hover:shadow-warm-lg">
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{item.label}</p>
              <p className="font-display text-lg text-foreground">{item.value ?? "—"}</p>
            </a>
          ))}
        </div>

        {/* LTV charts — ARPU trend & margin trend */}
        <div className="grid gap-4 lg:grid-cols-2">
          {arpuSeries.length > 0 && (
            <LineChart
              series={arpuSeries}
              title="Revenue & Profit per User"
              subtitle="Monthly trend"
              yLabel="$ per user"
              yFormatType="currency"
              modeUrl="https://app.mode.com/cleoai/reports/b301cc0c9572"
            />
          )}
          {marginSeries.length > 0 && (
            <LineChart
              series={marginSeries}
              title="Margin Trend"
              subtitle="vs baseline"
              yLabel="%"
              yFormatType="percent"
              modeUrl="https://app.mode.com/cleoai/reports/b301cc0c9572"
            />
          )}
        </div>

        {/* LTV deep dives */}
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Deep Dives
          </p>
          {[
            { label: "Strategic Finance KPIs", charts: kpiCharts },
            { label: "Conversion", charts: conversionCharts },
            { label: "Retention", charts: retentionCharts },
            { label: "COGs / Arrears", charts: cogsCharts },
          ]
            .filter((g) => g.charts.length > 0)
            .map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                <div className="grid gap-2 lg:grid-cols-2">
                  {group.charts.map((chart) => (
                    <ModeEmbed key={chart.url} url={chart.url} title={chart.title} subtitle="View in Mode" />
                  ))}
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* ── Section 2: CPA ── */}
      <section className="space-y-6">
        <SectionDivider
          title="Customer Acquisition Cost"
          subtitle="What does it cost to acquire a paying customer?"
          formula="Paid CPA = Total Spend ÷ Paying Customers Acquired"
        />

        {/* CPA component metrics */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Blended CPA", value: metrics?.cpa },
            { label: "MAU", value: metrics?.mau },
            { label: "Revenue", value: metrics?.revenue },
          ].map((item) => (
            <a key={item.label} href={modeUrl} target="_blank" rel="noopener noreferrer" className="group rounded-lg border border-border/50 bg-card px-3 py-2 shadow-warm transition-all hover:border-primary/30 hover:shadow-warm-lg">
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{item.label}</p>
              <p className="font-display text-lg text-foreground">{item.value ?? "—"}</p>
            </a>
          ))}
        </div>

        {/* CPA chart — payback period */}
        {paybackSeries.length > 0 && (
          <LineChart
            series={paybackSeries}
            title="Payback Period"
            subtitle="By cohort"
            yLabel="Months"
            yFormatType="months"
            modeUrl="https://app.mode.com/cleoai/reports/774f14224dd9"
          />
        )}

        {/* CPA deep dives */}
        {cacCharts.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Deep Dives
            </p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Growth Marketing Performance</p>
              <div className="grid gap-2 lg:grid-cols-2">
                {cacCharts.map((chart) => (
                  <ModeEmbed key={chart.url} url={chart.url} title={chart.title} subtitle="View in Mode" />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
