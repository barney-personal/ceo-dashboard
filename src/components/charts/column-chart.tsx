"use client";

import { useRef, useEffect, useCallback } from "react";
import { select } from "d3-selection";
import { scaleBand, scaleLinear } from "d3-scale";
import { axisLeft, axisBottom } from "d3-axis";
import { min, max } from "d3-array";
import { timeFormat } from "d3-time-format";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContentBoxWidth } from "./chart-utils";

export interface ColumnChartData {
  date: string;
  value: number;
}

type YFormatType = "compact" | "number" | "percent" | "currency";

const Y_FORMATTERS: Record<YFormatType, (v: number) => string> = {
  compact: (v) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  },
  number: (v) => v.toLocaleString(),
  percent: (v) => `${(v * 100).toFixed(1)}%`,
  currency: (v) => `$${v.toFixed(0)}`,
};

interface ColumnChartProps {
  data: ColumnChartData[];
  title: string;
  subtitle?: string;
  yLabel?: string;
  yFormatType?: YFormatType;
  color?: string;
  modeUrl?: string;
  className?: string;
}

export function ColumnChart({
  data,
  title,
  subtitle,
  yLabel,
  yFormatType = "compact",
  color = "#3b3bba",
  modeUrl,
  className,
}: ColumnChartProps) {
  const yFormat = Y_FORMATTERS[yFormatType];
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return;

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 420;
    const margin = { top: 16, right: 32, bottom: 56, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    select(svgRef.current).selectAll("*").remove();

    const svg = select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const parsed = data.map((d) => ({ ...d, date: new Date(d.date) }));

    const x = scaleBand()
      .domain(parsed.map((d) => d.date.toISOString()))
      .range([0, innerWidth])
      .padding(0.25);

    const yMin = min(parsed, (d) => d.value) ?? 0;
    const yMax = max(parsed, (d) => d.value) ?? 1;
    const yPadding = (yMax - yMin) * 0.15;

    const y = scaleLinear()
      .domain([Math.max(0, yMin - yPadding), yMax + yPadding])
      .nice()
      .range([innerHeight, 0]);

    // Grid lines
    g.append("g")
      .call(
        axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => "")
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick line")
          .attr("stroke", "#eee")
          .attr("stroke-width", 0.5)
      );

    // X axis — adapt ticks and format to data granularity
    const rangeMs = parsed[parsed.length - 1].date.getTime() - parsed[0].date.getTime();
    const avgGapMs = rangeMs / Math.max(parsed.length - 1, 1);
    const avgGapDays = avgGapMs / 86400000;

    // daily (<3 day gap), weekly (3–14 day gap), monthly (>14 day gap)
    const granularity = avgGapDays < 3 ? "daily" : avgGapDays < 14 ? "weekly" : "monthly";

    const tickInterval =
      granularity === "daily" ? 7
        : granularity === "weekly" ? 4
          : parsed.length > 12 ? 3 : parsed.length > 6 ? 2 : 1;

    const tickFormat = (d: string) => {
      const date = new Date(d);
      if (granularity === "daily") return timeFormat("%-d %b")(date);
      if (granularity === "weekly") return timeFormat("%-d %b")(date);
      return date.getMonth() === 0
        ? timeFormat("%b '%y")(date)
        : timeFormat("%b")(date);
    };

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        axisBottom(x)
          .tickValues(
            parsed
              .filter((_, i) => i % tickInterval === 0)
              .map((d) => d.date.toISOString())
          )
          .tickFormat((d) => tickFormat(d as string))
          .tickSizeOuter(0)
      )
      .call((sel) => sel.select(".domain").attr("stroke", "#ddd"))
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "10px")
          .attr("dy", "1.2em")
      )
      .call((sel) =>
        sel.selectAll(".tick line").attr("stroke", "#ddd").attr("y2", 4)
      );

    // Y axis
    g.append("g")
      .call(
        axisLeft(y)
          .ticks(5)
          .tickFormat((d) => yFormat(d as number))
          .tickSizeOuter(0)
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "11px")
      )
      .call((sel) => sel.selectAll(".tick line").remove());

    if (yLabel) {
      g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -48)
        .attr("x", -innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#aaa")
        .attr("font-size", "11px")
        .text(yLabel);
    }

    const tooltip = select(tooltipRef.current);

    // Bars
    g.selectAll("rect.bar")
      .data(parsed)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.date.toISOString())!)
      .attr("y", (d) => y(d.value))
      .attr("width", x.bandwidth())
      .attr("height", (d) => y(y.domain()[0]) - y(d.value))
      .attr("fill", color)
      .attr("rx", 2)
      .attr("opacity", 0.8)
      .style("cursor", "pointer")
      .on("mouseenter", function (event: MouseEvent, d) {
        select(this).attr("opacity", 1);
        tooltip
          .html(
            `<div style="font-size:11px;color:#999;margin-bottom:2px">${granularity === "daily" ? timeFormat("%-d %B %Y")(d.date) : granularity === "weekly" ? "w/c " + timeFormat("%-d %b %Y")(d.date) : timeFormat("%B %Y")(d.date)}</div>
             <div style="font-size:13px;font-weight:600;color:#333">${yFormat(d.value)}</div>`
          )
          .style("opacity", 1)
          .style("left", `${event.offsetX + 16}px`)
          .style("top", `${event.offsetY - 16}px`);
      })
      .on("mouseleave", function () {
        select(this).attr("opacity", 0.8);
        tooltip.style("opacity", 0);
      });
  }, [data, yFormat, yLabel, color]);

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
      <div ref={containerRef} className="relative px-4 py-5">
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
