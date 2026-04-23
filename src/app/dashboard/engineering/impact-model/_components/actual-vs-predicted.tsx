"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { max } from "d3-array";
import type { ImpactEngineerPrediction } from "@/lib/data/impact-model";
import { getContentBoxWidth } from "@/components/charts/chart-utils";

interface Props {
  engineers: ImpactEngineerPrediction[];
}

const DISCIPLINE_COLOR: Record<string, string> = {
  BE: "#9c5d2e",
  FE: "#3f7ca0",
  EM: "#8b5a9c",
  QA: "#6a8b4c",
  ML: "#c4673f",
  Ops: "#4a6b7c",
  Other: "#8e8680",
};

export function ActualVsPredicted({ engineers }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<ImpactEngineerPrediction | null>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = Math.min(520, Math.max(360, width * 0.6));
    const margin = { top: 24, right: 24, bottom: 48, left: 60 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const maxVal =
      max(engineers, (d) => Math.max(d.actual, d.predicted)) ?? 1;
    const domainMax = Math.ceil(maxVal * 1.05);

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleLinear().domain([0, domainMax]).range([0, innerW]);
    const y = scaleLinear().domain([0, domainMax]).range([innerH, 0]);

    // gridlines
    x.ticks(6).forEach((t) => {
      g.append("line")
        .attr("x1", x(t))
        .attr("x2", x(t))
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.07);
    });
    y.ticks(6).forEach((t) => {
      g.append("line")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", y(t))
        .attr("y2", y(t))
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.07);
    });

    // Diagonal y = x
    g.append("line")
      .attr("x1", x(0))
      .attr("y1", y(0))
      .attr("x2", x(domainMax))
      .attr("y2", y(domainMax))
      .attr("stroke", "#c4976b")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-dasharray", "4 4")
      .attr("stroke-width", 1.5);

    // Axis ticks
    x.ticks(6).forEach((t) => {
      g.append("text")
        .attr("x", x(t))
        .attr("y", innerH + 16)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.6)
        .text(t.toLocaleString());
    });
    y.ticks(6).forEach((t) => {
      g.append("text")
        .attr("x", -8)
        .attr("y", y(t))
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.6)
        .text(t.toLocaleString());
    });

    // Axis labels
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 36)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.75)
      .text("Actual impact (360d)");
    g.append("text")
      .attr("transform", `translate(-44,${innerH / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.75)
      .text("Predicted impact");

    // Points
    const tooltip = tooltipRef.current;
    g.selectAll("circle.engineer")
      .data(engineers)
      .join("circle")
      .attr("class", "engineer")
      .attr("cx", (d) => x(d.actual))
      .attr("cy", (d) => y(d.predicted))
      .attr("r", 4.5)
      .attr("fill", (d) => DISCIPLINE_COLOR[d.discipline] ?? "#8e8680")
      .attr("fill-opacity", 0.78)
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("mouseenter", function (event, d) {
        select(this).attr("r", 7).attr("stroke-width", 2);
        setHovered(d);
        if (tooltip) {
          tooltip.style.opacity = "1";
        }
      })
      .on("mousemove", function (event) {
        if (tooltip && container) {
          const rect = container.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          tooltip.style.left = `${px + 14}px`;
          tooltip.style.top = `${py + 14}px`;
        }
      })
      .on("mouseleave", function () {
        select(this).attr("r", 4.5).attr("stroke-width", 1);
        setHovered(null);
        if (tooltip) {
          tooltip.style.opacity = "0";
        }
      });

    // Legend for disciplines
    const disciplines = Array.from(
      new Set(engineers.map((e) => e.discipline)),
    ).sort();
    const lg = svg.append("g").attr("transform", `translate(${margin.left + 8},${margin.top + 8})`);
    disciplines.forEach((disc, i) => {
      const row = lg.append("g").attr("transform", `translate(0,${i * 18})`);
      row
        .append("circle")
        .attr("r", 5)
        .attr("cx", 5)
        .attr("cy", 5)
        .attr("fill", DISCIPLINE_COLOR[disc] ?? "#8e8680");
      row
        .append("text")
        .attr("x", 14)
        .attr("y", 8)
        .attr("font-size", 10)
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.75)
        .text(disc);
    });
  }, [engineers]);

  useEffect(() => {
    draw();
    const handler = () => draw();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [draw]);

  return (
    <div ref={containerRef} className="relative w-full">
      <svg ref={svgRef} />
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 min-w-[220px] rounded-lg border border-border/60 bg-card/95 px-3 py-2.5 text-[11px] shadow-warm backdrop-blur transition-opacity"
        style={{ opacity: 0 }}
      >
        {hovered && (
          <>
            <div className="mb-1 font-medium text-foreground">{hovered.name}</div>
            <div className="text-muted-foreground">
              {hovered.discipline} · {hovered.level_label} · {hovered.pillar}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
              <span className="text-muted-foreground">Actual</span>
              <span className="text-right">{hovered.actual.toLocaleString()}</span>
              <span className="text-muted-foreground">Predicted</span>
              <span className="text-right">{hovered.predicted.toLocaleString()}</span>
              <span className="text-muted-foreground">Residual</span>
              <span
                className="text-right"
                style={{
                  color: hovered.residual > 0 ? "#2e7d52" : "#b8472a",
                }}
              >
                {hovered.residual > 0 ? "+" : ""}
                {hovered.residual.toLocaleString()}
              </span>
              <span className="text-muted-foreground">Tenure</span>
              <span className="text-right">
                {hovered.tenure_months.toFixed(0)}mo
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
