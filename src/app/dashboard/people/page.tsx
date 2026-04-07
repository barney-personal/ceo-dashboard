import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { BarChart } from "@/components/charts/bar-chart";
import { getReportData } from "@/lib/data/mode";
import { getHeadcountByDepartment } from "@/lib/data/chart-data";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default async function PeoplePage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [headcountData, deptData] = await Promise.all([
    getReportData("people", "headcount").catch(() => []),
    getHeadcountByDepartment().catch(() => []),
  ]);

  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");
  const employees = headcountQuery?.rows ?? [];
  const active = employees.filter(
    (r) => r.lifecycle_status === "Employed" && r.is_cleo_headcount === 1
  );

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
          modeUrl="https://app.mode.com/cleoai/reports/c458b52ceb68"
          delay={0}
        />
        <MetricCard
          label="Departments"
          value={deptData.length > 0 ? deptData.length.toString() : "—"}
          subtitle={deptData.length > 0 ? "functions" : "awaiting data"}
          modeUrl="https://app.mode.com/cleoai/reports/c458b52ceb68"
          delay={50}
        />
        <MetricCard label="Engagement" value="—" subtitle="Culture Amp pending" delay={100} />
        <MetricCard label="Performance" value="—" subtitle="Culture Amp pending" delay={150} />
      </div>

      {/* D3 bar chart */}
      {deptData.length > 0 && (
        <BarChart
          data={deptData}
          title="Headcount by Department"
          subtitle={`${active.length} total`}
          modeUrl="https://app.mode.com/cleoai/reports/c458b52ceb68"
        />
      )}

      {/* Mode report links */}
      {headcountCharts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">Mode Reports</h3>
          {headcountCharts.map((chart) => (
            <ModeEmbed key={chart.url} url={chart.url} title={chart.title} subtitle="View in Mode" />
          ))}
        </div>
      )}
    </div>
  );
}
