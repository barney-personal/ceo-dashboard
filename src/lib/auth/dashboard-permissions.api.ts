import { NextResponse } from "next/server";
import { getCurrentUserWithTimeout } from "./current-user.server";
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
  // Always require an authenticated session, regardless of the permission's
  // required role. `getCurrentUserRole()` returns "everyone" for both
  // unauthenticated callers and authenticated-but-no-role users — so without
  // this precheck, lowering an editable admin permission to "everyone" via
  // the permissions admin would let anonymous traffic through.
  const auth = await getCurrentUserWithTimeout();
  if (auth.status !== "authenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
