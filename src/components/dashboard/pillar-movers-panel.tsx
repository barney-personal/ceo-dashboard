import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PillarMover, PillarMovers } from "@/lib/data/swarmia";

function formatValue(metric: PillarMover["metric"], v: number): string {
  if (metric === "Cycle time") {
    if (v < 1) return `${Math.round(v * 60)}m`;
    if (v < 24) return `${v.toFixed(1)}h`;
    return `${(v / 24).toFixed(1)}d`;
  }
  if (metric === "Review rate") return `${v.toFixed(0)}%`;
  return v.toFixed(1);
}

/**
 * Plain-English list of the biggest pillar-level metric changes this week.
 * Each row: pillar + metric, old → new values, % delta with up/down tint.
 */
export function PillarMoversPanel({ data }: { data: PillarMovers }) {
  if (data.movers.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-8 text-center shadow-warm">
        <p className="text-sm text-muted-foreground">
          No material changes this week.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">What moved</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.windowLabel}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border/40">
        {data.movers.map((m) => {
          const improved = m.direction === "improved";
          const ArrowIcon = improved ? ArrowDown : ArrowUp;
          const accent = improved ? "text-positive" : "text-negative";
          const signedPct =
            (m.deltaPercent > 0 ? "+" : "") + m.deltaPercent.toFixed(0) + "%";

          return (
            <li
              key={`${m.pillar}-${m.metric}`}
              className="flex items-center gap-4 px-5 py-3.5"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  improved ? "bg-positive/10" : "bg-negative/10",
                  accent
                )}
                aria-hidden="true"
              >
                <ArrowIcon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{m.pillar}</span>
                  <span className="text-muted-foreground"> — {m.metric} </span>
                  <span className={cn("font-medium", accent)}>
                    {improved ? "improved" : "worsened"}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {formatValue(m.metric, m.valuePrev)} →{" "}
                  {formatValue(m.metric, m.valueNow)}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-sm font-semibold tabular-nums",
                  accent
                )}
              >
                {signedPct}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
