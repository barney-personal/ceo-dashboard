"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Eye } from "lucide-react";
import type { Role } from "@/lib/auth/roles";

const ROLES: Role[] = ["everyone", "leadership", "ceo"];

const ROLE_LABELS: Record<Role, string> = {
  everyone: "Employee",
  leadership: "Leadership",
  ceo: "CEO",
};

export function RolePreview({ activeRole }: { activeRole: Role }) {
  const router = useRouter();

  const setPreview = (role: Role) => {
    if (role === "ceo") {
      // Clear the cookie to return to real role
      document.cookie = "role-preview=; path=/; max-age=0";
    } else {
      document.cookie = `role-preview=${role}; path=/; max-age=86400`;
    }
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
    </div>
  );
}
