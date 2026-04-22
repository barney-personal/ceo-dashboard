"use client";

import { useEffect, useMemo, useRef } from "react";
import { select } from "d3-selection";
import { scaleLinear, scaleLog, scaleBand } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import type { ImpactEngineer } from "@/lib/data/engineering-impact";
import { computeRampUp, median } from "@/components/charts/impact/stats";
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

function formatCurrency(v: number): string {
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  if (v >= 100) return `$${Math.round(v)}`;
  return `$${v.toFixed(1)}`;
}

// ─── E.1 Spend vs impact quadrant scatter ────────────────────────────

/**
 * Scatter of AI spend (x) vs impact_90d (y), quadranted by both medians.
 *
 * Cairo (Functional Art): "the most useful charts force a question, not
 * just a comparison." Quadrant lines plus four labelled regions turn the
 * scatter into a decision aid — the four boxes correspond to four
 * coaching recommendations. Tufte's small-multiples logic doesn't apply
 * (we want a single canvas to compare against the medians), so we lean
 * on layered annotation instead.
 *
 * X-axis is log because AI spend is heavily right-skewed: many engineers
 * are at $0–$5, a long tail reaches >$1k. Linear would squash 90% of
 * the dots into the left 10%.
 */
export function AiSpendVsImpactScatter({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  // Only ICs with positive AI spend in the latest month — engineers
  // matched at $0 are interesting for E.3 (adoption) but here they'd
  // pile up at the log-scale floor (x = $1) and can't be coloured by
  // efficiency. Keeping the filter symmetric with the median below.
  const points = useMemo(
    () =>
      engineers.filter(
        (e) =>
          e.isMatched &&
          e.levelTrack === "IC" &&
          e.aiSpend != null &&
          e.aiSpend > 0 &&
          e.tenureMonthsNow >= 1,
      ),
    [engineers],
  );

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    if (points.length < 5) return;

    const margin = { top: 24, right: 24, bottom: 56, left: 64 };
    const height = 420;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // x scale: log, with $1 floor so $0 is plottable
    const xMin = 1;
    const xMax = Math.max(10, Math.max(...points.map((p) => p.aiSpend ?? 0)) * 1.1);
    const x = scaleLog().domain([xMin, xMax]).range([0, innerW]);
    const yMax = Math.max(10, Math.max(...points.map((p) => p.impact90d)) * 1.05);
    const y = scaleLinear().domain([0, yMax]).range([innerH, 0]);

    // `points` is already filtered to aiSpend > 0 — guard against the
    // empty case anyway so a degenerate dataset produces an invisible
    // crosshair (NaN) instead of a NaN-positioned line.
    const spendValues = points.map((p) => p.aiSpend!);
    const medSpend = spendValues.length ? median(spendValues) : xMin;
    const medImpact = points.length ? median(points.map((p) => p.impact90d)) : 0;

    // Quadrant background tint (very subtle so the dots remain primary)
    g.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", x(medSpend))
      .attr("height", y(medImpact))
      .attr("fill", "currentColor")
      .attr("color", "oklch(0.55 0.16 155)")
      .attr("opacity", 0.04);
    g.append("rect")
      .attr("x", x(medSpend))
      .attr("y", 0)
      .attr("width", innerW - x(medSpend))
      .attr("height", y(medImpact))
      .attr("fill", "currentColor")
      .attr("color", "oklch(0.55 0.16 155)")
      .attr("opacity", 0.04);

    // Grid
    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(
        axisBottom(x)
          .ticks(6)
          .tickSize(-innerH)
          .tickFormat(() => ""),
      )
      .select(".domain")
      .remove();

    // Median crosshair (Tufte-style reference lines)
    g.append("line")
      .attr("x1", x(medSpend))
      .attr("x2", x(medSpend))
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3")
      .attr("opacity", 0.35);
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", y(medImpact))
      .attr("y2", y(medImpact))
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3")
      .attr("opacity", 0.35);

    // Quadrant labels
    const labelStyle = "font-family:var(--font-mono);font-size:9px;opacity:0.5;letter-spacing:0.06em;text-transform:uppercase;";
    g.append("text")
      .attr("x", innerW - 4)
      .attr("y", 12)
      .attr("text-anchor", "end")
      .attr("style", labelStyle)
      .text("HIGH IMPACT · HIGH SPEND");
    g.append("text")
      .attr("x", 4)
      .attr("y", 12)
      .attr("text-anchor", "start")
      .attr("style", labelStyle)
      .text("HIGH IMPACT · LOW SPEND");
    g.append("text")
      .attr("x", innerW - 4)
      .attr("y", innerH - 6)
      .attr("text-anchor", "end")
      .attr("style", labelStyle)
      .text("LOW IMPACT · HIGH SPEND");
    g.append("text")
      .attr("x", 4)
      .attr("y", innerH - 6)
      .attr("text-anchor", "start")
      .attr("style", labelStyle)
      .text("LOW IMPACT · LOW SPEND");

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(
        axisBottom(x)
          .ticks(5, ".0s")
          .tickFormat((d) => formatCurrency(Number(d))),
      )
      .selectAll("text")
      .style("font-size", "10px")
      .style("color", "var(--muted-foreground)");
    g.append("g")
      .call(axisLeft(y).ticks(5))
      .selectAll("text")
      .style("font-size", "10px")
      .style("color", "var(--muted-foreground)");

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 36)
      .attr("text-anchor", "middle")
      .attr("style", "font-size:11px;color:var(--muted-foreground);")
      .text(`AI spend (${aiMonthLabel(points)} · log scale)`);
    g.append("text")
      .attr("transform", `translate(-44,${innerH / 2})rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("style", "font-size:11px;color:var(--muted-foreground);")
      .text("impact_90d");

    // Dots — coloured by discipline so the user can see if e.g. ML is
    // clustered top-right (heavy AI users with strong shipping cadence).
    g.append("g")
      .selectAll("circle")
      .data(points)
      .join("circle")
      .attr("cx", (d) => x(Math.max(d.aiSpend ?? 0, xMin)))
      .attr("cy", (d) => y(d.impact90d))
      .attr("r", 5)
      .attr("fill", (d) => DISC_COLOR[d.discipline] ?? DISC_COLOR.Other)
      .attr("stroke", "var(--card)")
      .attr("stroke-width", 1)
      .attr("opacity", 0.8)
      .style("cursor", "default")
      .on("mouseenter", (event, d) => {
        showTooltip(event, {
          title: d.name,
          subtitle: `${d.discipline} · ${d.levelLabel} · ${d.pillar}`,
          meta: `impact_90d ${d.impact90d}  ·  AI ${formatCurrency(d.aiSpend ?? 0)}`,
        });
      })
      .on("mousemove", (event) => moveTooltip(event))
      .on("mouseleave", () => hideTooltip());

    // Median value labels for the crosshair lines.
    g.append("text")
      .attr("x", x(medSpend) + 6)
      .attr("y", innerH - 4)
      .attr("style", "font-size:10px;font-weight:600;color:var(--foreground);")
      .text(`median spend: ${formatCurrency(medSpend)}`);
    g.append("text")
      .attr("x", innerW - 4)
      .attr("y", y(medImpact) - 6)
      .attr("text-anchor", "end")
      .attr("style", "font-size:10px;font-weight:600;color:var(--foreground);")
      .text(`median impact: ${Math.round(medImpact)}`);
  }, [points, width]);

  if (points.length < 5) {
    return (
      <ChartFrame
        title="E.1 — Spend vs impact"
        caption="Need at least 5 engineers with AI usage data."
      >
        <p className="py-8 text-center text-sm text-muted-foreground">
          Insufficient AI usage data — only{" "}
          {engineers.filter((e) => e.aiSpend != null).length} engineers
          have spend recorded for the latest month.
        </p>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="E.1 — AI spend vs impact_90d"
      caption="ICs with positive AI spend in the latest month, log-scaled x. Crosshairs are the medians of plotted dots; the four quadrants suggest different coaching responses (top-right = power user; top-left = shipping without AI; bottom-right = high spend, low yield → review prompt habits; bottom-left = potential AI onboarding opportunity). Engineers matched at $0 spend are not plotted here — see E.3 for adoption rates."
    >
      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} role="img" />
      </div>
    </ChartFrame>
  );
}

function aiMonthLabel(points: ImpactEngineer[]): string {
  const m = points.find((p) => p.aiMonthStart)?.aiMonthStart;
  if (!m) return "latest month";
  const d = new Date(`${m}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

// ─── E.2 Ramp-up split by AI usage tier ──────────────────────────────

/**
 * Replays the Section B ramp-up curve, split into three cohorts based
 * on the engineer's latest-month AI spend: heavy / light / none.
 *
 * Hypothesis (the chart will confirm or refute): AI-heavy users reach
 * steady-state impact in fewer tenure months. If so, that's evidence
 * for AI as a ramp-up accelerator. If the curves overlap, AI usage is
 * uncorrelated with output cadence (which is also useful to know — it
 * argues against treating AI spend as a productivity signal).
 *
 * Buckets:
 *  - Heavy: aiSpend > tier-3 threshold (top tertile of users with data)
 *  - Light: 0 < aiSpend <= tier-3 threshold
 *  - None: aiSpend == null OR aiSpend == 0
 */
export function RampUpByAiUsage({
  engineers,
  buckets,
}: {
  engineers: ImpactEngineer[];
  buckets: import("@/lib/data/engineering-impact").ImpactTenureBucket[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  const tierByEmail = useMemo(() => {
    const withSpend = engineers
      .filter((e) => (e.aiSpend ?? 0) > 0)
      .map((e) => e.aiSpend!)
      .sort((a, b) => a - b);
    const tier3 =
      withSpend.length === 0
        ? 0
        : withSpend[Math.floor((withSpend.length * 2) / 3)];
    const map = new Map<string, "heavy" | "light" | "none">();
    for (const e of engineers) {
      if (!e.isMatched || e.levelTrack !== "IC") continue;
      const v = e.aiSpend;
      if (v == null || v === 0) map.set(e.email, "none");
      else if (v >= tier3) map.set(e.email, "heavy");
      else map.set(e.email, "light");
    }
    return { map, tier3 };
  }, [engineers]);

  const cohorts = useMemo(() => {
    const byEmail = new Map(engineers.map((e) => [e.email, e]));
    const make = (tier: "heavy" | "light" | "none") =>
      computeRampUp(buckets, byEmail, (e) => tierByEmail.map.get(e.email) === tier, {
        maxMonth: 24,
      });
    return {
      heavy: make("heavy"),
      light: make("light"),
      none: make("none"),
    };
  }, [engineers, buckets, tierByEmail]);

  const counts = useMemo(() => {
    let h = 0,
      l = 0,
      n = 0;
    for (const v of tierByEmail.map.values()) {
      if (v === "heavy") h++;
      else if (v === "light") l++;
      else n++;
    }
    return { heavy: h, light: l, none: n };
  }, [tierByEmail]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const allRows = [
      ...cohorts.heavy,
      ...cohorts.light,
      ...cohorts.none,
    ].filter((r) => r.p50 != null);
    if (allRows.length < 6) return;

    const margin = { top: 24, right: 100, bottom: 56, left: 56 };
    const height = 360;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    svg.attr("width", width).attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleLinear().domain([0, 24]).range([0, innerW]);
    const yMax =
      Math.max(...allRows.map((r) => r.p50 ?? 0)) * 1.1;
    const y = scaleLinear().domain([0, yMax]).range([innerH, 0]);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(
        axisBottom(x).ticks(8).tickSize(-innerH).tickFormat(() => ""),
      )
      .select(".domain")
      .remove();

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(axisBottom(x).ticks(8))
      .selectAll("text")
      .style("font-size", "10px")
      .style("color", "var(--muted-foreground)");
    g.append("g")
      .call(axisLeft(y).ticks(5))
      .selectAll("text")
      .style("font-size", "10px")
      .style("color", "var(--muted-foreground)");

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 36)
      .attr("text-anchor", "middle")
      .attr("style", "font-size:11px;color:var(--muted-foreground);")
      .text("Tenure (months)");
    g.append("text")
      .attr("transform", `translate(-40,${innerH / 2})rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("style", "font-size:11px;color:var(--muted-foreground);")
      .text("Median impact_90d");

    const tiers = [
      { key: "heavy", color: "oklch(0.42 0.17 265)", label: `Heavy AI (${counts.heavy})` },
      { key: "light", color: "oklch(0.55 0.15 200)", label: `Light AI (${counts.light})` },
      { key: "none", color: "oklch(0.55 0.005 75)", label: `No AI / unmatched (${counts.none})` },
    ] as const;

    for (const tier of tiers) {
      const rows = cohorts[tier.key].filter((r) => r.p50 != null);
      if (rows.length < 2) continue;
      const path = rows
        .map((r, i) => `${i === 0 ? "M" : "L"}${x(r.month)},${y(r.p50!)}`)
        .join(" ");
      g.append("path")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", tier.color)
        .attr("stroke-width", 2);

      // last-point label, direct labelling per Tufte
      const last = rows[rows.length - 1];
      g.append("circle")
        .attr("cx", x(last.month))
        .attr("cy", y(last.p50!))
        .attr("r", 3)
        .attr("fill", tier.color);
      g.append("text")
        .attr("x", x(last.month) + 8)
        .attr("y", y(last.p50!) + 3)
        .attr("style", `font-size:10px;font-weight:600;fill:${tier.color};`)
        .text(tier.label);
    }
  }, [cohorts, counts, width]);

  return (
    <ChartFrame
      title="E.2 — Ramp-up by AI usage tier"
      caption={`Median impact_90d at each tenure month, split by latest-month AI spend. Heavy = top tertile (≥${formatCurrency(tierByEmail.tier3)}/mo). The closer the heavy and light curves stay together, the less AI usage explains shipping cadence; if heavy is consistently above, AI spend correlates with output (causation still requires controlling for level + role).`}
    >
      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} role="img" />
      </div>
    </ChartFrame>
  );
}

// ─── E.3 AI adoption rate by tenure cohort ───────────────────────────

/**
 * Bar chart: % of engineers in each tenure bucket who have any AI usage
 * recorded for the latest month. Surfaces "old guard skipping AI" and
 * "AI as great equaliser" patterns.
 */
export function AiAdoptionByTenure({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  const cohorts = useMemo(() => {
    const tenureBuckets: Array<{
      label: string;
      min: number;
      max: number;
    }> = [
      { label: "0–3 mo", min: 0, max: 3 },
      { label: "3–6 mo", min: 3, max: 6 },
      { label: "6–12 mo", min: 6, max: 12 },
      { label: "1–2 yr", min: 12, max: 24 },
      { label: "2–4 yr", min: 24, max: 48 },
      { label: "4 yr+", min: 48, max: 600 },
    ];
    const ics = engineers.filter(
      (e) => e.isMatched && e.levelTrack === "IC",
    );
    return tenureBuckets.map((b) => {
      const cohort = ics.filter(
        (e) => e.tenureMonthsNow >= b.min && e.tenureMonthsNow < b.max,
      );
      const adopters = cohort.filter((e) => (e.aiSpend ?? 0) > 0).length;
      return {
        label: b.label,
        n: cohort.length,
        adopters,
        rate: cohort.length === 0 ? 0 : adopters / cohort.length,
      };
    });
  }, [engineers]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    if (cohorts.every((c) => c.n === 0)) return;

    const margin = { top: 16, right: 24, bottom: 64, left: 56 };
    const height = 280;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleBand<string>()
      .domain(cohorts.map((c) => c.label))
      .range([0, innerW])
      .padding(0.25);
    const y = scaleLinear().domain([0, 1]).range([innerH, 0]);

    g.append("g")
      .attr("color", "var(--border)")
      .call(
        axisLeft(y)
          .ticks(5)
          .tickSize(-innerW)
          .tickFormat(() => ""),
      )
      .select(".domain")
      .remove();

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(axisBottom(x))
      .selectAll("text")
      .style("font-size", "10px")
      .style("color", "var(--muted-foreground)");
    g.append("g")
      .call(axisLeft(y).ticks(5).tickFormat((d) => `${Number(d) * 100}%`))
      .selectAll("text")
      .style("font-size", "10px")
      .style("color", "var(--muted-foreground)");

    // Cohort bars (low-n are hatched per the page convention)
    const defs = svg.append("defs");
    const pattern = defs
      .append("pattern")
      .attr("id", "hatch-low-n")
      .attr("width", 6)
      .attr("height", 6)
      .attr("patternUnits", "userSpaceOnUse");
    pattern
      .append("path")
      .attr("d", "M 0 6 L 6 0")
      .attr("stroke", "var(--muted-foreground)")
      .attr("stroke-width", 1)
      .attr("opacity", 0.4);

    const bars = g
      .append("g")
      .selectAll("g")
      .data(cohorts)
      .join("g")
      .attr("transform", (d) => `translate(${x(d.label)},0)`);

    bars
      .append("rect")
      .attr("y", (d) => y(d.rate))
      .attr("width", x.bandwidth())
      .attr("height", (d) => innerH - y(d.rate))
      .attr("fill", (d) =>
        d.n < 5 ? "url(#hatch-low-n)" : "oklch(0.42 0.17 265)",
      )
      .attr("opacity", 0.85);

    // Value labels
    bars
      .append("text")
      .attr("x", x.bandwidth() / 2)
      .attr("y", (d) => y(d.rate) - 4)
      .attr("text-anchor", "middle")
      .attr("style", "font-size:10px;font-weight:600;fill:var(--foreground);")
      .text((d) => (d.n === 0 ? "" : `${Math.round(d.rate * 100)}%`));

    // n labels under x-axis
    bars
      .append("text")
      .attr("x", x.bandwidth() / 2)
      .attr("y", innerH + 28)
      .attr("text-anchor", "middle")
      .attr("style", "font-size:9px;color:var(--muted-foreground);font-family:var(--font-mono);")
      .text((d) => `n=${d.n}`);

    // Company-wide adoption reference line
    const overall =
      cohorts.reduce((sum, c) => sum + c.adopters, 0) /
      Math.max(
        1,
        cohorts.reduce((sum, c) => sum + c.n, 0),
      );
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", y(overall))
      .attr("y2", y(overall))
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3")
      .attr("opacity", 0.45);
    g.append("text")
      .attr("x", innerW - 6)
      .attr("y", y(overall) - 4)
      .attr("text-anchor", "end")
      .attr("style", "font-size:10px;font-weight:600;color:var(--foreground);")
      .text(`overall: ${Math.round(overall * 100)}%`);
  }, [cohorts, width]);

  return (
    <ChartFrame
      title="E.3 — AI adoption rate by tenure cohort"
      caption="% of ICs in each tenure cohort with any AI usage in the latest month. Bars below the dashed line are under-adopting compared to the company average. Hatched bars = n < 5 (low confidence)."
    >
      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} role="img" />
      </div>
    </ChartFrame>
  );
}
