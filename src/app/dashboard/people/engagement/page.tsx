import { PageHeader } from "@/components/dashboard/page-header";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { ModeEmbed } from "@/components/dashboard/mode-embed";

export default async function PeopleEngagementPage() {
  await requireDashboardPermission("dashboard.people.engagement");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Engagement"
        description="Employee engagement and culture surveys"
      />

      <div className="rounded-xl border border-border/60 bg-card px-6 py-8 shadow-warm">
        <h3 className="text-sm font-semibold text-foreground">
          Engagement Surveys
        </h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Engagement surveys run on a <span className="font-medium text-foreground">termly</span> cadence.
          The next survey is scheduled for <span className="font-medium text-foreground">end of April 2026</span>,
          run by Fiona Bennett.
        </p>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          To view survey results: open Culture Amp, select <span className="font-medium text-foreground">Feedback</span> in
          the top bar, then <span className="font-medium text-foreground">Surveys</span> to inspect responses.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Sources
        </h3>
        <ModeEmbed
          url="https://meetcleo.eu.cultureamp.com/app/home"
          title="Culture Amp — Engagement Surveys"
          subtitle="Feedback → Surveys"
        />
      </div>
    </div>
  );
}
