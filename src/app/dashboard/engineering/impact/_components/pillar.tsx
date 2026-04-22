"use client";

import { useEffect, useRef } from "react";
import { select } from "d3-selection";
import { scaleLinear, scaleBand } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import { line as d3Line, curveMonotoneX } from "d3-shape";
import { group as d3Group, rollup as d3Rollup, max as d3Max } from "d3-array";
import type {
  ImpactEngineer,
  ImpactTenureBucket,
} from "@/lib/data/engineering-impact";
import {
  computeRampUp,
  steadyStateFromEngineers,
  timeToTarget,
  percentile,
  median,
} from "@/components/charts/impact/stats";
import {
  PILLAR_PALETTE,
  useContainerWidth,
  showTooltip,
  moveTooltip,
  hideTooltip,
} from "@/components/charts/impact/shared";

function Frame({
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

// ─── C.1 Pillar box plots (sorted by median) ─────────────────────────

export function PillarBoxes({
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
      (e) => e.isMatched && e.levelTrack === "IC" && e.impact90d > 0,
    );
    const byPillar = d3Group(ics, (d) => d.pillar);
    const groups = [...byPillar.entries()]
      .map(([pillar, items]) => ({
        pillar,
        items,
        values: items.map((e) => e.impact90d),
      }))
      .filter((gp) => gp.values.length >= 3)
      .sort((a, b) => median(b.values) - median(a.values));

    const rowH = 46;
    const margin = { top: 28, right: 110, bottom: 54, left: 180 };
    const innerW = width - margin.left - margin.right;
    const height = margin.top + margin.bottom + groups.length * rowH;
    const innerH = groups.length * rowH;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMax = percentile(
      ics.map((e) => e.impact90d),
      0.98,
    );
    const x = scaleLinear().domain([0, xMax * 1.02]).nice().range([0, innerW]);
    const y = scaleBand<string>()
      .domain(groups.map((gp) => gp.pillar))
      .range([0, innerH])
      .paddingInner(0.25);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6).tickSize(-innerH).tickFormat(() => ""))
      .select(".domain")
      .remove();

    const overallMed = median(ics.map((e) => e.impact90d));
    g.append("line")
      .attr("x1", x(overallMed))
      .attr("x2", x(overallMed))
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3");
    g.append("text")
      .attr("x", x(overallMed))
      .attr("y", -8)
      .attr("text-anchor", "middle")
      .style("font-family", "var(--font-display)")
      .style("font-style", "italic")
      .style("font-size", "11px")
      .attr("fill", "var(--foreground)")
      .text(`company median ${Math.round(overallMed)}`);

    groups.forEach((grp, idx) => {
      const gy = (y(grp.pillar) ?? 0) + y.bandwidth() / 2;
      const color = PILLAR_PALETTE[idx % PILLAR_PALETTE.length];
      const q1 = percentile(grp.values, 0.25);
      const q2 = percentile(grp.values, 0.5);
      const q3 = percentile(grp.values, 0.75);
      const iqr = q3 - q1;
      const lo = Math.max(Math.min(...grp.values), q1 - 1.5 * iqr);
      const hi = Math.min(Math.max(...grp.values), q3 + 1.5 * iqr);

      g.append("line")
        .attr("x1", x(lo))
        .attr("x2", x(hi))
        .attr("y1", gy)
        .attr("y2", gy)
        .attr("stroke", color);
      g.append("rect")
        .attr("x", x(q1))
        .attr("y", gy - 10)
        .attr("width", x(q3) - x(q1))
        .attr("height", 20)
        .attr("fill", color)
        .attr("fill-opacity", 0.22)
        .attr("stroke", color);
      g.append("line")
        .attr("x1", x(q2))
        .attr("x2", x(q2))
        .attr("y1", gy - 12)
        .attr("y2", gy + 12)
        .attr("stroke", color)
        .attr("stroke-width", 2);

      // Visual-only jitter so overlapping dots resolve. d3-random isn't
      // installed in this worktree's node_modules — use Math.random instead.
      const jitter = () => (Math.random() - 0.5) * 14;
      g.append("g")
        .selectAll("circle")
        .data(grp.items)
        .join("circle")
        .attr("cx", (d) => x(d.impact90d))
        .attr("cy", () => gy + jitter())
        .attr("r", 2.2)
        .attr("fill", color)
        .attr("fill-opacity", 0.65)
        .attr("stroke", "var(--card)")
        .attr("stroke-width", 0.4)
        .style("cursor", "pointer")
        .on("mouseenter", (event: MouseEvent, d) =>
          showTooltip(event, {
            title: d.name,
            subtitle: `${d.levelLabel} · ${d.discipline} · ${d.pillar}`,
            meta: `impact 90d ${d.impact90d} · tenure ${d.tenureMonthsNow}mo`,
          }),
        )
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);

      g.append("text")
        .attr("x", -12)
        .attr("y", gy + 4)
        .attr("text-anchor", "end")
        .style("font-weight", "500")
        .style("font-size", "12px")
        .attr("fill", "var(--foreground)")
        .text(grp.pillar);
      g.append("text")
        .attr("x", innerW + 8)
        .attr("y", gy + 4)
        .style("font-size", "10px")
        .style("font-family", "var(--font-mono)")
        .attr("fill", "var(--muted-foreground)")
        .text(`n=${grp.values.length} · M=${Math.round(q2)}`);
    });

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 40)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("90-day impact");
  }, [engineers, width]);

  return (
    <Frame
      title="C.1  Impact distribution by pillar"
      caption="Horizontal box plots, sorted by median (Robbins, 2004 — always sort by the quantity being displayed). Strip of dots shows every engineer. Small pillars are flagged."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}

