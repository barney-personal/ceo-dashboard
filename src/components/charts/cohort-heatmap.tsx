"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainColor } from "./chart-utils";

export interface CohortRow {
  cohort: string; // e.g. "2025-01"
  periods: (number | null)[]; // retention rates (0–1) by relative period
}

interface CohortHeatmapProps {
  data: CohortRow[];
  periodLabel?: string; // e.g. "Month" → "M0", "M1", ...
  title: string;
  subtitle?: string;
  modeUrl?: string;
  className?: string;
  /** When true, render only the table without the card wrapper and header */
  bare?: boolean;
  /** [min, max] domain for the color scale. When set, the palette stretches
   *  across this range so small differences become visible. */
  colorDomain?: [number, number];
}

function retentionColor(rate: number): string {
  // Green (high retention) → Yellow → Red (low retention)
  if (rate >= 0.6) return `hsl(142, 55%, ${85 - rate * 30}%)`;
  if (rate >= 0.3) return `hsl(${40 + (rate - 0.3) * 340}, 60%, 80%)`;
  return `hsl(0, 55%, ${90 - rate * 20}%)`;
}

function formatCohortLabel(cohort: string): string {
  // Handle both "YYYY-MM" (monthly) and "YYYY-MM-DD" (weekly) formats
  const d =
    cohort.length <= 7 ? new Date(cohort + "-01") : new Date(cohort + "T00:00");
  if (isNaN(d.getTime())) return cohort;
  // Weekly cohorts get day + month, monthly cohorts get month + year
  return cohort.length > 7
    ? d.toLocaleDateString("en-US", { day: "numeric", month: "short" })
    : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function CohortHeatmap({
  data,
  periodLabel = "Month",
  title,
  subtitle,
  modeUrl,
  className,
  bare = false,
  colorDomain,
}: CohortHeatmapProps) {
  const colorFn = colorDomain
    ? (v: number) => domainColor(v, colorDomain[0], colorDomain[1])
    : retentionColor;
  if (data.length === 0) return null;

  const maxPeriods = Math.max(...data.map((r) => r.periods.length));
  const periodHeaders = Array.from(
    { length: maxPeriods },
    (_, i) => `${periodLabel.charAt(0)}${i + 1}`
  );

  const table = (
    <div className="max-h-[720px] overflow-auto px-4 py-4">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-10 bg-card px-2 py-1 text-left font-medium text-muted-foreground">
              Cohort
            </th>
            {periodHeaders.map((h) => (
              <th
                key={h}
                className="sticky top-0 z-10 bg-card px-1 py-1 text-center font-medium text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.cohort}>
              <td className="sticky left-0 bg-card whitespace-nowrap px-2 py-0.5 font-mono text-muted-foreground">
                {formatCohortLabel(row.cohort)}
              </td>
              {periodHeaders.map((_, i) => {
                const val = row.periods[i];
                if (val == null) {
                  return (
                    <td key={i} className="px-1 py-0.5" />
                  );
                }
                return (
                  <td
                    key={i}
                    className="px-1 py-0.5 text-center"
                    title={`${formatCohortLabel(row.cohort)} ${periodLabel} ${i + 1}: ${(val * 100).toFixed(1)}%`}
                  >
                    <div
                      className="mx-auto rounded px-1 py-0.5 font-mono tabular-nums"
                      style={{
                        backgroundColor: colorFn(val),
                        minWidth: "36px",
                      }}
                    >
                      {(val * 100).toFixed(0)}%
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (bare) return table;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card shadow-warm",
        className
      )}
    >
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
      {table}
    </div>
  );
}
