import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { getEngineeringRankingPageData } from "@/lib/data/engineering-ranking.server";
import { RankingScaffold } from "./_components/ranking-scaffold";

export const metadata = {
  title: "Ranking · Engineering",
};

export default async function EngineeringRankingPage() {
  await requireDashboardPermission("engineering.ranking");

  const { snapshot, profileSlugByHash } =
    await getEngineeringRankingPageData();

  return (
    <RankingScaffold
      snapshot={snapshot}
      profileSlugByHash={profileSlugByHash}
    />
  );
}
