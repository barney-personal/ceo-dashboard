import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { authErrorResponse, requireRole } from "@/lib/sync/request-auth";
import { db } from "@/lib/db";
import { dashboardPermissionOverrides } from "@/lib/db/schema";
import {
  DASHBOARD_PERMISSION_IDS,
  EDITABLE_PERMISSION_ROLES,
  getDashboardPermissionDefinition,
  type DashboardPermissionId,
} from "@/lib/auth/dashboard-permissions";
import type { Role } from "@/lib/auth/roles";
import { getDashboardPermissionSummaries } from "@/lib/auth/dashboard-permissions.server";

function isDashboardPermissionId(value: string): value is DashboardPermissionId {
  return DASHBOARD_PERMISSION_IDS.some((permissionId) => permissionId === value);
}

function revalidateDashboardPermissions() {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/admin/permissions", "page");
}

function isEditablePermissionRole(value: string): value is Role {
  return EDITABLE_PERMISSION_ROLES.includes(value as Role);
}

async function parseJsonBody<T>(
  request: NextRequest,
): Promise<
  | {
      ok: true;
      body: T;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  try {
    return {
      ok: true,
      body: (await request.json()) as T,
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }
}

export async function GET() {
  try {
    const auth = await requireRole("ceo");
    const authError = authErrorResponse(auth);
    if (authError) {
      return authError;
    }

    const permissions = await getDashboardPermissionSummaries();
    return NextResponse.json(permissions);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRole("ceo");
    const authError = authErrorResponse(auth);
    if (authError) {
      return authError;
    }

    const parsedBody = await parseJsonBody<{
      permissionId?: string;
      requiredRole?: string;
    }>(request);

    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const body = parsedBody.body;

    if (!body.permissionId || !body.requiredRole) {
      return NextResponse.json(
        { error: "permissionId and requiredRole are required" },
        { status: 400 },
      );
    }

    if (!isDashboardPermissionId(body.permissionId)) {
      return NextResponse.json(
        { error: "Unknown dashboard permission" },
        { status: 404 },
      );
    }

    if (!isEditablePermissionRole(body.requiredRole)) {
      return NextResponse.json(
        {
          error: `Invalid role. Must be one of: ${EDITABLE_PERMISSION_ROLES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const definition = getDashboardPermissionDefinition(body.permissionId);
    if (definition.editable === false) {
      return NextResponse.json(
        { error: "This permission is locked and cannot be changed" },
        { status: 400 },
      );
    }

    if (body.requiredRole === definition.defaultRole) {
      await db
        .delete(dashboardPermissionOverrides)
        .where(eq(dashboardPermissionOverrides.permissionId, body.permissionId));
    } else {
      await db
        .insert(dashboardPermissionOverrides)
        .values({
          permissionId: body.permissionId,
          requiredRole: body.requiredRole,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: dashboardPermissionOverrides.permissionId,
          set: {
            requiredRole: body.requiredRole,
            updatedAt: new Date(),
          },
        });
    }

    revalidateDashboardPermissions();
    const permissions = await getDashboardPermissionSummaries();
    const updated = permissions.find((item) => item.id === body.permissionId);

    return NextResponse.json(updated);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRole("ceo");
    const authError = authErrorResponse(auth);
    if (authError) {
      return authError;
    }

    const parsedBody = await parseJsonBody<{
      permissionId?: string;
    }>(request);

    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const body = parsedBody.body;

    if (!body.permissionId) {
      return NextResponse.json(
        { error: "permissionId is required" },
        { status: 400 },
      );
    }

    if (!isDashboardPermissionId(body.permissionId)) {
      return NextResponse.json(
        { error: "Unknown dashboard permission" },
        { status: 404 },
      );
    }

    const definition = getDashboardPermissionDefinition(body.permissionId);
    if (definition.editable === false) {
      return NextResponse.json(
        { error: "This permission is locked and cannot be reset" },
        { status: 400 },
      );
    }

    await db
      .delete(dashboardPermissionOverrides)
      .where(eq(dashboardPermissionOverrides.permissionId, body.permissionId));

    revalidateDashboardPermissions();
    const permissions = await getDashboardPermissionSummaries();
    const updated = permissions.find((item) => item.id === body.permissionId);

    return NextResponse.json(updated);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
