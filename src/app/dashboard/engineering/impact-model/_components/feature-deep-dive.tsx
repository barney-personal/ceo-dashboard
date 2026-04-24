"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { line as d3Line, area as d3Area } from "d3-shape";
import { min as d3Min, max as d3Max, quantile as d3Quantile } from "d3-array";
import type {
  ImpactPartialDependence,
  ImpactCategoricalEffect,
} from "@/lib/data/impact-model";
import { plainLabelFor } from "@/lib/data/impact-model-coaching";
import { getContentBoxWidth } from "@/components/charts/chart-utils";

const GROUP_COLOR: Record<string, string> = {
  Tenure: "#7a5a3e",
  "Slack engagement": "#3f7ca0",
  "AI usage": "#c4673f",
  "Performance review": "#6a8b4c",
  "PR cadence": "#2d6a5c",
  "PR habits": "#4a8b7c",
  Pillar: "#8b5a9c",
  Discipline: "#9c5d2e",
  Level: "#4a6b7c",
  Other: "#8e8680",
};

const ABOVE_COLOR = "#2e7d52";
const BELOW_COLOR = "#b8472a";

// Per-feature X-axis unit labels. Shown next to the axis title so readers
// know whether "0.2" is a fraction, a percentage, a count, or something else.
const AXIS_UNIT: Record<string, string> = {
  tenure_months: "months",
  slack_msgs_per_day: "msgs/day",
  slack_reactions_per_day: "reactions/day",
  slack_active_day_rate: "% of days",
  slack_desktop_share: "% on desktop",
  slack_channel_share: "% in channels",
  slack_days_since_active: "days",
  ai_tokens_log: "tokens/mo",
  ai_cost_log: "$/month",
  ai_n_days: "days/month",
  ai_max_models: "models",
  avg_rating: "rating (1–5)",
  latest_rating: "rating (1–5)",
  rating_count: "reviews",
  level_num: "level",
  pr_size_median: "lines",
  distinct_repos_180d: "repos",
  weekend_pr_share: "% weekend",
  offhours_pr_share: "% off-hours",
  pr_slope_per_week: "PRs/wk per wk",
  commits_180d_log: "commits/180d",
  commits_per_pr: "commits/PR",
  pr_gap_days: "% stale PRs",
  weekly_pr_cv: "(lower = steadier)",
  ramp_slope_first90: "PRs/tenure-month",
};

// A short manager-relevant "so what" framing per feature. Only used on
// strong-signal cards (More/Less/Sweet). Kept intentionally tentative —
// SHAP is correlational, not causal.
const MANAGER_TAKEAWAY: Record<string, string> = {
  tenure_months: "Newer engineers predict lower — factor tenure into expectations rather than comparing 6-month joiners to 3-year veterans.",
  slack_msgs_per_day: "Low Slack volume isn't automatically a problem, but worth pairing with other engagement signals.",
  slack_channel_share: "Encouraging more public-channel posts (vs DMs) tends to correlate with higher impact.",
  slack_active_day_rate: "Mostly-silent weeks are worth a check-in before they become a disengagement signal.",
  slack_days_since_active: "A gap of weeks is worth a direct conversation.",
  ai_tokens_log: "Tooling and access worth checking for low-usage engineers.",
  ai_cost_log: "Budget/approval blockers on AI tools worth removing where possible.",
  ai_n_days: "Engineers using AI daily tend to predict higher — worth a conversation about workflow fit.",
  ai_max_models: "Trying multiple models is cheap; worth encouraging experimentation.",
  pr_size_median: "Smaller, more frequent PRs tend to predict higher impact. Discuss scoping or review bottlenecks.",
  pr_slope_per_week: "Accelerating PR rate = growing productivity. A flatlining rate is worth a specific conversation.",
  commits_180d_log: "Low volume could be non-code work (design, review) — worth understanding where the time goes.",
  commits_per_pr: "High commits-per-PR = rework. Review churn or scope drift worth diagnosing.",
  weekend_pr_share: "High weekend share can be engagement OR burnout. Ask directly.",
  offhours_pr_share: "Off-hours work: check it's a choice, not a pressure.",
  ramp_slope_first90: "Slow ramp is worth a specific onboarding conversation.",
  weekly_pr_cv: "Bursty output can signal meeting-heavy weeks or cross-team dependencies.",
};

