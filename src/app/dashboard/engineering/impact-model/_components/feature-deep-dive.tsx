"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { line as d3Line } from "d3-shape";
import { min as d3Min, max as d3Max } from "d3-array";
import type {
  ImpactPartialDependence,
  ImpactCategoricalEffect,
} from "@/lib/data/impact-model";
import { getContentBoxWidth } from "@/components/charts/chart-utils";

const GROUP_COLOR: Record<string, string> = {
  Tenure: "#7a5a3e",
  "Slack engagement": "#3f7ca0",
  "AI usage": "#c4673f",
  "Performance review": "#6a8b4c",
  "Code style": "#2d6a5c",
  Pillar: "#8b5a9c",
  Discipline: "#9c5d2e",
  Level: "#4a6b7c",
  Other: "#8e8680",
};

interface PdpPlotProps {
  pdp: ImpactPartialDependence;
  baseline: number;
}

function describeShape(pdp: ImpactPartialDependence): string {
  const { grid, pdp_mean, actual_median } = pdp;
  const start = pdp_mean[0];
  const end = pdp_mean[pdp_mean.length - 1];
  const peak = Math.max(...pdp_mean);
  const trough = Math.min(...pdp_mean);
  const peakIdx = pdp_mean.indexOf(peak);
  const troughIdx = pdp_mean.indexOf(trough);
  const spread = peak - trough;
  const mid = (peak + trough) / 2;
  const direction = end > start ? "up" : end < start ? "down" : "flat";
  const monotonic =
    pdp_mean.every((v, i) => i === 0 || v >= pdp_mean[i - 1] - 1) ||
    pdp_mean.every((v, i) => i === 0 || v <= pdp_mean[i - 1] + 1);

  const lowLabel = Math.round(grid[0]);
  const highLabel = Math.round(grid[grid.length - 1]);
  const medLabel = Math.round(actual_median);

  if (direction === "up" && monotonic) {
    return `Higher ${pdp.label.toLowerCase()} → higher predicted impact. As ${pdp.label.toLowerCase()} goes from ${lowLabel} to ${highLabel}, predicted impact rises from ~${Math.round(start).toLocaleString()} to ~${Math.round(end).toLocaleString()}. The median engineer sits at ${medLabel}.`;
  }
  if (direction === "down" && monotonic) {
    return `Higher ${pdp.label.toLowerCase()} → lower predicted impact. As ${pdp.label.toLowerCase()} goes from ${lowLabel} to ${highLabel}, predicted impact falls from ~${Math.round(start).toLocaleString()} to ~${Math.round(end).toLocaleString()}.`;
  }
  // Non-monotonic: describe the shape
  const peakVal = Math.round(grid[peakIdx]);
  const troughVal = Math.round(grid[troughIdx]);
  if (peakIdx > 2 && peakIdx < pdp_mean.length - 3 && peak > mid) {
    return `Non-monotonic — impact peaks around ${pdp.label.toLowerCase()} = ${peakVal} (predicted ~${Math.round(peak).toLocaleString()}), then tapers off. Neither very low nor very high values are optimal.`;
  }
  if (spread < 50) {
    return `Mostly flat — changing ${pdp.label.toLowerCase()} only moves the prediction by ~${Math.round(spread)} points. The model relies on other signals instead.`;
  }
  return `Shape is complex. Across the 5–95 percentile range (${lowLabel} to ${highLabel}), predicted impact varies between ~${Math.round(trough).toLocaleString()} and ~${Math.round(peak).toLocaleString()}, with the biggest change near ${peakVal}.`;
}

function PdpPlot({ pdp, baseline }: PdpPlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 220;
    const margin = { top: 12, right: 16, bottom: 32, left: 52 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const allVals = [
      ...pdp.pdp_mean,
      ...pdp.ice_sample.flat(),
      baseline,
    ];
    const yMin = d3Min(allVals) ?? 0;
    const yMax = d3Max(allVals) ?? 1;
    const yDomain: [number, number] = [
      Math.max(0, yMin - (yMax - yMin) * 0.1),
      yMax + (yMax - yMin) * 0.1,
    ];
    const x = scaleLinear()
      .domain([pdp.grid[0], pdp.grid[pdp.grid.length - 1]])
      .range([0, innerW]);
    const y = scaleLinear().domain(yDomain).range([innerH, 0]);

    // Gridlines
    y.ticks(4).forEach((t) => {
      g.append("line")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", y(t))
        .attr("y2", y(t))
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.07);
      g.append("text")
        .attr("x", -6)
        .attr("y", y(t))
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 9)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.55)
        .text(Math.round(t).toLocaleString());
    });

    // Baseline (expected) line
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", y(baseline))
      .attr("y2", y(baseline))
      .attr("stroke", "#c4976b")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-dasharray", "3 3")
      .attr("stroke-width", 1);
    g.append("text")
      .attr("x", innerW - 2)
      .attr("y", y(baseline) - 4)
      .attr("text-anchor", "end")
      .attr("font-size", 9)
      .attr("fill", "#9c5d2e")
      .attr("fill-opacity", 0.75)
      .text(`baseline ${Math.round(baseline)}`);

    // ICE (per-engineer) lines — light, translucent
    const lineGen = d3Line<number>()
      .x((_, i) => x(pdp.grid[i]))
      .y((v) => y(v));
    pdp.ice_sample.forEach((series) => {
      g.append("path")
        .datum(series)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", GROUP_COLOR[pdp.group] ?? "#9c5d2e")
        .attr("stroke-opacity", 0.08)
        .attr("stroke-width", 1);
    });

    // PDP mean line — bold
    g.append("path")
      .datum(pdp.pdp_mean)
      .attr("d", lineGen)
      .attr("fill", "none")
      .attr("stroke", GROUP_COLOR[pdp.group] ?? "#9c5d2e")
      .attr("stroke-width", 2.5);

    // Median marker
    g.append("line")
      .attr("x1", x(pdp.actual_median))
      .attr("x2", x(pdp.actual_median))
      .attr("y1", innerH)
      .attr("y2", innerH - 6)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 2);
    g.append("text")
      .attr("x", x(pdp.actual_median))
      .attr("y", innerH + 22)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("font-family", "var(--font-mono, ui-monospace)")
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.5)
      .text(`median ${Math.round(pdp.actual_median)}`);

    // X axis
    const xTicks = x.ticks(5);
    xTicks.forEach((t) => {
      g.append("text")
        .attr("x", x(t))
        .attr("y", innerH + 14)
        .attr("text-anchor", "middle")
        .attr("font-size", 9)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.55)
        .text(Math.round(t).toLocaleString());
    });
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", innerH)
      .attr("y2", innerH)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.25);
  }, [pdp, baseline]);

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

