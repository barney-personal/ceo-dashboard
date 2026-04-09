import { redirect } from "next/navigation";
import { getCurrentUserWithTimeout } from "./current-user.server";
import { getUserRole, type Role } from "./roles";

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

  return getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );
}
