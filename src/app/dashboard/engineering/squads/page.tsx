import { EngineeringSquadView } from "@/components/dashboard/engineering-squad-view";
import { EngineerTopMetrics } from "@/components/dashboard/engineer-top-metrics";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import {
  getEngineeringRankings,
  PERIOD_OPTIONS,
  type PeriodDays,
} from "@/lib/data/engineering";
import {
  getSquadPillarMetrics,
  periodDaysToSwarmiaTimeframe,
} from "@/lib/data/swarmia";

export default async function EngineeringSquadsPage({
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

  const [rankings, swarmiaMetrics] = await Promise.all([
    getEngineeringRankings(periodDays),
    getSquadPillarMetrics(periodDaysToSwarmiaTimeframe(periodDays)),
  ]);

  return (
    <div className="space-y-6">
      <EngineerTopMetrics rankings={rankings} periodDays={periodDays} />
      <EngineeringSquadView
        data={rankings}
        groupBy="squad"
        swarmiaMetrics={swarmiaMetrics.data ?? undefined}
        periodDays={periodDays}
      />
    </div>
  );
}
