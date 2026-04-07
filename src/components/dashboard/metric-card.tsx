import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";

type Trend = "up" | "down" | "flat";

interface MetricCardProps {
  label: string;
  value: string;
  change?: string;
  trend?: Trend;
  subtitle?: string;
  /** URL to the Mode report this metric comes from */
  modeUrl?: string;
  className?: string;
  delay?: number;
}

export function MetricCard({
  label,
  value,
  change,
  trend,
  subtitle,
  modeUrl,
  className,
  delay = 0,
}: MetricCardProps) {
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  const trendColor =
    trend === "up"
      ? "text-positive"
      : trend === "down"
        ? "text-negative"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card p-5 shadow-warm transition-all duration-300 hover:shadow-warm-lg animate-fade-up",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
          {change && (
            <div className={cn("flex items-center gap-1", trendColor)}>
              <TrendIcon className="h-3 w-3" />
              <span className="text-xs font-medium">{change}</span>
            </div>
          )}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl tracking-tight text-foreground">
            {value}
          </span>
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>

        {modeUrl && (
          <a
            href={modeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-primary"
          >
            View in Mode
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
