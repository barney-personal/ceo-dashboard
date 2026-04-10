"use client";

import { useRef, useEffect, useCallback } from "react";
import { select, pointer } from "d3-selection";
import { scaleLinear, scalePoint } from "d3-scale";
import { axisLeft, axisBottom } from "d3-axis";
import { line as d3Line, curveMonotoneX } from "d3-shape";
import { min, max, bisector } from "d3-array";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContentBoxWidth } from "./chart-utils";

export interface ConversionCurveSeries {
  label: string;
  color: string;
  /** Data keyed by step label (e.g. "M0", "M1", …) */
  data: { step: string; value: number }[];
}

interface ConversionCurveChartProps {
  series: ConversionCurveSeries[];
  /** Ordered step labels for the x-axis */
  steps: string[];
  title: string;
  subtitle?: string;
  yLabel?: string;
  modeUrl?: string;
  className?: string;
}

/**
 * Sequential lightness ramp: oldest cohort is lightest, newest is darkest.
 * This encodes temporal order perceptually — the eye reads dark = recent.
 */
const SEQUENTIAL_COLORS = [
  "#c4c8d4", // lightest — oldest cohort
  "#8b92a8",
  "#5c6280",
  "#3b3bba",
  "#1e1e6e", // darkest — newest cohort
];

const SEQUENTIAL_WIDTHS = [1.2, 1.4, 1.6, 2, 2.4];

export function ConversionCurveChart({
  series,
  steps,
  title,
  subtitle,
  yLabel,
  modeUrl,
  className,
}: ConversionCurveChartProps) {
  const yFormat = (v: number) => `${v.toFixed(0)}%`;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || series.length === 0) return;

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 360;
    // Extra right margin for direct end-labels (label ≈ 100px + 10px offset)
    const margin = { top: 24, right: 120, bottom: 56, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    select(svgRef.current).selectAll("*").remove();

    const svg = select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Assign sequential colors by index (oldest first)
    const seriesData = series.map((s, i) => {
      const byStep = new Map(s.data.map((d) => [d.step, d.value]));
      const color = SEQUENTIAL_COLORS[i % SEQUENTIAL_COLORS.length];
      const strokeWidth = SEQUENTIAL_WIDTHS[i % SEQUENTIAL_WIDTHS.length];
      return { ...s, byStep, color, strokeWidth };
    });

    const allValues = series.flatMap((s) => s.data.map((d) => d.value));
    const yMin = min(allValues) ?? 0;
    const yMax = max(allValues) ?? 1;
    const yPadding = (yMax - yMin) * 0.15;

    const x = scalePoint<string>()
      .domain(steps)
      .range([0, innerWidth])
      .padding(0.1);

    const y = scaleLinear()
      .domain([Math.max(0, yMin - yPadding), yMax + yPadding])
      .nice()
      .range([innerHeight, 0]);

    // Horizontal grid lines
    g.append("g")
      .call(
        axisLeft(y)
          .ticks(6)
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
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(axisBottom(x).tickSizeOuter(0))
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

    // X axis title
    g.append("text")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 40)
      .attr("text-anchor", "middle")
      .attr("fill", "#aaa")
      .attr("font-size", "11px")
      .text("Months since signup");

    // Y axis
    g.append("g")
      .call(
        axisLeft(y)
          .ticks(6)
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

    // Draw lines + direct end-labels (Tufte: label the data, not the legend)
    for (const s of seriesData) {
      const points = steps
        .filter((step) => s.byStep.has(step))
        .map((step) => ({ step, value: s.byStep.get(step)! }));

      const linePath = d3Line<{ step: string; value: number }>()
        .x((d) => x(d.step)!)
        .y((d) => y(d.value))
        .curve(curveMonotoneX);

      g.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", s.strokeWidth)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", linePath);

      // Direct end-label — placed to the right of the last data point
      const last = points[points.length - 1];
      if (last) {
        g.append("circle")
          .attr("cx", x(last.step)!)
          .attr("cy", y(last.value))
          .attr("r", 3)
          .attr("fill", "white")
          .attr("stroke", s.color)
          .attr("stroke-width", s.strokeWidth);

        g.append("text")
          .attr("x", x(last.step)! + 10)
          .attr("y", y(last.value))
          .attr("dy", "0.35em")
          .attr("font-size", "11px")
          .attr("font-weight", 500)
          .attr("fill", s.color)
          .text(`${s.label}  ${last.value.toFixed(1)}%`);
      }
    }

    // Interactive tooltip
    const crosshairLine = g
      .append("line")
      .attr("stroke", "#ccc")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .style("opacity", 0);

    const dots = seriesData.map((s) =>
      g
        .append("circle")
        .attr("r", 4)
        .attr("fill", "white")
        .attr("stroke", s.color)
        .attr("stroke-width", 2)
        .style("opacity", 0),
    );

    const tooltip = select(tooltipRef.current);

    const stepPositions = steps.map((step) => ({
      step,
      cx: x(step)!,
    }));
    const bisect = bisector((d: { cx: number }) => d.cx).left;

    g.append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "crosshair")
      .on("mousemove", (event: MouseEvent) => {
        const [mx] = pointer(event);
        const idx = bisect(stepPositions, mx, 1);
        const d0 = stepPositions[idx - 1];
        const d1 = stepPositions[idx];
        if (!d0) return;
        const closest = d1 && mx - d0.cx > d1.cx - mx ? d1 : d0;

        crosshairLine
          .attr("x1", closest.cx)
          .attr("x2", closest.cx)
          .style("opacity", 1);

        let tooltipHtml = `<div style="font-size:11px;color:#999;margin-bottom:4px">${closest.step}</div>`;

        seriesData.forEach((s, i) => {
          const val = s.byStep.get(closest.step);
          if (val == null) {
            dots[i].style("opacity", 0);
            return;
          }
          dots[i]
            .attr("cx", closest.cx)
            .attr("cy", y(val))
            .style("opacity", 1);

          tooltipHtml += `<div style="display:flex;align-items:center;gap:6px;font-size:12px">
            <span style="width:8px;height:2px;background:${s.color};border-radius:1px"></span>
            <span style="color:#666">${s.label}:</span>
            <span style="font-weight:600;color:#333">${yFormat(val)}</span>
          </div>`;
        });

        tooltip
          .html(tooltipHtml)
          .style("opacity", 1)
          .style("left", `${event.offsetX + 16}px`)
          .style("top", `${event.offsetY - 16}px`);
      })
      .on("mouseleave", () => {
        crosshairLine.style("opacity", 0);
        dots.forEach((d) => d.style("opacity", 0));
        tooltip.style("opacity", 0);
      });
  }, [series, steps, yLabel]);

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
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {subtitle && (
            <span className="ml-2 text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/50">
            light = older · dark = newer
          </span>
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
