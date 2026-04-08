import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default function PeoplePerformancePage() {
  const performanceCharts = getChartEmbeds("people", "performance");

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Performance Dashboards
        </h3>
        {performanceCharts.length > 0 ? (
          performanceCharts.map((chart) => (
            <ModeEmbed
              key={chart.url}
              url={chart.url}
              title={chart.title}
              subtitle="View in Mode"
            />
          ))
        ) : (
          <ModeEmbed
            url="https://app.mode.com/cleoai/reports/79ea96d310a9"
            title="Performance Dashboard"
            subtitle="View in Mode"
          />
        )}
      </div>
    </div>
  );
}
