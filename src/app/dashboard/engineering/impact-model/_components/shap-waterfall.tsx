"use client";

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import type {
  ImpactEngineerPrediction,
  ImpactShapContribution,
} from "@/lib/data/impact-model";
import { getContentBoxWidth } from "@/components/charts/chart-utils";

const FEATURE_LABELS: Record<string, string> = {
  tenure_months: "Tenure",
  slack_msgs_per_day: "Slack msgs / day",
  slack_reactions_per_day: "Slack reactions / day",
  slack_active_day_rate: "Slack active-day rate",
  slack_desktop_share: "Slack desktop share",
  slack_channel_share: "Channel vs DM share",
  slack_days_since_active: "Days since last active",
  ai_tokens_log: "AI tokens used",
  ai_cost_log: "AI cost",
  ai_n_days: "AI usage days",
  ai_max_models: "AI models tried",
  avg_rating: "Avg perf rating",
  latest_rating: "Latest perf rating",
  rating_count: "Perf review count",
  level_num: "Level number",
};

function prettyName(raw: string): string {
  if (FEATURE_LABELS[raw]) return FEATURE_LABELS[raw];
  const idx = raw.indexOf("_");
  if (idx > 0) {
    const prefix = raw.slice(0, idx);
    const value = raw.slice(idx + 1).replace(/_/g, " ");
    return `${prefix[0].toUpperCase()}${prefix.slice(1)}: ${value}`;
  }
  return raw;
}

// Protected attributes (Gender, Location) are deliberately excluded from the
// model (see ml-impact/train.py) so they never reach these colour lookups.
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

interface WaterfallProps {
  engineer: ImpactEngineerPrediction;
  expectedImpact: number;
  maxSteps?: number;
}

