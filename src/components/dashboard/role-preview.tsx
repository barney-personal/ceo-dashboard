"use client";
"use no memo";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Eye, X } from "lucide-react";
import type { Role } from "@/lib/auth/roles";

const ROLES: Role[] = ["everyone", "leadership", "ceo"];

const ROLE_LABELS: Record<Role, string> = {
  everyone: "Employee",
  leadership: "Leadership",
  ceo: "CEO",
};

function setRolePreviewCookie(role: Role) {
  if (role === "ceo") {
    document.cookie = "role-preview=; path=/; max-age=0";
  } else {
    document.cookie = `role-preview=${role}; path=/; max-age=86400`;
  }
}

function clearImpersonation() {
  document.cookie = "impersonate=; path=/; max-age=0";
}

interface ImpersonationInfo {
  name: string;
  role: Role;
}

export function RolePreview({
  activeRole,
  impersonation,
}: {
  activeRole: Role;
  impersonation?: ImpersonationInfo;
}) {
  const router = useRouter();

  const setPreview = (role: Role) => {
    setRolePreviewCookie(role);
    router.refresh();
  };

  const stopImpersonating = () => {
    clearImpersonation();
    router.refresh();
  };

  return (
    <div className="border-t border-sidebar-border px-3 py-2">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <Eye className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
          View as
        </span>
      </div>

      {impersonation ? (
        <div className="rounded-lg bg-amber-500/10 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-amber-700">
                {impersonation.name}
              </p>
              <p className="text-[10px] text-amber-600">
                {ROLE_LABELS[impersonation.role]}
              </p>
            </div>
            <button
              onClick={stopImpersonating}
              title="Stop viewing as this user"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-500/20 hover:text-amber-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-0.5 rounded-lg bg-sidebar-accent/50 p-0.5">
          {ROLES.map((role) => (
            <button
              key={role}
              onClick={() => setPreview(role)}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                activeRole === role
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
