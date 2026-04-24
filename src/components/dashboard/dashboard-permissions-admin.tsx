"use client";

import { useState } from "react";
import { PanelLeft, RotateCcw, Shield, ShieldAlert, Waypoints } from "lucide-react";
import {
  EDITABLE_PERMISSION_ROLES,
  type DashboardPermissionSummary,
} from "@/lib/auth/dashboard-permissions";
import type { Role } from "@/lib/auth/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RowStatus = "idle" | "saving" | "success" | "error";

const ROLE_LABELS: Record<Role, string> = {
  everyone: "Everyone",
  manager: "Managers",
  leadership: "Leadership",
  ceo: "CEO",
};

const ROLE_STYLES: Record<Role, string> = {
  ceo: "border-primary/20 bg-primary/10 text-primary",
  leadership: "border-amber-500/20 bg-amber-500/10 text-amber-700",
  manager: "border-sky-500/20 bg-sky-500/10 text-sky-700",
  everyone: "border-border/60 bg-muted text-muted-foreground",
};

function replacePermission(
  permissions: DashboardPermissionSummary[],
  updated: DashboardPermissionSummary,
): DashboardPermissionSummary[] {
  return permissions.map((permission) =>
    permission.id === updated.id ? updated : permission,
  );
}

export function DashboardPermissionsAdmin({
  initialPermissions,
}: {
  initialPermissions: DashboardPermissionSummary[];
}) {
  const [permissions, setPermissions] =
    useState<DashboardPermissionSummary[]>(initialPermissions);
  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});

  const groups = new Map<string, DashboardPermissionSummary[]>();
  for (const permission of permissions) {
    const current = groups.get(permission.groupLabel) ?? [];
    current.push(permission);
    groups.set(permission.groupLabel, current);
  }

  const overrideCount = permissions.filter((permission) => permission.isOverride).length;
  const navCount = permissions.filter((permission) => permission.isNavItem).length;
  const lockedCount = permissions.filter((permission) => !permission.editable).length;

  async function updatePermission(permissionId: string, requiredRole: Role) {
    const previous = permissions;
    const current = permissions.find((permission) => permission.id === permissionId);
    if (!current) return;

    const optimistic: DashboardPermissionSummary = {
      ...current,
      requiredRole,
      isOverride: requiredRole !== current.defaultRole,
    };

    setPermissions((prev) => replacePermission(prev, optimistic));
    setStatusById((prev) => ({ ...prev, [permissionId]: "saving" }));

    try {
      const response = await fetch("/api/admin/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionId, requiredRole }),
      });

      if (!response.ok) {
        throw new Error("Failed to update permission");
      }

      const updated = (await response.json()) as DashboardPermissionSummary;
      setPermissions((prev) => replacePermission(prev, updated));
      setStatusById((prev) => ({ ...prev, [permissionId]: "success" }));
      window.setTimeout(() => {
        setStatusById((prev) => ({ ...prev, [permissionId]: "idle" }));
      }, 1800);
    } catch {
      setPermissions(previous);
      setStatusById((prev) => ({ ...prev, [permissionId]: "error" }));
      window.setTimeout(() => {
        setStatusById((prev) => ({ ...prev, [permissionId]: "idle" }));
      }, 3000);
    }
  }

  async function resetPermission(permissionId: string) {
    const previous = permissions;
    const current = permissions.find((permission) => permission.id === permissionId);
    if (!current) return;

    const optimistic: DashboardPermissionSummary = {
      ...current,
      requiredRole: current.defaultRole,
      isOverride: false,
    };

    setPermissions((prev) => replacePermission(prev, optimistic));
    setStatusById((prev) => ({ ...prev, [permissionId]: "saving" }));

    try {
      const response = await fetch("/api/admin/permissions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionId }),
      });

      if (!response.ok) {
        throw new Error("Failed to reset permission");
      }

      const updated = (await response.json()) as DashboardPermissionSummary;
      setPermissions((prev) => replacePermission(prev, updated));
      setStatusById((prev) => ({ ...prev, [permissionId]: "success" }));
      window.setTimeout(() => {
        setStatusById((prev) => ({ ...prev, [permissionId]: "idle" }));
      }, 1800);
    } catch {
      setPermissions(previous);
      setStatusById((prev) => ({ ...prev, [permissionId]: "error" }));
      window.setTimeout(() => {
        setStatusById((prev) => ({ ...prev, [permissionId]: "idle" }));
      }, 3000);
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryTile
          icon={Waypoints}
          label="Tracked pages"
          value={permissions.length}
          detail="Dashboard routes using the central permission registry."
        />
        <SummaryTile
          icon={ShieldAlert}
          label="Active overrides"
          value={overrideCount}
          detail="Routes currently using a role different from the code default."
        />
        <SummaryTile
          icon={PanelLeft}
          label="Sidebar items"
          value={navCount}
          detail="Navigation entries that update automatically from this page."
        />
        <SummaryTile
          icon={Shield}
          label="Locked routes"
          value={lockedCount}
          detail="Routes kept fixed to avoid exposing the permission editor itself."
        />
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-warm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
            <Shield className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Minimum role rules
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Each route uses the selected minimum role as its server-side access
              check and sidebar visibility rule. The manager tier is a derived access
              level based on direct reports, even though it is not assigned in
              Clerk.
            </p>
          </div>
        </div>
      </div>

      {Array.from(groups.entries()).map(([groupLabel, items]) => (
        <section
          key={groupLabel}
          className="rounded-2xl border border-border/60 bg-card shadow-warm"
        >
          <div className="border-b border-border/50 px-5 py-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {groupLabel}
            </h3>
          </div>

          <div className="divide-y divide-border/30">
            {items.map((permission) => {
              const status = statusById[permission.id] ?? "idle";
              const isSaving = status === "saving";
              const canReset = permission.editable && permission.isOverride;

              return (
                <div
                  key={permission.id}
                  className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {permission.label}
                      </p>
                      {permission.isNavItem ? (
                        <Badge variant="secondary">Sidebar</Badge>
                      ) : (
                        <Badge variant="outline">Hidden route</Badge>
                      )}
                      {!permission.editable && (
                        <Badge variant="outline">Locked</Badge>
                      )}
                      {permission.isOverride && (
                        <Badge variant="outline">Override</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {permission.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <code className="rounded bg-muted px-2 py-1 font-mono">
                        {permission.href}
                      </code>
                      <span>Default:</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 font-medium",
                          ROLE_STYLES[permission.defaultRole],
                        )}
                      >
                        {ROLE_LABELS[permission.defaultRole]}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={permission.requiredRole}
                      onChange={(event) =>
                        updatePermission(
                          permission.id,
                          event.target.value as Role,
                        )
                      }
                      disabled={isSaving || !permission.editable}
                      className={cn(
                        "min-w-40 rounded-lg border px-3 py-2 text-sm font-medium outline-none transition-colors focus:border-primary/40",
                        ROLE_STYLES[permission.requiredRole],
                        (isSaving || !permission.editable) && "opacity-60",
                      )}
                    >
                      {EDITABLE_PERMISSION_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>

                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canReset || isSaving}
                      onClick={() => resetPermission(permission.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </Button>

                    <span
                      className={cn(
                        "min-w-14 text-xs",
                        status === "success" && "text-positive",
                        status === "error" && "text-destructive",
                        status === "saving" && "text-muted-foreground",
                        status === "idle" && "text-transparent",
                      )}
                    >
                      {status === "saving"
                        ? "Saving..."
                        : status === "success"
                          ? "Saved"
                          : status === "error"
                            ? "Failed"
                            : "Idle"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-warm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-[0.12em]">
          {label}
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}
