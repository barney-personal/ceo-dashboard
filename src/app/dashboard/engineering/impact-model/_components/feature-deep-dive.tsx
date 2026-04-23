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

const ABOVE_COLOR = "#2e7d52"; // green — impact above baseline
const BELOW_COLOR = "#b8472a"; // amber-red — impact below baseline

// Plain-English feature labels that drop technical suffixes like "(log)" or "(scaled)"
// and describe what the feature actually measures in human terms.
const PLAIN_LABEL: Record<string, string> = {
  tenure_months: "How long they've been here",
  slack_msgs_per_day: "How many Slack messages per day",
  slack_reactions_per_day: "How many Slack reactions per day",
  slack_active_day_rate: "Share of days active on Slack",
  slack_desktop_share: "Share of Slack activity on desktop",
  slack_channel_share: "Share of messages in channels vs DMs",
  slack_days_since_active: "Days since last active on Slack",
  ai_tokens_log: "How heavily they use AI tools",
  ai_cost_log: "How much they spend on AI tools",
  ai_n_days: "Days per month using AI",
  ai_max_models: "How many different AI models they try",
  avg_rating: "Average performance rating",
  latest_rating: "Latest performance rating",
  rating_count: "Performance reviews received",
  level_num: "Level (seniority number)",
  pr_size_median: "Typical PR size",
  distinct_repos_180d: "How many different repos they touch",
  weekend_pr_share: "Share of PRs merged on weekends",
  offhours_pr_share: "Share of PRs merged outside 9–6 UTC",
  pr_slope_per_week: "Whether their PR rate is speeding up",
  commits_180d_log: "How many commits they ship",
  commits_per_pr: "Commits per PR (rework proxy)",
  pr_gap_days: "Share of PRs that are older than 3 months",
  weekly_pr_cv: "How steady vs bursty their PR output is",
  ramp_slope_first90: "Recent PR rate (per tenure-month)",
};

function plainLabel(feature: string, fallback: string): string {
  return PLAIN_LABEL[feature] ?? fallback;
}

// Unit formatter for grid tick labels — converts "log" features back to a
// human-readable approximation so axis labels don't say "7.5" for an AI
// spend that's really $1,800.
function formatValue(feature: string, v: number): string {
  if (feature.endsWith("_log")) {
    const raw = Math.expm1(v);
    if (raw >= 1000) return `${Math.round(raw / 1000)}k`;
    return Math.round(raw).toLocaleString();
  }
  if (feature === "slack_channel_share" || feature === "slack_desktop_share" ||
      feature === "slack_active_day_rate" || feature === "weekend_pr_share" ||
      feature === "offhours_pr_share") {
    return `${Math.round(v * 100)}%`;
  }
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v) || Math.abs(v) >= 10) return Math.round(v).toLocaleString();
  return v.toFixed(1);
}

interface DirectionBadge {
  label: string;
  color: string;
  bg: string;
}

interface FeatureInsight {
  headline: string;
  badge: DirectionBadge;
  example: string;
  spread: number;
}

