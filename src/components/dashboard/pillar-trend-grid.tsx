import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/charts/sparkline";
import type { PillarTrends } from "@/lib/data/swarmia";

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function PillarTrendGrid({ data }: { data: PillarTrends }) {
  // Sort by current cycle time descending — slowest pillars surface first so
  // eye naturally lands on the problem spots.
  const sorted = [...data.pillars]
    .filter((p) => p.weeks.some((w) => w.cycleTimeHours > 0))
    .sort((a, b) => {
      const aLast = a.weeks[a.weeks.length - 1]?.cycleTimeHours ?? 0;
      const bLast = b.weeks[b.weeks.length - 1]?.cycleTimeHours ?? 0;
      return bLast - aLast;
    });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((p, i) => {
        const series = p.weeks.map((w) => w.cycleTimeHours);
        const last = series[series.length - 1] ?? 0;
        const priorAvg = mean(series.slice(-5, -1));
        const delta = priorAvg > 0 ? ((last - priorAvg) / priorAvg) * 100 : 0;
        const absDelta = Math.abs(delta);
        // Cycle time — lower is better. Up (red) = worsened; down (green) = improved.
        const TrendIcon =
          absDelta < 1 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
        const trendColor =
          absDelta < 1
            ? "text-muted-foreground"
            : delta > 0
              ? "text-negative"
              : "text-positive";

        return (
          <div
            key={p.pillar}
            className="rounded-xl border border-border/60 bg-card p-4 shadow-warm animate-fade-up"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {p.pillar}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl tracking-tight text-foreground">
                  {formatHours(last)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  cycle time
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Sparkline
                  values={series}
                  className="text-foreground/60"
                />
                <div className={cn("flex items-center gap-1", trendColor)}>
                  <TrendIcon className="h-3 w-3" />
                  <span className="text-[11px] font-medium tabular-nums">
                    {absDelta < 1
                      ? "flat"
                      : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
