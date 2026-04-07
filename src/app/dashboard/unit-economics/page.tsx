import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";

export default async function UnitEconomicsPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Unit Economics"
        description="Customer lifetime value and acquisition costs"
      />

      {/* LTV Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Lifetime Value
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="LTV" value="—" subtitle="awaiting data" delay={0} />
          <MetricCard label="ARPU" value="—" subtitle="monthly" delay={50} />
          <MetricCard label="Retention" value="—" subtitle="12-month" delay={100} />
          <MetricCard label="Avg Lifetime" value="—" subtitle="months" delay={150} />
        </div>
      </div>

      {/* CAC Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Customer Acquisition Cost
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="CAC" value="—" subtitle="blended" delay={200} />
          <MetricCard label="LTV:CAC" value="—" subtitle="ratio" delay={250} />
          <MetricCard label="Payback" value="—" subtitle="months" delay={300} />
          <MetricCard label="CAC Trend" value="—" subtitle="vs last quarter" delay={350} />
        </div>
      </div>

      {/* Detail cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="LTV Breakdown"
          description="Component analysis from Mode"
        >
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Connect Mode Analytics to view LTV components
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="CAC by Channel"
          description="Acquisition cost per channel"
        >
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Connect Mode Analytics to view CAC breakdown
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
