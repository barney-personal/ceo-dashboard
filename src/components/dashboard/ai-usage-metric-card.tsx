import { cn } from "@/lib/utils";
import { ExternalLink, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";

interface AiUsageMetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  /** Percentage change vs prior window. Null hides the badge. */
  deltaPct: number | null;
  /**
   * When true, an increase is rendered as good (green) and a decrease as bad
   * (amber). Defaults to false because most cards on this page show cost,
   * where going up is bad.
   */
  higherIsBetter?: boolean;
  /**
   * When true, both directions render in muted foreground. Use for metrics
   * where direction is not inherently good or bad (e.g. AI spend under an
   * adoption mandate — up means more engineers on Claude, which is the
   * business goal; down could mean either savings or disengagement). The
   * arrow still flips so direction is visible without encoding a judgment.
   */
  neutralDelta?: boolean;
  modeUrl?: string;
  /** Recent window sparkline. Skipped if < 2 points. */
  sparkline?: number[];
  sparklineColor?: string;
  className?: string;
}

/**
 * Metric card with inline sparkline + MoM/prior-window delta.
 *
 * Tufte (Beautiful Evidence): "Sparklines can be tucked into the middle of
 * paragraphs, tables, maps... they are data words." Placing a trajectory
 * next to the number turns a snapshot into a story — you can see direction
 * without an extra chart.
 */
export function AiUsageMetricCard({
  label,
  value,
  subtitle,
  deltaPct,
  higherIsBetter = false,
  neutralDelta = false,
  modeUrl,
  sparkline,
  sparklineColor = "#4f46e5",
  className,
}: AiUsageMetricCardProps) {
  const deltaTone =
    deltaPct == null
      ? "flat"
      : Math.abs(deltaPct) < 3
        ? "flat"
        : deltaPct > 0
          ? "up"
          : "down";
  const DeltaIcon =
    deltaTone === "up" ? TrendingUp : deltaTone === "down" ? TrendingDown : Minus;
  const goodColor = "text-positive";
  const badColor = "text-amber-700";
  const deltaColor = neutralDelta
    ? "text-muted-foreground"
    : deltaTone === "flat"
      ? "text-muted-foreground/70"
      : deltaTone === "up"
        ? higherIsBetter
          ? goodColor
          : badColor
        : higherIsBetter
          ? badColor
          : goodColor;

  const showSpark =
    Array.isArray(sparkline) &&
    sparkline.length >= 2 &&
    sparkline.some((v) => v > 0);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card p-5 shadow-warm transition-all duration-300 hover:shadow-warm-lg",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        {deltaPct != null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              deltaColor,
            )}
          >
            <DeltaIcon className="h-2.5 w-2.5" />
            {deltaPct > 0 ? "+" : ""}
            {deltaPct.toFixed(0)}%
          </span>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl tracking-tight text-foreground">
            {value}
          </span>
        </div>
        {showSpark && (
          <div className="shrink-0 pb-1" style={{ color: sparklineColor }}>
            <Sparkline
              values={sparkline!}
              width={80}
              height={28}
              showLatest={true}
            />
          </div>
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
      )}

      {modeUrl && (
        <a
          href={modeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-primary"
        >
          View in Mode
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  );
}
