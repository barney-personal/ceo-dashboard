import { PageHeader } from "@/components/dashboard/page-header";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default function OKRsPage() {
  const okrCharts = getChartEmbeds("okrs", "company");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="OKRs"
        description="Company objectives and key results"
      />

      {okrCharts.length > 0 ? (
        <div className="grid gap-3">
          {okrCharts.map((chart) => (
            <ModeEmbed key={chart.url} url={chart.url} title={chart.title} subtitle="View full OKR dashboard in Mode" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Connect Slack and Notion to automatically sync OKR updates.
          </p>
        </div>
      )}
    </div>
  );
}
