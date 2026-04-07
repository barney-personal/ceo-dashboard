import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";

export default async function ProductPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Product"
        description="Key product performance metrics from Mode"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="DAU" value="—" subtitle="awaiting data" delay={0} />
        <MetricCard label="WAU" value="—" subtitle="awaiting data" delay={50} />
        <MetricCard label="Activation" value="—" subtitle="rate" delay={100} />
        <MetricCard label="Retention" value="—" subtitle="D7" delay={150} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Usage Trends"
          description="Daily and weekly active users"
        >
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Connect Mode Analytics to view usage trends
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Feature Adoption"
          description="Key feature usage and conversion"
        >
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Connect Mode Analytics to view feature metrics
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
