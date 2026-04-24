import { hasAccess } from "@/lib/auth/roles";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import {
  getImpactAnalysis,
  type ImpactAnalysis,
} from "@/lib/data/engineering-impact";
import { ImpactReport } from "./_components/impact-report";

export const metadata = {
  title: "Impact · Engineering",
};

// Non-leadership viewers get the same engineer payload with fields that
// aren't exposed on the everyone-accessible Engineers table scrubbed.
// `startDate` is excluded from the engineer-ranking payload deliberately
// (see src/lib/data/engineering.ts) to avoid leaking hire dates to the
// whole company; `location` isn't on that page at all. Keeping parity here
// means opening Impact doesn't widen data exposure beyond what already
// ships to `everyone`.
function scrubForNonLeadership(analysis: ImpactAnalysis): ImpactAnalysis {
  return {
    ...analysis,
    engineers: analysis.engineers.map((e) => ({
      ...e,
      startDate: "",
      location: null,
    })),
  };
}

export default async function ImpactPage() {
  const role = await requireDashboardPermission("engineering.impact");
  const canSeeIndividuals = hasAccess(role, "leadership");

  const raw = await getImpactAnalysis();
  const analysis = canSeeIndividuals ? raw : scrubForNonLeadership(raw);

  return (
    <ImpactReport analysis={analysis} canSeeIndividuals={canSeeIndividuals} />
  );
}
