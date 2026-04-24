import {
  getRequiredRoleForDashboardPermission,
  requireDashboardPermission,
} from "@/lib/auth/dashboard-permissions.server";
import { hasAccess } from "@/lib/auth/roles";
import { getEngineeringRankingPageData } from "@/lib/data/engineering-ranking.server";
import { MainScaffold } from "./_components/main-scaffold";

export const metadata = {
  title: "Ranking · Engineering",
};

export default async function EngineeringRankingPage() {
  const role = await requireDashboardPermission("engineering.ranking");

  const [pageData, hrRequiredRole] = await Promise.all([
    getEngineeringRankingPageData(),
    getRequiredRoleForDashboardPermission("engineering.ranking.hr"),
  ]);
  const { snapshot, profileSlugByHash } = pageData;
  const canSeeHrReview = hasAccess(role, hrRequiredRole);

  return (
    <MainScaffold
      snapshot={snapshot}
      profileSlugByHash={profileSlugByHash}
      canSeeHrReview={canSeeHrReview}
    />
  );
}
