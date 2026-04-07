import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { Upload } from "lucide-react";

export default async function FinancialsPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Financials"
        description="Revenue, P&L, and management accounts"
      >
        <button className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground">
          <Upload className="h-3.5 w-3.5" />
          Upload
        </button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Revenue" value="—" subtitle="awaiting data" delay={0} />
        <MetricCard label="EBITDA" value="—" subtitle="awaiting data" delay={50} />
        <MetricCard label="Burn Rate" value="—" subtitle="awaiting data" delay={100} />
        <MetricCard label="Runway" value="—" subtitle="awaiting data" delay={150} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Revenue Trend"
          description="Monthly revenue from Mode Analytics"
        >
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Connect Mode Analytics to view revenue charts
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Management Accounts"
          description="Latest uploaded financials"
        >
          <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border/50 text-center">
            <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Upload your first Excel or CSV file
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Supports .xlsx and .csv formats
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
