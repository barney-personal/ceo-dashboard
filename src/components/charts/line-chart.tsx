"use client";

import { useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LineChartSeries {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  dashed?: boolean;
}

type YFormatType = "currency" | "percent" | "number" | "months";

const Y_FORMATTERS: Record<YFormatType, (v: number) => string> = {
  currency: (v) => `$${v.toFixed(0)}`,
  percent: (v) => `${v.toFixed(0)}%`,
  number: (v) => v.toLocaleString(),
  months: (v) => `${v.toFixed(0)}m`,
};

interface LineChartProps {
  series: LineChartSeries[];
  title: string;
  subtitle?: string;
  yLabel?: string;
  yFormatType?: YFormatType;
  modeUrl?: string;
  className?: string;
}

export function LineChart({
  series,
  title,
  subtitle,
  yLabel,
  yFormatType = "number",
  modeUrl,
  className,
}: LineChartProps) {
  const yFormat = Y_FORMATTERS[yFormatType];
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || series.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = 360;
    const margin = { top: 24, right: 24, bottom: 56, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Parse dates
    const parsedSeries = series.map((s) => ({
      ...s,
      data: s.data.map((d) => ({ ...d, date: new Date(d.date) })),
    }));

    const allDates = parsedSeries.flatMap((s) => s.data.map((d) => d.date));
    const allValues = parsedSeries.flatMap((s) => s.data.map((d) => d.value));

    const x = d3
      .scaleTime()
      .domain(d3.extent(allDates) as [Date, Date])
      .range([0, innerWidth]);

    const yMin = d3.min(allValues) ?? 0;
    const yMax = d3.max(allValues) ?? 1;
    const yPadding = (yMax - yMin) * 0.15;

    const y = d3
      .scaleLinear()
      .domain([Math.max(0, yMin - yPadding), yMax + yPadding])
      .nice()
      .range([innerHeight, 0]);

    // Horizontal grid lines
    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(6)
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

    // X axis — adaptive tick interval based on date range
    const dateRange = allDates;
    const rangeMonths =
      (dateRange[dateRange.length - 1]?.getTime() - dateRange[0]?.getTime()) /
      (1000 * 60 * 60 * 24 * 30);
    const tickInterval =
      rangeMonths > 36
        ? d3.timeMonth.every(6)
        : rangeMonths > 18
          ? d3.timeMonth.every(3)
          : d3.timeMonth.every(2);

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(tickInterval)
          .tickFormat((d) => {
            const date = d as Date;
            // Show "Jan 2024" for January, "Apr" for other months
            if (date.getMonth() === 0) {
              return d3.timeFormat("%b %Y")(date);
            }
            return d3.timeFormat("%b")(date);
          })
          .tickSizeOuter(0)
      )
      .call((sel) => sel.select(".domain").attr("stroke", "#ddd"))
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "11px")
          .attr("dy", "1.2em")
      )
      .call((sel) => sel.selectAll(".tick line").attr("stroke", "#ddd").attr("y2", 6));

    // X axis title
    g.append("text")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 40)
      .attr("text-anchor", "middle")
      .attr("fill", "#aaa")
      .attr("font-size", "11px")
      .text("Date");

    // Y axis
    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(6)
          .tickFormat((d) => yFormat(d as number))
          .tickSizeOuter(0)
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "11px")
          .attr("dx", "-0.5em")
      )
      .call((sel) => sel.selectAll(".tick line").remove());

    // Y axis label
    if (yLabel) {
      g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -56)
        .attr("x", -innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#aaa")
        .attr("font-size", "11px")
        .text(yLabel);
    }

    // Draw lines
    const line = d3
      .line<{ date: Date; value: number }>()
      .x((d) => x(d.date))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    for (const s of parsedSeries) {
      g.append("path")
        .datum(s.data)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", s.dashed ? 1.5 : 2)
        .attr("stroke-dasharray", s.dashed ? "6,4" : "none")
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", line);
    }

    // End dots
    for (const s of parsedSeries) {
      const last = s.data[s.data.length - 1];
      if (last) {
        g.append("circle")
          .attr("cx", x(last.date))
          .attr("cy", y(last.value))
          .attr("r", 3.5)
          .attr("fill", "white")
          .attr("stroke", s.color)
          .attr("stroke-width", 2);
      }
    }

    // Interactive crosshair + tooltip
    const crosshairLine = g
      .append("line")
      .attr("stroke", "#ccc")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .style("opacity", 0);

    const dots = parsedSeries.map((s) =>
      g
        .append("circle")
        .attr("r", 4)
        .attr("fill", "white")
        .attr("stroke", s.color)
        .attr("stroke-width", 2)
        .style("opacity", 0)
    );

    const tooltip = d3.select(tooltipRef.current);

    const overlay = g
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "crosshair");

    overlay.on("mousemove", (event: MouseEvent) => {
      const [mx] = d3.pointer(event);
      const dateAtMouse = x.invert(mx);

      // Find closest date across all series
      const bisect = d3.bisector((d: { date: Date }) => d.date).left;

      let tooltipHtml = `<div style="font-size:11px;color:#999;margin-bottom:4px">${d3.timeFormat("%b %Y")(dateAtMouse)}</div>`;

      crosshairLine.attr("x1", mx).attr("x2", mx).style("opacity", 1);

      parsedSeries.forEach((s, i) => {
        const idx = bisect(s.data, dateAtMouse, 1);
        const d0 = s.data[idx - 1];
        const d1 = s.data[idx];
        if (!d0) return;
        const d =
          d1 && dateAtMouse.getTime() - d0.date.getTime() > d1.date.getTime() - dateAtMouse.getTime()
            ? d1
            : d0;

        dots[i]
          .attr("cx", x(d.date))
          .attr("cy", y(d.value))
          .style("opacity", 1);

        tooltipHtml += `<div style="display:flex;align-items:center;gap:6px;font-size:12px">
          <span style="width:8px;height:2px;background:${s.color};border-radius:1px;${s.dashed ? "border-top:1px dashed " + s.color + ";background:none" : ""}"></span>
          <span style="color:#666">${s.label}:</span>
          <span style="font-weight:600;color:#333">${yFormat(d.value)}</span>
        </div>`;
      });

      tooltip
        .html(tooltipHtml)
        .style("opacity", 1)
        .style("left", `${event.offsetX + 16}px`)
        .style("top", `${event.offsetY - 16}px`);
    });

    overlay.on("mouseleave", () => {
      crosshairLine.style("opacity", 0);
      dots.forEach((d) => d.style("opacity", 0));
      tooltip.style("opacity", 0);
    });
  }, [series, yFormat, yLabel]);

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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4">
            {series.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div
                  className="h-0.5 w-4 rounded-full"
                  style={{
                    backgroundColor: s.dashed ? "transparent" : s.color,
                    borderTop: s.dashed ? `2px dashed ${s.color}` : "none",
                  }}
                />
                <span className="text-[11px] text-muted-foreground">
                  {s.label}
                </span>
              </div>
            ))}
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
