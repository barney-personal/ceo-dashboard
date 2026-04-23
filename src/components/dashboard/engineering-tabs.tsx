"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PeriodPicker } from "./period-picker";

// Inlined to avoid pulling server-only deps (postgres) into the client bundle.
// Keep in sync with PERIOD_OPTIONS in src/lib/data/engineering.ts.
const PERIOD_OPTIONS = [
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "180 days", value: 180 },
  { label: "360 days", value: 360 },
] as const;

const BASE_TABS = [
  { label: "Delivery Health", href: "/dashboard/engineering/delivery-health" },
  { label: "Pillars", href: "/dashboard/engineering/pillars" },
  { label: "Squads", href: "/dashboard/engineering/squads" },
  { label: "Engineers", href: "/dashboard/engineering/engineers" },
] as const;

const IMPACT_TAB = {
  label: "Impact",
  href: "/dashboard/engineering/impact",
} as const;

const MODEL_TAB = {
  label: "Impact model",
  href: "/dashboard/engineering/impact-model",
} as const;

const CODE_REVIEW_TAB = {
  label: "Code review",
  href: "/dashboard/engineering/code-review",
} as const;

const RANKING_TAB = {
  label: "Ranking",
  href: "/dashboard/engineering/ranking",
} as const;

/** Tabs where the period picker has no effect (trend/sparkline-based views). */
const PERIODLESS_TABS = new Set<string>([
  "/dashboard/engineering/delivery-health",
  "/dashboard/engineering/impact",
  "/dashboard/engineering/impact-model",
  "/dashboard/engineering/code-review",
  "/dashboard/engineering/ranking",
]);

export function EngineeringTabs({
  showImpact = false,
  showImpactModel = false,
  showCodeReview = false,
  showRanking = false,
}: {
  showImpact?: boolean;
  /** Separate gate from `showImpact` — the Impact model is open to
   * managers (team-scoped view) even when the Impact analysis page isn't. */
  showImpactModel?: boolean;
  /** CEO-only. The code-review ranking uses LLM judgement of individual
   * engineers' PRs — sensitive, not for broader distribution. */
  showCodeReview?: boolean;
  /** CEO-only. Unified methodology-first engineer ranking. */
  showRanking?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const TABS = [
    ...BASE_TABS,
    ...(showImpact ? [IMPACT_TAB] : []),
    ...(showImpactModel ? [MODEL_TAB] : []),
    ...(showCodeReview ? [CODE_REVIEW_TAB] : []),
    ...(showRanking ? [RANKING_TAB] : []),
  ];
  // Preserve period (and any other query state) when switching tabs so the
  // user doesn't lose their 90-day selection by navigating.
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : "";

  const currentPeriod = Number(searchParams.get("period")) || 30;
  const validPeriod = PERIOD_OPTIONS.find((p) => p.value === currentPeriod)?.value ?? 30;
  const showPicker = !PERIODLESS_TABS.has(pathname);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5 w-fit">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={`${tab.href}${suffix}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {showPicker && (
        <PeriodPicker periods={PERIOD_OPTIONS} current={validPeriod} />
      )}
    </div>
  );
}
