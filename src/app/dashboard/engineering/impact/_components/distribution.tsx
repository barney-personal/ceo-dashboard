"use client";

import { useEffect, useRef } from "react";
import { select } from "d3-selection";
import { scaleLinear, scaleBand, scaleDiverging } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import { line as d3Line, area as d3Area, curveBasis } from "d3-shape";
import { bin as d3Bin, max as d3Max, min as d3Min } from "d3-array";
import { interpolateRdYlBu } from "d3-scale-chromatic";
import { randomUniform } from "d3-random";
import type { ImpactEngineer } from "@/lib/data/engineering-impact";
import {
  percentile,
  median,
  kde,
} from "@/components/charts/impact/stats";
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

// ─── A.3 Ridgeline by tenure bucket ──────────────────────────────────

export function DistRidgeline({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const tenureBuckets = [
      { label: "< 3 mo", min: 0, max: 3 },
      { label: "3–6 mo", min: 3, max: 6 },
      { label: "6–12 mo", min: 6, max: 12 },
      { label: "1–2 yr", min: 12, max: 24 },
      { label: "2+ yr", min: 24, max: 9999 },
    ];
    const ics = engineers.filter(
      (e) => e.isMatched && e.levelTrack === "IC",
    );
    const groups = tenureBuckets.map((b) => ({
      ...b,
      values: ics
        .filter(
          (e) =>
            e.tenureMonthsNow >= b.min && e.tenureMonthsNow < b.max,
        )
        .map((e) => e.impact90d),
    }));

    const rowH = 52;
    const margin = { top: 26, right: 60, bottom: 42, left: 84 };
    const innerW = width - margin.left - margin.right;
    const height = margin.top + margin.bottom + groups.length * rowH;
    const innerH = groups.length * rowH;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const allValues = ics.map((e) => e.impact90d);
    const xMax = (d3Max(allValues) ?? 0) * 1.05;
    const x = scaleLinear().domain([0, xMax]).range([0, innerW]);
    const y = scaleBand<string>()
      .domain(groups.map((gp) => gp.label))
      .range([0, innerH])
      .paddingInner(0.2);

    // Grid
    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6).tickSize(-innerH).tickFormat(() => ""))
      .select(".domain")
      .remove();

    const overallMed = median(allValues);
    g.append("line")
      .attr("x1", x(overallMed))
      .attr("x2", x(overallMed))
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3")
      .attr("stroke-width", 1);
    g.append("text")
      .attr("x", x(overallMed) + 6)
      .attr("y", 10)
      .style("font-family", "var(--font-display)")
      .style("font-style", "italic")
      .style("font-size", "11px")
      .attr("fill", "var(--foreground)")
      .text(`overall median ${Math.round(overallMed)}`);

    const ridgeH = y.bandwidth();
    groups.forEach((grp) => {
      const bandG = g
        .append("g")
        .attr("transform", `translate(0,${y(grp.label) ?? 0})`);

      if (grp.values.length >= 3) {
        const dens = kde(grp.values, { min: 0, max: xMax, gridN: 100 });
        const maxDens = d3Max(dens, (d) => d[1]) ?? 1;
        const rs = scaleLinear()
          .domain([0, maxDens])
          .range([ridgeH - 2, 0]);
        const pts: [number, number][] = dens.map((d) => [d[0], rs(d[1])]);
        const path = d3Line<[number, number]>()
          .x((d) => x(d[0]))
          .y((d) => d[1])
          .curve(curveBasis)(pts);
        bandG
          .append("path")
          .attr("d", `${path} L${x(xMax)},${ridgeH} L0,${ridgeH}Z`)
          .attr("fill", "oklch(0.42 0.17 265 / 0.35)")
          .attr("stroke", "oklch(0.42 0.17 265)")
          .attr("stroke-width", 1);
        const med = median(grp.values);
        bandG
          .append("circle")
          .attr("cx", x(med))
          .attr("cy", ridgeH - 4)
          .attr("r", 3)
          .attr("fill", "var(--foreground)");
      }

      // Strip of points
      bandG
        .append("g")
        .selectAll("circle.strip")
        .data(grp.values)
        .join("circle")
        .attr("class", "strip")
        .attr("cx", (d) => x(d))
        .attr("cy", ridgeH - 1)
        .attr("r", 1.4)
        .attr("fill", "var(--foreground)")
        .attr("opacity", 0.55);

      g.append("text")
        .attr("x", -12)
        .attr("y", (y(grp.label) ?? 0) + ridgeH / 2 + 4)
        .attr("text-anchor", "end")
        .style("font-size", "12px")
        .style("font-weight", "500")
        .attr("fill", "var(--foreground)")
        .text(grp.label);
      g.append("text")
        .attr("x", innerW + 6)
        .attr("y", (y(grp.label) ?? 0) + ridgeH / 2 + 4)
        .style("font-size", "10px")
        .attr("fill", "var(--muted-foreground)")
        .text(`n=${grp.values.length}`);
    });

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );
  }, [engineers, width]);

  return (
    <ChartFrame
      title="A.3  Distributions by tenure bucket"
      caption="A ridgeline plot (after Wilke, Fundamentals of Data Visualization, 2019). Each ridge is the density of 90-day impact for one tenure bucket. Watch for the peak shifting right and the spread narrowing."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </ChartFrame>
  );
}

