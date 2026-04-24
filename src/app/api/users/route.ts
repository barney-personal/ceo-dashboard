import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { dashboardPermissionErrorResponse } from "@/lib/auth/dashboard-permissions.api";
import { type Role } from "@/lib/auth/roles";

const VALID_ROLES: Role[] = ["everyone", "leadership", "ceo"];

export async function GET() {
  try {
    const authError = await dashboardPermissionErrorResponse("admin.users");
    if (authError) return authError;

    const client = await clerkClient();
    const { data: users } = await client.users.getUserList({ limit: 100 });

    const sessionCounts = await Promise.all(
      users.map(async (u) => {
        try {
          const { data: sessions } = await client.sessions.getSessionList({
            userId: u.id,
            limit: 100,
          });
          return { userId: u.id, count: sessions.length };
        } catch {
          return { userId: u.id, count: 0 };
        }
      })
    );
    const sessionCountMap = new Map(
      sessionCounts.map((s) => [s.userId, s.count])
    );

    const serialized = users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.emailAddresses[0]?.emailAddress ?? null,
      imageUrl: u.imageUrl,
      role:
        (u.publicMetadata as Record<string, unknown>)?.role ?? "everyone",
      lastSignInAt: u.lastSignInAt,
      lastActiveAt: u.lastActiveAt,
      sessionCount: sessionCountMap.get(u.id) ?? 0,
    }));

    return NextResponse.json(serialized);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authError = await dashboardPermissionErrorResponse("admin.users");
    if (authError) return authError;

    const body = await request.json();
    const { userId, role } = body as { userId?: string; role?: string };

    if (!userId || !role) {
      return NextResponse.json(
        { error: "userId and role are required" },
        { status: 400 }
      );
    }

    if (!VALID_ROLES.includes(role as Role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    const client = await clerkClient();
    const updated = await client.users.updateUser(userId, {
      publicMetadata: { role },
    });

    return NextResponse.json({
      id: updated.id,
      role: (updated.publicMetadata as Record<string, unknown>)?.role ?? "everyone",
    });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
