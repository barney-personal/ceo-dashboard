"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Users, TrendingUp, Heart } from "lucide-react";

const TABS = [
  { label: "Org", href: "/dashboard/people", icon: Users },
  { label: "Performance", href: "/dashboard/people/performance", icon: TrendingUp },
  { label: "Engagement", href: "/dashboard/people/engagement", icon: Heart },
] as const;

export function PeopleTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          tab.href === "/dashboard/people"
            ? pathname === "/dashboard/people"
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150",
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
