"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricInfoTooltipProps {
  /** The metric name — used as the tooltip heading and aria-label. */
  label: string;
  /** Tooltip body — short explanation, optional formula, optional example. */
  children: React.ReactNode;
  /** Where to anchor the tooltip panel relative to the icon. Defaults to "below". */
  align?: "below" | "above" | "right";
  className?: string;
}

/**
 * Info-icon affordance shown next to a column header or metric label. Hover
 * or keyboard focus reveals a tooltip explaining the metric.
 *
 * Keyboard: the <button> is focusable; `group-focus-within` shows the panel.
 * Screen readers: aria-label on the button + role="tooltip" on the panel.
 */
export function MetricInfoTooltip({
  label,
  children,
  align = "below",
  className,
}: MetricInfoTooltipProps) {
  const position =
    align === "above"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : align === "right"
        ? "left-full ml-2 top-1/2 -translate-y-1/2"
        : "top-full mt-2 left-1/2 -translate-x-1/2";

  return (
    <span className={cn("relative inline-flex group", className)}>
      <button
        type="button"
        aria-label={`About ${label}`}
        // `cursor-help` hints at informational rather than actionable.
        // Prevent the parent <th> sort click from firing.
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <Info className="h-3 w-3" />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 w-64 rounded-lg border border-border/60 bg-popover p-3 text-left text-xs text-popover-foreground shadow-lg",
          "opacity-0 transition-opacity duration-150",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          "group-hover:pointer-events-auto group-focus-within:pointer-events-auto",
          position
        )}
      >
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground">
          {label}
        </span>
        <span className="block space-y-2 normal-case tracking-normal text-muted-foreground">
          {children}
        </span>
      </span>
    </span>
  );
}
