import { type Role, hasAccess } from "@/lib/auth/roles";

interface PermissionGateProps {
  role: Role;
  requiredRole: Role;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({
  role,
  requiredRole,
  children,
  fallback = null,
}: PermissionGateProps) {
  if (!hasAccess(role, requiredRole)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
