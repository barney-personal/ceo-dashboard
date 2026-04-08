import { currentUser } from "@clerk/nextjs/server";
import { type NextRequest } from "next/server";
import { getUserRole, hasAccess } from "@/lib/auth/roles";

export async function isCronRequest(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  return (
    !!process.env.CRON_SECRET &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`
  );
}

export async function authorizeSyncRequest(
  request: NextRequest
): Promise<"cron" | "manual" | "unauthenticated" | "forbidden"> {
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
