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
