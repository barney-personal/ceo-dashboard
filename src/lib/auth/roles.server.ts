import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserWithTimeout } from "./current-user.server";
import { getUserRole, type Role } from "./roles";

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

  const realRole = getUserRole(
    (result.user.publicMetadata as Record<string, unknown>) ?? {}
  );

  // CEO-only overrides: impersonation takes precedence over role preview
  if (realRole === "ceo") {
    try {
      const cookieStore = await cookies();

      // Check impersonation first
      const impersonation = parseImpersonateCookie(
        cookieStore.get(IMPERSONATE_COOKIE)?.value
      );
      if (impersonation) {
        return impersonation.role;
      }

      // Fall back to role preview
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

/**
 * Get the active impersonation, if any.
 * Returns null if not impersonating or if the real user is not CEO.
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
    return parseImpersonateCookie(cookieStore.get(IMPERSONATE_COOKIE)?.value);
  } catch {
    return null;
  }
}

function parseImpersonateCookie(value: string | undefined): Impersonation | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      typeof parsed.userId === "string" &&
      typeof parsed.name === "string" &&
      (parsed.role === "everyone" || parsed.role === "leadership" || parsed.role === "ceo")
    ) {
      return { userId: parsed.userId, name: parsed.name, role: parsed.role };
    }
  } catch {
    // malformed cookie
  }
  return null;
}
