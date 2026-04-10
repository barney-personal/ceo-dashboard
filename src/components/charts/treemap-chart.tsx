"use client";

import { useRef, useEffect, useCallback } from "react";
import { select } from "d3-selection";
import {
  treemap,
  hierarchy,
  treemapSquarify,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import { scaleOrdinal } from "d3-scale";
import { cn } from "@/lib/utils";
import { getContentBoxWidth } from "./chart-utils";

interface TreemapRoot {
  label?: string;
  value?: number;
  children?: TreemapItem[];
}

type TreeNode = HierarchyRectangularNode<TreemapRoot>;

export interface TreemapItem {
  label: string;
  value: number;
}

interface TreemapChartProps {
  data: TreemapItem[];
  title: string;
  subtitle?: string;
  className?: string;
}

const PALETTE = [
  "#3b3bba", // indigo
  "#6366f1", // violet
  "#8b5cf6", // purple
  "#a78bfa", // lavender
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#ec4899", // pink
  "#64748b", // slate
];

export function TreemapChart({
  data,
  title,
  subtitle,
  className,
}: TreemapChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const draw = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return;

    const container = svg.parentElement;
    if (!container) return;

    const width = getContentBoxWidth(container);
    const height = 420;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    const s = select(svg);
    s.selectAll("*").remove();

    const color = scaleOrdinal<string>()
      .domain(data.map((d) => d.label))
      .range(PALETTE);

    const root = hierarchy<TreemapRoot>({ children: data })
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    treemap<TreemapRoot>()
      .size([width, height])
      .padding(3)
      .round(true)
      .tile(treemapSquarify)(root);

    const total = data.reduce((s, d) => s + d.value, 0);

    const leaves = root.leaves() as TreeNode[];
    const groups = s
      .selectAll<SVGGElement, TreeNode>("g")
      .data(leaves)
      .join("g")
      .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

    // Rectangles
    groups
      .append("rect")
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0)
      .attr("rx", 6)
      .attr("fill", (d) => color(d.data.label ?? ""))
      .attr("opacity", 0.85)
      .style("cursor", "default")
      .on("mouseenter", function () {
        select(this).attr("opacity", 1);
      })
      .on("mouseleave", function () {
        select(this).attr("opacity", 0.85);
      });

    // Labels — only render if the box is large enough
    groups.each(function (d) {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      const item = d.data;
      const g = select(this);
      const val = item.value ?? 0;
      const label = item.label ?? "";
      const pct = total > 0 ? ((val / total) * 100).toFixed(0) : "0";

      if (w > 60 && h > 40) {
        g.append("text")
          .attr("x", 10)
          .attr("y", 22)
          .attr("fill", "white")
          .attr("font-size", w > 120 ? "13px" : "11px")
          .attr("font-weight", "600")
          .attr("font-family", "var(--font-sans)")
          .text(label);

        g.append("text")
          .attr("x", 10)
          .attr("y", 40)
          .attr("fill", "rgba(255,255,255,0.75)")
          .attr("font-size", "11px")
          .attr("font-family", "var(--font-sans)")
          .text(`${val} views · ${pct}%`);
      } else if (w > 40 && h > 24) {
        g.append("text")
          .attr("x", 6)
          .attr("y", 16)
          .attr("fill", "white")
          .attr("font-size", "10px")
          .attr("font-weight", "600")
          .attr("font-family", "var(--font-sans)")
          .text(label);
      }
    });
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
      <div className="border-b border-border/50 px-5 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {subtitle && (
          <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
      <div className="p-4">
        <svg ref={svgRef} className="w-full" />
      </div>
    </div>
  );
}
