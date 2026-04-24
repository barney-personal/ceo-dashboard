"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type Role, hasAccess } from "@/lib/auth/roles";
import { type DashboardNavGroup, type NavIconKey } from "@/lib/auth/dashboard-permissions";
import { RolePreview } from "@/components/dashboard/role-preview";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Calculator,
  Calendar,
  ClipboardList,
  Compass,
  Database,
  GitPullRequest,
  Heart,
  HeartPulse,
  LayoutDashboard,
  Menu,
  MessageSquare,
  PoundSterling,
  Settings,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";

export interface ImpersonationInfo {
  name: string;
  role: Role;
}

interface SidebarShellProps {
  role: Role;
  isCeo: boolean;
  navGroups: DashboardNavGroup[];
  impersonation?: ImpersonationInfo | null;
  onNavigate?: () => void;
}

const ICONS: Record<NavIconKey, React.ElementType> = {
  activity: Activity,
  "alert-triangle": AlertTriangle,
  "bar-chart-3": BarChart3,
  calculator: Calculator,
  calendar: Calendar,
  "clipboard-list": ClipboardList,
  compass: Compass,
  database: Database,
  "git-pull-request": GitPullRequest,
  heart: Heart,
  "heart-pulse": HeartPulse,
  "layout-dashboard": LayoutDashboard,
  "message-square": MessageSquare,
  "pound-sterling": PoundSterling,
  settings: Settings,
  shield: Shield,
  sparkles: Sparkles,
  target: Target,
  "trending-up": TrendingUp,
  "user-plus": UserPlus,
  users: Users,
};

function SidebarShell({
  role,
  isCeo,
  navGroups,
  impersonation,
  onNavigate,
}: SidebarShellProps) {
  const pathname = usePathname();

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasAccess(role, item.requiredRole)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
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

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        {visibleGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <span className="mb-0.5 px-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
              {group.label}
            </span>
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const isActive = item.exactMatch
                ? pathname === item.href
                : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-150",
                    isActive
                      ? "bg-primary/8 text-primary shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground/70 group-hover:text-foreground",
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {isCeo && (
        <RolePreview
          activeRole={role}
          impersonation={impersonation ?? undefined}
        />
      )}

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg px-1">
          <div className="h-1.5 w-1.5 rounded-full bg-positive" />
          <span className="text-[11px] text-muted-foreground">
            All systems operational
          </span>
        </div>
      </div>
    </>
  );
}

export function SidebarClient({
  role,
  isCeo = false,
  navGroups,
  impersonation,
}: {
  role: Role;
  isCeo?: boolean;
  navGroups: DashboardNavGroup[];
  impersonation?: ImpersonationInfo | null;
}) {
  return (
    <aside className="hidden w-56 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <SidebarShell
        role={role}
        isCeo={isCeo}
        navGroups={navGroups}
        impersonation={impersonation}
      />
    </aside>
  );
}

export function MobileSidebarClient({
  role,
  isCeo = false,
  navGroups,
  impersonation,
}: {
  role: Role;
  isCeo?: boolean;
  navGroups: DashboardNavGroup[];
  impersonation?: ImpersonationInfo | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing UI to pathname (external system)
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      {open && (
        <div
          id="mobile-nav-drawer"
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 max-w-[80%] flex-col border-r border-sidebar-border bg-sidebar shadow-xl">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarShell
              role={role}
              isCeo={isCeo}
              navGroups={navGroups}
              impersonation={impersonation}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}
