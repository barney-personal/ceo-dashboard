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
  Settings,
  Activity,
  TrendingUp,
  Heart,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  requiredRole: Role;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        requiredRole: "everyone",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Performance",
    items: [
      {
        label: "Unit Economics",
        href: "/dashboard/unit-economics",
        requiredRole: "leadership",
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
    ],
  },
  {
    label: "Goals",
    items: [
      {
        label: "OKRs",
        href: "/dashboard/okrs",
        requiredRole: "everyone",
        icon: Target,
      },
    ],
  },
  {
    label: "Team",
    items: [
      {
        label: "Org",
        href: "/dashboard/people",
        requiredRole: "leadership",
        icon: Users,
      },
      {
        label: "Performance",
        href: "/dashboard/people/performance",
        requiredRole: "leadership",
        icon: TrendingUp,
      },
      {
        label: "Engagement",
        href: "/dashboard/people/engagement",
        requiredRole: "leadership",
        icon: Heart,
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        label: "Users",
        href: "/dashboard/admin/users",
        requiredRole: "ceo",
        icon: Users,
      },
      {
        label: "Squads",
        href: "/dashboard/admin/squads",
        requiredRole: "ceo",
        icon: Settings,
      },
      {
        label: "Data Status",
        href: "/dashboard/admin/status",
        requiredRole: "ceo",
        icon: Activity,
      },
    ],
  },
];

// Paths that have sibling child routes need exact matching to avoid
// multiple items highlighting at once (e.g. /dashboard/people vs /dashboard/people/performance).
const exactMatchPaths = new Set<string>(["/dashboard"]);
for (const group of NAV_GROUPS) {
  for (const item of group.items) {
    for (const sibling of group.items) {
      if (sibling.href !== item.href && sibling.href.startsWith(item.href + "/")) {
        exactMatchPaths.add(item.href);
      }
    }
  }
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasAccess(role, item.requiredRole)),
  })).filter((group) => group.items.length > 0);

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
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        {visibleGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <span className="mb-0.5 px-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
              {group.label}
            </span>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = exactMatchPaths.has(item.href)
                ? pathname === item.href
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
          </div>
        ))}
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
