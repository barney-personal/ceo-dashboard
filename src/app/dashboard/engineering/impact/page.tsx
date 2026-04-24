import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { getImpactAnalysis } from "@/lib/data/engineering-impact";
import { ImpactReport } from "./_components/impact-report";

export const metadata = {
  title: "Impact · Engineering",
};

export default async function ImpactPage() {
  await requireDashboardPermission("engineering.impact");

  const analysis = await getImpactAnalysis();

  return <ImpactReport analysis={analysis} />;
}
