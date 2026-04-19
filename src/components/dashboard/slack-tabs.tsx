"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Pillars", href: "/dashboard/slack/pillars" },
  { label: "Squads", href: "/dashboard/slack/squads" },
  { label: "Members", href: "/dashboard/slack/members" },
] as const;

export function SlackTabs() {
  const pathname = usePathname();
  return (
    <div className="flex w-fit items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
