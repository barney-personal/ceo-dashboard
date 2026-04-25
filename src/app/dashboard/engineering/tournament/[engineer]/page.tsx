import { notFound } from "next/navigation";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { getEngineerTournamentDetail } from "@/lib/data/tournament";
import { EngineerDetailReport } from "./_components/engineer-detail-report";

export const dynamic = "force-dynamic";

export default async function EngineerTournamentDetailPage({
  params,
}: {
  params: Promise<{ engineer: string }>;
}) {
  await requireDashboardPermission("engineering.tournament");

  const { engineer } = await params;
  const email = decodeURIComponent(engineer);
  const detail = await getEngineerTournamentDetail(email);
  if (!detail) notFound();

  return <EngineerDetailReport detail={detail} />;
}
