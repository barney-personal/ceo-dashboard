"use client";

import { useEffect, useRef, useCallback } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { axisLeft, axisBottom } from "d3-axis";
import { line as d3Line, curveMonotoneX } from "d3-shape";
import { getContentBoxWidth } from "./chart-utils";

/**
 * Lorenz curve — cumulative share of users (x) vs cumulative share of
 * spend (y), sorted ascending by spend. The 45° reference line is perfect
 * equality; the gap between it and the curve visualises concentration.
 *
 * The Gini coefficient (2 × that gap's area) is rendered as a badge so the
 * figure answers "how concentrated" at a glance — Wilke's *Fundamentals of
 * Data Visualization*, Ch. 18, makes the case that distributional plots
 * belong next to rankings, not instead of them.
 */
export interface LorenzCurveProps {
  points: Array<{ x: number; y: number }>;
  gini: number;
  userCount: number;
  totalSpend: number;
  title?: string;
  subtitle?: string;
  /** Optional annotation tuple: highlights "top N users = M% of spend". */
  highlightTopN?: number;
}

function interpretGini(gini: number): string {
  if (gini < 0.25) return "broadly distributed";
  if (gini < 0.4) return "moderately concentrated";
  if (gini < 0.55) return "concentrated";
  return "highly concentrated";
}

export function LorenzCurve({
  points,
  gini,
  userCount,
  totalSpend,
  title = "Spend concentration",
  subtitle,
  highlightTopN = 10,
}: LorenzCurveProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || points.length < 2) return;
    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 240;
    const margin = { top: 16, right: 16, bottom: 36, left: 40 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleLinear().domain([0, 1]).range([0, innerW]);
    const y = scaleLinear().domain([0, 1]).range([innerH, 0]);

    // Equality gridlines every 25%
    g.append("g")
      .call(
        axisLeft(y)
          .tickValues([0, 0.25, 0.5, 0.75, 1])
          .tickSize(-innerW)
          .tickFormat((d) => `${Math.round((d as number) * 100)}%`),
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick line")
          .attr("stroke", "#eee")
          .attr("stroke-width", 0.5),
      )
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "10px"),
      );

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(
        axisBottom(x)
          .tickValues([0, 0.25, 0.5, 0.75, 1])
          .tickFormat((d) => `${Math.round((d as number) * 100)}%`)
          .tickSizeOuter(0),
      )
      .call((sel) => sel.select(".domain").attr("stroke", "#ddd"))
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "10px"),
      );

    // 45° equality line.
    g.append("line")
      .attr("x1", 0)
      .attr("y1", innerH)
      .attr("x2", innerW)
      .attr("y2", 0)
      .attr("stroke", "#bbb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3");

    // Area between equality and curve → the concentration gap.
    const pathGen = d3Line<{ x: number; y: number }>()
      .x((d) => x(d.x))
      .y((d) => y(d.y))
      .curve(curveMonotoneX);

    const areaPath = [
      `M 0 ${innerH}`,
      ...points.map((p) => `L ${x(p.x)} ${y(p.y)}`),
      `L ${innerW} 0`,
      `L 0 ${innerH} Z`,
    ].join(" ");

    g.append("path")
      .attr("d", areaPath)
      .attr("fill", "#c87f5a")
      .attr("fill-opacity", 0.08);

    g.append("path")
      .datum(points)
      .attr("d", pathGen)
      .attr("fill", "none")
      .attr("stroke", "#c87f5a")
      .attr("stroke-width", 1.75);

    // Axis labels
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 30)
      .attr("text-anchor", "middle")
      .attr("fill", "#666")
      .attr("font-size", "10px")
      .text("Cumulative % of users (sorted by spend, ascending)");

    g.append("text")
      .attr("x", -innerH / 2)
      .attr("y", -28)
      .attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)")
      .attr("fill", "#666")
      .attr("font-size", "10px")
      .text("Cumulative % of spend");
  }, [points]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // Compute the "top-N = M%" headline stat, if we have enough users.
  let topShareLabel: string | null = null;
  if (points.length > 1 && userCount >= highlightTopN) {
    // points is sorted ascending; the *last* (N / total) users are the top.
    const cutoff = 1 - highlightTopN / userCount;
    // Interpolate the Lorenz curve at x = cutoff.
    let yAtCutoff = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].x >= cutoff) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const t = (cutoff - p0.x) / (p1.x - p0.x || 1);
        yAtCutoff = p0.y + t * (p1.y - p0.y);
        break;
      }
    }
    const topShare = 1 - yAtCutoff;
    topShareLabel = `Top ${highlightTopN} users = ${(topShare * 100).toFixed(0)}% of spend`;
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/50 px-5 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </p>
          <h3 className="font-display text-lg italic text-foreground">
            Is AI spend concentrated or diffuse?
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Gini
          </span>
          <span className="font-display text-2xl tabular-nums text-foreground">
            {gini.toFixed(2)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {interpretGini(gini)}
          </span>
        </div>
      </div>

      <div ref={containerRef} className="px-5 py-4">
        <svg ref={svgRef} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/40 px-5 py-3 text-[11px] text-muted-foreground">
        <span>{userCount} active users</span>
        <span>·</span>
        <span>
          Total this month $
          {Math.round(totalSpend).toLocaleString()}
        </span>
        {topShareLabel && (
          <>
            <span>·</span>
            <span className="text-foreground">{topShareLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
