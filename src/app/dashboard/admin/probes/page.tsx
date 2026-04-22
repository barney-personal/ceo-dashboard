import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getProbeStatusSummary, getProbeTimeline } from "@/lib/data/probes";
import {
  getSchemaCompatibilityMessage,
  isSchemaCompatibilityError,
} from "@/lib/db/errors";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { ProbeSummary } from "./_components/ProbeSummary";
import { ProbeTimeline } from "./_components/ProbeTimeline";
import {
  serializeSummary,
  serializeTimelineRun,
  type SerializedProbeCheckSummary,
  type SerializedTimelineRun,
} from "./_components/format";

const KNOWN_CHECKS = ["ceo-ping-auth"];

export default async function ProbesPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  const now = new Date();
  let serializedSummaries: SerializedProbeCheckSummary[] = [];
  let serializedTimeline: SerializedTimelineRun[] = [];
  let schemaWarning: string | null = null;

  try {
    const [summaries, timelineRuns] = await Promise.all([
      getProbeStatusSummary(KNOWN_CHECKS, now),
      getProbeTimeline(24),
    ]);
    serializedSummaries = summaries.map(serializeSummary);
    serializedTimeline = timelineRuns.map(serializeTimelineRun);
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }
    schemaWarning = getSchemaCompatibilityMessage(error);
  }

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Production Probes"
        description="Automated health checks, uptime, latency, and incident status"
      />

      {schemaWarning && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          {schemaWarning}
        </div>
      )}

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
