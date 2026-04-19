"use client";

import { useRouter } from "next/navigation";
import { X, Eye } from "lucide-react";
import type { Role } from "@/lib/auth/roles";

const ROLE_LABELS: Record<Role, string> = {
  everyone: "Employee",
  manager: "Manager",
  leadership: "Leadership",
  ceo: "CEO",
};

function stopImpersonation() {
  document.cookie = "impersonate=; path=/; max-age=0";
}

export function ImpersonationBanner({
  name,
  role,
}: {
  name: string;
  role: Role;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between bg-amber-500/10 border-b border-amber-500/20 px-4 py-2">
      <div className="flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-amber-700" />
        <span className="text-xs font-medium text-amber-700">
          Viewing as{" "}
          <span className="font-semibold">{name}</span>
          <span className="ml-1 text-amber-600">({ROLE_LABELS[role]})</span>
        </span>
      </div>
      <button
        onClick={() => {
          stopImpersonation();
          router.refresh();
        }}
        className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-white/60 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-white hover:text-amber-900"
      >
        <X className="h-3 w-3" />
        Stop viewing
      </button>
    </div>
  );
}