// Analyse the PDP curve and produce:
//   - a plain-English one-line headline ("More tenure → more impact")
//   - a direction badge (More is better / Less is better / Sweet spot / Weak signal)
//   - a concrete example comparing low-quartile vs high-quartile engineers
function analyseFeature(
  pdp: ImpactPartialDependence,
  baseline: number,
): FeatureInsight {
  const { grid, pdp_mean, actual_median, feature } = pdp;
  const plain = plainLabel(feature, pdp.label);
  const start = pdp_mean[0];
  const end = pdp_mean[pdp_mean.length - 1];
  const peak = Math.max(...pdp_mean);
  const trough = Math.min(...pdp_mean);
  const peakIdx = pdp_mean.indexOf(peak);
  const spread = peak - trough;

  // Deltas of adjacent points — monotonic if one direction dominates
  const deltas = pdp_mean.slice(1).map((v, i) => v - pdp_mean[i]);
  const up = deltas.filter((d) => d > 0).length;
  const down = deltas.filter((d) => d < 0).length;
  const monotonicUp = up > deltas.length * 0.7 && end > start;
  const monotonicDown = down > deltas.length * 0.7 && end < start;

  // Flat: the whole curve barely moves relative to the baseline
  const flatThreshold = Math.max(40, baseline * 0.08);
  if (spread < flatThreshold) {
    return {
      headline: `${plain} barely changes the prediction`,
      badge: {
        label: "Weak signal",
        color: "#6b6660",
        bg: "rgb(107 102 96 / 0.15)",
      },
      example: `Across the realistic range, the model's prediction only moves by about ${Math.round(spread)} points. Other features matter more.`,
      spread,
    };
  }

  const loLabel = formatValue(feature, grid[Math.floor(grid.length * 0.15)]);
  const hiLabel = formatValue(feature, grid[Math.floor(grid.length * 0.85)]);
  const loPred = Math.round(pdp_mean[Math.floor(pdp_mean.length * 0.15)]);
  const hiPred = Math.round(pdp_mean[Math.floor(pdp_mean.length * 0.85)]);

  if (monotonicUp) {
    const ratio = hiPred > 0 && loPred > 0 ? hiPred / loPred : null;
    const ratioText = ratio && ratio >= 1.2
      ? ` — a ${ratio.toFixed(1)}× difference`
      : "";
    return {
      headline: `More ${plain.toLowerCase().replace(/^how |^share of |^days |^whether /, "")} → more predicted impact`,
      badge: {
        label: "More is better",
        color: ABOVE_COLOR,
        bg: "rgb(46 125 82 / 0.12)",
      },
      example: `Lower-end (${loLabel}): predicted ~${loPred.toLocaleString()}. Higher-end (${hiLabel}): predicted ~${hiPred.toLocaleString()}${ratioText}.`,
      spread,
    };
  }

  if (monotonicDown) {
    const ratio = loPred > 0 && hiPred > 0 ? loPred / hiPred : null;
    const ratioText = ratio && ratio >= 1.2
      ? ` — a ${ratio.toFixed(1)}× difference`
      : "";
    return {
      headline: `More ${plain.toLowerCase().replace(/^how |^share of |^days |^whether /, "")} → less predicted impact`,
      badge: {
        label: "Less is better",
        color: BELOW_COLOR,
        bg: "rgb(184 71 42 / 0.12)",
      },
      example: `Lower-end (${loLabel}): predicted ~${loPred.toLocaleString()}. Higher-end (${hiLabel}): predicted ~${hiPred.toLocaleString()}${ratioText}.`,
      spread,
    };
  }

  // Non-monotonic: find whether the peak is in the interior
  const peakInterior = peakIdx > 2 && peakIdx < pdp_mean.length - 3;
  if (peakInterior && peak - Math.min(start, end) > flatThreshold) {
    const peakVal = formatValue(feature, grid[peakIdx]);
    return {
      headline: `Sweet spot around ${peakVal}`,
      badge: {
        label: "Sweet spot",
        color: "#8b5a2a",
        bg: "rgb(139 90 42 / 0.12)",
      },
      example: `Predicted impact peaks at ~${Math.round(peak).toLocaleString()} when this feature is around ${peakVal}. Both very low and very high values score lower.`,
      spread,
    };
  }

  // Complex / mixed: describe as a range
  return {
    headline: `Mixed effect across the range`,
    badge: {
      label: "Mixed",
      color: "#6b6660",
      bg: "rgb(107 102 96 / 0.15)",
    },
    example: `Predicted impact ranges from ~${Math.round(trough).toLocaleString()} to ~${Math.round(peak).toLocaleString()} across realistic values — no simple \"more is better\" story.`,
    spread,
  };
}

interface PdpPlotProps {
  pdp: ImpactPartialDependence;
  baseline: number;
}