// ─── C.2 Pillar ramp-up curves overlaid ──────────────────────────────

export function PillarCurves({
  engineers,
  buckets,
}: {
  engineers: ImpactEngineer[];
  buckets: ImpactTenureBucket[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const byEmail = new Map(engineers.map((e) => [e.email, e]));
    const ics = engineers.filter(
      (e) => e.isMatched && e.levelTrack === "IC",
    );
    const pillarCounts = d3Rollup(
      ics,
      (v) => v.length,
      (d) => d.pillar,
    );
    const eligible = [...pillarCounts.entries()]
      .filter(([, n]) => n >= 6)
      .map(([p]) => p);
    const pillarRows = eligible.map((pillar) => ({
      pillar,
      rows: computeRampUp(
        buckets,
        byEmail,
        (e) => e.levelTrack === "IC" && e.pillar === pillar,
        { maxMonth: 15 },
      ),
      n: pillarCounts.get(pillar) ?? 0,
    }));

    const height = 420;
    const margin = { top: 24, right: 180, bottom: 56, left: 52 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleLinear().domain([0, 15]).range([0, innerW]);
    const yMax =
      (d3Max(
        pillarRows.flatMap((p) =>
          p.rows.filter((r) => r.n >= 3).map((r) => r.p50 ?? 0),
        ),
      ) ?? 0) * 1.15;
    const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(() => ""))
      .select(".domain")
      .remove();

    const line = d3Line<{ month: number; p50?: number }>()
      .x((d) => x(d.month))
      .y((d) => y(d.p50 ?? 0))
      .curve(curveMonotoneX);

    pillarRows.forEach((p, idx) => {
      const data = p.rows.filter((r) => r.n >= 3);
      if (!data.length) return;
      const color = PILLAR_PALETTE[idx % PILLAR_PALETTE.length];
      g.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.85)
        .attr("d", line(data) as string);
      g.append("g")
        .selectAll("circle")
        .data(data)
        .join("circle")
        .attr("cx", (d) => x(d.month))
        .attr("cy", (d) => y(d.p50 ?? 0))
        .attr("r", 2)
        .attr("fill", color);
      const last = data[data.length - 1];
      g.append("text")
        .attr("x", x(last.month) + 6)
        .attr("y", y(last.p50 ?? 0) + 4)
        .style("font-weight", "500")
        .style("font-size", "11px")
        .attr("fill", color)
        .text(`${p.pillar} (n=${p.n})`);
    });

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(
        axisBottom(x)
          .ticks(8)
          .tickFormat((d) => (d === 0 ? "start" : `m${Number(d) + 1}`)),
      )
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
      .attr("y", innerH + 40)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("tenure month");
  }, [engineers, buckets, width]);

  return (
    <Frame
      title="C.2  Ramp-up curves by pillar"
      caption="Overlaid median curves, one per pillar with n ≥ 3 engineers contributing to every plotted month. Direct labels at line ends (Tufte) replace the legend."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}

// ─── C.3 Time to 50% lollipop ────────────────────────────────────────

