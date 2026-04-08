import { PageHeader } from "@/components/dashboard/page-header";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default function PeoplePerformancePage() {
  const performanceCharts = getChartEmbeds("people", "performance");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Performance"
        description="Team performance dashboards and reviews"
      />

      <div className="space-y-3">
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
