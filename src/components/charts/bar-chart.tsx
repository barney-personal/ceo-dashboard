"use client";

import { useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartData[];
  title: string;
  subtitle?: string;
  modeUrl?: string;
  className?: string;
}

export function BarChart({
  data,
  title,
  subtitle,
  modeUrl,
  className,
}: BarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const barHeight = 34;
    const margin = { top: 12, right: 24, bottom: 32, left: 150 };
    const height = data.length * barHeight + margin.top + margin.bottom;
    const innerWidth = width - margin.left - margin.right;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const maxVal = d3.max(data, (d) => d.value) ?? 1;

    const x = d3.scaleLinear().domain([0, maxVal]).range([0, innerWidth]);

    const y = d3
      .scaleBand()
      .domain(data.map((d) => d.label))
      .range([0, data.length * barHeight])
      .padding(0.35);

    // Light grid lines
    g.append("g")
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickSize(data.length * barHeight)
          .tickFormat(() => "")
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick line")
          .attr("stroke", "#eee")
          .attr("stroke-width", 0.5)
      );

    // X axis labels at bottom
    g.append("g")
      .attr("transform", `translate(0,${data.length * barHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickSizeOuter(0)
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#999")
          .attr("font-size", "10px")
          .attr("dy", "0.8em")
      )
      .call((sel) => sel.selectAll(".tick line").remove());

    // X axis title
    g.append("text")
      .attr("x", innerWidth / 2)
      .attr("y", data.length * barHeight + 28)
      .attr("text-anchor", "middle")
      .attr("fill", "#aaa")
      .attr("font-size", "11px")
      .text("Employees");

    const tooltip = d3.select(tooltipRef.current);

    // Bars
    g.selectAll("rect")
      .data(data)
      .join("rect")
      .attr("x", 0)
      .attr("y", (d) => y(d.label)!)
      .attr("width", (d) => x(d.value))
      .attr("height", y.bandwidth())
      .attr("fill", (d) => d.color ?? "#3b3bba")
      .attr("rx", 4)
      .attr("opacity", 0.85)
      .style("cursor", "pointer")
      .on("mouseenter", function (event: MouseEvent, d: BarChartData) {
        d3.select(this).attr("opacity", 1);
        const pct = ((d.value / maxVal) * 100).toFixed(0);
        tooltip
          .html(
            `<div style="font-size:12px;font-weight:600;color:#333">${d.label}</div>
             <div style="font-size:12px;color:#666;margin-top:2px">${d.value.toLocaleString()} employees (${pct}% of largest)</div>`
          )
          .style("opacity", 1)
          .style("left", `${event.offsetX + 16}px`)
          .style("top", `${event.offsetY - 16}px`);
      })
      .on("mouseleave", function () {
        d3.select(this).attr("opacity", 0.85);
        tooltip.style("opacity", 0);
      });

    // Department labels
    g.selectAll(".label")
      .data(data)
      .join("text")
      .attr("class", "label")
      .attr("x", -10)
      .attr("y", (d) => y(d.label)! + y.bandwidth() / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "central")
      .attr("fill", "#555")
      .attr("font-size", "12px")
      .text((d) => d.label);

    // Value labels at end of bars
    g.selectAll(".value")
      .data(data)
      .join("text")
      .attr("class", "value")
      .attr("x", (d) => x(d.value) + 8)
      .attr("y", (d) => y(d.label)! + y.bandwidth() / 2)
      .attr("dominant-baseline", "central")
      .attr("fill", "#999")
      .attr("font-size", "11px")
      .attr("font-family", "var(--font-geist-mono)")
      .text((d) => d.value.toLocaleString());
  }, [data]);

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
