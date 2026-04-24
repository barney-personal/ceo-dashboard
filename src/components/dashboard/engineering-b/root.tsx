import type { Role } from "@/lib/auth/roles";
import { EngineerView } from "./engineer-view";
import { ManagerView, type ManagerScopeKind } from "./manager-view";

export type EngineeringBPersona = "engineer" | "manager";

export function resolvePersona(effectiveRole: Role): EngineeringBPersona {
  return effectiveRole === "ceo" || effectiveRole === "leadership"
    ? "manager"
    : "engineer";
}

/**
 * For the manager persona, pick the scope kind from the effective role. CEO
 * and leadership see the full org stack rank. Any other effective role falling
 * into the manager persona (not reachable in first pass thanks to M4, but kept
 * consistent in code) would use direct-reports scoping.
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
}

export function EngineeringBRoot({
  effectiveRole,
  managerEmail,
}: EngineeringBRootProps) {
  const persona = resolvePersona(effectiveRole);

  if (persona === "manager") {
    const scope = resolveManagerScope(effectiveRole);
    return (
      <div
        data-testid="engineering-b-root"
        data-persona="manager"
        data-scope={scope}
      >
        <ManagerView scope={scope} managerEmail={managerEmail ?? null} />
      </div>
    );
  }

  return (
    <div data-testid="engineering-b-root" data-persona="engineer">
      <EngineerView />
    </div>
  );
}
