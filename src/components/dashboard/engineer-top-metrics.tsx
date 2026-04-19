import { MetricCard } from "./metric-card";
import type { EngineerRanking } from "@/lib/data/engineering";

/**
 * Aggregate top-of-page scorecard: Contributors, PRs, Commits, Lines, Repos.
 * Shared across the Pillars / Squads / Engineers engineering sub-pages so the
 * header context is consistent regardless of which breakdown is visible.
 */
export function EngineerTopMetrics({
  rankings,
  periodDays,
}: {
  rankings: EngineerRanking[];
  /** When set, metrics cover only engineers employed for the full window,
   *  matching the default filter on the engineers list below. */
  periodDays?: number;
}) {
  const humans = rankings.filter((r) => !r.isBot);
  // Match the list default: engineers employed for the whole window only.
  const tenured = periodDays
    ? humans.filter(
        (r) => r.tenureDays == null || r.tenureDays >= periodDays
      )
    : humans;
  const contributors = tenured.filter((r) => !r.silent);
  const totalPRs = tenured.reduce((sum, r) => sum + r.prsCount, 0);
  const totalCommits = tenured.reduce((sum, r) => sum + r.commitsCount, 0);
  const totalAdditions = tenured.reduce((sum, r) => sum + r.additions, 0);
  const totalDeletions = tenured.reduce((sum, r) => sum + r.deletions, 0);
  const uniqueRepos = new Set(tenured.flatMap((r) => r.repos)).size;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard
        label="Contributors"
        value={contributors.length.toString()}
        subtitle={`of ${tenured.length} engineers`}
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
  );
}