// ─── A.4 BE vs FE violins ────────────────────────────────────────────

export function DistViolins({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const ics = engineers.filter(
      (e) =>
        e.isMatched &&
        e.levelTrack === "IC" &&
        (e.discipline === "BE" || e.discipline === "FE"),
    );
    const groups = (["BE", "FE"] as const).map((disc) => ({
      key: disc,
      values: ics.filter((e) => e.discipline === disc).map((e) => e.impact90d),
    }));

    const height = 360;
    const margin = { top: 20, right: 24, bottom: 64, left: 56 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const yMax = d3Max(ics, (e) => e.impact90d) ?? 0;
    const y = scaleLinear().domain([0, yMax * 1.05]).nice().range([innerH, 0]);
    const x = scaleBand<string>()
      .domain(groups.map((gp) => gp.key))
      .range([0, innerW])
      .paddingInner(0.4)
      .paddingOuter(0.2);

    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(() => ""))
      .select(".domain")
      .remove();

    const violinW = x.bandwidth();
    groups.forEach((grp) => {
      const gx = x(grp.key) ?? 0;
      const color = DISC_COLOR[grp.key];
      const dens = kde(grp.values, { min: 0, max: yMax, gridN: 120 });
      const maxDens = d3Max(dens, (d) => d[1]) ?? 1;
      const ws = scaleLinear().domain([0, maxDens]).range([0, violinW / 2]);
      const area = d3Area<[number, number]>()
        .y((d) => y(d[0]))
        .x0((d) => -ws(d[1]))
        .x1((d) => ws(d[1]))
        .curve(curveBasis);
      g.append("g")
        .attr("transform", `translate(${gx + violinW / 2},0)`)
        .append("path")
        .attr("d", area(dens))
        .attr("fill", color)
        .attr("fill-opacity", 0.25)
        .attr("stroke", color)
        .attr("stroke-width", 1);

      const q1 = percentile(grp.values, 0.25);
      const q2 = percentile(grp.values, 0.5);
      const q3 = percentile(grp.values, 0.75);
      const boxW = 10;
      g.append("rect")
        .attr("x", gx + violinW / 2 - boxW / 2)
        .attr("y", y(q3))
        .attr("width", boxW)
        .attr("height", y(q1) - y(q3))
        .attr("fill", "var(--card)")
        .attr("stroke", color);
      g.append("line")
        .attr("x1", gx + violinW / 2 - boxW / 2)
        .attr("x2", gx + violinW / 2 + boxW / 2)
        .attr("y1", y(q2))
        .attr("y2", y(q2))
        .attr("stroke", color)
        .attr("stroke-width", 2);

      const jitter = randomUniform(-violinW * 0.22, violinW * 0.22);
      g.append("g")
        .selectAll("circle")
        .data(grp.values)
        .join("circle")
        .attr("cx", () => gx + violinW / 2 + jitter())
        .attr("cy", (d) => y(d))
        .attr("r", 2.2)
        .attr("fill", color)
        .attr("fill-opacity", 0.6);

      g.append("text")
        .attr("x", gx + violinW / 2)
        .attr("y", innerH + 26)
        .attr("text-anchor", "middle")
        .style("font-weight", "600")
        .style("font-size", "13px")
        .attr("fill", color)
        .text(grp.key === "BE" ? "Backend" : "Frontend");
      g.append("text")
        .attr("x", gx + violinW / 2)
        .attr("y", innerH + 42)
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .attr("fill", "var(--muted-foreground)")
        .text(
          `n=${grp.values.length} · median ${Math.round(q2)} · IQR ${Math.round(q1)}–${Math.round(q3)}`,
        );
    });

    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );
  }, [engineers, width]);

  return (
    <ChartFrame
      title="A.4  Backend vs Frontend"
      caption="Side-by-side violins with a strip of individual points. Violin = shape of distribution; box = interquartile range; strip = every engineer. Sample sizes visible."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </ChartFrame>
  );
}

// ─── A.5 Level × tenure heatmap ──────────────────────────────────────

