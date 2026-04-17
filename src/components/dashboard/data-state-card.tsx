import { AlertTriangle, Clock, Database } from "lucide-react";
import { LastSyncedAt } from "./last-synced-at";
import { cn } from "@/lib/utils";

export type DataStateVariant = "empty" | "stale" | "unavailable";

const VARIANT_STYLES: Record<
  DataStateVariant,
  {
    label: string;
    icon: typeof AlertTriangle;
    iconClass: string;
    borderClass: string;
    defaultDescription: string;
  }
> = {
  empty: {
    label: "No data yet",
    icon: Database,
    iconClass: "text-muted-foreground",
    borderClass: "border-border/50",
    defaultDescription:
      "No records have been synced yet. Trigger a sync or wait for the next scheduled run.",
  },
  stale: {
    label: "Data may be stale",
    icon: Clock,
    iconClass: "text-warning",
    borderClass: "border-warning/30",
    defaultDescription:
      "The last successful sync is older than twice the normal interval. Figures shown may not reflect the latest source data.",
  },
  unavailable: {
    label: "Data temporarily unavailable",
    icon: AlertTriangle,
    iconClass: "text-destructive",
    borderClass: "border-destructive/30",
    defaultDescription:
      "We could not reach the database for this section. Retry in a moment — queued background sync attempts will resume once the database is reachable.",
  },
};

export interface DataStateCardProps {
  variant: DataStateVariant;
  title: string;
  description?: string;
  lastSyncedAt?: Date | string | null;
  action?: React.ReactNode;
  className?: string;
  now?: Date;
}

/**
 * Explicit UI state for a dashboard section. Three variants:
 *
 *  - `empty`: no data has been synced yet (onboarding copy)
 *  - `stale`: data exists but the last sync is older than 2× the source interval
 *  - `unavailable`: the loader threw a typed DatabaseUnavailableError
 *
 * Pair with `resolveDataState` from `@/lib/data/data-state` to decide the
 * variant server-side.
 */
export function DataStateCard({
  variant,
  title,
  description,
  lastSyncedAt,
  action,
  className,
  now,
}: DataStateCardProps) {
  const preset = VARIANT_STYLES[variant];
  const Icon = preset.icon;
  const copy = description ?? preset.defaultDescription;
  const showLastSynced = variant !== "empty" && lastSyncedAt != null;

  return (
    <div
      data-testid="data-state-card"
      data-variant={variant}
      className={cn(
        "rounded-xl border bg-card shadow-warm",
        preset.borderClass,
        className
      )}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/60",
            preset.iconClass
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            {preset.label}
          </p>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{copy}</p>
          {showLastSynced ? (
            <LastSyncedAt
              at={lastSyncedAt}
              now={now}
              className="text-xs text-muted-foreground/80"
            />
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
