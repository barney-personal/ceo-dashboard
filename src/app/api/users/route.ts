import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { dashboardPermissionErrorResponse } from "@/lib/auth/dashboard-permissions.api";
import { type Role } from "@/lib/auth/roles";

const VALID_ROLES: Role[] = [
  "everyone",
  "engineering_manager",
  "leadership",
  "ceo",
];

export async function GET() {
  try {
    const authError = await dashboardPermissionErrorResponse("admin.users");
    if (authError) return authError;

    const client = await clerkClient();

    const USER_PAGE_SIZE = 100;
    const users: Awaited<ReturnType<typeof client.users.getUserList>>["data"] = [];
    for (let offset = 0; ; offset += USER_PAGE_SIZE) {
      const { data, totalCount } = await client.users.getUserList({
        limit: USER_PAGE_SIZE,
        offset,
        orderBy: "-created_at",
      });
      users.push(...data);
      if (data.length < USER_PAGE_SIZE || users.length >= totalCount) break;
    }

    const SESSION_FETCH_CONCURRENCY = 20;
    const sessionCountMap = new Map<string, number>();
    for (let i = 0; i < users.length; i += SESSION_FETCH_CONCURRENCY) {
      const batch = users.slice(i, i + SESSION_FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (u) => {
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
      for (const { userId, count } of results) sessionCountMap.set(userId, count);
    }

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
