import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { getChartEmbeds } from "@/lib/integrations/mode-config";
import { Upload } from "lucide-react";

export default async function FinancialPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  const seasonalityCharts = getChartEmbeds("financial", "seasonality");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Financial"
        description="Management accounts, FP&A, and financial reporting"
      >
        <button className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground">
          <Upload className="h-3.5 w-3.5" />
          Upload
        </button>
      </PageHeader>

      {seasonalityCharts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">Seasonality</h3>
          {seasonalityCharts.map((chart) => (
            <ModeEmbed key={chart.url} url={chart.url} title={chart.title} subtitle="View interactive chart in Mode" />
          ))}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">Management Accounts</h3>
        <SectionCard title="Latest Period" description="Uploaded Excel/CSV financial statements">
          <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border/50 text-center">
            <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Upload your first management accounts file</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Supports .xlsx and .csv formats</p>
          </div>
        </SectionCard>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">FP&A</h3>
        <SectionCard title="Forecast vs Actuals" description="Budget variance from uploaded forecasts">
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">Upload FP&A forecast to view variance analysis</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
