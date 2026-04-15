import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getProbeStatusSummary, getProbeTimeline } from "@/lib/data/probes";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { ProbeSummary } from "./_components/ProbeSummary";
import { ProbeTimeline } from "./_components/ProbeTimeline";
import { serializeSummary, serializeTimelineRun } from "./_components/format";

const KNOWN_CHECKS = ["ceo-ping-auth", "ceo-clerk-playwright"];

export default async function ProbesPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  const now = new Date();
  const [summaries, timelineRuns] = await Promise.all([
    getProbeStatusSummary(KNOWN_CHECKS, now),
    getProbeTimeline(24),
  ]);

  const serializedSummaries = summaries.map(serializeSummary);
  const serializedTimeline = timelineRuns.map(serializeTimelineRun);

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Production Probes"
        description="Automated health checks, uptime, latency, and incident status"
      />

      <SectionCard
        title="Check Status"
        description="Current status for each registered probe check"
      >
        <ProbeSummary checks={serializedSummaries} />
      </SectionCard>

      <SectionCard
        title="24h Timeline"
        description="Probe runs from the last 24 hours"
      >
        <ProbeTimeline runs={serializedTimeline} />
      </SectionCard>
    </div>
  );
}
