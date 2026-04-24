import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { SquadAdmin } from "@/components/dashboard/squad-admin";
import { db } from "@/lib/db";
import { squads } from "@/lib/db/schema";

export default async function SquadsAdminPage() {
  await requireDashboardPermission("admin.squads");

  const allSquads = await db
    .select()
    .from(squads)
    .orderBy(squads.pillar, squads.name);

  // Serialize dates for client component
  const serialized = allSquads.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Squad Registry"
        description="Manage squads, pillars, and PMs"
      />
      <SquadAdmin initialSquads={serialized} />
    </div>
  );
}
