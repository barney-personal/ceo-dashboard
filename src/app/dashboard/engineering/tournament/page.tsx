import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import {
  getLatestTournamentRunDetail,
  getRecentTournamentRuns,
} from "@/lib/data/tournament";
import { TournamentReport } from "./_components/tournament-report";

export const metadata = {
  title: "Tournament · Engineering",
};

export const dynamic = "force-dynamic";

export default async function TournamentPage() {
  await requireDashboardPermission("engineering.tournament");

  const [latest, recent] = await Promise.all([
    getLatestTournamentRunDetail(),
    getRecentTournamentRuns(8),
  ]);

  return <TournamentReport latest={latest} recent={recent} />;
}
