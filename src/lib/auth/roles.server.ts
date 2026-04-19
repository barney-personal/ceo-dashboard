import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { getCurrentUserWithTimeout } from "./current-user.server";
import { getUserRole, type Role } from "./roles";
import { isManagerByAnyEmail } from "@/lib/data/managers";

export const ROLE_PREVIEW_COOKIE = "role-preview";
export const IMPERSONATE_COOKIE = "impersonate";

export interface Impersonation {
  userId: string;
  name: string;
  role: Role;
}

/**
 * Fetch the current user's role from Clerk.
 * Uses currentUser() which returns the full user object including
 * publicMetadata — unlike sessionClaims which requires a custom JWT
 * template to include publicMetadata.
 *
 * Server-only: cannot be imported from client components.
 */
export async function getCurrentUserRole(): Promise<Role> {
  const result = await getCurrentUserWithTimeout();

  if (result.status === "timeout") {
    redirect("/sign-in");
  }

  if (result.status === "unauthenticated") {
    return "everyone";
  }

  const clerkRole = getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );
  const realRole = await promoteToManagerIfNeeded(
    clerkRole,
    (result.user.emailAddresses ?? []).map((e) => e.emailAddress),
  );

  // CEO-only overrides: impersonation takes precedence over role preview
  if (realRole === "ceo") {
    try {
      const cookieStore = await cookies();

      // Check impersonation first — resolve role from Clerk, not the cookie
      const cookieData = parseImpersonateCookie(
        cookieStore.get(IMPERSONATE_COOKIE)?.value
      );
      if (cookieData) {
        const role = await resolveUserRole(cookieData.userId);
        return role;
      }

      // Fall back to role preview
      const preview = cookieStore.get(ROLE_PREVIEW_COOKIE)?.value as Role | undefined;
      if (preview === "everyone" || preview === "leadership" || preview === "manager") {
        return preview;
      }
    } catch {
      // cookies() unavailable outside request scope (e.g. tests)
    }
  }

  return realRole;
}

/**
 * Promote an `everyone` role to `manager` if ANY of the user's Clerk email
 * addresses matches an employee in SSoT with ≥2 active direct reports.
 * Leadership/CEO roles are unchanged (manager access is a subset of theirs).
 *
 * Checking all addresses (not just the primary) makes this robust to Clerk
 * users whose primary email is a personal address while a verified secondary
 * is their `@meetcleo.com`.
 *
 * The SSoT query is request-scoped via React cache() so this promotion is
 * essentially free after the first role lookup per request.
 */
async function promoteToManagerIfNeeded(
  clerkRole: Role,
  emails: string[],
): Promise<Role> {
  if (clerkRole !== "everyone" || emails.length === 0) return clerkRole;
  try {
    const isMgr = await isManagerByAnyEmail(emails);
    return isMgr ? "manager" : clerkRole;
  } catch {
    // Mode data unavailable (DB down, empty SSoT) — fall back to the
    // Clerk-configured role rather than crashing the whole request.
    return clerkRole;
  }
}

/**
 * Get the real (un-overridden) role for the current user.
 * Used to decide whether to show the role preview toggle.
 */
export async function getRealUserRole(): Promise<Role> {
  const result = await getCurrentUserWithTimeout();

  if (result.status === "timeout") {
    redirect("/sign-in");
  }

  if (result.status === "unauthenticated") {
    return "everyone";
  }

  const clerkRole = getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );
  return promoteToManagerIfNeeded(
    clerkRole,
    (result.user.emailAddresses ?? []).map((e) => e.emailAddress),
  );
}

/**
 * Get the active impersonation, if any.
 * Returns null if not impersonating or if the real user is not CEO.
 * Resolves the target user's role from Clerk (not the cookie snapshot).
 */
export async function getImpersonation(): Promise<Impersonation | null> {
  const result = await getCurrentUserWithTimeout();
  if (result.status !== "authenticated") return null;

  const realRole = getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );
  if (realRole !== "ceo") return null;

  try {
    const cookieStore = await cookies();
    const cookieData = parseImpersonateCookie(
      cookieStore.get(IMPERSONATE_COOKIE)?.value
    );
    if (!cookieData) return null;

    // Resolve live role from Clerk rather than trusting cookie snapshot
    const role = await resolveUserRole(cookieData.userId);
    return { ...cookieData, role };
  } catch {
    return null;
  }
}

/** Look up a user's current role from Clerk by ID. */
async function resolveUserRole(userId: string): Promise<Role> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return getUserRole(
      (user.publicMetadata as Record<string, unknown>) ?? {}
    );
  } catch {
    return "everyone";
  }
}

function parseImpersonateCookie(value: string | undefined): Impersonation | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed.userId === "string" &&
      typeof parsed.name === "string" &&
      (parsed.role === "everyone" || parsed.role === "manager" || parsed.role === "leadership" || parsed.role === "ceo")
    ) {
      return { userId: parsed.userId, name: parsed.name, role: parsed.role };
    }
  } catch {
    // malformed cookie
  }
  return null;
}
