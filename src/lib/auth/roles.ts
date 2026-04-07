import { currentUser } from "@clerk/nextjs/server";

export type Role = "ceo" | "leadership" | "everyone";

const ROLE_LEVEL: Record<Role, number> = {
  everyone: 0,
  leadership: 1,
  ceo: 2,
};

export function hasAccess(userRole: Role, requiredRole: Role): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}

export function getUserRole(publicMetadata: Record<string, unknown>): Role {
  const role = publicMetadata?.role as string | undefined;
  if (role === "ceo" || role === "leadership") return role;
  return "everyone";
}

/**
 * Fetch the current user's role from Clerk.
 * Uses currentUser() which returns the full user object including
 * publicMetadata — unlike sessionClaims which requires a custom JWT
 * template to include publicMetadata.
 */
export async function getCurrentUserRole(): Promise<Role> {
  const user = await currentUser();
  if (!user) return "everyone";
  return getUserRole(
    (user.publicMetadata as Record<string, unknown>) ?? {}
  );
}
