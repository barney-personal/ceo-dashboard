export type Role = "ceo" | "leadership" | "manager" | "everyone";

const ROLE_LEVEL: Record<Role, number> = {
  everyone: 0,
  manager: 1,
  leadership: 2,
  ceo: 3,
};

export function hasAccess(userRole: Role, requiredRole: Role): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}

/**
 * Resolve the *static* Clerk role from publicMetadata. The `manager` tier is
 * dynamic (derived at request time from SSoT org structure) and is never set
 * in Clerk — it's layered on in `roles.server.ts#getCurrentUserRole`.
 */
export function getUserRole(publicMetadata: Record<string, unknown>): Role {
  const role = publicMetadata?.role as string | undefined;
  if (role === "ceo" || role === "leadership") return role;
  return "everyone";
}
