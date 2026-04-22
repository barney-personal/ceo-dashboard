import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/charts/sparkline";
import {
  formatKrValue,
  krTrend,
  progressTowardTarget,
  type ModeKr,
} from "@/lib/data/okr-mode";

interface OkrCompanyKrCardProps {
  kr: ModeKr;
  delay?: number;
}

export function OkrCompanyKrCard({ kr, delay = 0 }: OkrCompanyKrCardProps) {
  const progress = progressTowardTarget(kr);
  const trend = krTrend(kr);
  const higherIsBetter =
    kr.baseline != null && kr.target != null ? kr.target >= kr.baseline : true;

  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up"
      ? "text-positive"
      : trend === "down"
        ? "text-negative"
        : "text-muted-foreground";

  const barColor =
    progress == null
      ? "bg-muted-foreground/30"
      : progress >= 0.95
        ? "bg-positive"
        : progress >= 0.6
          ? "bg-primary"
          : progress >= 0.25
            ? "bg-warning"
            : "bg-negative";

  const delta =
    kr.current != null && kr.previous != null ? kr.current - kr.previous : null;
  const deltaLabel =
    delta != null
      ? `${delta > 0 ? "+" : ""}${formatKrValue(delta, kr.format)}`
      : null;

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5 shadow-warm transition-all duration-300 hover:shadow-warm-lg animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold leading-snug text-foreground">
          {kr.description}
        </h4>
        {deltaLabel && (
          <div className={cn("flex shrink-0 items-center gap-1", trendColor)}>
            <TrendIcon className="h-3 w-3" />
            <span className="font-mono text-[11px] font-medium tabular-nums">
              {deltaLabel}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl tracking-tight text-foreground">
          {formatKrValue(kr.current, kr.format)}
        </span>
        {kr.target != null && (
          <span className="text-xs text-muted-foreground">
            of {formatKrValue(kr.target, kr.format)} target
          </span>
        )}
      </div>

      {progress != null && (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
            <div
              className={cn("h-full rounded-full transition-all", barColor)}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground/70">
            <span>Baseline {formatKrValue(kr.baseline, kr.format)}</span>
            <span>{Math.round(progress * 100)}% to goal</span>
          </div>
        </div>
      )}

      {kr.snapshots.length >= 2 && (
        <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60">
            {kr.snapshots.length}-month trend
          </span>
          <Sparkline
            values={kr.snapshots.map((s) => s.value)}
            invert={!higherIsBetter}
            color={trend === "down" ? "var(--color-negative)" : undefined}
            className={trend !== "down" ? "text-positive/70" : undefined}
          />
        </div>
      )}
    </div>
  );
}
