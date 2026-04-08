import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { authErrorResponse, requireRole } from "@/lib/sync/request-auth";
import { type Role } from "@/lib/auth/roles";

const VALID_ROLES: Role[] = ["everyone", "leadership", "ceo"];

export async function GET() {
  const auth = await requireRole("ceo");
  const authError = authErrorResponse(auth);
  if (authError) {
    return authError;
  }

  const client = await clerkClient();
  const { data: users } = await client.users.getUserList({ limit: 100 });

  const serialized = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.emailAddresses[0]?.emailAddress ?? null,
    imageUrl: u.imageUrl,
    role:
      (u.publicMetadata as Record<string, unknown>)?.role ?? "everyone",
    lastSignInAt: u.lastSignInAt,
  }));

  return NextResponse.json(serialized);
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRole("ceo");
  const authError = authErrorResponse(auth);
  if (authError) {
    return authError;
  }

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
}