export function DistHeatmap({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const levels = [1, 2, 3, 4, 5, 6];
    const buckets = [
      { label: "< 3 mo", min: 0, max: 3 },
      { label: "3–6 mo", min: 3, max: 6 },
      { label: "6–12 mo", min: 6, max: 12 },
      { label: "1–2 yr", min: 12, max: 24 },
      { label: "2–3 yr", min: 24, max: 36 },
      { label: "3+ yr", min: 36, max: 9999 },
    ];
    const ics = engineers.filter(
      (e) =>
        e.isMatched && e.levelTrack === "IC" && e.levelNum != null,
    );
    const cells: {
      level: number;
      bucket: string;
      n: number;
      medianImpact: number | null;
    }[] = [];
    for (const lvl of levels) {
      for (const b of buckets) {
        const vs = ics
          .filter(
            (e) =>
              e.levelNum === lvl &&
              e.tenureMonthsNow >= b.min &&
              e.tenureMonthsNow < b.max,
          )
          .map((e) => e.impact90d);
        cells.push({
          level: lvl,
          bucket: b.label,
          n: vs.length,
          medianImpact: vs.length ? median(vs) : null,
        });
      }
    }
    const overallMed = median(ics.map((e) => e.impact90d));
    const maxMed = d3Max(
      cells.filter((c) => c.medianImpact != null),
      (c) => c.medianImpact as number,
    ) ?? 0;
    const minMed = d3Min(
      cells.filter((c) => c.medianImpact != null),
      (c) => c.medianImpact as number,
    ) ?? 0;
    const color = scaleDiverging<string>()
      .domain([minMed, overallMed, maxMed])
      .interpolator(interpolateRdYlBu)
      .clamp(true);

    const cellH = 46;
    const margin = { top: 24, right: 32, bottom: 48, left: 60 };
    const innerW = width - margin.left - margin.right;
    const height = margin.top + margin.bottom + levels.length * cellH;
    const innerH = levels.length * cellH;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleBand<string>()
      .domain(buckets.map((b) => b.label))
      .range([0, innerW])
      .paddingInner(0.06);
    const y = scaleBand<string>()
      .domain(levels.map((l) => `L${l}`))
      .range([0, innerH])
      .paddingInner(0.06);

    g.selectAll("rect")
      .data(cells)
      .join("rect")
      .attr("x", (d) => x(d.bucket) ?? 0)
      .attr("y", (d) => y(`L${d.level}`) ?? 0)
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("fill", (d) =>
        d.medianImpact == null
          ? "var(--muted)"
          : color(d.medianImpact),
      )
      .attr("stroke", "var(--card)")
      .attr("stroke-width", 2)
      .on("mouseenter", (event: MouseEvent, d) =>
        showTooltip(event, {
          title: `L${d.level} · ${d.bucket}`,
          subtitle:
            d.medianImpact != null
              ? `median impact ${Math.round(d.medianImpact)}`
              : "no data",
          meta: `n = ${d.n}`,
        }),
      )
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);

    g.selectAll("text.cell")
      .data(cells)
      .join("text")
      .attr("class", "cell")
      .attr("x", (d) => (x(d.bucket) ?? 0) + x.bandwidth() / 2)
      .attr("y", (d) => (y(`L${d.level}`) ?? 0) + y.bandwidth() / 2 + 2)
      .attr("text-anchor", "middle")
      .style("font-family", "var(--font-mono)")
      .style("font-size", "13px")
      .attr("fill", "var(--foreground)")
      .text((d) =>
        d.medianImpact != null ? Math.round(d.medianImpact) : "—",
      );

    g.selectAll("text.n")
      .data(cells)
      .join("text")
      .attr("class", "n")
      .attr("x", (d) => (x(d.bucket) ?? 0) + x.bandwidth() / 2)
      .attr("y", (d) => (y(`L${d.level}`) ?? 0) + y.bandwidth() - 6)
      .attr("text-anchor", "middle")
      .style("font-size", "9px")
      .style("font-family", "var(--font-mono)")
      .attr("fill", "var(--muted-foreground)")
      .text((d) => (d.n ? `n=${d.n}` : ""));

    // Row labels
    levels.forEach((lvl) => {
      g.append("text")
        .attr("x", -10)
        .attr("y", (y(`L${lvl}`) ?? 0) + y.bandwidth() / 2 + 4)
        .attr("text-anchor", "end")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .attr("fill", "var(--foreground)")
        .text(`L${lvl}`);
    });
    buckets.forEach((b) => {
      g.append("text")
        .attr("x", (x(b.label) ?? 0) + x.bandwidth() / 2)
        .attr("y", innerH + 20)
        .attr("text-anchor", "middle")
        .style("font-size", "11px")
        .attr("fill", "var(--muted-foreground)")
        .text(b.label);
    });
  }, [engineers, width]);

  return (
    <ChartFrame
      title="A.5  Level × tenure heatmap"
      caption="Median 90-day impact for every level × tenure cell. Cells annotated with sample size. Diverging RdYlBu palette puts the overall median at the neutral midpoint."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </ChartFrame>
  );
}
