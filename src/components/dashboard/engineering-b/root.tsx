import type { Role } from "@/lib/auth/roles";
import { EngineerView } from "./engineer-view";
import { ManagerView, type ManagerScopeKind } from "./manager-view";

export type EngineeringBPersona = "engineer" | "manager";

/**
 * Pick the persona for a given effective role. The role gate
 * (`ENGINEERING_VIEW_B_MIN_ROLE` in engineering-view.server) keeps plain
 * `manager` and `everyone` off B-side entirely — those values only reach
 * resolvePersona via CEO role-preview (which deliberately routes them
 * through the engineer persona for layout testing).
 *
 *   ceo, leadership          → manager persona, org-scope (see resolveManagerScope)
 *   engineering_manager      → manager persona, directs-scope
 *   manager, everyone        → engineer persona (only reachable via CEO preview)
 */
export function resolvePersona(effectiveRole: Role): EngineeringBPersona {
  return effectiveRole === "ceo" ||
    effectiveRole === "leadership" ||
    effectiveRole === "engineering_manager"
    ? "manager"
    : "engineer";
}

/**
 * For the manager persona, pick the scope kind from the effective role. CEO
 * and leadership see the full org stack rank. Engineering managers see only
 * their direct reports (directs-scope). Any other effective role falling
 * into the manager persona (only reachable via CEO role-preview) defaults to
 * directs-scope as a safe lower-leakage default.
 */
export function resolveManagerScope(effectiveRole: Role): ManagerScopeKind {
  return effectiveRole === "ceo" || effectiveRole === "leadership"
    ? "org"
    : "directs";
}

interface EngineeringBRootProps {
  effectiveRole: Role;
  /**
   * Manager email to scope to when the view runs in "directs" scope. Not
   * reachable in the first-pass B-side (M4 gate), so callers don't supply it
   * outside tests / controlled previews.
   */
  managerEmail?: string | null;
  /**
   * True when the actual Clerk session role is CEO — used by the engineer
   * persona to render a layout preview (with a banner) instead of an empty
   * MissingIdentityState when the CEO previews and their own email isn't in
   * the GitHub mapping. Real non-CEO users never reach B-side, so this flag
   * is always true in production.
   */
  isCeoPreview?: boolean;
  /**
   * Email of the user the CEO is currently impersonating, if any. When set:
   *   - The engineer persona looks up THIS email's composite row instead of
   *     the CEO's own, and skips the CEO-preview layout fallback so the
   *     rendering is the truthful engineer view for the impersonated user.
   *   - The manager persona's directs-scope falls back to this email when no
   *     explicit `managerEmail` was supplied.
   */
  impersonatedEmail?: string | null;
}

export function EngineeringBRoot({
  effectiveRole,
  managerEmail,
  isCeoPreview = false,
  impersonatedEmail = null,
}: EngineeringBRootProps) {
  const persona = resolvePersona(effectiveRole);

  if (persona === "manager") {
    const scope = resolveManagerScope(effectiveRole);
    // Impersonation overrides the explicit managerEmail so the CEO impersonating
    // an eng manager sees that manager's directs cohort, not the CEO's. For
    // org-scope ManagerView ignores the email anyway, so this is harmless in
    // the CEO-impersonating-leadership case.
    const resolvedManagerEmail =
      impersonatedEmail ?? managerEmail ?? null;
    return (
      <div
        data-testid="engineering-b-root"
        data-persona="manager"
        data-scope={scope}
        data-impersonated={impersonatedEmail ? "true" : undefined}
      >
        <ManagerView scope={scope} managerEmail={resolvedManagerEmail} />
      </div>
    );
  }

  // CEO preview banner only when the CEO is viewing their OWN identity. Under
  // impersonation we want the truthful engineer view for the impersonated
  // user — the orange "Viewing as X" banner already surfaces the context.
  const showCeoPreview = isCeoPreview && !impersonatedEmail;

  return (
    <div
      data-testid="engineering-b-root"
      data-persona="engineer"
      data-ceo-preview={showCeoPreview ? "true" : undefined}
      data-impersonated={impersonatedEmail ? "true" : undefined}
    >
      <EngineerView
        viewerEmail={impersonatedEmail ?? undefined}
        isCeoPreview={showCeoPreview}
      />
    </div>
  );
}
