import { cn } from "@/lib/utils";

type Status = "on_track" | "at_risk" | "behind" | "completed" | "default";

const STATUS_CONFIG: Record<
  Status,
  { label: string; dotClass: string; bgClass: string }
> = {
  on_track: {
    label: "On Track",
    dotClass: "bg-positive",
    bgClass: "bg-positive/10 text-positive",
  },
  at_risk: {
    label: "At Risk",
    dotClass: "bg-warning",
    bgClass: "bg-warning/10 text-warning",
  },
  behind: {
    label: "Behind",
    dotClass: "bg-negative",
    bgClass: "bg-negative/10 text-negative",
  },
  completed: {
    label: "Completed",
    dotClass: "bg-primary",
    bgClass: "bg-primary/10 text-primary",
  },
  default: {
    label: "Pending",
    dotClass: "bg-muted-foreground",
    bgClass: "bg-muted text-muted-foreground",
  },
};

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  // Status strings can arrive from LLM-parsed Slack updates and may not
  // match a known key. Fall back to `default` rather than crashing.
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.default;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        config.bgClass,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dotClass)} />
      {config.label}
    </span>
  );
}
