import { SectionDivider } from "@/components/dashboard/section-divider";
import { DoraScorecardCard } from "@/components/dashboard/dora-scorecard-card";
import { PillarMoversPanel } from "@/components/dashboard/pillar-movers-panel";
import { PillarTrendGrid } from "@/components/dashboard/pillar-trend-grid";
import { BarChart } from "@/components/charts/bar-chart";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import {
  getDoraScorecard,
  getDoraTrend,
  getPillarWeeklyTrend,
  getSquadLeaderboard,
  computePillarMovers,
  classifyDeployFrequency,
  classifyChangeLeadTime,
  classifyChangeFailureRate,
  classifyMttr,
  type DoraTrend,
} from "@/lib/data/swarmia";
import {
  SectionEmpty,
  SwarmiaNotConfiguredBanner,
  formatDelta,
  formatMinutesAsHours,
  loaderReason,
} from "../_shared";

export default async function EngineeringDeliveryHealthPage() {
  await requireDashboardPermission("dashboard.engineering");

  const [dora, doraTrend, pillarTrend, leaderboard] = await Promise.all([
    getDoraScorecard(),
    getDoraTrend(),
    getPillarWeeklyTrend(),
    getSquadLeaderboard(),
  ]);

  const movers = pillarTrend.data ? computePillarMovers(pillarTrend.data) : null;

  const allUnconfigured = [dora, doraTrend, pillarTrend, leaderboard].every(
    (r) => r.status === "not_configured"
  );

  return (
    <div className="space-y-8">
      {allUnconfigured && <SwarmiaNotConfiguredBanner />}

      {/* --- DORA scorecard ------------------------------------------- */}
      <section className="space-y-4">
        <SectionDivider
          title="DORA Metrics"
          subtitle="Rolling 30 days — banded vs industry thresholds, 12-week sparklines"
        />
        {dora.status === "ok" && dora.data ? (
          <DoraGrid
            data={dora.data}
            trend={doraTrend.status === "ok" ? doraTrend.data : null}
          />
        ) : (
          <SectionEmpty
            title="DORA metrics"
            reason={loaderReason(dora, "DORA metrics")}
          />
        )}
      </section>

      {/* --- What Moved — biggest pillar-level changes this week ------ */}
      <section className="space-y-4">
        <SectionDivider
          title="What Moved"
          subtitle="Biggest pillar-level changes this week"
        />
        {pillarTrend.status === "ok" && movers ? (
          <PillarMoversPanel data={movers} />
        ) : (
          <SectionEmpty
            title="What moved"
            reason={loaderReason(pillarTrend, "pillar trend data")}
          />
        )}
      </section>

      {/* --- Pillar cycle time trend ---------------------------------- */}
      <section className="space-y-4">
        <SectionDivider
          title="Pillar Cycle Time Trend"
          subtitle="12-week trend per pillar, sorted slowest first"
        />
        {pillarTrend.status === "ok" && pillarTrend.data && pillarTrend.data.pillars.length > 0 ? (
          <PillarTrendGrid data={pillarTrend.data} />
        ) : (
          <SectionEmpty
            title="Pillar cycle time"
            reason={loaderReason(pillarTrend, "pillar trend")}
          />
        )}
      </section>

      {/* --- Squad cycle-time leaderboard ----------------------------- */}
      <section className="space-y-4">
        <SectionDivider
          title="Squad Cycle Time"
          subtitle="PR open → merge, last 30 days"
          formula="Sorted fastest to slowest"
        />
        {leaderboard.status === "ok" && leaderboard.data && leaderboard.data.squads.length > 0 ? (
          <BarChart
            title="Cycle time by squad"
            subtitle={`${leaderboard.data.squads.length} squads with activity in the last 30 days`}
            data={leaderboard.data.squads.map((s) => ({
              label: s.squad,
              value: Number(s.cycleTimeHours.toFixed(1)),
              color: s.cycleTimeHours > 72 ? "#c44" : "#3b3bba",
            }))}
            leftMargin={180}
            xAxisLabel="Hours (PR open → merge)"
            valueUnit="hours"
            showPercentOfMax={false}
          />
        ) : (
          <SectionEmpty
            title="Squad cycle time"
            reason={loaderReason(leaderboard, "squad metrics")}
          />
        )}
      </section>
    </div>
  );
}

