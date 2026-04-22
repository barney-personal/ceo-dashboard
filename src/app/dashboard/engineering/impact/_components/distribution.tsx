"use client";

import { useEffect, useRef } from "react";
import { select } from "d3-selection";
import { scaleLinear, scaleBand } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import { line as d3Line, curveBasis } from "d3-shape";
import { bin as d3Bin, max as d3Max } from "d3-array";
import type { ImpactEngineer } from "@/lib/data/engineering-impact";
import { percentile, median, kde } from "@/components/charts/impact/stats";
import {
  DISC_COLOR,
  useContainerWidth,
  showTooltip,
  moveTooltip,
  hideTooltip,
} from "@/components/charts/impact/shared";

function ChartFrame({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="rounded-xl border border-border/60 bg-card shadow-warm">
      <figcaption className="border-b border-border/50 px-5 py-3">
        <h3 className="font-display text-lg italic tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground max-w-3xl">
          {caption}
        </p>
      </figcaption>
      <div className="px-5 py-4">{children}</div>
    </figure>
  );
}

// ─── A.1 Cleveland dot plot ──────────────────────────────────────────

export function DistCleveland({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const ics = engineers
      .filter(
        (e) => e.isMatched && e.levelTrack === "IC" && e.impact90d > 0,
      )
      .slice()
      .sort((a, b) => b.impact90d - a.impact90d);

    const rowH = 4;
    const margin = { top: 16, right: 140, bottom: 44, left: 16 };
    const innerW = width - margin.left - margin.right;
    const height = ics.length * rowH + margin.top + margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    const innerH = height - margin.top - margin.bottom;

    const xMax = Math.max(...ics.map((d) => d.impact90d)) * 1.05;
    const x = scaleLinear().domain([0, xMax]).range([0, innerW]);
    const y = scaleBand<number>()
      .domain(ics.map((_, i) => i))
      .range([0, innerH])
      .paddingInner(0.3);

    // Grid
    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6).tickSize(-innerH).tickFormat(() => ""))
      .select(".domain")
      .remove();

    // Connectors
    g.append("g")
      .selectAll("line")
      .data(ics)
      .join("line")
      .attr("x1", 0)
      .attr("x2", (d) => x(d.impact90d))
      .attr("y1", (_, i) => (y(i) ?? 0) + y.bandwidth() / 2)
      .attr("y2", (_, i) => (y(i) ?? 0) + y.bandwidth() / 2)
      .attr("stroke", (d) => DISC_COLOR[d.discipline] ?? DISC_COLOR.Other)
      .attr("stroke-width", 1)
      .attr("opacity", 0.25);

    // Dots
    g.append("g")
      .selectAll("circle")
      .data(ics)
      .join("circle")
      .attr("cx", (d) => x(d.impact90d))
      .attr("cy", (_, i) => (y(i) ?? 0) + y.bandwidth() / 2)
      .attr("r", 3)
      .attr("fill", (d) => DISC_COLOR[d.discipline] ?? DISC_COLOR.Other)
      .attr("stroke", "var(--card)")
      .attr("stroke-width", 0.5)
      .style("cursor", "pointer")
      .on("mouseenter", (event: MouseEvent, d) =>
        showTooltip(event, {
          title: d.name,
          subtitle: `${d.levelLabel} · ${d.discipline} · ${d.pillar}`,
          meta: `impact 90d ${d.impact90d} · ${d.prs90d} PRs · ${d.tenureMonthsNow}mo tenure`,
        }),
      )
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);

    const med = median(ics.map((d) => d.impact90d));
    g.append("line")
      .attr("x1", x(med))
      .attr("x2", x(med))
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3")
      .attr("stroke-width", 1);
    g.append("text")
      .attr("x", x(med) + 6)
      .attr("y", 12)
      .attr("fill", "var(--foreground)")
      .style("font-family", "var(--font-display)")
      .style("font-style", "italic")
      .style("font-size", "12px")
      .text(`median ${Math.round(med)}`);

    // Top/bottom labels
    const hi = ics.slice(0, 3);
    const lo = ics.slice(-3);
    [...hi, ...lo].forEach((d) => {
      const i = ics.indexOf(d);
      g.append("text")
        .attr("x", x(d.impact90d) + 6)
        .attr("y", (y(i) ?? 0) + y.bandwidth() / 2 + 3)
        .attr("fill", "var(--muted-foreground)")
        .style("font-size", "10px")
        .style("font-family", "var(--font-sans)")
        .text(d.name);
    });

    // X axis
    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 36)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("90-day impact");
  }, [engineers, width]);

  return (
    <ChartFrame
      title="A.1  Every engineer, ranked"
      caption="A Cleveland dot plot of 90-day impact. One dot per IC, sorted. Hover for name; the shape of the curve shows the top steepness and the tail length."
    >
      <div ref={containerRef} className="relative w-full overflow-x-hidden">
        <svg ref={svgRef} className="w-full" />
      </div>
    </ChartFrame>
  );
}

