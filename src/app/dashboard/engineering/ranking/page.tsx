import {
  getRequiredRoleForDashboardPermission,
  requireDashboardPermission,
} from "@/lib/auth/dashboard-permissions.server";
import { hasAccess } from "@/lib/auth/roles";
import { buildHrEvidencePack } from "@/lib/data/engineering-ranking-hr";
import { getEngineeringRankingPageData } from "@/lib/data/engineering-ranking.server";
import { RankingScaffold } from "./_components/ranking-scaffold";

export const metadata = {
  title: "Ranking · Engineering",
};

export default async function EngineeringRankingPage() {
  const role = await requireDashboardPermission("engineering.ranking");

  const [pageData, hrRequiredRole] = await Promise.all([
    getEngineeringRankingPageData(),
    getRequiredRoleForDashboardPermission("engineering.ranking.hr"),
  ]);
  const {
    snapshot,
    profileSlugByHash,
    signals,
    slackRows,
    recent30dByLogin,
    recent30dAnalyses,
    performanceByEmail,
  } = pageData;

  const canSeeHrReview = hasAccess(role, hrRequiredRole);
  const hrPack = canSeeHrReview
    ? buildHrEvidencePack(snapshot, {
        signals,
        slackRows,
        recent30dByLogin,
        recent30dAnalyses,
        performanceByEmail,
      })
    : null;

  return (
    <RankingScaffold
      snapshot={snapshot}
      profileSlugByHash={profileSlugByHash}
      canSeeHrReview={canSeeHrReview}
      hrPack={hrPack}
    />
  );
}