function WaterfallChart({
  engineer,
  expectedImpact,
  maxSteps = 8,
}: WaterfallProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => {
    // Keep top-|shap| contributions; collapse the rest into "other features"
    // The contributions array already has a trailing "{n}_minor_features" bucket
    // from Python, so everything sums to the in-sample prediction.
    const visible = engineer.shap_contributions.slice(0, maxSteps);
    const rest = engineer.shap_contributions.slice(maxSteps);
    const restSum = rest.reduce((s, c) => s + c.shap, 0);
    const restCount = rest.reduce((n, c) => {
      const m = c.feature.match(/^(\d+)_minor_features$/);
      return n + (m ? parseInt(m[1], 10) : 1);
    }, 0);
    const augmented: ImpactShapContribution[] = [...visible];
    if (Math.abs(restSum) > 1e-3 && rest.length > 0) {
      augmented.push({
        feature: `+${restCount} other features`,
        group: "Other",
        shap: restSum,
        pct_multiplier: Math.round((Math.exp(restSum) - 1) * 1000) / 10,
        value: null,
      });
    }
    return augmented;
  }, [engineer, maxSteps]);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const barHeight = 28;
    // Right margin leaves space for two separate label columns
    // (pct-change + running-total) so they never overlap with the bar.
    const margin = { top: 28, right: 140, bottom: 36, left: 200 };
    const nRows = steps.length + 2; // base + steps + final
    const height = nRows * barHeight + margin.top + margin.bottom;
    const innerW = width - margin.left - margin.right;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Compute running log-prediction for each step for waterfall math.
    // log_pred_0 = expected_log; step i adds shap_i. Final log = log(predicted).
    const expectedLog = Math.log1p(expectedImpact);
    let cum = expectedLog;
    const rows = [
      {
        label: "Base prediction",
        feature: "base",
        group: "Base",
        shap: 0,
        pct: 0,
        startImpact: 0,
        endImpact: expectedImpact,
      },
    ];
    for (const s of steps) {
      const startLog = cum;
      const endLog = cum + s.shap;
      cum = endLog;
      rows.push({
        label: prettyName(s.feature),
        feature: s.feature,
        group: s.group,
        shap: s.shap,
        pct: s.pct_multiplier,
        startImpact: Math.expm1(startLog),
        endImpact: Math.expm1(endLog),
      });
    }
    rows.push({
      label: "Final prediction",
      feature: "final",
      group: "Final",
      shap: 0,
      pct: 0,
      startImpact: 0,
      endImpact: Math.expm1(cum),
    });

    const maxImpact = Math.max(
      ...rows.map((r) => Math.max(r.startImpact, r.endImpact)),
    );
    const x = scaleLinear().domain([0, maxImpact * 1.05]).range([0, innerW]);

    // Gridlines
    x.ticks(5).forEach((t) => {
      g.append("line")
        .attr("x1", x(t))
        .attr("x2", x(t))
        .attr("y1", -8)
        .attr("y2", nRows * barHeight)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.07);
      g.append("text")
        .attr("x", x(t))
        .attr("y", -12)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.55)
        .text(t.toLocaleString());
    });
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", -26)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.7)
      .text("Predicted impact (running total)");

    rows.forEach((r, i) => {
      const y = i * barHeight;
      const isAnchor = r.feature === "base" || r.feature === "final";

      if (isAnchor) {
        // Solid bar from 0 to endImpact
        g.append("rect")
          .attr("x", 0)
          .attr("y", y + 6)
          .attr("width", x(r.endImpact))
          .attr("height", 14)
          .attr("fill", r.feature === "final" ? "#3f5b4c" : "#8e8680")
          .attr("rx", 2);
        // Total in the running-total column (same x as step rows)
        g.append("text")
          .attr("x", innerW + 70)
          .attr("y", y + 15)
          .attr("text-anchor", "start")
          .attr("dominant-baseline", "middle")
          .attr("font-size", 11)
          .attr("font-family", "var(--font-mono, ui-monospace)")
          .attr("fill", "currentColor")
          .attr("fill-opacity", 0.9)
          .attr("font-weight", "600")
          .text(Math.round(r.endImpact).toLocaleString());
      } else {
        // Step bar from startImpact to endImpact
        const up = r.endImpact > r.startImpact;
        const x0 = Math.min(x(r.startImpact), x(r.endImpact));
        const w = Math.abs(x(r.endImpact) - x(r.startImpact));
        const color = up
          ? GROUP_COLOR[r.group] ?? "#7a5a3e"
          : "#b8472a";
        g.append("rect")
          .attr("x", x0)
          .attr("y", y + 8)
          .attr("width", Math.max(1.5, w))
          .attr("height", 10)
          .attr("fill", color)
          .attr("rx", 2);

        // % label in a fixed column right after the bar area (never overlaps bar)
        const text = `${up ? "+" : ""}${r.pct.toFixed(1)}%`;
        g.append("text")
          .attr("x", innerW + 8)
          .attr("y", y + 13)
          .attr("text-anchor", "start")
          .attr("dominant-baseline", "middle")
          .attr("font-size", 10)
          .attr("font-family", "var(--font-mono, ui-monospace)")
          .attr("fill", color)
          .attr("font-weight", 600)
          .text(text);

        // Running total in its own column further right
        g.append("text")
          .attr("x", innerW + 70)
          .attr("y", y + 13)
          .attr("text-anchor", "start")
          .attr("dominant-baseline", "middle")
          .attr("font-size", 10)
          .attr("font-family", "var(--font-mono, ui-monospace)")
          .attr("fill", "currentColor")
          .attr("fill-opacity", 0.55)
          .text(`→ ${Math.round(r.endImpact).toLocaleString()}`);
      }

      // Row label
      g.append("text")
        .attr("x", -10)
        .attr("y", y + 14)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 11)
        .attr(
          "font-weight",
          isAnchor ? "600" : "400",
        )
        .attr("fill", "currentColor")
        .attr("fill-opacity", isAnchor ? 0.95 : 0.8)
        .text(r.label);

      // Connector line between step and next step's bar start
      if (i < rows.length - 1) {
        const currentEnd =
          r.feature === "base" || r.feature === "final"
            ? x(r.endImpact)
            : r.endImpact > r.startImpact
              ? x(r.endImpact)
              : x(r.startImpact);
        g.append("line")
          .attr("x1", currentEnd)
          .attr("x2", currentEnd)
          .attr("y1", y + 18)
          .attr("y2", y + barHeight + 8)
          .attr("stroke", "currentColor")
          .attr("stroke-opacity", 0.25)
          .attr("stroke-dasharray", "2 2");
      }
    });

    // Axis baseline
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", nRows * barHeight + 4)
      .attr("y2", nRows * barHeight + 4)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.3);
  }, [steps, expectedImpact]);

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

