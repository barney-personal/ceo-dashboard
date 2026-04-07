import { redirect } from "next/navigation";
import { getCurrentUserRole, hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";

export default async function PeoplePage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="People"
        description="Headcount, engagement, and team metrics"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Headcount" value="—" subtitle="awaiting data" delay={0} />
        <MetricCard label="New Hires" value="—" subtitle="this quarter" delay={50} />
        <MetricCard label="Attrition" value="—" subtitle="annualised" delay={100} />
        <MetricCard label="Engagement" value="—" subtitle="awaiting data" delay={150} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Team Breakdown"
          description="Headcount by department from HiBob"
        >
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Connect HiBob to view department breakdown
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Engagement Scores"
          description="Latest survey results from Culture Amp"
        >
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">
              Connect Culture Amp to view engagement trends
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
