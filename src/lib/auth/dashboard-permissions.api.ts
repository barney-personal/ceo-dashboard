import { NextResponse } from "next/server";
import { getCurrentUserRole } from "./roles.server";
import { hasAccess } from "./roles";
import {
  getRequiredRoleForDashboardPermission,
} from "./dashboard-permissions.server";
import type { DashboardPermissionId } from "./dashboard-permissions";

export async function dashboardPermissionErrorResponse(
  permissionId: DashboardPermissionId,
): Promise<NextResponse | null> {
  const [role, requiredRole] = await Promise.all([
    getCurrentUserRole(),
    getRequiredRoleForDashboardPermission(permissionId),
  ]);

  if (hasAccess(role, requiredRole)) {
    return null;
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