interface Props {
  engineers: ImpactEngineerPrediction[];
  expectedImpact: number;
}

export function ShapWaterfall({ engineers, expectedImpact }: Props) {
  // Sort alphabetically, but start with someone with an interesting story
  // (biggest positive residual — model under-predicted them)
  const sorted = useMemo(
    () => [...engineers].sort((a, b) => a.name.localeCompare(b.name)),
    [engineers],
  );
  const defaultId = useMemo(
    () =>
      [...engineers].sort((a, b) => b.residual - a.residual)[0]?.email ??
      sorted[0]?.email ??
      "",
    [engineers, sorted],
  );
  const [selectedId, setSelectedId] = useState(defaultId);
  const [query, setQuery] = useState("");

  const engineer = sorted.find((e) => e.email === selectedId) ?? sorted[0];
  if (!engineer) return null;

  const filtered = query
    ? sorted.filter(
        (e) =>
          e.name.toLowerCase().includes(query.toLowerCase()) ||
          e.discipline.toLowerCase().includes(query.toLowerCase()) ||
          e.pillar.toLowerCase().includes(query.toLowerCase()),
      )
    : sorted;

  // Use the in-sample prediction here because that's what the SHAP
  // decomposition explains. The cross-validated `predicted` is the
  // honest held-out estimate used for aggregate R²/MAE metrics.
  const explainedPrediction = engineer.predicted_insample;
  const direction =
    explainedPrediction > expectedImpact ? "above" : "below";
  const pctVsBaseline =
    Math.round(
      ((explainedPrediction - expectedImpact) / expectedImpact) * 100,
    );

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Why did the model predict this for …
          </div>
          <h3 className="mt-1 font-display text-2xl italic tracking-tight text-foreground">
            {engineer.name}
          </h3>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {engineer.discipline} · {engineer.level_label} · {engineer.pillar} ·{" "}
            {engineer.tenure_months.toFixed(0)}mo tenure
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <input
            type="text"
            placeholder="Search engineer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary/50 sm:w-60"
          />
          <select
            value={engineer.email}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary/50 sm:w-60"
          >
            {filtered.map((e) => (
              <option key={e.email} value={e.email}>
                {e.name} — {e.discipline}, {e.level_label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Model prediction
          </div>
          <div className="mt-1 font-display text-2xl italic text-foreground">
            {explainedPrediction.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            held-out CV:{" "}
            <span className="font-mono">
              {engineer.predicted.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Actual (360d)
          </div>
          <div className="mt-1 font-display text-2xl italic text-foreground">
            {engineer.actual.toLocaleString()}
          </div>
        </div>
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor:
              engineer.actual - explainedPrediction >= 0
                ? "rgb(46 125 82 / 0.3)"
                : "rgb(184 71 42 / 0.3)",
            backgroundColor:
              engineer.actual - explainedPrediction >= 0
                ? "rgb(46 125 82 / 0.05)"
                : "rgb(184 71 42 / 0.05)",
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Actual − predicted
          </div>
          <div
            className="mt-1 font-display text-2xl italic"
            style={{
              color:
                engineer.actual - explainedPrediction >= 0
                  ? "#2e7d52"
                  : "#b8472a",
            }}
          >
            {engineer.actual - explainedPrediction > 0 ? "+" : ""}
            {(engineer.actual - explainedPrediction).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Reading the waterfall.</span>{" "}
        Start with the base prediction of{" "}
        <span className="font-mono">{Math.round(expectedImpact).toLocaleString()}</span>{" "}
        — that&rsquo;s what the model would guess for an &ldquo;average&rdquo;
        engineer with no information. Each feature then moves the prediction up
        or down, based on this engineer&rsquo;s actual values. The final bar is
        the model&rsquo;s prediction for {engineer.name.split(" ")[0]}:{" "}
        <span className="font-mono">{explainedPrediction.toLocaleString()}</span> —{" "}
        {Math.abs(pctVsBaseline)}% {direction} baseline.
      </div>

      <WaterfallChart engineer={engineer} expectedImpact={expectedImpact} />
    </div>
  );
}
