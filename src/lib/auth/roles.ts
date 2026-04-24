export type Role =
  | "ceo"
  | "leadership"
  | "engineering_manager"
  | "manager"
  | "everyone";

const ROLE_LEVEL: Record<Role, number> = {
  everyone: 0,
  manager: 1,
  engineering_manager: 2,
  leadership: 3,
  ceo: 4,
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
  if (role === "ceo" || role === "leadership" || role === "engineering_manager") {
    return role;
  }
  return "everyone";
}