function DoraGrid({
  data,
  trend,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getDoraScorecard>>["data"]>;
  trend: DoraTrend | null;
}) {
  const { current, comparison } = data;

  const deployDelta = comparison
    ? formatDelta(current.deploymentFrequencyPerDay, comparison.deploymentFrequencyPerDay)
    : { change: "", trend: "flat" as const };

  // For lead time / CFR / MTTR, an INCREASE is bad, so invert the trend arrow's
  // color by passing the opposite direction to the trend prop.
  const leadDelta = comparison
    ? formatDelta(current.changeLeadTimeMinutes, comparison.changeLeadTimeMinutes)
    : { change: "", trend: "flat" as const };
  const leadTrend =
    leadDelta.trend === "up" ? "down" : leadDelta.trend === "down" ? "up" : "flat";

  const cfrDelta = comparison
    ? formatDelta(current.changeFailureRatePercent, comparison.changeFailureRatePercent)
    : { change: "", trend: "flat" as const };
  const cfrTrend =
    cfrDelta.trend === "up" ? "down" : cfrDelta.trend === "down" ? "up" : "flat";

  const mttrDelta = comparison
    ? formatDelta(current.meanTimeToRecoveryMinutes, comparison.meanTimeToRecoveryMinutes)
    : { change: "", trend: "flat" as const };
  const mttrTrend =
    mttrDelta.trend === "up" ? "down" : mttrDelta.trend === "down" ? "up" : "flat";

  const deploys = trend?.weeks.map((w) => w.deploymentFrequencyPerDay) ?? [];
  const leads = trend?.weeks.map((w) => w.changeLeadTimeMinutes) ?? [];
  const cfrs = trend?.weeks.map((w) => w.changeFailureRatePercent) ?? [];
  const mttrs = trend?.weeks.map((w) => w.meanTimeToRecoveryMinutes) ?? [];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <DoraScorecardCard
        label="Deploys / day"
        value={current.deploymentFrequencyPerDay.toFixed(1)}
        subtitle={`${current.deploymentCount.toLocaleString()} in 30d`}
        change={deployDelta.change || undefined}
        trend={deployDelta.trend}
        band={classifyDeployFrequency(current.deploymentFrequencyPerDay)}
        trendValues={deploys}
        delay={0}
      />
      <DoraScorecardCard
        label="Change Lead Time"
        value={formatMinutesAsHours(current.changeLeadTimeMinutes)}
        subtitle="merge → prod"
        change={leadDelta.change || undefined}
        trend={leadTrend}
        band={classifyChangeLeadTime(current.changeLeadTimeMinutes)}
        trendValues={leads}
        delay={60}
      />
      <DoraScorecardCard
        label="Change Failure Rate"
        value={`${current.changeFailureRatePercent.toFixed(2)}%`}
        subtitle="failed deploys"
        change={cfrDelta.change || undefined}
        trend={cfrTrend}
        band={classifyChangeFailureRate(current.changeFailureRatePercent)}
        trendValues={cfrs}
        delay={120}
      />
      <DoraScorecardCard
        label="Mean Time to Recovery"
        value={formatMinutesAsHours(current.meanTimeToRecoveryMinutes)}
        subtitle="incident → resolved"
        change={mttrDelta.change || undefined}
        trend={mttrTrend}
        band={classifyMttr(current.meanTimeToRecoveryMinutes)}
        trendValues={mttrs}
        delay={180}
      />
    </div>
  );
}
