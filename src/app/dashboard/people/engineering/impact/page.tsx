import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { getImpactAnalysis } from "@/lib/data/engineering-impact";
import { ImpactReport } from "./_components/impact-report";

export const metadata = {
  title: "Impact · Engineering",
};

export default async function ImpactPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const analysis = await getImpactAnalysis();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Impact"
        description="How engineering impact is distributed across tenure, discipline, level, and pillar — with a watchlist of concerns for leadership review."
      />
      <ImpactReport analysis={analysis} />
    </div>
  );
}
