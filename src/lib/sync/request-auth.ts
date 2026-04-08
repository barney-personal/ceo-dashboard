import { currentUser } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { getUserRole, hasAccess, type Role } from "@/lib/auth/roles";

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
  const user = await currentUser();
  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const role = getUserRole(
    (user.publicMetadata as Record<string, unknown>) ?? {}
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
  request: NextRequest
): Promise<SyncRequestAccess> {
  if (await isCronRequest(request)) {
    return "cron";
  }

  const user = await currentUser();
  if (!user) {
    return "unauthenticated";
  }

  const role = getUserRole(
    (user.publicMetadata as Record<string, unknown>) ?? {}
  );

  return hasAccess(role, "ceo") ? "manual" : "forbidden";
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
