"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type Role, hasAccess } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Calculator,
  PoundSterling,
  BarChart3,
  Target,
  Users,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  requiredRole: Role;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    requiredRole: "everyone",
    icon: LayoutDashboard,
  },
  {
    label: "Unit Economics",
    href: "/dashboard/unit-economics",
    requiredRole: "ceo",
    icon: Calculator,
  },
  {
    label: "Financial",
    href: "/dashboard/financial",
    requiredRole: "ceo",
    icon: PoundSterling,
  },
  {
    label: "Product",
    href: "/dashboard/product",
    requiredRole: "leadership",
    icon: BarChart3,
  },
  {
    label: "OKRs",
    href: "/dashboard/okrs",
    requiredRole: "everyone",
    icon: Target,
  },
  {
    label: "People",
    href: "/dashboard/people",
    requiredRole: "leadership",
    icon: Users,
  },
];

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter((item) =>
    hasAccess(role, item.requiredRole)
  );

  return (
    <aside className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo area */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
            <div className="h-2 w-2 rounded-full bg-primary" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Command
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
        <span className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
          Navigation
        </span>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/8 text-primary shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground/70 group-hover:text-foreground"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg px-1">
          <div className="h-1.5 w-1.5 rounded-full bg-positive" />
          <span className="text-[11px] text-muted-foreground">
            All systems operational
          </span>
        </div>
      </div>
    </aside>
  );
}
