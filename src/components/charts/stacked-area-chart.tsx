"use client";

import { useRef, useEffect, useCallback } from "react";
import { select, pointer } from "d3-selection";
import { scaleTime, scaleLinear } from "d3-scale";
import { axisLeft, axisBottom } from "d3-axis";
import { area as d3Area, stack as d3Stack, curveMonotoneX } from "d3-shape";
import { extent, max, bisector } from "d3-array";
import { timeFormat } from "d3-time-format";
import { timeMonth } from "d3-time";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContentBoxWidth } from "./chart-utils";

/**
 * Minimal HTML escape for the tooltip. Labels come from series config today
 * (hard-coded "Claude"/"Cursor"), but this keeps us safe if the component is
 * ever reused with labels sourced from Mode query results.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface StackedAreaSeries {
  key: string;
  label: string;
  color: string;
}

export interface StackedAreaDatum {
  date: string;
  [key: string]: string | number;
}

type YFormatType = "currency" | "number" | "percent" | "tokens";

const Y_FORMATTERS: Record<YFormatType, (v: number) => string> = {
  currency: (v) => (v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v.toFixed(0)}`),
  number: (v) => v.toLocaleString(),
  percent: (v) => `${v.toFixed(0)}%`,
  tokens: (v) => {
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1000) return `${Math.round(v / 1000)}K`;
    return v.toLocaleString();
  },
};

interface StackedAreaChartProps {
  data: StackedAreaDatum[];
  series: StackedAreaSeries[];
  title: string;
  subtitle?: string;
  yFormatType?: YFormatType;
  modeUrl?: string;
  className?: string;
  /**
   * Optional vertical annotation (e.g. "Claude data begins"). `date` must
   * match the data's x-domain format (YYYY-MM-DD).
   */
  annotations?: Array<{ date: string; label: string }>;
}

/**
 * Stacked area chart — composition + total visible in one figure.
 *
 * Tufte's data-density argument: when two additive series also need the
 * total, a single stacked area beats two lines + a separate total chart.
 * Each band's thickness at any x is that series' value; the top envelope
 * is the running total.
 */
