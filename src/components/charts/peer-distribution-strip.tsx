"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface PeerDistributionStripProps {
  /** All peer values (cost in USD). */
  peers: number[];
  /** Value for the currently-viewed user. */
  userValue: number;
  /** Accessible label, e.g. "April 2026 AI spend, all peers". */
  label?: string;
  /** Tick label formatter. */
  format?: (v: number) => string;
  className?: string;
  /** Color for the highlighted dot. */
  highlightColor?: string;
}

function defaultFormat(v: number): string {
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v)}`;
}

/**
 * 1-D dot plot / strip plot of peer distribution with the current user
 * highlighted.
 *
 * Cleveland ("Visualizing Data", ch. 5): dot plots are the preferred
 * encoding for "position along a common scale" — the highest-accuracy
 * perceptual task. For a distribution with a subject of interest, a
 * strip plot with a single highlighted point answers "where does this
 * person sit among peers?" at a glance — far better than a peer median
 * number alone.
 *
 * Uses log-scale by default because AI spend is heavily right-skewed
 * (many users at $0-$10, a long tail up to >$1k). Linear would squash
 * 90% of the dots into the left 10% of the strip.
 */
export function PeerDistributionStrip({
  peers,
  userValue,
  label,
  format = defaultFormat,
  className,
  highlightColor = "#4f46e5",
}: PeerDistributionStripProps) {
  const { min, max, positions, userPosition, percentile } = useMemo(() => {
    const positive = peers.filter((p) => p > 0);
    if (positive.length === 0) {
      return {
        min: 0,
        max: 0,
        positions: [] as number[],
        userPosition: null as number | null,
        percentile: null as number | null,
      };
    }
    const minVal = Math.max(Math.min(...positive), 0.01);
    const maxVal = Math.max(...positive, userValue);
    const logMin = Math.log10(minVal);
    const logMax = Math.log10(maxVal);
    const range = Math.max(logMax - logMin, 0.0001);

    const scale = (v: number) => {
      const clamped = Math.max(v, minVal);
      return ((Math.log10(clamped) - logMin) / range) * 100;
    };

    const sortedPositive = [...positive].sort((a, b) => a - b);
    const userRank = sortedPositive.filter((v) => v <= userValue).length;
    const pct = Math.round((userRank / sortedPositive.length) * 100);

    return {
      min: minVal,
      max: maxVal,
      positions: peers.map(scale),
      userPosition: userValue > 0 ? scale(userValue) : null,
      percentile: pct,
    };
  }, [peers, userValue]);

  if (positions.length === 0) return null;

  const ticks = niceLogTicks(min, max);

  return (
    <div className={cn("w-full", className)} aria-label={label}>
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        <span>Peer distribution</span>
        {percentile != null && (
          <span className="tabular-nums text-foreground/80">
            {percentile >= 50
              ? `top ${100 - percentile}%`
              : `bottom ${percentile}%`}
          </span>
        )}
      </div>
      <div className="relative mt-2 h-9">
        {/* Track */}
        <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-muted/40" />

        {/* Peer dots */}
        {positions.map((pos, i) => (
          <div
            key={i}
            className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40"
            style={{ left: `${pos}%` }}
          />
        ))}

        {/* User highlight */}
        {userPosition != null && (
          <>
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
              style={{ left: `${userPosition}%`, backgroundColor: highlightColor }}
            />
            <div
              className="absolute -top-1 h-11 w-px"
              style={{
                left: `${userPosition}%`,
                backgroundColor: highlightColor,
                opacity: 0.25,
              }}
            />
          </>
        )}
      </div>

      {/* Log-scale tick labels */}
      <div className="relative mt-1 h-3 text-[9px] tabular-nums text-muted-foreground/60">
        {ticks.map((t) => {
          const pos = scaleLog(t, min, max);
          if (pos < 0 || pos > 100) return null;
          return (
            <span
              key={t}
              className="absolute -translate-x-1/2"
              style={{ left: `${pos}%` }}
            >
              {format(t)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function scaleLog(v: number, min: number, max: number): number {
  if (max <= min) return 0;
  const logMin = Math.log10(Math.max(min, 0.01));
  const logMax = Math.log10(max);
  const range = Math.max(logMax - logMin, 0.0001);
  return ((Math.log10(Math.max(v, min)) - logMin) / range) * 100;
}

function niceLogTicks(min: number, max: number): number[] {
  if (max <= min) return [min];
  const logMin = Math.floor(Math.log10(Math.max(min, 0.01)));
  const logMax = Math.ceil(Math.log10(max));
  const ticks: number[] = [];
  for (let i = logMin; i <= logMax; i++) {
    ticks.push(10 ** i);
  }
  return ticks.filter((t) => t >= min && t <= max);
}
