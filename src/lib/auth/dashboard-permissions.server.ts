import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { dashboardPermissionOverrides } from "@/lib/db/schema";
import { isSchemaCompatibilityError } from "@/lib/db/errors";
import { getCurrentUserRole } from "./roles.server";
import { hasAccess, type Role } from "./roles";
import {
  EDITABLE_PERMISSION_ROLES,
  buildDashboardNavGroups,
  buildDashboardPermissionSummaries,
  getDashboardPermissionDefinition,
  type DashboardNavGroup,
  type DashboardPermissionId,
  type DashboardPermissionRoleMap,
  type DashboardPermissionSummary,
} from "./dashboard-permissions";

function isEditablePermissionRole(value: string): value is Role {
  return EDITABLE_PERMISSION_ROLES.includes(value as Role);
}

const getStoredDashboardPermissionOverrides = cache(
  async (): Promise<DashboardPermissionRoleMap> => {
    try {
      const rows = await db
        .select({
          permissionId: dashboardPermissionOverrides.permissionId,
          requiredRole: dashboardPermissionOverrides.requiredRole,
        })
        .from(dashboardPermissionOverrides);

      return rows.reduce<DashboardPermissionRoleMap>((acc, row) => {
        try {
          const definition = getDashboardPermissionDefinition(
            row.permissionId as DashboardPermissionId,
          );

          if (isEditablePermissionRole(row.requiredRole)) {
            acc[definition.id] = row.requiredRole;
          }
        } catch {
          // Ignore invalid stored permission IDs or roles and fall back to the
          // registry defaults for the affected route.
        }

        return acc;
      }, {});
    } catch (error) {
      // Missing table/column should fall back to code defaults so pre-migration
      // environments keep working. Transient DB outages must not widen access by
      // silently dropping persisted overrides.
      if (isSchemaCompatibilityError(error)) {
        return {};
      }

      throw error;
    }
  },
);

export const getDashboardPermissionRoleMap = cache(
  async (): Promise<Record<DashboardPermissionId, Role>> => {
    const storedOverrides = await getStoredDashboardPermissionOverrides();
    const summaries = buildDashboardPermissionSummaries(storedOverrides);

    return summaries.reduce<Record<DashboardPermissionId, Role>>(
      (acc, summary) => {
        acc[summary.id] = summary.requiredRole;
        return acc;
      },
      {} as Record<DashboardPermissionId, Role>,
    );
  },
);

export const getDashboardPermissionSummaries = cache(
  async (): Promise<DashboardPermissionSummary[]> => {
    const storedOverrides = await getStoredDashboardPermissionOverrides();
    return buildDashboardPermissionSummaries(storedOverrides);
  },
);

export const getDashboardNavGroups = cache(
  async (): Promise<DashboardNavGroup[]> => {
    const storedOverrides = await getStoredDashboardPermissionOverrides();
    return buildDashboardNavGroups(storedOverrides);
  },
);

export async function getRequiredRoleForDashboardPermission(
  permissionId: DashboardPermissionId,
): Promise<Role> {
  const roleMap = await getDashboardPermissionRoleMap();
  return roleMap[permissionId];
}

export async function requireDashboardPermission(
  permissionId: DashboardPermissionId,
): Promise<Role> {
  const definition = getDashboardPermissionDefinition(permissionId);
  const [role, requiredRole] = await Promise.all([
    getCurrentUserRole(),
    definition.editable === false
      ? Promise.resolve(definition.defaultRole)
      : getRequiredRoleForDashboardPermission(permissionId),
  ]);

  if (!hasAccess(role, requiredRole)) {
    redirect(definition.redirectTo ?? "/dashboard");
  }

  return role;
}