interface CatProps {
  effect: ImpactCategoricalEffect;
}

function CategoricalEffectBars({ effect }: CatProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;
    const cats = effect.categories;
    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const barHeight = 28;
    const margin = { top: 8, right: 70, bottom: 8, left: 140 };
    const innerW = width - margin.left - margin.right;
    const height = cats.length * barHeight + margin.top + margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const maxPred =
      d3Max([effect.baseline, ...cats.map((c) => c.mean_predicted)]) ?? 1;
    const x = scaleLinear().domain([0, maxPred * 1.05]).range([0, innerW]);

    // Baseline vertical
    g.append("line")
      .attr("x1", x(effect.baseline))
      .attr("x2", x(effect.baseline))
      .attr("y1", -2)
      .attr("y2", cats.length * barHeight)
      .attr("stroke", "#c4976b")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-dasharray", "3 3");
    g.append("text")
      .attr("x", x(effect.baseline))
      .attr("y", cats.length * barHeight + 2)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("fill", "#9c5d2e")
      .attr("fill-opacity", 0.8)
      .text(`baseline ${Math.round(effect.baseline)}`);

    cats.forEach((c, i) => {
      const y = i * barHeight;
      const color =
        c.mean_predicted >= effect.baseline ? "#6a8b4c" : "#b8472a";
      g.append("rect")
        .attr("x", 0)
        .attr("y", y + 4)
        .attr("width", x(c.mean_predicted))
        .attr("height", 14)
        .attr("fill", color)
        .attr("fill-opacity", 0.75)
        .attr("rx", 2);
      g.append("text")
        .attr("x", -10)
        .attr("y", y + 12)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 11)
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.85)
        .text(`${c.category} (n=${c.n})`);
      g.append("text")
        .attr("x", x(c.mean_predicted) + 6)
        .attr("y", y + 12)
        .attr("dominant-baseline", "middle")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.75)
        .text(
          `${Math.round(c.mean_predicted).toLocaleString()} (${
            c.vs_baseline_pct > 0 ? "+" : ""
          }${c.vs_baseline_pct.toFixed(0)}%)`,
        );
    });
  }, [effect]);

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

interface DeepDiveProps {
  partialDependence: ImpactPartialDependence[];
  categoricalEffects: Record<string, ImpactCategoricalEffect | null>;
  baseline: number;
}

export function FeatureDeepDive({
  partialDependence,
  categoricalEffects,
  baseline,
}: DeepDiveProps) {
  // Show top 6 PDP as a grid
  const topPdp = useMemo(
    () => partialDependence.slice(0, 6),
    [partialDependence],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">How to read this.</span>{" "}
        Each small chart shows what the model predicts as one feature sweeps
        from low to high, holding everything else constant. The bold line is
        the average; the faint lines underneath are individual engineers
        (ICE), showing whether the effect is the same for everyone or varies.
        The dashed horizontal line is the baseline (average prediction across
        all engineers) — if the bold line stays near it, that feature barely
        moves the needle.
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {topPdp.map((pdp) => (
          <div
            key={pdp.feature}
            className="rounded-xl border border-border/60 bg-card p-5 shadow-warm"
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h4 className="font-display text-xl italic tracking-tight text-foreground">
                {pdp.label}
              </h4>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                style={{
                  backgroundColor: `${GROUP_COLOR[pdp.group] ?? "#9c5d2e"}20`,
                  color: GROUP_COLOR[pdp.group] ?? "#9c5d2e",
                }}
              >
                {pdp.group}
              </span>
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
              {describeShape(pdp)}
            </p>
            <PdpPlot pdp={pdp} baseline={baseline} />
          </div>
        ))}
      </div>

      <div>
        <h4 className="mb-2 font-display text-xl italic tracking-tight text-foreground">
          Categorical effects
        </h4>
        <p className="mb-4 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
          For categorical features we can&rsquo;t draw a curve — instead, for
          each category we show the mean predicted impact of engineers in it
          vs the baseline. Bars above the dashed line predict higher impact on
          average; below, lower. (Small-n categories are filtered out.)
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(categoricalEffects).map(([key, effect]) => {
            if (!effect || !effect.categories.length) return null;
            return (
              <div
                key={key}
                className="rounded-xl border border-border/60 bg-card p-5 shadow-warm"
              >
                <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {effect.label}
                </div>
                <CategoricalEffectBars effect={effect} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
