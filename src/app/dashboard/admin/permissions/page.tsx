import { requireDashboardPermission, getDashboardPermissionSummaries } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { DashboardPermissionsAdmin } from "@/components/dashboard/dashboard-permissions-admin";

export default async function PermissionsAdminPage() {
  await requireDashboardPermission("admin.permissions");
  const permissions = await getDashboardPermissionSummaries();

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Permissions"
        description="Choose the minimum role required for each dashboard page."
      />
      <DashboardPermissionsAdmin initialPermissions={permissions} />
    </div>
  );
}
