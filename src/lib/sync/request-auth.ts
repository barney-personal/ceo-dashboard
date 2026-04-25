import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserWithTimeout } from "@/lib/auth/current-user.server";
import { getUserRole, hasAccess, type Role } from "@/lib/auth/roles";
import {
  getDashboardPermissionDefinition,
  type DashboardPermissionId,
} from "@/lib/auth/dashboard-permissions";
import {
  getRequiredRoleForDashboardPermission,
} from "@/lib/auth/dashboard-permissions.server";

export type AuthCheckResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

export type SyncRequestAccess =
  | "cron"
  | "manual"
  | "unauthenticated"
  | "forbidden";

/**
 * Check that the current Clerk session holds at least `minRole`.
 * Returns 401 for unauthenticated requests, 403 for insufficient role.
 */
export async function requireRole(minRole: Role): Promise<AuthCheckResult> {
  const result = await getCurrentUserWithTimeout();

  if (result.status !== "authenticated") {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const role = getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );
  if (!hasAccess(role, minRole)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}

export function authErrorResponse(auth: AuthCheckResult): NextResponse | null {
  if (auth.ok) {
    return null;
  }

  return NextResponse.json({ error: auth.error }, { status: auth.status });
}

export async function isCronRequest(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  return (
    !!process.env.CRON_SECRET &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`
  );
}

export async function authorizeSyncRequest(
  request: NextRequest,
  manualPermissionId?: DashboardPermissionId,
): Promise<SyncRequestAccess> {
  const identity = await authorizeSyncRequestWithIdentity(
    request,
    manualPermissionId,
  );
  return identity.access;
}

export type SyncRequestIdentity =
  | { access: "cron" }
  | { access: "manual"; userId: string }
  | { access: "unauthenticated" }
  | { access: "forbidden" };

export async function authorizeSyncRequestWithIdentity(
  request: NextRequest,
  manualPermissionId?: DashboardPermissionId,
): Promise<SyncRequestIdentity> {
  if (await isCronRequest(request)) {
    return { access: "cron" };
  }

  const result = await getCurrentUserWithTimeout();

  if (result.status !== "authenticated") {
    return { access: "unauthenticated" };
  }

  const role = getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );

  let requiredRole: Role = "ceo";
  if (manualPermissionId) {
    const definition = getDashboardPermissionDefinition(manualPermissionId);
    requiredRole =
      definition.editable === false
        ? definition.defaultRole
        : await getRequiredRoleForDashboardPermission(manualPermissionId);
  }

  if (!hasAccess(role, requiredRole)) {
    return { access: "forbidden" };
  }

  return { access: "manual", userId: result.user.id };
}

export function syncRequestAccessErrorResponse(
  access: SyncRequestAccess
): NextResponse | null {
  if (access === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (access === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