// Single source of truth for plain-English feature labels lives in
// impact-model-coaching.ts (plainLabelFor). The `fallback` param is kept
// for call-sites that want to prefer the PDP's own label field on unknowns,
// but for known features the shared dictionary wins.
function plainLabel(feature: string, fallback: string): string {
  const known = plainLabelFor(feature);
  // plainLabelFor returns "feature name" for unknowns (raw-snake → spaces).
  // If that matches the naive transform exactly, we didn't find a mapping —
  // fall back to the PDP's label instead, which is more specific than the
  // raw name (e.g. "Tenure (months)" from train.py's FEATURE_DISPLAY).
  if (known === feature.replace(/_/g, " ")) return fallback;
  return known;
}

function axisUnit(feature: string): string | null {
  return AXIS_UNIT[feature] ?? null;
}

function managerTakeaway(feature: string): string | null {
  return MANAGER_TAKEAWAY[feature] ?? null;
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
      feature === "offhours_pr_share" || feature === "pr_gap_days") {
    return `${Math.round(v * 100)}%`;
  }
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v) || Math.abs(v) >= 10) return Math.round(v).toLocaleString();
  return v.toFixed(1);
}

type BadgeKind = "more" | "less" | "sweet" | "weak" | "mixed";

interface DirectionBadge {
  label: string;
  color: string;
  bg: string;
  kind: BadgeKind;
}

interface FeatureInsight {
  headline: string;
  badge: DirectionBadge;
  example: string;
  spread: number;
  // Only set for strong signals (More/Less/Sweet)
  takeaway: string | null;
}

