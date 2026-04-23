"use client";

import { useRef, useEffect, useCallback } from "react";
import { select, pointer } from "d3-selection";
import { scaleTime, scaleLinear } from "d3-scale";
import { axisLeft, axisBottom } from "d3-axis";
import { line as d3Line, area as d3Area, curveMonotoneX } from "d3-shape";
import { min, max, bisector } from "d3-array";
import { timeFormat } from "d3-time-format";
import { timeMonth } from "d3-time";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContentBoxWidth } from "./chart-utils";

export interface HireForecastActualPoint {
  date: string;
  value: number;
}

export interface HireForecastBandPoint {
  date: string;
  low: number;
  mid: number;
  high: number;
}

interface HireForecastChartProps {
  /** Historical actuals — solid line ending at `forecastStart - 1`. */
  actual: HireForecastActualPoint[];
  /** Forecast fan — from the first projected month through the horizon. */
  forecast: HireForecastBandPoint[];
  title: string;
  subtitle?: string;
  yLabel?: string;
  modeUrl?: string;
  className?: string;
  /** Brand colour used for the actual and mid-forecast lines. */
  color?: string;
}

export function HireForecastChart({
  actual,
  forecast,
  title,
  subtitle,
  yLabel,
  modeUrl,
  className,
  color = "#2563eb",
}: HireForecastChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (actual.length === 0 && forecast.length === 0) return;

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 380;
    const margin = { top: 28, right: 80, bottom: 56, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    select(svgRef.current).selectAll("*").remove();

    const svg = select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Parse dates
    const actualPts = actual.map((d) => ({
      date: new Date(d.date),
      value: d.value,
    }));
    const forecastPts = forecast.map((d) => ({
      date: new Date(d.date),
      low: d.low,
      mid: d.mid,
      high: d.high,
    }));

    // Anchor the forecast to the last actual value so the mid line and band
    // connect visually with no gap.
    const anchor = actualPts[actualPts.length - 1];
    const forecastWithAnchor = anchor
      ? [
          {
            date: anchor.date,
            low: anchor.value,
            mid: anchor.value,
            high: anchor.value,
          },
          ...forecastPts,
        ]
      : forecastPts;

    const allDates = [
      ...actualPts.map((d) => d.date),
      ...forecastPts.map((d) => d.date),
    ];
    const allValues = [
      ...actualPts.map((d) => d.value),
      ...forecastPts.flatMap((d) => [d.low, d.mid, d.high]),
    ];

    const x = scaleTime()
      .domain([allDates[0], allDates[allDates.length - 1]])
      .range([0, innerWidth]);

    const yMin = min(allValues) ?? 0;
    const yMax = max(allValues) ?? 1;
    const yPadding = (yMax - yMin) * 0.15;
    const y = scaleLinear()
      .domain([Math.max(0, yMin - yPadding), yMax + yPadding])
      .nice()
      .range([innerHeight, 0]);

    // Horizontal grid
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
    const rangeMonths =
      (allDates[allDates.length - 1]?.getTime() - allDates[0]?.getTime()) /
      (1000 * 60 * 60 * 24 * 30);
    const tickInterval =
      rangeMonths > 36
        ? timeMonth.every(6)
        : rangeMonths > 18
          ? timeMonth.every(3)
          : timeMonth.every(2);

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
          .ticks(6)
          .tickFormat((d) => String(d))
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
        .attr("y", -48)
        .attr("x", -innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#aaa")
        .attr("font-size", "11px")
        .text(yLabel);
    }

    // Shaded band between low and high — drawn first so lines sit on top.
    if (forecastWithAnchor.length > 1) {
      const bandArea = d3Area<{
        date: Date;
        low: number;
        mid: number;
        high: number;
      }>()
        .x((d) => x(d.date))
        .y0((d) => y(d.low))
        .y1((d) => y(d.high))
        .curve(curveMonotoneX);

      g.append("path")
        .datum(forecastWithAnchor)
        .attr("fill", color)
        .attr("opacity", 0.12)
        .attr("d", bandArea);
    }

    // Forecast edge lines (thin, muted) — low + high
    if (forecastWithAnchor.length > 1) {
      const edgeLine = d3Line<{ date: Date; value: number }>()
        .x((d) => x(d.date))
        .y((d) => y(d.value))
        .curve(curveMonotoneX);

      const lowLine = forecastWithAnchor.map((d) => ({
        date: d.date,
        value: d.low,
      }));
      const highLine = forecastWithAnchor.map((d) => ({
        date: d.date,
        value: d.high,
      }));

      g.append("path")
        .datum(lowLine)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,3")
        .attr("d", edgeLine);

      g.append("path")
        .datum(highLine)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,3")
        .attr("d", edgeLine);
    }

    // Forecast mid line (dashed, brand colour)
    if (forecastWithAnchor.length > 1) {
      const midLine = d3Line<{ date: Date; value: number }>()
        .x((d) => x(d.date))
        .y((d) => y(d.value))
        .curve(curveMonotoneX);

      g.append("path")
        .datum(forecastWithAnchor.map((d) => ({ date: d.date, value: d.mid })))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.75)
        .attr("stroke-dasharray", "6,4")
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", midLine);
    }

    // Actual line (solid, brand colour, thicker)
    if (actualPts.length > 0) {
      const actualLine = d3Line<{ date: Date; value: number }>()
        .x((d) => x(d.date))
        .y((d) => y(d.value))
        .curve(curveMonotoneX);

      g.append("path")
        .datum(actualPts)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 2.25)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", actualLine);
    }

    // "Today" divider — vertical dotted line at the boundary between actual
    // and forecast, with a small label above.
    if (anchor && forecastPts.length > 0) {
      const boundary = x(forecastPts[0].date);
      g.append("line")
        .attr("x1", boundary)
        .attr("x2", boundary)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("stroke", "#bbb")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,3");

      g.append("text")
        .attr("x", boundary)
        .attr("y", -8)
        .attr("text-anchor", "middle")
        .attr("fill", "#888")
        .attr("font-size", "10px")
        .attr("font-style", "italic")
        .text("forecast →");
    }

    // End-of-horizon labels on the right edge
    if (forecastPts.length > 0) {
      const last = forecastPts[forecastPts.length - 1];
      const labelX = innerWidth + 8;

      const labelHigh = y(last.high);
      const labelMid = y(last.mid);
      const labelLow = y(last.low);

      g.append("text")
        .attr("x", labelX)
        .attr("y", labelHigh + 4)
        .attr("fill", color)
        .attr("font-size", "10px")
        .attr("opacity", 0.7)
        .text(`P90 · ${last.high.toFixed(0)}`);

      g.append("text")
        .attr("x", labelX)
        .attr("y", labelMid + 4)
        .attr("fill", color)
        .attr("font-size", "11px")
        .attr("font-weight", 600)
        .text(`P50 · ${last.mid.toFixed(0)}`);

      g.append("text")
        .attr("x", labelX)
        .attr("y", labelLow + 4)
        .attr("fill", color)
        .attr("font-size", "10px")
        .attr("opacity", 0.7)
        .text(`P10 · ${last.low.toFixed(0)}`);
    }

    // Actual end-of-series dot
    const lastActual = actualPts[actualPts.length - 1];
    if (lastActual) {
      g.append("circle")
        .attr("cx", x(lastActual.date))
        .attr("cy", y(lastActual.value))
        .attr("r", 3.5)
        .attr("fill", "white")
        .attr("stroke", color)
        .attr("stroke-width", 2);
    }

    // Interactive tooltip
    const crosshair = g
      .append("line")
      .attr("stroke", "#ccc")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .style("opacity", 0);

    const actualDot = g
      .append("circle")
      .attr("r", 4)
      .attr("fill", "white")
      .attr("stroke", color)
      .attr("stroke-width", 2)
      .style("opacity", 0);

    const forecastDot = g
      .append("circle")
      .attr("r", 4)
      .attr("fill", "white")
      .attr("stroke", color)
      .attr("stroke-width", 2)
      .style("opacity", 0);

    const tooltip = select(tooltipRef.current);
    const overlay = g
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "crosshair");

    const actualBisect = bisector((d: { date: Date }) => d.date).left;

    overlay.on("mousemove", (event: MouseEvent) => {
      const [mx] = pointer(event);
      const dateAtMouse = x.invert(mx);
      crosshair.attr("x1", mx).attr("x2", mx).style("opacity", 1);

      let html = `<div style="font-size:11px;color:#999;margin-bottom:4px">${timeFormat("%b %Y")(dateAtMouse)}</div>`;
      let anyVisible = false;

      // Actual — closest actual point to cursor
      if (actualPts.length > 0) {
        const idx = actualBisect(actualPts, dateAtMouse, 1);
        const d0 = actualPts[idx - 1];
        const d1 = actualPts[idx];
        const chosen =
          d1 &&
          dateAtMouse.getTime() - d0.date.getTime() >
            d1.date.getTime() - dateAtMouse.getTime()
            ? d1
            : d0;

        if (
          chosen &&
          dateAtMouse <= actualPts[actualPts.length - 1].date &&
          Math.abs(dateAtMouse.getTime() - chosen.date.getTime()) <
            1000 * 60 * 60 * 24 * 45
        ) {
          actualDot
            .attr("cx", x(chosen.date))
            .attr("cy", y(chosen.value))
            .style("opacity", 1);
          html += `<div style="display:flex;align-items:center;gap:6px;font-size:12px">
            <span style="width:10px;height:2px;background:${color};border-radius:1px"></span>
            <span style="color:#666">Actual:</span>
            <span style="font-weight:600;color:#333">${chosen.value.toFixed(1)}</span>
          </div>`;
          anyVisible = true;
        } else {
          actualDot.style("opacity", 0);
        }
      }

      // Forecast — find the closest forecast point
      if (forecastPts.length > 0 && dateAtMouse >= forecastPts[0].date) {
        const idx = actualBisect(forecastPts, dateAtMouse, 1);
        const d0 = forecastPts[idx - 1];
        const d1 = forecastPts[idx];
        const chosen =
          d1 &&
          dateAtMouse.getTime() - d0.date.getTime() >
            d1.date.getTime() - dateAtMouse.getTime()
            ? d1
            : d0;
        if (chosen) {
          forecastDot
            .attr("cx", x(chosen.date))
            .attr("cy", y(chosen.mid))
            .style("opacity", 1);
          html += `<div style="display:flex;align-items:center;gap:6px;font-size:12px">
            <span style="width:10px;border-top:2px dashed ${color}"></span>
            <span style="color:#666">Most likely:</span>
            <span style="font-weight:600;color:#333">${chosen.mid.toFixed(1)}</span>
          </div>`;
          html += `<div style="font-size:11px;color:#999;margin-top:2px;padding-left:16px">range ${chosen.low.toFixed(0)}–${chosen.high.toFixed(0)} (80% CI)</div>`;
          anyVisible = true;
        }
      } else {
        forecastDot.style("opacity", 0);
      }

      tooltip
        .html(html)
        .style("opacity", anyVisible ? 1 : 0)
        .style("left", `${event.offsetX + 16}px`)
        .style("top", `${event.offsetY - 16}px`);
    });

    overlay.on("mouseleave", () => {
      crosshair.style("opacity", 0);
      actualDot.style("opacity", 0);
      forecastDot.style("opacity", 0);
      tooltip.style("opacity", 0);
    });
  }, [actual, forecast, yLabel, color]);

  useEffect(() => {
    draw();
    if (!containerRef.current) return;
    // ResizeObserver is unavailable in jsdom; guard so unit tests don't crash.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card shadow-warm",
        className,
      )}
    >
      <div className="flex items-start justify-between border-b border-border/50 px-5 py-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
            {modeUrl && (
              <a
                href={modeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 transition-colors hover:text-primary"
              >
                Mode
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <LegendKey color={color} />
      </div>
      <div ref={containerRef} className="relative w-full px-5 py-4">
        <svg ref={svgRef} />
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg transition-opacity"
          style={{ opacity: 0 }}
        />
      </div>
    </div>
  );
}

function LegendKey({ color }: { color: string }) {
  return (
    <div className="flex shrink-0 items-center gap-4 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span
          className="block h-[2px] w-5 rounded"
          style={{ background: color }}
        />
        <span>Actual</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="block h-0 w-5 border-t-2 border-dashed"
          style={{ borderColor: color }}
        />
        <span>Forecast (P50)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="block h-3 w-5 rounded-sm"
          style={{ background: color, opacity: 0.15 }}
        />
        <span>80% range (P10–P90)</span>
      </div>
    </div>
  );
}
