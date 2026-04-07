import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { getReportData } from "@/lib/data/mode";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default async function PeoplePage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const headcountData = await getReportData("people", "headcount").catch(() => []);
  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");
  const employees = headcountQuery?.rows ?? [];
  const active = employees.filter(
    (r) => r.lifecycle_status === "Employed" && r.is_cleo_headcount === 1
  );

  const byDepartment = new Map<string, number>();
  for (const emp of active) {
    const dept = (emp.hb_function as string) || "Unknown";
    byDepartment.set(dept, (byDepartment.get(dept) ?? 0) + 1);
  }
  const departments = [...byDepartment.entries()].sort((a, b) => b[1] - a[1]);

  const headcountCharts = getChartEmbeds("people", "headcount");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="People"
        description="Headcount, team structure, and workforce metrics"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Headcount"
          value={active.length > 0 ? active.length.toString() : "—"}
          subtitle={active.length > 0 ? "active employees" : "awaiting data"}
          delay={0}
        />
        <MetricCard
          label="Departments"
          value={byDepartment.size > 0 ? byDepartment.size.toString() : "—"}
          subtitle={byDepartment.size > 0 ? "functions" : "awaiting data"}
          delay={50}
        />
        <MetricCard label="Engagement" value="—" subtitle="Culture Amp pending" delay={100} />
        <MetricCard label="Performance" value="—" subtitle="Culture Amp pending" delay={150} />
      </div>

      {/* Mode headcount dashboard embed */}
      {headcountCharts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Headcount Dashboard
          </h3>
          {headcountCharts.map((chart) => (
            <ModeEmbed key={chart.url} url={chart.url} title={chart.title} />
          ))}
        </div>
      )}

      {/* Department breakdown from synced data */}
      <SectionCard
        title="Team Breakdown"
        description={`${active.length} employees across ${byDepartment.size} functions`}
      >
        {departments.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {departments.map(([dept, count]) => (
              <div key={dept} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                <span className="text-sm text-foreground">{dept}</span>
                <span className="font-mono text-sm text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/50">
            <p className="text-sm text-muted-foreground">Awaiting headcount data sync</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
