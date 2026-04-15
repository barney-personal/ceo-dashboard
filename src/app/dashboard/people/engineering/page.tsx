import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EngineeringViewToggle } from "@/components/dashboard/engineering-view-toggle";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import {
  getEngineeringRankings,
  PERIOD_OPTIONS,
  type PeriodDays,
} from "@/lib/data/engineering";
import { getLatestTerminalSyncRun } from "@/lib/data/mode";

export default async function EngineeringPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const validPeriods = PERIOD_OPTIONS.map((p) => p.value);
  const periodDays = validPeriods.includes(Number(params.period) as PeriodDays)
    ? (Number(params.period) as PeriodDays)
    : 30;

  const [rankings, latestSync] = await Promise.all([
    getEngineeringRankings(periodDays),
    getLatestTerminalSyncRun("github"),
  ]);

  const humans = rankings.filter((r) => !r.isBot);
  const totalPRs = humans.reduce((sum, r) => sum + r.prsCount, 0);
  const totalCommits = humans.reduce((sum, r) => sum + r.commitsCount, 0);
  const totalAdditions = humans.reduce((sum, r) => sum + r.additions, 0);
  const totalDeletions = humans.reduce((sum, r) => sum + r.deletions, 0);
  const uniqueRepos = new Set(humans.flatMap((r) => r.repos)).size;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Engineering"
          description={`Pull request activity and lines of code across the org (last ${periodDays} days)`}
        />
        <PeriodPicker
          periods={PERIOD_OPTIONS}
          current={periodDays}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Contributors"
          value={humans.length.toString()}
          subtitle="engineers"
          delay={0}
        />
        <MetricCard
          label="PRs Merged"
          value={totalPRs.toLocaleString()}
          subtitle="total"
          delay={50}
        />
        <MetricCard
          label="Commits"
          value={totalCommits.toLocaleString()}
          subtitle="to default branch"
          delay={100}
        />
        <MetricCard
          label="Lines Added"
          value={totalAdditions.toLocaleString()}
          subtitle={`${totalDeletions.toLocaleString()} deleted`}
          delay={150}
        />
        <MetricCard
          label="Repos Active"
          value={uniqueRepos.toString()}
          subtitle="with merged PRs"
          delay={200}
        />
      </div>

      <EngineeringViewToggle data={rankings} />

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
