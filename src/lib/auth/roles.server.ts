import { currentUser } from "@clerk/nextjs/server";
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
  const user = await currentUser();
  if (!user) return "everyone";
  return getUserRole(
    (user.publicMetadata as Record<string, unknown>) ?? {}
  );
}
