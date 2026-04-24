import { EngineeringTable } from "@/components/dashboard/engineering-table";
import { EngineerTopMetrics } from "@/components/dashboard/engineer-top-metrics";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import {
  getEngineeringRankings,
  PERIOD_OPTIONS,
  type PeriodDays,
} from "@/lib/data/engineering";
import { getLatestTerminalSyncRun } from "@/lib/data/mode";

export default async function EngineeringEngineersPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireDashboardPermission("dashboard.engineering");

  const params = await searchParams;
  const validPeriods = PERIOD_OPTIONS.map((p) => p.value);
  const periodDays = validPeriods.includes(Number(params.period) as PeriodDays)
    ? (Number(params.period) as PeriodDays)
    : 30;

  const [rankings, latestSync] = await Promise.all([
    getEngineeringRankings(periodDays),
    getLatestTerminalSyncRun("github"),
  ]);

  return (
    <div className="space-y-6">
      <EngineerTopMetrics rankings={rankings} periodDays={periodDays} />
      <EngineeringTable data={rankings} periodDays={periodDays} />
      {latestSync && (
        <p className="text-[11px] text-muted-foreground/60">
          Last synced{" "}
          {latestSync.completedAt
            ? new Date(latestSync.completedAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "unknown"}
        </p>
      )}
    </div>
  );
}