// ─── A.2 Histogram with KDE + rug ────────────────────────────────────

export function DistHistogram({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const values = engineers
      .filter(
        (e) => e.isMatched && e.levelTrack === "IC" && e.impact90d > 0,
      )
      .map((e) => e.impact90d);

    const height = 320;
    const margin = { top: 20, right: 24, bottom: 56, left: 52 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMax = (d3Max(values) ?? 0) * 1.05;
    const x = scaleLinear().domain([0, xMax]).nice().range([0, innerW]);
    const bins = d3Bin<number, number>()
      .domain(x.domain() as [number, number])
      .thresholds(x.ticks(24))(values);
    const yMax = d3Max(bins, (b) => b.length) ?? 0;
    const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    // Gridlines
    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(() => ""))
      .select(".domain")
      .remove();

    // Bars
    g.selectAll("rect")
      .data(bins)
      .join("rect")
      .attr("x", (d) => x(d.x0 ?? 0) + 1)
      .attr("y", (d) => y(d.length))
      .attr("width", (d) => Math.max(0, x(d.x1 ?? 0) - x(d.x0 ?? 0) - 2))
      .attr("height", (d) => innerH - y(d.length))
      .attr("fill", "oklch(0.42 0.17 265 / 0.55)");

    // KDE
    const density = kde(values, { min: 0, max: x.domain()[1], gridN: 140 });
    const binWidth = (x.domain()[1] - x.domain()[0]) / bins.length;
    const scaled: [number, number][] = density.map(([xv, yv]) => [
      xv,
      yv * values.length * binWidth,
    ]);
    g.append("path")
      .datum(scaled)
      .attr("fill", "none")
      .attr("stroke", "oklch(0.55 0.18 25)")
      .attr("stroke-width", 1.6)
      .attr(
        "d",
        d3Line<[number, number]>()
          .x((d) => x(d[0]))
          .y((d) => y(d[1]))
          .curve(curveBasis),
      );

    // Rug
    g.append("g")
      .selectAll("line")
      .data(values)
      .join("line")
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("y1", innerH)
      .attr("y2", innerH + 7)
      .attr("stroke", "var(--muted-foreground)")
      .attr("opacity", 0.55);

    // Quartile references
    const refs: [string, number][] = [
      ["p25", percentile(values, 0.25)],
      ["med", percentile(values, 0.5)],
      ["p75", percentile(values, 0.75)],
    ];
    refs.forEach(([label, v]) => {
      g.append("line")
        .attr("x1", x(v))
        .attr("x2", x(v))
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "var(--muted-foreground)")
        .attr("stroke-dasharray", "3 3")
        .attr("opacity", 0.6);
      g.append("text")
        .attr("x", x(v))
        .attr("y", -5)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--muted-foreground)")
        .style("font-size", "10px")
        .text(`${label} ${Math.round(v)}`);
    });

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );
    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 36)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("90-day impact");
  }, [engineers, width]);

  return (
    <ChartFrame
      title="A.2  Distribution & density"
      caption="Histogram with a Gaussian-kernel density overlay. Marks along the x-axis (the rug) show each engineer individually — we never hide the raw data behind a summary."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </ChartFrame>
  );
}

