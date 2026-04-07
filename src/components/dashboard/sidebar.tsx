"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type Role, hasAccess } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  requiredRole: Role;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/dashboard", requiredRole: "everyone" },
  { label: "Financials", href: "/dashboard/financials", requiredRole: "ceo" },
  { label: "People", href: "/dashboard/people", requiredRole: "leadership" },
  { label: "OKRs", href: "/dashboard/okrs", requiredRole: "everyone" },
];

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter((item) =>
    hasAccess(role, item.requiredRole)
  );

  return (
    <aside className="flex w-56 flex-col border-r bg-muted/40 px-4 py-6">
      <div className="mb-8 px-2">
        <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
      </div>
      <nav className="flex flex-col gap-1">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
