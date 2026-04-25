import { cookies } from "next/headers";
import { clerkClient } from "@clerk/nextjs/server";
import { getCurrentUserWithTimeout } from "./current-user.server";
import { getUserRole, type Role } from "./roles";
import { ROLE_PREVIEW_COOKIE, IMPERSONATE_COOKIE } from "./roles.server";

export type EngineeringSurface = "a-side" | "b-side";

export interface EngineeringViewResolution {
  /** Which surface the current request should render. */
  surface: EngineeringSurface;
  /** True iff the real Clerk session user is CEO — not derived from preview,
   * impersonation, manager auto-promotion, or role overrides. */
  actualCeo: boolean;
  /** Raw publicMetadata.engineeringViewB value on the actual CEO user. */
  toggleOn: boolean;
  /** Effective display role after role preview/impersonation are applied. */
  effectiveRole: Role;
}

const ANON_RESOLUTION: EngineeringViewResolution = {
  surface: "a-side",
  actualCeo: false,
  toggleOn: false,
  effectiveRole: "everyone",
};

function readBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * Resolve which engineering surface the caller should see.
 *
 * The surface returns "b-side" ONLY when every condition holds:
 *   1. The real Clerk user has publicMetadata.role === "ceo".
 *   2. publicMetadata.engineeringViewB === true on that user.
 *   3. No impersonation cookie is active (impersonation routes the CEO into
 *      another user's view — that view is always A-side for now).
 *
 * The role-preview cookie does NOT route the CEO back to A-side any more —
 * instead it switches the B-side persona (manager when effectiveRole stays
 * `ceo` or `leadership`, engineer otherwise). This keeps the engineer-view
 * code path testable by the real CEO without compromising leakage: only
 * `actualCeo === true` users ever reach B-side.
 *
 * Non-CEOs always resolve to A-side, even if their publicMetadata has been
 * hand-edited to set engineeringViewB true. Manager auto-promotion and the
 * `manager` role are non-CEO and therefore cannot reach B-side.
 */
export async function getEngineeringViewResolution(): Promise<EngineeringViewResolution> {
  const result = await getCurrentUserWithTimeout();
  if (result.status !== "authenticated") {
    return ANON_RESOLUTION;
  }

  const metadata =
    (result.user.publicMetadata as Record<string, unknown>) ?? {};
  const actualRole = getUserRole(metadata);
  const actualCeo = actualRole === "ceo";
  const toggleOn = actualCeo && readBoolean(metadata.engineeringViewB);

  let effectiveRole: Role = actualRole;

  if (actualCeo) {
    try {
      const cookieStore = await cookies();
      const impersonate = cookieStore.get(IMPERSONATE_COOKIE)?.value;
      if (impersonate) {
        return {
          surface: "a-side",
          actualCeo: true,
          toggleOn,
          effectiveRole,
        };
      }

      const preview = cookieStore.get(ROLE_PREVIEW_COOKIE)?.value as
        | Role
        | undefined;
      if (
        preview === "everyone" ||
        preview === "manager" ||
        preview === "engineering_manager" ||
        preview === "leadership"
      ) {
        effectiveRole = preview;
      }
    } catch {
      // cookies() unavailable (outside a request scope, e.g. some tests).
      // Fall through with the default effectiveRole.
    }
  }

  const surface: EngineeringSurface =
    actualCeo && toggleOn ? "b-side" : "a-side";

  return { surface, actualCeo, toggleOn, effectiveRole };
}

/** Convenience helper for route handlers and layouts. */
export async function isEngineeringViewB(): Promise<boolean> {
  const { surface } = await getEngineeringViewResolution();
  return surface === "b-side";
}

export class EngineeringViewMutationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "EngineeringViewMutationError";
  }
}

/**
 * Persist the engineeringViewB toggle on the real CEO user's publicMetadata.
 * Throws EngineeringViewMutationError for unauthenticated or non-CEO callers.
 * Role preview and impersonation MUST NOT grant mutation rights — this helper
 * reads the real session user from Clerk, not the effective role.
 */
export async function setEngineeringViewB(value: boolean): Promise<void> {
  const result = await getCurrentUserWithTimeout();
  if (result.status !== "authenticated") {
    throw new EngineeringViewMutationError("Unauthorized", 401);
  }

  const metadata =
    (result.user.publicMetadata as Record<string, unknown>) ?? {};
  if (getUserRole(metadata) !== "ceo") {
    throw new EngineeringViewMutationError("Forbidden", 403);
  }

  const client = await clerkClient();
  await client.users.updateUser(result.user.id, {
    publicMetadata: { ...metadata, engineeringViewB: !!value },
  });
}
