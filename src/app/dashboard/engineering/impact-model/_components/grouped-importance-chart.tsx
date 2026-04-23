"use client";

import { useRef, useEffect, useCallback } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { max } from "d3-array";
import type { ImpactGroupedImportance } from "@/lib/data/impact-model";
import { getContentBoxWidth } from "@/components/charts/chart-utils";

const GROUP_COLOR: Record<string, string> = {
  Tenure: "#7a5a3e",
  "Slack engagement": "#3f7ca0",
  "AI usage": "#c4673f",
  "Performance review": "#6a8b4c",
  "PR cadence": "#2d6a5c",
  "PR habits": "#4a8b7c",
  "Code style": "#2d6a5c", // retained for back-compat with pre-migration JSONs
  Pillar: "#8b5a9c",
  Discipline: "#9c5d2e",
  Level: "#4a6b7c",
  Gender: "#8e8680",
  Location: "#8e8680",
  Other: "#8e8680",
};

export function GroupedImportanceChart({
  data,
}: {
  data: ImpactGroupedImportance[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    const sorted = [...data].sort((a, b) => b.mean_abs_shap - a.mean_abs_shap);
    const total = sorted.reduce((s, d) => s + d.mean_abs_shap, 0);

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const barHeight = 40;
    const margin = { top: 8, right: 80, bottom: 8, left: 150 };
    const innerW = width - margin.left - margin.right;
    const height = sorted.length * barHeight + margin.top + margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const m = max(sorted, (d) => d.mean_abs_shap) ?? 1;
    const x = scaleLinear().domain([0, m]).range([0, innerW]);

    sorted.forEach((d, i) => {
      const y = i * barHeight;
      g.append("rect")
        .attr("x", 0)
        .attr("y", y + 8)
        .attr("width", Math.max(1, x(d.mean_abs_shap)))
        .attr("height", 22)
        .attr("fill", GROUP_COLOR[d.group] ?? "#8e8680")
        .attr("rx", 3);

      g.append("text")
        .attr("x", -10)
        .attr("y", y + 19)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 12)
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.9)
        .attr("font-weight", "500")
        .text(d.group);

      const pct = total > 0 ? (d.mean_abs_shap / total) * 100 : 0;
      g.append("text")
        .attr("x", x(d.mean_abs_shap) + 8)
        .attr("y", y + 19)
        .attr("dominant-baseline", "middle")
        .attr("font-size", 11)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.8)
        .text(`${pct.toFixed(0)}%`);
    });
  }, [data]);

  useEffect(() => {
    draw();
    const handler = () => draw();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [draw]);

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} />
    </div>
  );
}