export function PillarLollipop({
  engineers,
  buckets,
}: {
  engineers: ImpactEngineer[];
  buckets: ImpactTenureBucket[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const byEmail = new Map(engineers.map((e) => [e.email, e]));
    const ics = engineers.filter(
      (e) => e.isMatched && e.levelTrack === "IC",
    );
    const pillarCounts = d3Rollup(
      ics,
      (v) => v.length,
      (d) => d.pillar,
    );
    const eligible = [...pillarCounts.entries()]
      .filter(([, n]) => n >= 6)
      .map(([p]) => p);
    const items = eligible
      .map((pillar) => {
        const rows = computeRampUp(
          buckets,
          byEmail,
          (e) => e.levelTrack === "IC" && e.pillar === pillar,
          { maxMonth: 15 },
        );
        const ssInfo = steadyStateFromEngineers(
          engineers,
          (e) => e.levelTrack === "IC" && e.pillar === pillar,
          12,
        );
        if (!ssInfo) return null;
        const ss = ssInfo.value;
        const t50 = timeToTarget(rows, ss * 0.5);
        const anyData = rows.some((r) => r.n >= 2);
        if (!anyData) return null;
        return {
          pillar,
          t50,
          ss,
          n: pillarCounts.get(pillar) ?? 0,
          reached: t50 != null,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => {
        if (a.reached !== b.reached) return a.reached ? -1 : 1;
        if (a.reached && b.reached) return (a.t50 ?? 0) - (b.t50 ?? 0);
        return a.pillar.localeCompare(b.pillar);
      });

    const rowH = 36;
    const margin = { top: 28, right: 260, bottom: 60, left: 180 };
    const innerW = width - margin.left - margin.right;
    const height = margin.top + margin.bottom + items.length * rowH;
    const innerH = items.length * rowH;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMax = 16;
    const x = scaleLinear().domain([0, xMax]).range([0, innerW]);
    const y = scaleBand<string>()
      .domain(items.map((d) => d.pillar))
      .range([0, innerH])
      .paddingInner(0.4);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6).tickSize(-innerH).tickFormat(() => ""))
      .select(".domain")
      .remove();

    items.forEach((d, idx) => {
      const gy = (y(d.pillar) ?? 0) + y.bandwidth() / 2;
      const color = PILLAR_PALETTE[idx % PILLAR_PALETTE.length];

      if (d.reached && d.t50 != null) {
        g.append("line")
          .attr("x1", 0)
          .attr("x2", x(d.t50))
          .attr("y1", gy)
          .attr("y2", gy)
          .attr("stroke", color)
          .attr("stroke-width", 2);
        g.append("circle")
          .attr("cx", x(d.t50))
          .attr("cy", gy)
          .attr("r", 7)
          .attr("fill", color)
          .attr("stroke", "var(--card)")
          .attr("stroke-width", 2);
        g.append("text")
          .attr("x", x(d.t50) + 14)
          .attr("y", gy + 4)
          .style("font-size", "11px")
          .style("font-family", "var(--font-mono)")
          .attr("fill", "var(--muted-foreground)")
          .text(`m${d.t50 + 1} · SS ${Math.round(d.ss)} · n=${d.n}`);
      } else {
        g.append("line")
          .attr("x1", 0)
          .attr("x2", x(xMax))
          .attr("y1", gy)
          .attr("y2", gy)
          .attr("stroke", "var(--muted-foreground)")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "2 3");
        g.append("circle")
          .attr("cx", x(xMax))
          .attr("cy", gy)
          .attr("r", 6)
          .attr("fill", "var(--card)")
          .attr("stroke", "var(--muted-foreground)")
          .attr("stroke-width", 1.5);
        g.append("text")
          .attr("x", x(xMax) + 14)
          .attr("y", gy + 4)
          .style("font-size", "11px")
          .style("font-style", "italic")
          .style("font-family", "var(--font-mono)")
          .attr("fill", "var(--muted-foreground)")
          .text(`not reached · SS ${Math.round(d.ss)} · n=${d.n}`);
      }

      g.append("text")
        .attr("x", -12)
        .attr("y", gy + 4)
        .attr("text-anchor", "end")
        .style("font-weight", "500")
        .style("font-size", "12px")
        .attr("fill", "var(--foreground)")
        .text(d.pillar);
    });

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(
        axisBottom(x)
          .ticks(6)
          .tickFormat((d) => `m${Number(d) + 1}`),
      )
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 40)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("tenure month to reach 50% of pillar steady state");
  }, [engineers, buckets, width]);

  return (
    <Frame
      title="C.3  Time to 50% of steady state, by pillar"
      caption="A horizontal lollipop chart showing how fast each pillar's ICs reach 50% of their pillar-specific steady state. We use 50% rather than 80% because cohort rolling medians don't always converge within our observation window."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}
