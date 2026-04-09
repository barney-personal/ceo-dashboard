import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserWithTimeout } from "./current-user.server";
import { getUserRole, type Role } from "./roles";

export const ROLE_PREVIEW_COOKIE = "role-preview";

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

  const realRole = getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );

  // CEO-only role preview: override role via cookie for testing
  if (realRole === "ceo") {
    try {
      const cookieStore = await cookies();
      const preview = cookieStore.get(ROLE_PREVIEW_COOKIE)?.value as Role | undefined;
      if (preview === "everyone" || preview === "leadership") {
        return preview;
      }
    } catch {
      // cookies() unavailable outside request scope (e.g. tests)
    }
  }

  return realRole;
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

  return getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );
}
