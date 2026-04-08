"use client";

import { useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DivergingBarData {
  date: string;
  positive: number;
  negative: number;
}

interface DivergingBarChartProps {
  data: DivergingBarData[];
  title: string;
  subtitle?: string;
  positiveLabel?: string;
  negativeLabel?: string;
  positiveColor?: string;
  negativeColor?: string;
  showNetLine?: boolean;
  modeUrl?: string;
  className?: string;
}

export function DivergingBarChart({
  data,
  title,
  subtitle,
  positiveLabel = "Joiners",
  negativeLabel = "Departures",
  positiveColor = "#22c55e",
  negativeColor = "#ef4444",
  showNetLine = true,
  modeUrl,
  className,
}: DivergingBarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = 400;
    const margin = { top: 20, right: 32, bottom: 52, left: 48 };
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

    const parsed = data.map((d) => ({
      ...d,
      date: new Date(d.date),
      net: d.positive - d.negative,
    }));

    // X scale — band for columns
    const x = d3
      .scaleBand()
      .domain(parsed.map((d) => d.date.toISOString()))
      .range([0, innerWidth])
      .padding(0.2);

    // Y scale — symmetric around zero, tight to the data
    const maxAbs = d3.max(parsed, (d) =>
      Math.max(d.positive, d.negative)
    ) ?? 1;

    const y = d3
      .scaleLinear()
      .domain([-maxAbs, maxAbs])
      .nice()
      .range([innerHeight, 0]);

    // Horizontal grid lines
    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(8)
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

    // Zero line — prominent
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", y(0))
      .attr("y2", y(0))
      .attr("stroke", "#ccc")
      .attr("stroke-width", 1);

    // X axis — month labels
    const tickInterval = parsed.length > 24 ? 3 : parsed.length > 12 ? 2 : 1;

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(
            parsed
              .filter((_, i) => i % tickInterval === 0)
              .map((d) => d.date.toISOString())
          )
          .tickFormat((d) => {
            const date = new Date(d as string);
            return date.getMonth() === 0
              ? d3.timeFormat("%b '%y")(date)
              : d3.timeFormat("%b")(date);
          })
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
        d3
          .axisLeft(y)
          .ticks(8)
          .tickFormat((d) => {
            const v = d as number;
            return v === 0 ? "0" : Math.abs(v).toFixed(0);
          })
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

    const tooltip = d3.select(tooltipRef.current);

    // Positive bars (joiners — upward)
    g.selectAll("rect.pos")
      .data(parsed)
      .join("rect")
      .attr("class", "pos")
      .attr("x", (d) => x(d.date.toISOString())!)
      .attr("y", (d) => y(d.positive))
      .attr("width", x.bandwidth())
      .attr("height", (d) => y(0) - y(d.positive))
      .attr("fill", positiveColor)
      .attr("rx", 1.5)
      .attr("opacity", 0.8);

    // Negative bars (departures — downward)
    g.selectAll("rect.neg")
      .data(parsed)
      .join("rect")
      .attr("class", "neg")
      .attr("x", (d) => x(d.date.toISOString())!)
      .attr("y", y(0))
      .attr("width", x.bandwidth())
      .attr("height", (d) => y(0) - y(d.negative))
      .attr("fill", negativeColor)
      .attr("rx", 1.5)
      .attr("opacity", 0.8);

    // Net change line
    if (showNetLine) {
      const lineGen = d3
        .line<(typeof parsed)[0]>()
        .x((d) => x(d.date.toISOString())! + x.bandwidth() / 2)
        .y((d) => y(d.net))
        .curve(d3.curveMonotoneX);

      g.append("path")
        .datum(parsed)
        .attr("fill", "none")
        .attr("stroke", "#3b3bba")
        .attr("stroke-width", 2)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", lineGen);

      // End dot on net line
      const last = parsed[parsed.length - 1];
      if (last) {
        g.append("circle")
          .attr("cx", x(last.date.toISOString())! + x.bandwidth() / 2)
          .attr("cy", y(last.net))
          .attr("r", 3.5)
          .attr("fill", "white")
          .attr("stroke", "#3b3bba")
          .attr("stroke-width", 2);
      }
    }

    // Invisible overlay rects for tooltip per month
    g.selectAll("rect.overlay")
      .data(parsed)
      .join("rect")
      .attr("class", "overlay")
      .attr("x", (d) => x(d.date.toISOString())! - x.step() * 0.1)
      .attr("y", 0)
      .attr("width", x.step())
      .attr("height", innerHeight)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "crosshair")
      .on("mouseenter", function (event: MouseEvent, d) {
        // Highlight bars
        g.selectAll("rect.pos").attr("opacity", (dd) =>
          (dd as typeof d).date.getTime() === d.date.getTime() ? 1 : 0.4
        );
        g.selectAll("rect.neg").attr("opacity", (dd) =>
          (dd as typeof d).date.getTime() === d.date.getTime() ? 1 : 0.4
        );

        const net = d.positive - d.negative;
        const netSign = net >= 0 ? "+" : "";
        tooltip
          .html(
            `<div style="font-size:11px;color:#999;margin-bottom:4px">${d3.timeFormat("%B %Y")(d.date)}</div>
             <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:2px">
               <span style="width:8px;height:8px;border-radius:2px;background:${positiveColor}"></span>
               <span style="color:#666">${positiveLabel}:</span>
               <span style="font-weight:600;color:#333">${d.positive}</span>
             </div>
             <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:2px">
               <span style="width:8px;height:8px;border-radius:2px;background:${negativeColor}"></span>
               <span style="color:#666">${negativeLabel}:</span>
               <span style="font-weight:600;color:#333">${d.negative}</span>
             </div>
             <div style="display:flex;align-items:center;gap:6px;font-size:12px;border-top:1px solid #eee;padding-top:4px;margin-top:2px">
               <span style="width:8px;height:2px;border-radius:1px;background:#3b3bba"></span>
               <span style="color:#666">Net:</span>
               <span style="font-weight:600;color:${net >= 0 ? positiveColor : negativeColor}">${netSign}${net}</span>
             </div>`
          )
          .style("opacity", 1)
          .style("left", `${event.offsetX + 16}px`)
          .style("top", `${event.offsetY - 16}px`);
      })
      .on("mouseleave", function () {
        g.selectAll("rect.pos").attr("opacity", 0.8);
        g.selectAll("rect.neg").attr("opacity", 0.8);
        tooltip.style("opacity", 0);
      });
  }, [data, positiveLabel, negativeLabel, positiveColor, negativeColor, showNetLine]);

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
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: positiveColor }}
              />
              <span className="text-[11px] text-muted-foreground">
                {positiveLabel}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: negativeColor }}
              />
              <span className="text-[11px] text-muted-foreground">
                {negativeLabel}
              </span>
            </div>
            {showNetLine && (
              <div className="flex items-center gap-1.5">
                <div className="h-0.5 w-4 rounded-full bg-[#3b3bba]" />
                <span className="text-[11px] text-muted-foreground">Net</span>
              </div>
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