function PdpPlot({ pdp, baseline }: PdpPlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 240;
    const margin = { top: 18, right: 20, bottom: 50, left: 58 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const allVals = [...pdp.pdp_mean, ...pdp.ice_sample.flat(), baseline];
    const yMin = d3Min(allVals) ?? 0;
    const yMax = d3Max(allVals) ?? 1;
    const yDomain: [number, number] = [
      Math.max(0, yMin - (yMax - yMin) * 0.1),
      yMax + (yMax - yMin) * 0.12,
    ];
    const x = scaleLinear()
      .domain([pdp.grid[0], pdp.grid[pdp.grid.length - 1]])
      .range([0, innerW]);
    const y = scaleLinear().domain(yDomain).range([innerH, 0]);

    // Horizontal band shading: green above baseline, amber below
    g.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", innerW)
      .attr("height", y(baseline))
      .attr("fill", ABOVE_COLOR)
      .attr("fill-opacity", 0.045);
    g.append("rect")
      .attr("x", 0)
      .attr("y", y(baseline))
      .attr("width", innerW)
      .attr("height", innerH - y(baseline))
      .attr("fill", BELOW_COLOR)
      .attr("fill-opacity", 0.045);

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
        .attr("x", -8)
        .attr("y", y(t))
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 9)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.55)
        .text(Math.round(t).toLocaleString());
    });

    // Baseline line
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", y(baseline))
      .attr("y2", y(baseline))
      .attr("stroke", "#9c5d2e")
      .attr("stroke-opacity", 0.7)
      .attr("stroke-dasharray", "4 3")
      .attr("stroke-width", 1.2);
    g.append("text")
      .attr("x", innerW - 2)
      .attr("y", y(baseline) - 5)
      .attr("text-anchor", "end")
      .attr("font-size", 9)
      .attr("fill", "#9c5d2e")
      .attr("fill-opacity", 0.9)
      .attr("font-weight", 600)
      .text(`avg engineer ≈ ${Math.round(baseline).toLocaleString()}`);

    // ICE lines (translucent) — show spread across individuals
    const lineGen = d3Line<number>()
      .x((_, i) => x(pdp.grid[i]))
      .y((v) => y(v));
    pdp.ice_sample.forEach((series) => {
      g.append("path")
        .datum(series)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.07)
        .attr("stroke-width", 1);
    });

    // PDP mean line — split into above / below baseline segments,
    // coloured green / amber accordingly.
    const segments: { color: string; pts: Array<[number, number]> }[] = [];
    let currentColor = pdp.pdp_mean[0] >= baseline ? ABOVE_COLOR : BELOW_COLOR;
    let currentPts: Array<[number, number]> = [[pdp.grid[0], pdp.pdp_mean[0]]];
    for (let i = 1; i < pdp.pdp_mean.length; i++) {
      const v = pdp.pdp_mean[i];
      const prev = pdp.pdp_mean[i - 1];
      const color = v >= baseline ? ABOVE_COLOR : BELOW_COLOR;
      if (color !== currentColor) {
        // Find the x-coordinate where the line crosses baseline (linear interpolation)
        const t = (baseline - prev) / (v - prev);
        const xCross =
          pdp.grid[i - 1] + t * (pdp.grid[i] - pdp.grid[i - 1]);
        currentPts.push([xCross, baseline]);
        segments.push({ color: currentColor, pts: currentPts });
        currentColor = color;
        currentPts = [[xCross, baseline]];
      }
      currentPts.push([pdp.grid[i], v]);
    }
    segments.push({ color: currentColor, pts: currentPts });

    for (const seg of segments) {
      const segLine = d3Line<[number, number]>()
        .x((p) => x(p[0]))
        .y((p) => y(p[1]));
      g.append("path")
        .datum(seg.pts)
        .attr("d", segLine)
        .attr("fill", "none")
        .attr("stroke", seg.color)
        .attr("stroke-width", 2.8);
    }

    // Typical engineer marker (vertical at median of feature's actual distribution)
    const medX = x(pdp.actual_median);
    g.append("line")
      .attr("x1", medX)
      .attr("x2", medX)
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.18)
      .attr("stroke-dasharray", "2 3");
    g.append("text")
      .attr("x", medX)
      .attr("y", -6)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("font-family", "var(--font-mono, ui-monospace)")
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.55)
      .text(`typical: ${formatValue(pdp.feature, pdp.actual_median)}`);

    // X axis ticks
    const xTicks = x.ticks(5);
    xTicks.forEach((t) => {
      g.append("line")
        .attr("x1", x(t))
        .attr("x2", x(t))
        .attr("y1", innerH)
        .attr("y2", innerH + 4)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.3);
      g.append("text")
        .attr("x", x(t))
        .attr("y", innerH + 16)
        .attr("text-anchor", "middle")
        .attr("font-size", 9)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.6)
        .text(formatValue(pdp.feature, t));
    });
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", innerH)
      .attr("y2", innerH)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.3);

    // Axis labels
    g.append("text")
      .attr("x", -44)
      .attr("y", innerH / 2)
      .attr("text-anchor", "middle")
      .attr("transform", `rotate(-90, -44, ${innerH / 2})`)
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.65)
      .text("Predicted impact (360d)");
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 38)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.65)
      .text(plainLabel(pdp.feature, pdp.label));
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
    const margin = { top: 8, right: 70, bottom: 20, left: 140 };
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
      .attr("stroke", "#9c5d2e")
      .attr("stroke-opacity", 0.7)
      .attr("stroke-dasharray", "3 3");
    g.append("text")
      .attr("x", x(effect.baseline))
      .attr("y", cats.length * barHeight + 14)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("fill", "#9c5d2e")
      .attr("fill-opacity", 0.9)
      .text(`avg ${Math.round(effect.baseline)}`);

    cats.forEach((c, i) => {
      const y = i * barHeight;
      const color =
        c.mean_predicted >= effect.baseline ? ABOVE_COLOR : BELOW_COLOR;
      g.append("rect")
        .attr("x", 0)
        .attr("y", y + 4)
        .attr("width", x(c.mean_predicted))
        .attr("height", 14)
        .attr("fill", color)
        .attr("fill-opacity", 0.8)
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
  const topPdp = useMemo(
    () => partialDependence.slice(0, 6),
    [partialDependence],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">How to read these charts.</span>{" "}
        Each card shows how the model&rsquo;s prediction changes as one feature
        goes from low to high. The <span className="font-medium" style={{ color: ABOVE_COLOR }}>green</span>{" "}
        band means &ldquo;above the average engineer&rdquo;;{" "}
        <span className="font-medium" style={{ color: BELOW_COLOR }}>amber</span>{" "}
        means below. The badge in the top-right tells you the story at a glance:
        <span
          className="mx-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{ color: ABOVE_COLOR, backgroundColor: "rgb(46 125 82 / 0.12)" }}
        >
          More is better
        </span>
        ,{" "}
        <span
          className="mx-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{ color: BELOW_COLOR, backgroundColor: "rgb(184 71 42 / 0.12)" }}
        >
          Less is better
        </span>
        ,{" "}
        <span
          className="mx-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "#8b5a2a", backgroundColor: "rgb(139 90 42 / 0.12)" }}
        >
          Sweet spot
        </span>
        ,{" "}
        <span
          className="mx-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "#6b6660", backgroundColor: "rgb(107 102 96 / 0.15)" }}
        >
          Weak signal
        </span>
        , or{" "}
        <span
          className="mx-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "#6b6660", backgroundColor: "rgb(107 102 96 / 0.15)" }}
        >
          Mixed
        </span>
        {" "}(non-monotonic, no single sweet spot). The vertical dotted line is the typical engineer&rsquo;s value.
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {topPdp.map((pdp) => {
          const insight = analyseFeature(pdp, baseline);
          return (
            <div
              key={pdp.feature}
              className="rounded-xl border border-border/60 bg-card p-5 shadow-warm"
            >
              <div className="mb-1 flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-display text-xl italic tracking-tight text-foreground">
                    {plainLabel(pdp.feature, pdp.label)}
                  </h4>
                  <p className="mt-0.5 text-[11px] font-medium text-foreground/80">
                    {insight.headline}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                    style={{
                      backgroundColor: insight.badge.bg,
                      color: insight.badge.color,
                    }}
                  >
                    {insight.badge.label}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]"
                    style={{
                      backgroundColor: `${GROUP_COLOR[pdp.group] ?? "#9c5d2e"}20`,
                      color: GROUP_COLOR[pdp.group] ?? "#9c5d2e",
                    }}
                  >
                    {pdp.group}
                  </span>
                </div>
              </div>
              <p className="mb-3 mt-2 text-[12px] leading-relaxed text-muted-foreground">
                {insight.example}
              </p>
              <PdpPlot pdp={pdp} baseline={baseline} />
            </div>
          );
        })}
      </div>

      <div>
        <h4 className="mb-2 font-display text-xl italic tracking-tight text-foreground">
          Categorical effects
        </h4>
        <p className="mb-4 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
          For categorical features (pillar, discipline, level track) we
          can&rsquo;t draw a curve — instead, for each category we show the
          mean predicted impact of engineers in it.{" "}
          <span className="font-medium" style={{ color: ABOVE_COLOR }}>Green</span>{" "}
          bars are above the average engineer,{" "}
          <span className="font-medium" style={{ color: BELOW_COLOR }}>amber</span>{" "}
          bars below. The % next to each bar shows the deviation. Small-n
          categories are filtered out.
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
