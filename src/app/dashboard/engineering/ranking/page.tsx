import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getEngineeringRankingSnapshot } from "@/lib/data/engineering-ranking.server";
import { RankingScaffold } from "./_components/ranking-scaffold";

export const metadata = {
  title: "Ranking · Engineering",
};

export default async function EngineeringRankingPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard/engineering");
  }

  const snapshot = await getEngineeringRankingSnapshot();

  return <RankingScaffold snapshot={snapshot} />;
}
