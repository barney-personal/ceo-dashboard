import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EngineeringTable } from "@/components/dashboard/engineering-table";
import {
  getEngineeringRankings,
  getDefaultPeriod,
} from "@/lib/data/engineering";
import { getLatestTerminalSyncRun } from "@/lib/data/mode";

export default async function EngineeringPerformancePage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const { start, end } = getDefaultPeriod(30);
  const [rankings, latestSync] = await Promise.all([
    getEngineeringRankings(start, end),
    getLatestTerminalSyncRun("github"),
  ]);

  const totalPRs = rankings.reduce((sum, r) => sum + r.prsCount, 0);
  const totalAdditions = rankings.reduce((sum, r) => sum + r.additions, 0);
  const totalDeletions = rankings.reduce((sum, r) => sum + r.deletions, 0);
  const uniqueRepos = new Set(rankings.flatMap((r) => r.repos)).size;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Engineering"
        description="Pull request activity and lines of code across the org (last 30 days)"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Contributors"
          value={rankings.length.toString()}
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
          label="Lines Added"
          value={totalAdditions.toLocaleString()}
          subtitle={`${totalDeletions.toLocaleString()} deleted`}
          delay={100}
        />
        <MetricCard
          label="Repos Active"
          value={uniqueRepos.toString()}
          subtitle="with merged PRs"
          delay={150}
        />
      </div>

      <EngineeringTable data={rankings} />

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
