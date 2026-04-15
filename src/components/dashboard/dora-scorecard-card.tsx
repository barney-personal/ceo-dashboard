import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/charts/sparkline";
import type { DoraBand, DoraBandInfo } from "@/lib/data/swarmia";

type Trend = "up" | "down" | "flat";

interface DoraScorecardCardProps {
  label: string;
  value: string;
  subtitle?: string;
  /** Delta text, e.g. "+20% vs 90d". Omit to hide the chip. */
  change?: string;
  /** Trend arrow direction. Pre-inverted by caller for "lower is better" metrics. */
  trend?: Trend;
  band: DoraBandInfo;
  /** 12 weekly values, oldest first. */
  trendValues: number[];
  /** true → higher values render lower in the sparkline (matches "lower is better"). */
  invertSparkline?: boolean;
  delay?: number;
}

/** Tailwind classes per DORA band for the badge + subtle card tint. */
const BAND_STYLES: Record<
  DoraBand,
  { chip: string; dot: string; tint: string }
> = {
  elite: {
    chip: "bg-positive/10 text-positive",
    dot: "bg-positive",
    tint: "",
  },
  high: {
    chip: "bg-primary/10 text-primary",
    dot: "bg-primary",
    tint: "",
  },
  medium: {
    chip: "bg-warning/15 text-warning",
    dot: "bg-warning",
    tint: "",
  },
  low: {
    chip: "bg-negative/10 text-negative",
    dot: "bg-negative",
    tint: "border-negative/30",
  },
};

export function DoraScorecardCard({
  label,
  value,
  subtitle,
  change,
  trend,
  band,
  trendValues,
  invertSparkline = false,
  delay = 0,
}: DoraScorecardCardProps) {
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up"
      ? "text-positive"
      : trend === "down"
        ? "text-negative"
        : "text-muted-foreground";
  const style = BAND_STYLES[band.band];

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card p-5 shadow-warm transition-all duration-300 hover:shadow-warm-lg animate-fade-up",
        style.tint
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-col gap-3">
        {/* Top row: label + band badge */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
              style.chip
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            {band.label}
          </span>
        </div>

        {/* Value + subtitle */}
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl tracking-tight text-foreground">
            {value}
          </span>
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>

        {/* Bottom row: sparkline on the left, delta on the right */}
        <div className="flex items-center justify-between gap-2">
          <Sparkline
            values={trendValues}
            invert={invertSparkline}
            className="text-foreground/60"
          />
          {change && (
            <div className={cn("flex items-center gap-1", trendColor)}>
              <TrendIcon className="h-3 w-3" />
              <span className="text-[11px] font-medium">{change}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
