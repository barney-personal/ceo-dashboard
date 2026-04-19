import { SectionCard } from "@/components/dashboard/section-card";
import { SlackMembersTable } from "@/components/dashboard/slack-members-table";
import { getLatestSlackMembersSnapshot } from "@/lib/data/slack-members";

export default async function SlackMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ pillar?: string; squad?: string; function?: string }>;
}) {
  const params = await searchParams;
  const snapshot = await getLatestSlackMembersSnapshot();

  if (!snapshot) {
    return (
      <SectionCard title="No snapshot imported yet">
        <div className="space-y-3 py-6 text-sm text-muted-foreground">
          <p>
            Upload a Slack Member Analytics CSV from the{" "}
            <a
              href="/dashboard/admin/status"
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              Data Status page
            </a>{" "}
            (CEO only) to populate this view.
          </p>
          <p className="text-xs text-muted-foreground">
            Export steps: Slack Admin → Analytics → Members → pick a time window →
            Export CSV. Slackbot DMs you the file; drop it into the uploader on
            Data Status.
          </p>
        </div>
      </SectionCard>
    );
  }

  const rankable = snapshot.rows.filter(
    (r) => !r.isGuest && !r.isDeactivated && !r.isServiceAccount,
  );
  const activeShare =
    rankable.length > 0
      ? rankable.filter(
          (r) => r.daysSinceLastActive !== null && r.daysSinceLastActive <= 30,
        ).length / rankable.length
      : 0;
  const medianEngagement = (() => {
    if (rankable.length === 0) return 0;
    const scores = rankable.map((r) => r.engagementScore).sort((a, b) => a - b);
    const mid = Math.floor(scores.length / 2);
    return scores.length % 2 === 0
      ? Math.round((scores[mid - 1]! + scores[mid]!) / 2)
      : scores[mid]!;
  })();

  return (
    <div className="space-y-8">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:max-w-[96rem]">
        <StatTile
          label="Members in ranking"
          value={rankable.length.toLocaleString()}
          hint="excludes guests, deactivated, service accounts"
        />
        <StatTile
          label="Active last 30d"
          value={`${(activeShare * 100).toFixed(0)}%`}
          hint={`${rankable
            .filter(
              (r) => r.daysSinceLastActive !== null && r.daysSinceLastActive <= 30,
            )
            .length.toLocaleString()} of ${rankable.length.toLocaleString()}`}
        />
        <StatTile
          label="Median engagement score"
          value={`${medianEngagement}/100`}
          hint="percentile-based composite"
        />
        <StatTile
          label="Total messages"
          value={rankable
            .reduce((s, r) => s + r.messagesPosted, 0)
            .toLocaleString()}
          hint="across window"
        />
      </div>

      <SectionCard
        title="Member engagement ranking"
        description="Sort ascending on Engagement to find the least engaged tenured members. Metrics are normalised by tenure (capped at 365 days)."
      >
        <SlackMembersTable
          rows={snapshot.rows}
          initialPillar={params.pillar}
          initialSquad={params.squad}
          initialFunction={params.function}
        />
      </SectionCard>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-warm">
      <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl tracking-tight text-foreground">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
