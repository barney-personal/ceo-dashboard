"use client";

import { useRef, useEffect, useCallback } from "react";
import { select } from "d3-selection";
import { scaleTime, scaleLinear } from "d3-scale";
import { axisLeft, axisBottom } from "d3-axis";
import { line as d3Line, area as d3Area, curveMonotoneX } from "d3-shape";
import { extent, max } from "d3-array";
import { timeFormat } from "d3-time-format";
import { timeMonth } from "d3-time";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SmallMultiplesTimeSeriesPanel {
  label: string;
  category?: string;
  color: string;
  data: { date: string; value: number }[];
  /** Per-panel subtitle shown under the label (e.g. total spend). */
  subtitle?: string;
}

type YFormatType = "currency" | "number";

const Y_FORMATTERS: Record<YFormatType, (v: number) => string> = {
  currency: (v) =>
    v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`,
  number: (v) => v.toLocaleString(),
};

interface SmallMultiplesTimeSeriesProps {
  panels: SmallMultiplesTimeSeriesPanel[];
  title: string;
  subtitle?: string;
  yFormatType?: YFormatType;
  /**
   * When true, every panel uses the same y-scale (easier comparison of
   * absolute magnitude, Cleveland-style). When false, each panel gets its
   * own y so relative shapes are visible even for small models.
   */
  sharedY?: boolean;
  modeUrl?: string;
  className?: string;
  /** Panels per row. */
  columns?: number;
}

/**
 * Small multiples (trellis) of time series — one tiny panel per series.
 *
 * Tufte (Envisioning Information, ch. 4): "Small multiples, whether tabular
 * or pictorial, move to the heart of visual reasoning — to see, distinguish,
 * choose."
 *
 * Better than a 6-line overplot: each model gets its own canvas, magnitude
 * differences don't squash small series. Shared y-axis makes absolute
 * comparison honest.
 */
export function SmallMultiplesTimeSeries({
  panels,
  title,
  subtitle,
  yFormatType = "currency",
  sharedY = true,
  modeUrl,
  className,
  columns = 3,
}: SmallMultiplesTimeSeriesProps) {
  const yFormat = Y_FORMATTERS[yFormatType];

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card shadow-warm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-3">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {subtitle && (
            <span className="ml-2 text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
          {sharedY && <span>shared y-axis</span>}
          {modeUrl && (
            <a
              href={modeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 transition-colors hover:border-border hover:text-foreground"
            >
              Mode
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      </div>
      <div
        className="grid gap-3 p-4"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {panels.map((panel) => (
          <Panel
            key={panel.label}
            panel={panel}
            sharedY={sharedY}
            globalYMax={
              sharedY
                ? (max(panels.flatMap((p) => p.data.map((d) => d.value))) ?? 0)
                : null
            }
            globalXDomain={
              sharedY
                ? (extent(
                    panels.flatMap((p) => p.data.map((d) => new Date(d.date))),
                  ) as [Date, Date])
                : null
            }
            yFormat={yFormat}
          />
        ))}
      </div>
    </div>
  );
}

function Panel({
  panel,
  sharedY,
  globalYMax,
  globalXDomain,
  yFormat,
}: {
  panel: SmallMultiplesTimeSeriesPanel;
  sharedY: boolean;
  globalYMax: number | null;
  globalXDomain: [Date, Date] | null;
  yFormat: (v: number) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const width = container.getBoundingClientRect().width;
    const height = 120;
    const margin = { top: 6, right: 8, bottom: 22, left: 38 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    select(svgRef.current).selectAll("*").remove();

    const svg = select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    if (panel.data.length === 0) {
      g.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#bbb")
        .attr("font-size", "10px")
        .text("no data");
      return;
    }

    const parsed = panel.data
      .map((d) => ({ date: new Date(d.date), value: d.value }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const xDomain =
      globalXDomain ?? (extent(parsed.map((d) => d.date)) as [Date, Date]);
    const x = scaleTime().domain(xDomain).range([0, innerWidth]);

    const localMax = max(parsed.map((d) => d.value)) ?? 1;
    const yMax = sharedY && globalYMax ? globalYMax : localMax;
    const y = scaleLinear()
      .domain([0, yMax * 1.05])
      .nice()
      .range([innerHeight, 0]);

    // Faint zero baseline
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", innerHeight)
      .attr("y2", innerHeight)
      .attr("stroke", "#eee")
      .attr("stroke-width", 0.5);

    // Area fill (subtle) for the data-ink boost
    const areaGen = d3Area<{ date: Date; value: number }>()
      .x((d) => x(d.date))
      .y0(innerHeight)
      .y1((d) => y(d.value))
      .curve(curveMonotoneX);
    g.append("path")
      .datum(parsed)
      .attr("fill", panel.color)
      .attr("fill-opacity", 0.12)
      .attr("d", areaGen);

    // Line
    const lineGen = d3Line<{ date: Date; value: number }>()
      .x((d) => x(d.date))
      .y((d) => y(d.value))
      .curve(curveMonotoneX);
    g.append("path")
      .datum(parsed)
      .attr("fill", "none")
      .attr("stroke", panel.color)
      .attr("stroke-width", 1.8)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("d", lineGen);

    // Last-point dot
    const last = parsed.at(-1);
    if (last) {
      g.append("circle")
        .attr("cx", x(last.date))
        .attr("cy", y(last.value))
        .attr("r", 2.5)
        .attr("fill", "white")
        .attr("stroke", panel.color)
        .attr("stroke-width", 1.8);
    }

    // Minimal y axis — just min/max
    const yTicks = [0, yMax];
    g.append("g")
      .selectAll("text")
      .data(yTicks)
      .enter()
      .append("text")
      .attr("x", -6)
      .attr("y", (d) => y(d))
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .attr("fill", "#999")
      .attr("font-size", "9px")
      .text((d) => yFormat(d));

    // X axis: first + last date labels only
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        axisBottom(x)
          .tickValues([xDomain[0], xDomain[1]])
          .tickFormat((d) => timeFormat("%b '%y")(d as Date))
          .tickSizeOuter(0),
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#999")
          .attr("font-size", "9px")
          .attr("dy", "1em"),
      )
      .call((sel) => sel.selectAll(".tick line").remove());

    // Hidden placeholder call (yFormat path already handled, but keep
    // ticks var referenced to silence linters when custom y handling above)
    void axisLeft;
  }, [panel, sharedY, globalYMax, globalXDomain, yFormat]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  const total = panel.data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="rounded-lg border border-border/40 bg-background/30 p-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-foreground">
            {panel.label}
          </p>
          <p className="truncate text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
            {panel.category ?? panel.subtitle ?? " "}
          </p>
        </div>
        <span
          className="shrink-0 text-[11px] font-medium tabular-nums"
          style={{ color: panel.color }}
        >
          {yFormat(total)}
        </span>
      </div>
      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </div>
  );
}
