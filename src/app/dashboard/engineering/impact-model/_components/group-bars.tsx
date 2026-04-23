"use client";

import { useRef, useEffect, useCallback } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { max } from "d3-array";
import type { ImpactGroupStat } from "@/lib/data/impact-model";
import { getContentBoxWidth } from "@/components/charts/chart-utils";

interface Props {
  data: ImpactGroupStat[];
  title: string;
}

export function GroupBars({ data, title }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    const sorted = [...data].sort((a, b) => b.median - a.median);
    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const barHeight = 30;
    const margin = { top: 20, right: 60, bottom: 8, left: 130 };
    const innerW = width - margin.left - margin.right;
    const height = sorted.length * barHeight + margin.top + margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const maxV = max(sorted, (d) => Math.max(d.mean, d.median)) ?? 1;
    const x = scaleLinear().domain([0, maxV]).range([0, innerW]);

    // gridlines
    x.ticks(4).forEach((t) => {
      g.append("line")
        .attr("x1", x(t))
        .attr("x2", x(t))
        .attr("y1", -6)
        .attr("y2", sorted.length * barHeight)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.08);
      g.append("text")
        .attr("x", x(t))
        .attr("y", -10)
        .attr("text-anchor", "middle")
        .attr("font-size", 9)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.55)
        .text(t.toLocaleString());
    });

    sorted.forEach((d, i) => {
      const y = i * barHeight;
      // median bar
      g.append("rect")
        .attr("x", 0)
        .attr("y", y + 6)
        .attr("width", x(d.median))
        .attr("height", 8)
        .attr("fill", "#9c5d2e")
        .attr("rx", 2);
      // mean marker
      g.append("line")
        .attr("x1", x(d.mean))
        .attr("x2", x(d.mean))
        .attr("y1", y + 4)
        .attr("y2", y + 22)
        .attr("stroke", "#3f5b4c")
        .attr("stroke-width", 2);

      // label
      g.append("text")
        .attr("x", -10)
        .attr("y", y + 12)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 11)
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.85)
        .text(d.group);
      g.append("text")
        .attr("x", -10)
        .attr("y", y + 24)
        .attr("text-anchor", "end")
        .attr("font-size", 9)
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.5)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .text(`n=${d.n}`);

      g.append("text")
        .attr("x", x(d.median) + 6)
        .attr("y", y + 12)
        .attr("dominant-baseline", "middle")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.75)
        .text(Math.round(d.median).toLocaleString());
    });

    // Legend
    const legend = svg.append("g").attr("transform", `translate(${margin.left},4)`);
    legend
      .append("rect")
      .attr("width", 10)
      .attr("height", 6)
      .attr("fill", "#9c5d2e")
      .attr("rx", 1);
    legend
      .append("text")
      .attr("x", 14)
      .attr("y", 6)
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.7)
      .text("Median");
    legend
      .append("line")
      .attr("x1", 70)
      .attr("x2", 70)
      .attr("y1", 0)
      .attr("y2", 10)
      .attr("stroke", "#3f5b4c")
      .attr("stroke-width", 2);
    legend
      .append("text")
      .attr("x", 78)
      .attr("y", 6)
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.7)
      .text("Mean");
  }, [data]);

  useEffect(() => {
    draw();
    const handler = () => draw();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [draw]);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </div>
      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} />
      </div>
    </div>
  );
}
