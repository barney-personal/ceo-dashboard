import {
  getRequiredRoleForDashboardPermission,
  requireDashboardPermission,
} from "@/lib/auth/dashboard-permissions.server";
import { hasAccess } from "@/lib/auth/roles";
import { buildHrEvidencePack } from "@/lib/data/engineering-ranking-hr";
import {
  getEngineeringRankingPageData,
  getHrAuxiliaryData,
} from "@/lib/data/engineering-ranking.server";
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
  const { snapshot, profileSlugByHash, signals } = pageData;

  const canSeeHrReview = hasAccess(role, hrRequiredRole);
  // The HR auxiliary fetches (Slack rows, 30d GitHub activity, 30d rubric
  // analyses, performance ratings) are only triggered when the viewer can
  // actually see the HR section. Viewers without the permission pay no
  // additional DB/API cost compared to the base ranking page.
  const hrPack = canSeeHrReview
    ? await (async () => {
        const aux = await getHrAuxiliaryData();
        return buildHrEvidencePack(snapshot, {
          signals,
          slackRows: aux.slackRows,
          recent30dByLogin: aux.recent30dByLogin,
          recent30dAnalyses: aux.recent30dAnalyses,
          performanceByEmail: aux.performanceByEmail,
        });
      })()
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
