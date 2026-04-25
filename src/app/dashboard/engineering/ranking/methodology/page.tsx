import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { getEngineeringRankingPageData } from "@/lib/data/engineering-ranking.server";
import { MethodologyScaffold } from "../_components/methodology-scaffold";

export const metadata = {
  title: "Methodology · Engineer Ranking",
};

export default async function EngineeringRankingMethodologyPage() {
  await requireDashboardPermission("engineering.ranking");
  const { snapshot } = await getEngineeringRankingPageData();
  return <MethodologyScaffold snapshot={snapshot} />;
}