export function StackedAreaChart({
  data,
  series,
  title,
  subtitle,
  yFormatType = "currency",
  modeUrl,
  className,
  annotations = [],
}: StackedAreaChartProps) {
  const yFormat = Y_FORMATTERS[yFormatType];
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return;

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 320;
    const margin = { top: 20, right: 24, bottom: 48, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    select(svgRef.current).selectAll("*").remove();

    const svg = select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    type ParsedRow = Record<string, string | number | Date> & {
      date: string;
      _date: Date;
    };
    const parsed: ParsedRow[] = data
      .map((d) => ({ ...d, _date: new Date(d.date as string) }) as ParsedRow)
      .sort((a, b) => a._date.getTime() - b._date.getTime());

    const stackGenerator = d3Stack<ParsedRow>()
      .keys(series.map((s) => s.key))
      .value((d, key) => Number(d[key] ?? 0));

    const stacked = stackGenerator(parsed);

    const x = scaleTime()
      .domain(extent(parsed.map((d) => d._date)) as [Date, Date])
      .range([0, innerWidth]);

    const yMax = max(stacked.at(-1)?.map((d) => d[1]) ?? [1]) ?? 1;

    const y = scaleLinear()
      .domain([0, yMax * 1.1])
      .nice()
      .range([innerHeight, 0]);

    // Gridlines
    g.append("g")
      .call(
        axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => ""),
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick line")
          .attr("stroke", "#eee")
          .attr("stroke-width", 0.5),
      );

    // X axis
    const dateRange = parsed.map((d) => d._date);
    const rangeMonths =
      (dateRange.at(-1)!.getTime() - dateRange[0]!.getTime()) /
      (1000 * 60 * 60 * 24 * 30);
    const tickInterval =
      rangeMonths > 18 ? timeMonth.every(3) : timeMonth.every(1);

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        axisBottom(x)
          .ticks(tickInterval)
          .tickFormat((d) => {
            const date = d as Date;
            if (date.getMonth() === 0) return timeFormat("%b %Y")(date);
            return timeFormat("%b")(date);
          })
          .tickSizeOuter(0),
      )
      .call((sel) => sel.select(".domain").attr("stroke", "#ddd"))
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "11px")
          .attr("dy", "1.2em"),
      )
      .call((sel) =>
        sel.selectAll(".tick line").attr("stroke", "#ddd").attr("y2", 6),
      );

    // Y axis
    g.append("g")
      .call(
        axisLeft(y)
          .ticks(5)
          .tickFormat((d) => yFormat(d as number))
          .tickSizeOuter(0),
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "11px")
          .attr("dx", "-0.5em"),
      )
      .call((sel) => sel.selectAll(".tick line").remove());

    // Areas
    const areaGenerator = d3Area<{ 0: number; 1: number; data: (typeof parsed)[number] }>()
      .x((d) => x(d.data._date))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(curveMonotoneX);

    stacked.forEach((layer, i) => {
      const s = series[i];
      g.append("path")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .datum(layer as any)
        .attr("fill", s.color)
        .attr("fill-opacity", 0.85)
        .attr("stroke", s.color)
        .attr("stroke-width", 0.5)
        .attr("d", areaGenerator);
    });

    // Annotations
    for (const anno of annotations) {
      const annoDate = new Date(anno.date);
      const cx = x(annoDate);
      if (cx < 0 || cx > innerWidth) continue;

      g.append("line")
        .attr("x1", cx)
        .attr("x2", cx)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("stroke", "#666")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "3,3")
        .attr("opacity", 0.6);

      g.append("text")
        .attr("x", cx + 4)
        .attr("y", 12)
        .attr("fill", "#555")
        .attr("font-size", "10px")
        .attr("font-style", "italic")
        .text(anno.label);
    }

    // Crosshair + tooltip
    const crosshair = g
      .append("line")
      .attr("stroke", "#333")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .style("opacity", 0);

    const tooltip = select(tooltipRef.current);

    const bisect = bisector((d: { _date: Date }) => d._date).left;

    g.append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "crosshair")
      .on("mousemove", (event: MouseEvent) => {
        const [mx] = pointer(event);
        const dateAt = x.invert(mx);
        const idx = bisect(parsed, dateAt, 1);
        const d0 = parsed[idx - 1];
        const d1 = parsed[idx];
        if (!d0) return;
        const d =
          d1 &&
          dateAt.getTime() - d0._date.getTime() >
            d1._date.getTime() - dateAt.getTime()
            ? d1
            : d0;

        const cx = x(d._date);
        crosshair.attr("x1", cx).attr("x2", cx).style("opacity", 1);

        let total = 0;
        let html = `<div style="font-size:11px;color:#999;margin-bottom:4px">${escapeHtml(timeFormat("%b %d, %Y")(d._date))}</div>`;
        for (const s of series) {
          const v = Number(d[s.key] ?? 0);
          total += v;
          html += `<div style="display:flex;align-items:center;gap:6px;font-size:12px">
            <span style="width:10px;height:10px;background:${escapeHtml(s.color)};border-radius:2px"></span>
            <span style="color:#666">${escapeHtml(s.label)}:</span>
            <span style="font-weight:600;color:#333">${escapeHtml(yFormat(v))}</span>
          </div>`;
        }
        html += `<div style="border-top:1px solid #eee;margin-top:4px;padding-top:4px;font-size:12px;display:flex;justify-content:space-between;gap:12px">
          <span style="color:#666">Total</span>
          <span style="font-weight:700;color:#111">${escapeHtml(yFormat(total))}</span>
        </div>`;

        tooltip
          .html(html)
          .style("opacity", 1)
          .style("left", `${event.offsetX + 16}px`)
          .style("top", `${event.offsetY - 16}px`);
      })
      .on("mouseleave", () => {
        crosshair.style("opacity", 0);
        tooltip.style("opacity", 0);
      });
  }, [data, series, yFormat, annotations]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[11px] text-muted-foreground">
                {s.label}
              </span>
            </div>
          ))}
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
      </div>
      <div ref={containerRef} className="relative px-4 py-3">
        <svg ref={svgRef} className="w-full" />
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-10 rounded-lg border border-border/60 bg-card px-3 py-2 shadow-warm-lg"
          style={{ opacity: 0, transition: "opacity 0.15s" }}
        />
      </div>
    </div>
  );
}
