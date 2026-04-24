import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { buildHrEvidencePack } from "@/lib/data/engineering-ranking-hr";
import {
  getEngineeringRankingPageData,
  getHrAuxiliaryData,
} from "@/lib/data/engineering-ranking.server";
import { HrReviewSection } from "../_components/hr-review-section";
import { RankingHeader } from "../_components/shared";

export const metadata = {
  title: "HR Review · Engineer Ranking",
};

export default async function EngineeringRankingHrReviewPage() {
  await requireDashboardPermission("engineering.ranking.hr");

  const [pageData, aux] = await Promise.all([
    getEngineeringRankingPageData(),
    getHrAuxiliaryData(),
  ]);
  const { snapshot, profileSlugByHash, signals } = pageData;
  const pack = buildHrEvidencePack(snapshot, {
    signals,
    slackRows: aux.slackRows,
    recent30dByLogin: aux.recent30dByLogin,
    recent30dAnalyses: aux.recent30dAnalyses,
    performanceByEmail: aux.performanceByEmail,
  });

  return (
    <div className="space-y-6">
      <RankingHeader
        snapshot={snapshot}
        title="HR review"
        subtitle="Evidence pack for a manager-calibration conversation about the bottom-ranked engineers. Decision support, not a case file."
        links={[
          { href: "/dashboard/engineering/ranking", label: "Back to ranking" },
          {
            href: "/dashboard/engineering/ranking/methodology",
            label: "Methodology",
          },
        ]}
      />
      <HrReviewSection pack={pack} profileSlugByHash={profileSlugByHash} />
    </div>
  );
}
