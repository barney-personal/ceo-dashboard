"use client";

import { useState, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainColor, domainTextColor } from "./chart-utils";

// ─── Types ───────────────────────────────────────────────

export interface RetentionCohort {
  cohort: string; // "2025-01" (monthly) or "2025-01-15" (weekly)
  periods: (number | null)[]; // retention rates 0–1 per relative period
  cohortSize?: number; // absolute count at period 0
}

export interface RetentionTier {
  key: string;
  label: string;
  data: RetentionCohort[];
}

interface RetentionTriangleProps {
  tiers: RetentionTier[];
  periodLabel?: string; // "Month" → "M0", "M1", …
  skipM0?: boolean; // Skip the M0 column (always ~100% for subscription retention)
  title: string;
  subtitle?: string;
  modeUrl?: string;
  className?: string;
}

// ─── Color Scale ─────────────────────────────────────────
//
// Domain-stretched red → yellow → green, shared with the
// conversion heatmap. The scale is normalised to each tier's
// actual min/max so even small differences are clearly visible.

// ─── Format helpers ──────────────────────────────────────

function formatCohortLabel(cohort: string): string {
  const d =
    cohort.length <= 7
      ? new Date(cohort + "-01")
      : new Date(cohort + "T00:00");
  if (isNaN(d.getTime())) return cohort;
  // Force UTC so date-only strings aren't shifted to the prior month in US timezones
  return cohort.length > 7
    ? d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function formatCohortSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ─── Triangle Table ──────────────────────────────────────
//
// Tufte's "small multiples" principle: every triangle uses the
// same scale so tiers can be compared at a glance.
//
// The diagonal edge (the triangle) emerges naturally because
// newer cohorts have fewer periods — empty cells are left blank,
// producing the signature shape without any decorative elements.

function TriangleTable({
  data,
  periodLabel,
  hoveredCell,
  onHover,
  skipM0,
  colorRange,
}: {
  data: RetentionCohort[];
  periodLabel: string;
  hoveredCell: [number, number] | null;
  onHover: (cell: [number, number] | null) => void;
  skipM0?: boolean;
  colorRange: [number, number];
}) {
  const rawMaxPeriods = Math.max(0, ...data.map((r) => r.periods.length));
  const startPeriod = skipM0 ? 1 : 0;
  const maxPeriods = rawMaxPeriods;
  const prefix = periodLabel.charAt(0);
  const hasCohortSizes = data.some((r) => r.cohortSize != null);

  const averages = useMemo(() => {
    const avgs: (number | null)[] = [];
    for (let p = 0; p < maxPeriods; p++) {
      const vals = data
        .map((r) => r.periods[p])
        .filter((v): v is number => v != null);
      avgs.push(
        vals.length > 0
          ? vals.reduce((a, b) => a + b, 0) / vals.length
          : null,
      );
    }
    return avgs;
  }, [data, maxPeriods]);

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Cohort
            </th>
            {hasCohortSizes && (
              <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                n
              </th>
            )}
            {Array.from(
              { length: maxPeriods - startPeriod },
              (_, i) => i + startPeriod,
            ).map((p) => (
              <th
                key={p}
                className={cn(
                  "px-0.5 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors",
                  hoveredCell?.[1] === p && "text-foreground",
                )}
              >
                {prefix}
                {p}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {data.map((row, rowIdx) => (
            <tr
              key={row.cohort}
              className={cn(
                "transition-colors duration-75",
                hoveredCell?.[0] === rowIdx && "bg-muted/25",
              )}
            >
              <td
                className={cn(
                  "sticky left-0 z-10 whitespace-nowrap px-3 py-[3px] font-mono text-[11px] transition-colors duration-75",
                  hoveredCell?.[0] === rowIdx
                    ? "bg-muted/25 text-foreground"
                    : "bg-card text-muted-foreground",
                )}
              >
                {formatCohortLabel(row.cohort)}
              </td>

              {hasCohortSizes && (
                <td className="whitespace-nowrap px-2 py-[3px] text-right font-mono text-[10px] text-muted-foreground/50">
                  {row.cohortSize != null
                    ? formatCohortSize(row.cohortSize)
                    : ""}
                </td>
              )}

              {Array.from(
                { length: maxPeriods - startPeriod },
                (_, i) => i + startPeriod,
              ).map((colIdx) => {
                const val = row.periods[colIdx];
                if (val == null) {
                  return <td key={colIdx} className="px-[2px] py-[3px]" />;
                }

                const isHovered =
                  hoveredCell?.[0] === rowIdx && hoveredCell?.[1] === colIdx;

                const tooltipParts = [
                  `${formatCohortLabel(row.cohort)}, ${periodLabel} ${colIdx}: ${(val * 100).toFixed(1)}%`,
                ];
                if (row.cohortSize != null) {
                  tooltipParts.push(
                    `${Math.round(val * row.cohortSize).toLocaleString()} of ${row.cohortSize.toLocaleString()}`,
                  );
                }

                return (
                  <td
                    key={colIdx}
                    className="px-[2px] py-[3px]"
                    onMouseEnter={() => onHover([rowIdx, colIdx])}
                    onMouseLeave={() => onHover(null)}
                  >
                    <div
                      className={cn(
                        "mx-auto flex items-center justify-center rounded-[3px] font-mono text-[11px] tabular-nums transition-shadow duration-75",
                        isHovered && "ring-2 ring-foreground/25",
                      )}
                      style={{
                        backgroundColor: domainColor(val, colorRange[0], colorRange[1]),
                        color: domainTextColor(val, colorRange[0], colorRange[1]),
                        minWidth: "42px",
                        height: "26px",
                      }}
                      title={tooltipParts.join("\n")}
                    >
                      {(val * 100).toFixed(0)}%
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}

          {/* ── Average summary row ────────────────────────
              Tufte: "Micro/macro readings" — the averages give
              a macro view while individual cells are the micro. */}
          {data.length > 1 && (
            <tr className="border-t border-border/40">
              <td className="sticky left-0 z-10 bg-card whitespace-nowrap px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Avg
              </td>
              {hasCohortSizes && <td />}
              {Array.from(
                { length: maxPeriods - startPeriod },
                (_, i) => i + startPeriod,
              ).map((colIdx) => {
                const val = averages[colIdx] ?? null;
                if (val == null) {
                  return <td key={colIdx} className="px-[2px] pt-2 pb-1" />;
                }
                const cohortCount = data.filter(
                  (r) => r.periods[colIdx] != null,
                ).length;
                return (
                  <td key={colIdx} className="px-[2px] pt-2 pb-1">
                    <div
                      className="mx-auto flex items-center justify-center rounded-[3px] font-mono text-[11px] font-semibold tabular-nums"
                      style={{
                        backgroundColor: domainColor(val, colorRange[0], colorRange[1]),
                        color: domainTextColor(val, colorRange[0], colorRange[1]),
                        minWidth: "42px",
                        height: "26px",
                      }}
                      title={`Average ${periodLabel} ${colIdx}: ${(val * 100).toFixed(1)}% (across ${cohortCount} cohorts)`}
                    >
                      {(val * 100).toFixed(0)}%
                    </div>
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Color Legend ─────────────────────────────────────────
//
// Bertin: always provide a key for the visual variable encoding.
// A continuous bar communicates that the scale is sequential, not
// categorical — reinforcing the quantitative reading.

function ColorLegend({ colorRange }: { colorRange: [number, number] }) {
  const stops = 24;
  return (
    <div className="flex items-center gap-2 border-t border-border/30 px-5 pt-3 pb-3">
      <span className="text-[10px] tabular-nums text-muted-foreground/50">
        {(colorRange[0] * 100).toFixed(0)}%
      </span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full">
        {Array.from({ length: stops }, (_, i) => {
          const rate = colorRange[0] + (i / (stops - 1)) * (colorRange[1] - colorRange[0]);
          return (
            <div
              key={i}
              className="flex-1"
              style={{ backgroundColor: domainColor(rate, colorRange[0], colorRange[1]) }}
            />
          );
        })}
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground/50">
        {(colorRange[1] * 100).toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export function RetentionTriangle({
  tiers,
  periodLabel = "Month",
  skipM0 = false,
  title,
  subtitle,
  modeUrl,
  className,
}: RetentionTriangleProps) {
  const [activeTier, setActiveTier] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);

  const activeTierData = tiers[activeTier];

  const colorRange = useMemo<[number, number]>(() => {
    if (!activeTierData) return [0, 1];
    const startIdx = skipM0 ? 1 : 0;
    const vals = activeTierData.data.flatMap((r) =>
      r.periods.slice(startIdx).filter((v): v is number => v != null),
    );
    if (vals.length === 0) return [0, 1];
    return [Math.min(...vals), Math.max(...vals)];
  }, [activeTierData, skipM0]);

  if (!activeTierData || activeTierData.data.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card shadow-warm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {subtitle && (
            <span className="ml-2 text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
        {modeUrl && (
          <a
            href={modeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:border-border hover:text-foreground"
          >
            Mode
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      {/* Tier tabs — only when multiple tiers exist.
          Tufte's "small multiples" ideal would show them side-by-side,
          but monthly cohorts are too wide for that. Tabs keep the shared
          axis & scale while fitting the viewport. */}
      {tiers.length > 1 && (
        <div className="flex gap-0 border-b border-border/40 px-5">
          {tiers.map((tier, idx) => (
            <button
              key={tier.key}
              onClick={() => {
                setActiveTier(idx);
                setHoveredCell(null);
              }}
              className={cn(
                "relative px-3 py-2.5 text-xs font-medium transition-colors",
                idx === activeTier
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/70",
              )}
            >
              {tier.label}
              {tier.data.length > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground/50">
                  {tier.data.length}
                </span>
              )}
              {idx === activeTier && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-foreground" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Triangle */}
      <div className="px-3 py-3">
        <TriangleTable
          data={activeTierData.data}
          periodLabel={periodLabel}
          hoveredCell={hoveredCell}
          onHover={setHoveredCell}
          skipM0={skipM0}
          colorRange={colorRange}
        />
      </div>

      {/* Legend */}
      <ColorLegend colorRange={colorRange} />
    </div>
  );
}
