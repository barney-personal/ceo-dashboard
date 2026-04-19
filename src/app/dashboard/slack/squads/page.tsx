import { SectionCard } from "@/components/dashboard/section-card";
import { SlackGroupsTable } from "@/components/dashboard/slack-groups-table";
import {
  aggregateMembers,
  getLatestSlackMembersSnapshot,
} from "@/lib/data/slack-members";

export default async function SlackSquadsPage() {
  const snapshot = await getLatestSlackMembersSnapshot();
  if (!snapshot) {
    return (
      <SectionCard title="No snapshot imported yet">
        <p className="py-8 text-sm text-muted-foreground">
          Import a Slack Member Analytics CSV first.
        </p>
      </SectionCard>
    );
  }

  const groups = aggregateMembers(snapshot.rows, "squad");

  return (
    <SectionCard
      title="Engagement by squad"
      description="Average engagement, active share, and message volume per squad. Click any row to drill down to members."
    >
      <SlackGroupsTable groups={groups} groupBy="squad" />
    </SectionCard>
  );
}
