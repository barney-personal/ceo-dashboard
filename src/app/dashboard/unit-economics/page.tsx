import { PageHeader } from "@/components/dashboard/page-header";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import {
  getLtvTimeSeries,
  getLtvCacRatioSeries,
  getQuery3Series,
} from "@/lib/data/chart-data";
import {
  getChartEmbeds,
  getModeReportLink,
} from "@/lib/integrations/mode-config";

export default async function UnitEconomicsPage() {

  const [ltvSeries, ltvCacRatio, q3] = await Promise.all([
    getLtvTimeSeries(),
    getLtvCacRatioSeries(),
    getQuery3Series(),
  ]);

  const modeUrl = getModeReportLink("unit-economics", "kpis");
  const cacModeUrl = getModeReportLink("unit-economics", "cac");

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
      {ltvCacRatio.length > 0 && (
        <LineChart
          series={ltvCacRatio}
          title="LTV:Paid CAC"
          subtitle="Weekly, LTV ÷ Paid CPA"
          yLabel="x"
          yFormatType="number"
          modeUrl={cacModeUrl}
        />
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
        <div className="rounded-xl border border-border/60 bg-card px-5 py-10 text-center shadow-warm">
          <p className="text-sm text-muted-foreground">
            LTV chart awaiting data sync
          </p>
        </div>
      )}

      {/* CPA — actual vs targets */}
      {q3.cpa.length > 0 && (
        <LineChart
          series={q3.cpa}
          title="Paid CPA"
          subtitle="Weekly avg, actual vs targets"
          yLabel="$"
          yFormatType="currency"
          modeUrl={modeUrl}
        />
      )}

      {/* Spend — actual vs targets */}
      {q3.spend.length > 0 && (
        <LineChart
          series={q3.spend}
          title="Marketing Spend"
          subtitle="Weekly, actual vs targets"
          yLabel="$"
          yFormatType="currency"
          modeUrl={modeUrl}
        />
      )}

      {/* New users — actual vs targets */}
      {q3.users.length > 0 && (
        <LineChart
          series={q3.users}
          title="New Bank Connected Users"
          subtitle="Weekly, actual vs targets"
          yLabel="Users"
          yFormatType="number"
          modeUrl={modeUrl}
        />
      )}

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
