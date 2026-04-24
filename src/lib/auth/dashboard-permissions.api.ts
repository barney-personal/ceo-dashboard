import { NextResponse } from "next/server";
import { getCurrentUserRole } from "./roles.server";
import { hasAccess } from "./roles";
import { getDashboardPermissionDefinition } from "./dashboard-permissions";
import {
  getRequiredRoleForDashboardPermission,
} from "./dashboard-permissions.server";
import type { DashboardPermissionId } from "./dashboard-permissions";

export async function dashboardPermissionErrorResponse(
  permissionId: DashboardPermissionId,
): Promise<NextResponse | null> {
  const definition = getDashboardPermissionDefinition(permissionId);
  const [role, requiredRole] = await Promise.all([
    getCurrentUserRole(),
    definition.editable === false
      ? Promise.resolve(definition.defaultRole)
      : getRequiredRoleForDashboardPermission(permissionId),
  ]);

  if (hasAccess(role, requiredRole)) {
    return null;
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
