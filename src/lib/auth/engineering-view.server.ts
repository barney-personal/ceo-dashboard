import { cache } from "react";
import { cookies } from "next/headers";
import { clerkClient } from "@clerk/nextjs/server";
import { getCurrentUserWithTimeout } from "./current-user.server";
import { getUserRole, hasAccess, type Role } from "./roles";
import { ROLE_PREVIEW_COOKIE, getImpersonation } from "./roles.server";

export type EngineeringSurface = "a-side" | "b-side";

/**
 * Minimum role required to view B-side. Engineering managers and above
 * (engineering_manager / leadership / ceo) inherit B-side when the global
 * CEO toggle is on. Plain `manager` (auto-promoted via SSoT direct-reports
 * count) is intentionally NOT included — that tier mixes engineering and
 * non-engineering managers and B-side data is engineering-specific.
 */
export const ENGINEERING_VIEW_B_MIN_ROLE: Role = "engineering_manager";

export interface EngineeringViewResolution {
  /** Which surface the current request should render. */
  surface: EngineeringSurface;
  /** True iff the real Clerk session user is CEO — not derived from preview,
   * impersonation, manager auto-promotion, or role overrides. */
  actualCeo: boolean;
  /**
   * Org-wide B-side enable flag, sourced from the CEO user's
   * publicMetadata.engineeringViewB. The CEO is the only writer; engineering
   * managers and above READ this value to decide whether B-side renders.
   */
  toggleOn: boolean;
  /** Effective display role after role preview/impersonation are applied. */
  effectiveRole: Role;
  /**
   * Email of the impersonated user when the CEO is impersonating; null
   * otherwise. The B-side engineer persona uses this email to look up the
   * impersonated user's composite row instead of the CEO's own row, so
   * "viewing as Arti" actually renders Arti's data on B-side.
   */
  impersonatedEmail: string | null;
  /**
   * Primary email of the actual session user (NOT the impersonated user).
   * Used by the layout to plumb a viewer email into the manager persona's
   * directs-scope, so an engineering manager visiting B-side sees their own
   * direct reports rather than an empty cohort.
   */
  viewerEmail: string | null;
}

const ANON_RESOLUTION: EngineeringViewResolution = {
  surface: "a-side",
  actualCeo: false,
  toggleOn: false,
  effectiveRole: "everyone",
  impersonatedEmail: null,
  viewerEmail: null,
};

function readBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * Resolve the org-wide B-side enable flag by finding the CEO user(s) in
 * Clerk and reading their publicMetadata.engineeringViewB. The CEO is the
 * only writer, so this is the source of truth for non-CEO viewers.
 *
 * Cached per request via React `cache()` so a page rendering several
 * server components only pays one Clerk listing per request.
 *
 * Fails closed: any Clerk error returns `false` (B-side off) rather than
 * surfacing B-side without a confirmed enable signal.
 *
 * Implementation note: Clerk's `getUserList` does not support metadata
 * filtering, so we list a bounded page (200 users) and filter by role in
 * code. For a Cleo-sized org (~150 employees) this is one call returning
 * one page; for orgs that grow past 200 users we'd need pagination.
 */
const getCeoEngineeringViewBFlag = cache(async (): Promise<boolean> => {
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({ limit: 200 });
    for (const user of list.data) {
      const meta = (user.publicMetadata as Record<string, unknown>) ?? {};
      if (
        getUserRole(meta) === "ceo" &&
        readBoolean(meta.engineeringViewB)
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
});

/**
 * Resolve which engineering surface the caller should see.
 *
 * The surface returns "b-side" ONLY when both conditions hold:
 *   1. The org-wide CEO toggle is ON (`publicMetadata.engineeringViewB` on
 *      a user with `publicMetadata.role === "ceo"`). For the CEO viewing
 *      their own session this is read from their own metadata — no extra
 *      Clerk call. For non-CEO viewers the resolver makes a cached Clerk
 *      lookup via `getCeoEngineeringViewBFlag()`.
 *   2. The effective role passes `hasAccess(role, "engineering_manager")`
 *      — i.e. the viewer is an engineering manager, leadership, or CEO.
 *      Plain `manager` (SSoT auto-promotion) is below the gate.
 *
 * Neither role-preview nor impersonation routes the CEO back to A-side.
 * Both adjust `effectiveRole` so the persona resolution downstream can
 * switch between manager and engineer views, and the engineer persona
 * uses `impersonatedEmail` to look up the impersonated user's composite
 * row instead of the CEO's own.
 *
 * Impersonation takes precedence over role-preview, mirroring
 * `getCurrentUserRole`.
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

  const viewerEmail =
    result.user.primaryEmailAddress?.emailAddress ??
    result.user.emailAddresses?.[0]?.emailAddress ??
    null;

  // The CEO is the writer of the org-wide flag, so for the CEO we read
  // their own metadata and never hit the Clerk-list path. For everyone
  // else we resolve the CEO's flag through the cached helper.
  const toggleOn = actualCeo
    ? readBoolean(metadata.engineeringViewB)
    : await getCeoEngineeringViewBFlag();

  let effectiveRole: Role = actualRole;
  let impersonatedEmail: string | null = null;

  if (actualCeo) {
    // Impersonation takes precedence over role preview, mirroring
    // getCurrentUserRole. We resolve the impersonated user's real role and
    // primary email live from Clerk via getImpersonation(), so the cookie
    // payload itself is never trusted.
    const impersonation = await getImpersonation();
    if (impersonation) {
      effectiveRole = impersonation.role;
      impersonatedEmail = impersonation.email;
    } else {
      try {
        const cookieStore = await cookies();
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
  }

  // Surface gate: org toggle on AND viewer's effective role passes the
  // minimum-role check. Plain `manager` and `everyone` cannot reach b-side.
  const roleCanSeeB = hasAccess(effectiveRole, ENGINEERING_VIEW_B_MIN_ROLE);
  const surface: EngineeringSurface =
    toggleOn && roleCanSeeB ? "b-side" : "a-side";

  return {
    surface,
    actualCeo,
    toggleOn,
    effectiveRole,
    impersonatedEmail,
    viewerEmail,
  };
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
 *
 * The CEO's flag is the org-wide on/off switch — engineering managers and
 * above READ it but cannot WRITE it. Only the CEO can flip the kill switch.
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
