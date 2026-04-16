"use client";

import { useEffect, useRef } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import { line as d3Line, area as d3Area, curveMonotoneX } from "d3-shape";
import { max as d3Max } from "d3-array";
import type {
  ImpactEngineer,
  ImpactTenureBucket,
} from "@/lib/data/engineering-impact";
import {
  computeRampUp,
  steadyStateFromEngineers,
  timeToTarget,
  percentile,
} from "@/components/charts/impact/stats";
import {
  DISC_COLOR,
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

const RAMP_COLOR = "oklch(0.55 0.18 25)"; // warm red accent
const BAND_COLOR = "oklch(0.55 0.18 25 / 0.18)";

// ─── B.1 Main ramp-up curve ──────────────────────────────────────────

export function RampUpMain({
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
    const MAX_MONTH = 18;
    const rows = computeRampUp(
      buckets,
      byEmail,
      (e) => e.levelTrack === "IC",
      { maxMonth: MAX_MONTH },
    );
    const ssInfo = steadyStateFromEngineers(
      engineers,
      (e) => e.levelTrack === "IC",
      18,
    );
    const ss = ssInfo?.value ?? null;
    const t80 = ss != null ? timeToTarget(rows, ss * 0.8) : null;

    const height = 420;
    const margin = { top: 28, right: 120, bottom: 76, left: 56 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleLinear().domain([0, MAX_MONTH]).range([0, innerW]);
    const yMax =
      (d3Max(
        rows.filter((r) => r.n),
        (r) => r.p75 ?? 0,
      ) ?? 0) * 1.1;
    const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(() => ""))
      .select(".domain")
      .remove();

    if (ss != null) {
      g.append("line")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", y(ss))
        .attr("y2", y(ss))
        .attr("stroke", "var(--foreground)")
        .attr("stroke-dasharray", "4 3");
      g.append("text")
        .attr("x", innerW + 8)
        .attr("y", y(ss) + 4)
        .style("font-family", "var(--font-display)")
        .style("font-style", "italic")
        .style("font-size", "12px")
        .attr("fill", "var(--foreground)")
        .text(`SS ${Math.round(ss)}`);
      g.append("text")
        .attr("x", innerW + 8)
        .attr("y", y(ss) + 16)
        .style("font-size", "10px")
        .attr("fill", "var(--muted-foreground)")
        .text(`n=${ssInfo?.n}`);

      g.append("line")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", y(ss * 0.8))
        .attr("y2", y(ss * 0.8))
        .attr("stroke", "var(--muted-foreground)")
        .attr("stroke-dasharray", "3 3")
        .attr("opacity", 0.6);
      g.append("text")
        .attr("x", innerW + 8)
        .attr("y", y(ss * 0.8) + 4)
        .style("font-size", "10px")
        .attr("fill", "var(--muted-foreground)")
        .text(`80% (${Math.round(ss * 0.8)})`);
    }

    const data = rows.filter((r) => r.n >= 3);

    const area = d3Area<(typeof data)[number]>()
      .x((d) => x(d.month))
      .y0((d) => y(d.p25 ?? 0))
      .y1((d) => y(d.p75 ?? 0))
      .curve(curveMonotoneX);
    g.append("path")
      .datum(data)
      .attr("fill", BAND_COLOR)
      .attr("d", area as unknown as string);

    const line = d3Line<(typeof data)[number]>()
      .x((d) => x(d.month))
      .y((d) => y(d.p50 ?? 0))
      .curve(curveMonotoneX);
    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", RAMP_COLOR)
      .attr("stroke-width", 2.4)
      .attr("d", line as unknown as string);

    g.append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", (d) => x(d.month))
      .attr("cy", (d) => y(d.p50 ?? 0))
      .attr("r", 3)
      .attr("fill", RAMP_COLOR)
      .attr("stroke", "var(--card)")
      .on("mouseenter", (event: MouseEvent, d) =>
        showTooltip(event, {
          title: `Tenure month ${d.month + 1}`,
          subtitle: `median impact ${Math.round(d.p50 ?? 0)}`,
          meta: `IQR ${Math.round(d.p25 ?? 0)}–${Math.round(d.p75 ?? 0)} · n=${d.n}`,
        }),
      )
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);

    if (t80 != null && ss != null) {
      g.append("line")
        .attr("x1", x(t80))
        .attr("x2", x(t80))
        .attr("y1", y(ss * 0.8))
        .attr("y2", innerH)
        .attr("stroke", "var(--foreground)")
        .attr("stroke-dasharray", "2 2");
      g.append("circle")
        .attr("cx", x(t80))
        .attr("cy", y(ss * 0.8))
        .attr("r", 5)
        .attr("fill", "var(--foreground)")
        .attr("stroke", "var(--card)")
        .attr("stroke-width", 2);
      g.append("text")
        .attr("x", x(t80) + 10)
        .attr("y", y(ss * 0.8) - 10)
        .style("font-family", "var(--font-display)")
        .style("font-style", "italic")
        .style("font-size", "12px")
        .attr("fill", RAMP_COLOR)
        .text(`80% of SS reached at month ${t80 + 1}`);
    }

    // n row beneath axis
    const nY = innerH + 32;
    g.append("g")
      .selectAll("text")
      .data(rows.filter((r) => r.n))
      .join("text")
      .attr("x", (d) => x(d.month))
      .attr("y", nY)
      .attr("text-anchor", "middle")
      .style("font-family", "var(--font-mono)")
      .style("font-size", "9px")
      .attr("fill", "var(--muted-foreground)")
      .text((d) => d.n);
    g.append("text")
      .attr("x", -8)
      .attr("y", nY)
      .attr("text-anchor", "end")
      .style("font-size", "10px")
      .attr("fill", "var(--muted-foreground)")
      .text("n");

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(
        axisBottom(x)
          .ticks(9)
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
      .attr("y", innerH + 54)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("tenure month");
  }, [engineers, buckets, width]);

  return (
    <Frame
      title="B.1  The ramp-up curve (IC engineers)"
      caption="Each point is the median 90-day rolling impact across engineers at that tenure month — each contributes their preceding 90 days' impact. Band is 25–75th percentile. Dashed line is the steady-state median (impact_90d of ICs with tenure ≥ 18 months)."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}

// ─── B.2 Spaghetti plot ──────────────────────────────────────────────

export function RampUpSpaghetti({
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
    const traj = new Map<
      string,
      { month: number; impact: number }[]
    >();
    for (const b of buckets) {
      if (!b.inWindow) continue;
      const e = byEmail.get(b.email);
      if (!e || e.levelTrack !== "IC") continue;
      const bucket = traj.get(b.email) ?? [];
      bucket.push({ month: b.tenureMonth, impact: b.impact });
      traj.set(b.email, bucket);
    }
    const trajArr = [...traj.entries()]
      .filter(([, pts]) => pts.length >= 3)
      .map(([email, pts]) => {
        const e = byEmail.get(email)!;
        return {
          email,
          name: e.name,
          discipline: e.discipline,
          tenureNow: e.tenureMonthsNow,
          pts: pts
            .sort((a, b) => a.month - b.month)
            .filter((p) => p.month <= 18),
        };
      })
      .filter((t) => t.pts.length >= 3);

    const height = 420;
    const margin = { top: 28, right: 40, bottom: 60, left: 56 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const allImpacts = trajArr.flatMap((t) => t.pts.map((p) => p.impact));
    const yMax = percentile(allImpacts, 0.98);

    const x = scaleLinear().domain([0, 18]).range([0, innerW]);
    const y = scaleLinear().domain([0, yMax * 1.05]).nice().range([innerH, 0]);

    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(() => ""))
      .select(".domain")
      .remove();

    const line = d3Line<{ month: number; impact: number }>()
      .x((d) => x(d.month))
      .y((d) => y(Math.min(d.impact, yMax * 1.05)))
      .curve(curveMonotoneX);

    g.append("g")
      .selectAll("path.old")
      .data(trajArr.filter((t) => t.tenureNow >= 12))
      .join("path")
      .attr("fill", "none")
      .attr("stroke", "var(--muted-foreground)")
      .attr("stroke-width", 0.6)
      .attr("stroke-opacity", 0.22)
      .attr("d", (t) => line(t.pts));

    g.append("g")
      .selectAll("path.new")
      .data(trajArr.filter((t) => t.tenureNow < 12))
      .join("path")
      .attr("fill", "none")
      .attr("stroke", (t) => DISC_COLOR[t.discipline] ?? DISC_COLOR.Other)
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.7)
      .attr("d", (t) => line(t.pts))
      .style("cursor", "pointer")
      .on("mouseenter", function (event: MouseEvent, t) {
        select(this).attr("stroke-width", 2.5).attr("stroke-opacity", 1);
        showTooltip(event, {
          title: t.name,
          subtitle: `${t.discipline} · tenure ${t.tenureNow}mo`,
          meta: `${t.pts.length} months observed`,
        });
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", function () {
        select(this).attr("stroke-width", 1.2).attr("stroke-opacity", 0.7);
        hideTooltip();
      });

    const rows = computeRampUp(
      buckets,
      byEmail,
      (e) => e.levelTrack === "IC",
      { maxMonth: 18 },
    );
    const medData = rows.filter((r) => r.n >= 3);
    g.append("path")
      .datum(medData)
      .attr("fill", "none")
      .attr("stroke", "var(--foreground)")
      .attr("stroke-width", 2.6)
      .attr(
        "d",
        (d3Line<(typeof medData)[number]>()
          .x((d) => x(d.month))
          .y((d) => y(d.p50 ?? 0))
          .curve(curveMonotoneX))(medData) as string,
      );

    g.append("text")
      .attr("x", innerW)
      .attr("y", -8)
      .attr("text-anchor", "end")
      .style("font-family", "var(--font-display)")
      .style("font-style", "italic")
      .style("font-size", "11px")
      .attr("fill", RAMP_COLOR)
      .text("bold = cohort median · colour = new hire");

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(
        axisBottom(x)
          .ticks(9)
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
      .attr("y", innerH + 42)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("tenure month");
  }, [engineers, buckets, width]);

  return (
    <Frame
      title="B.2  Individual trajectories"
      caption="A spaghetti plot. Each thin line is one engineer's trajectory. New hires (< 12 months) are coloured; longer-tenured engineers in grey. Bold line is the cohort median."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}

// ─── B.3 Ramp-up by discipline (BE vs FE side by side) ───────────────

export function RampUpByDiscipline({
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
    const disciplines = ["BE", "FE"] as const;
    const results = disciplines.map((disc) => {
      const rows = computeRampUp(
        buckets,
        byEmail,
        (e) => e.levelTrack === "IC" && e.discipline === disc,
        { maxMonth: 18 },
      );
      const ssInfo = steadyStateFromEngineers(
        engineers,
        (e) => e.levelTrack === "IC" && e.discipline === disc,
        18,
      );
      const ss = ssInfo?.value ?? null;
      const t80 = ss != null ? timeToTarget(rows, ss * 0.8) : null;
      return { disc, rows, ss, ssN: ssInfo?.n ?? 0, t80 };
    });

    const height = 340;
    const gap = 24;
    const panelW = (width - gap) / 2;
    const margin = { top: 24, right: 16, bottom: 60, left: 52 };

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const yMax =
      (d3Max(
        results.flatMap((r) => r.rows.filter((x) => x.n).map((x) => x.p75 ?? 0)),
      ) ?? 0) * 1.1;

    results.forEach((res, idx) => {
      const gx = idx * (panelW + gap) + margin.left;
      const g = svg
        .append("g")
        .attr("transform", `translate(${gx},${margin.top})`);
      const innerW = panelW - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;

      const x = scaleLinear().domain([0, 18]).range([0, innerW]);
      const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

      g.append("g")
        .attr("color", "var(--border)")
        .call(axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(() => ""))
        .select(".domain")
        .remove();

      if (res.ss != null) {
        g.append("line")
          .attr("x1", 0)
          .attr("x2", innerW)
          .attr("y1", y(res.ss))
          .attr("y2", y(res.ss))
          .attr("stroke", "var(--foreground)")
          .attr("stroke-dasharray", "4 3");
        g.append("text")
          .attr("x", innerW - 4)
          .attr("y", y(res.ss) - 4)
          .attr("text-anchor", "end")
          .style("font-size", "11px")
          .style("font-family", "var(--font-display)")
          .style("font-style", "italic")
          .attr("fill", "var(--foreground)")
          .text(`SS ${Math.round(res.ss)}`);
      }

      const data = res.rows.filter((r) => r.n >= 3);
      const color = DISC_COLOR[res.disc];

      g.append("path")
        .datum(data)
        .attr("fill", color)
        .attr("fill-opacity", 0.15)
        .attr(
          "d",
          (d3Area<(typeof data)[number]>()
            .x((d) => x(d.month))
            .y0((d) => y(d.p25 ?? 0))
            .y1((d) => y(d.p75 ?? 0))
            .curve(curveMonotoneX))(data) as string,
        );
      g.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 2.4)
        .attr(
          "d",
          (d3Line<(typeof data)[number]>()
            .x((d) => x(d.month))
            .y((d) => y(d.p50 ?? 0))
            .curve(curveMonotoneX))(data) as string,
        );

      g.append("text")
        .attr("x", 0)
        .attr("y", -6)
        .style("font-weight", "600")
        .style("font-size", "13px")
        .attr("fill", color)
        .text(res.disc === "BE" ? "Backend" : "Frontend");

      if (res.t80 != null) {
        g.append("text")
          .attr("x", 0)
          .attr("y", innerH + 30)
          .style("font-family", "var(--font-display)")
          .style("font-style", "italic")
          .style("font-size", "11px")
          .attr("fill", color)
          .text(`80% of SS at month ${res.t80 + 1}`);
      }

      g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .attr("color", "var(--border)")
        .call(
          axisBottom(x)
            .ticks(6)
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
    });
  }, [engineers, buckets, width]);

  return (
    <Frame
      title="B.3  Ramp-up by discipline"
      caption="Same methodology as B.1 faceted by BE vs FE. Shared y-axis makes the comparison honest; identical x-axis makes the shapes directly overlayable."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}

// ─── B.4 Ramp-up by level (small multiples) ──────────────────────────

export function RampUpByLevel({
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
    const levels = [2, 3, 4, 5, 6].filter((lvl) =>
      engineers.some(
        (e) =>
          e.isMatched && e.levelTrack === "IC" && e.levelNum === lvl,
      ),
    );
    const panels = levels.map((lvl) => {
      const rows = computeRampUp(
        buckets,
        byEmail,
        (e) => e.levelTrack === "IC" && e.levelNum === lvl,
        { maxMonth: 18 },
      );
      const ssInfo = steadyStateFromEngineers(
        engineers,
        (e) => e.levelTrack === "IC" && e.levelNum === lvl,
        18,
      );
      return {
        lvl,
        rows,
        ss: ssInfo?.value ?? null,
        ssN: ssInfo?.n ?? 0,
        n: engineers.filter(
          (e) =>
            e.isMatched && e.levelTrack === "IC" && e.levelNum === lvl,
        ).length,
      };
    });

    const cols = Math.min(3, panels.length);
    const rowsN = Math.ceil(panels.length / cols);
    const panelW = width / cols;
    const panelH = 220;
    const height = panelH * rowsN + 32;
    const margin = { top: 26, right: 16, bottom: 36, left: 42 };

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const yMax =
      (d3Max(
        panels.flatMap((p) => p.rows.filter((r) => r.n).map((r) => r.p75 ?? 0)),
      ) ?? 0) * 1.05;

    panels.forEach((p, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const gx = col * panelW;
      const gy = row * panelH;
      const g = svg
        .append("g")
        .attr(
          "transform",
          `translate(${gx + margin.left},${gy + margin.top})`,
        );
      const innerW = panelW - margin.left - margin.right;
      const innerH = panelH - margin.top - margin.bottom;

      const x = scaleLinear().domain([0, 18]).range([0, innerW]);
      const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

      g.append("g")
        .attr("color", "var(--border)")
        .call(axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(() => ""))
        .select(".domain")
        .remove();

      if (p.ss != null) {
        g.append("line")
          .attr("x1", 0)
          .attr("x2", innerW)
          .attr("y1", y(p.ss))
          .attr("y2", y(p.ss))
          .attr("stroke", "var(--foreground)")
          .attr("stroke-dasharray", "4 3");
      }

      const data = p.rows.filter((r) => r.n >= 3);
      const color = "oklch(0.68 0.15 70)"; // gold
      g.append("path")
        .datum(data)
        .attr("fill", color)
        .attr("fill-opacity", 0.2)
        .attr(
          "d",
          (d3Area<(typeof data)[number]>()
            .x((d) => x(d.month))
            .y0((d) => y(d.p25 ?? 0))
            .y1((d) => y(d.p75 ?? 0))
            .curve(curveMonotoneX))(data) as string,
        );
      g.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr(
          "d",
          (d3Line<(typeof data)[number]>()
            .x((d) => x(d.month))
            .y((d) => y(d.p50 ?? 0))
            .curve(curveMonotoneX))(data) as string,
        );

      g.append("text")
        .attr("x", 0)
        .attr("y", -10)
        .style("font-weight", "600")
        .style("font-size", "13px")
        .attr("fill", "var(--foreground)")
        .text(`Level ${p.lvl}`);
      g.append("text")
        .attr("x", innerW)
        .attr("y", -10)
        .attr("text-anchor", "end")
        .style("font-size", "10px")
        .attr("fill", "var(--muted-foreground)")
        .text(
          p.ss != null
            ? `n=${p.n} · SS≈${Math.round(p.ss)}`
            : `n=${p.n} · low data`,
        );

      g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .attr("color", "var(--border)")
        .call(
          axisBottom(x)
            .ticks(5)
            .tickFormat((d) => (d === 0 ? "0" : `m${Number(d) + 1}`)),
        )
        .call((s) =>
          s.selectAll("text").attr("fill", "var(--muted-foreground)"),
        );
      if (col === 0) {
        g.append("g")
          .attr("color", "var(--border)")
          .call(axisLeft(y).ticks(4))
          .call((s) =>
            s.selectAll("text").attr("fill", "var(--muted-foreground)"),
          );
      }
    });
  }, [engineers, buckets, width]);

  return (
    <Frame
      title="B.4  Ramp-up by level"
      caption="Small multiples, one panel per level, ordered by seniority. Small multiples (Tufte, 1983) let us compare distributions with single eye-movements instead of legend lookups."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}