// Analyse the PDP curve and produce:
//   - a plain-English one-line headline ("More tenure → more impact")
//   - a direction badge (More is better / Less is better / Sweet spot / Weak signal / Mixed)
//   - a concrete example comparing bottom- vs top-quintile engineers
function analyseFeature(
  pdp: ImpactPartialDependence,
  baseline: number,
): FeatureInsight {
  const { grid, pdp_mean, feature } = pdp;
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
      headline: "Barely moves the prediction.",
      badge: {
        label: "Weak signal",
        kind: "weak",
        color: "#6b6660",
        bg: "rgb(107 102 96 / 0.15)",
      },
      example: `Across realistic values, predicted impact changes by only ~${Math.round(spread)} points. Other features matter more.`,
      spread,
      takeaway: null,
    };
  }

  const loIdx = Math.floor(pdp_mean.length * 0.15);
  const hiIdx = Math.floor(pdp_mean.length * 0.85);
  const loLabel = formatValue(feature, grid[loIdx]);
  const hiLabel = formatValue(feature, grid[hiIdx]);
  const loPred = Math.round(pdp_mean[loIdx]);
  const hiPred = Math.round(pdp_mean[hiIdx]);

  if (monotonicUp) {
    const ratio = hiPred > 0 && loPred > 0 ? hiPred / loPred : null;
    const ratioText = ratio && ratio >= 1.2
      ? ` — about ${ratio.toFixed(1)}× higher`
      : "";
    return {
      headline: "Higher values predict more impact.",
      badge: {
        label: "More is better",
        kind: "more",
        color: ABOVE_COLOR,
        bg: "rgb(46 125 82 / 0.12)",
      },
      example: `Low end (${loLabel}): predicted ~${loPred.toLocaleString()}. High end (${hiLabel}): predicted ~${hiPred.toLocaleString()}${ratioText}.`,
      spread,
      takeaway: managerTakeaway(feature),
    };
  }

  if (monotonicDown) {
    const ratio = loPred > 0 && hiPred > 0 ? loPred / hiPred : null;
    const ratioText = ratio && ratio >= 1.2
      ? ` — about ${ratio.toFixed(1)}× higher`
      : "";
    return {
      headline: "Lower values predict more impact.",
      badge: {
        label: "Less is better",
        kind: "less",
        color: BELOW_COLOR,
        bg: "rgb(184 71 42 / 0.12)",
      },
      example: `Low end (${loLabel}): predicted ~${loPred.toLocaleString()}. High end (${hiLabel}): predicted ~${hiPred.toLocaleString()}${ratioText}.`,
      spread,
      takeaway: managerTakeaway(feature),
    };
  }

  // Non-monotonic: find whether the peak is in the interior
  const peakInterior = peakIdx > 2 && peakIdx < pdp_mean.length - 3;
  if (peakInterior && peak - Math.min(start, end) > flatThreshold) {
    const peakVal = formatValue(feature, grid[peakIdx]);
    return {
      headline: `Best around ${peakVal}.`,
      badge: {
        label: "Sweet spot",
        kind: "sweet",
        color: "#8b5a2a",
        bg: "rgb(139 90 42 / 0.12)",
      },
      example: `Predicted impact peaks at ~${Math.round(peak).toLocaleString()} when this feature is around ${peakVal}. Both very low and very high values score lower.`,
      spread,
      takeaway: managerTakeaway(feature),
    };
  }

  // Complex / mixed
  return {
    headline: "No simple pattern.",
    badge: {
      label: "Mixed",
      kind: "mixed",
      color: "#6b6660",
      bg: "rgb(107 102 96 / 0.15)",
    },
    example: `Predicted impact ranges from ~${Math.round(trough).toLocaleString()} to ~${Math.round(peak).toLocaleString()} across realistic values — not a simple "higher is better" story.`,
    spread,
    takeaway: null,
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
    const height = 220;
    const margin = { top: 16, right: 20, bottom: 48, left: 54 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Compute IQR band across individuals at each grid point (from ice_sample).
    // This replaces the old "spaghetti" ICE lines — same spread information,
    // far less visual noise.
    const gridLen = pdp.grid.length;
    const iqrLow: number[] = [];
    const iqrHigh: number[] = [];
    for (let i = 0; i < gridLen; i++) {
      const col = pdp.ice_sample.map((s) => s[i]).filter((v): v is number => Number.isFinite(v));
      col.sort((a, b) => a - b);
      iqrLow.push(d3Quantile(col, 0.25) ?? pdp.pdp_mean[i]);
      iqrHigh.push(d3Quantile(col, 0.75) ?? pdp.pdp_mean[i]);
    }

    const allVals = [...pdp.pdp_mean, ...iqrLow, ...iqrHigh, baseline];
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

    // Horizontal band shading: light green above baseline, light amber below.
    g.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", innerW)
      .attr("height", y(baseline))
      .attr("fill", ABOVE_COLOR)
      .attr("fill-opacity", 0.04);
    g.append("rect")
      .attr("x", 0)
      .attr("y", y(baseline))
      .attr("width", innerW)
      .attr("height", innerH - y(baseline))
      .attr("fill", BELOW_COLOR)
      .attr("fill-opacity", 0.04);

    // Y gridlines + tick labels
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

    // IQR band (25–75% spread across individuals at each grid point) —
    // shaded area hugging the mean curve.
    const areaGen = d3Area<number>()
      .x((_, i) => x(pdp.grid[i]))
      .y0((_, i) => y(iqrLow[i]))
      .y1((_, i) => y(iqrHigh[i]));
    g.append("path")
      .datum(pdp.grid)
      .attr("d", areaGen)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.08);

    // Baseline line — no number next to it, just a small "Average" label.
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", y(baseline))
      .attr("y2", y(baseline))
      .attr("stroke", "#9c5d2e")
      .attr("stroke-opacity", 0.7)
      .attr("stroke-dasharray", "4 3")
      .attr("stroke-width", 1.1);
    g.append("text")
      .attr("x", innerW - 2)
      .attr("y", y(baseline) - 4)
      .attr("text-anchor", "end")
      .attr("font-size", 9)
      .attr("fill", "#9c5d2e")
      .attr("fill-opacity", 0.85)
      .attr("font-weight", 600)
      .text("Average");

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
        .attr("stroke-width", 2.6);
    }

    // Typical engineer marker (vertical at median of feature's actual distribution)
    const medX = x(pdp.actual_median);
    g.append("line")
      .attr("x1", medX)
      .attr("x2", medX)
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.16)
      .attr("stroke-dasharray", "2 3");
    g.append("text")
      .attr("x", medX)
      .attr("y", -5)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("font-family", "var(--font-mono, ui-monospace)")
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.55)
      .text(`typical engineer: ${formatValue(pdp.feature, pdp.actual_median)}`);

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
      .attr("x", -38)
      .attr("y", innerH / 2)
      .attr("text-anchor", "middle")
      .attr("transform", `rotate(-90, -38, ${innerH / 2})`)
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.65)
      .text("Predicted impact");
    const unit = axisUnit(pdp.feature);
    const xLabel = unit
      ? `${plainLabel(pdp.feature, pdp.label)}  ·  ${unit}`
      : plainLabel(pdp.feature, pdp.label);
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 36)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.65)
      .text(xLabel);
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
      .text("Average");

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
  // Compute insights once, then split: strong signals (More/Less/Sweet)
  // get full chart cards; weak/mixed go into a compact "no clear pattern"
  // list so the grid isn't padded out with uninformative charts.
  const {
    strong,
    weak,
  } = useMemo(() => {
    const top = partialDependence.slice(0, 10);
    const analyzed = top.map((pdp) => ({ pdp, insight: analyseFeature(pdp, baseline) }));
    const strong = analyzed.filter(
      (a) => a.insight.badge.kind === "more" || a.insight.badge.kind === "less" || a.insight.badge.kind === "sweet",
    ).slice(0, 6);
    const weak = analyzed.filter(
      (a) => a.insight.badge.kind === "weak" || a.insight.badge.kind === "mixed",
    );
    return { strong, weak };
  }, [partialDependence, baseline]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-[12px] leading-relaxed text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">One card per feature — each answers: &ldquo;as this thing goes up, does the model predict more or less impact?&rdquo;</span>{" "}
          The solid line is the model&rsquo;s prediction; the shaded area shows
          the spread across individual engineers. The dashed horizontal line
          is the average engineer. The dashed vertical line is where the
          typical engineer sits today.
        </p>
        <p className="mt-2">
          <span className="font-medium">Read the badge first:</span>{" "}
          <Badge color={ABOVE_COLOR} bg="rgb(46 125 82 / 0.12)">More is better</Badge>
          {" "}<Badge color={BELOW_COLOR} bg="rgb(184 71 42 / 0.12)">Less is better</Badge>
          {" "}<Badge color="#8b5a2a" bg="rgb(139 90 42 / 0.12)">Sweet spot</Badge>
          {" "}tell you a clear story. Features with no clear pattern are summarised at the bottom — those are real features in the model, they just don&rsquo;t move the needle on their own.
        </p>
      </div>

      {strong.length === 0 && (
        <p className="rounded-lg border border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground">
          No features in the top set showed a clear monotonic or peak pattern.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {strong.map(({ pdp, insight }) => (
          <StrongCard
            key={pdp.feature}
            pdp={pdp}
            insight={insight}
            baseline={baseline}
          />
        ))}
      </div>

      {weak.length > 0 && (
        <details className="group rounded-xl border border-border/60 bg-muted/10 p-4 text-[12px]">
          <summary className="cursor-pointer select-none text-foreground">
            <span className="font-medium">{weak.length} features have no clear pattern on their own</span>
            <span className="ml-2 text-muted-foreground">(click to expand)</span>
          </summary>
          <ul className="mt-3 space-y-1.5 text-muted-foreground">
            {weak.map(({ pdp, insight }) => (
              <li key={pdp.feature} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium text-foreground">
                  {plainLabel(pdp.feature, pdp.label)}
                </span>
                <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: insight.badge.color }}>
                  {insight.badge.label}
                </span>
                <span className="text-[12px]">{insight.headline}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div>
        <h4 className="mb-2 font-display text-xl italic tracking-tight text-foreground">
          Categorical effects
        </h4>
        <p className="mb-4 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
          For categorical features (pillar, discipline, level track) we can&rsquo;t
          draw a curve — instead, for each category we show the mean predicted
          impact of engineers in it.{" "}
          <span className="font-medium" style={{ color: ABOVE_COLOR }}>Green</span>{" "}
          bars are above the average engineer,{" "}
          <span className="font-medium" style={{ color: BELOW_COLOR }}>amber</span>{" "}
          bars below. Small-n categories are filtered out.
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

function Badge({
  children,
  color,
  bg,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      className="mx-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
      style={{ color, backgroundColor: bg }}
    >
      {children}
    </span>
  );
}

function StrongCard({
  pdp,
  insight,
  baseline,
}: {
  pdp: ImpactPartialDependence;
  insight: FeatureInsight;
  baseline: number;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
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
      {insight.takeaway && (
        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-[12px] leading-relaxed text-foreground">
          <span className="font-medium">What to do with this: </span>
          <span className="text-muted-foreground">{insight.takeaway}</span>
        </div>
      )}
    </div>
  );
}
