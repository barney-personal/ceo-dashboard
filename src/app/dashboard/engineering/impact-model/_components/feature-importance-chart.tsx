"use client";

import { useRef, useEffect, useCallback } from "react";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { max } from "d3-array";
import type { ImpactFeatureImportance } from "@/lib/data/impact-model";
import { getContentBoxWidth } from "@/components/charts/chart-utils";

const FEATURE_LABELS: Record<string, string> = {
  tenure_months: "Tenure (months)",
  slack_msgs_per_day: "Slack msgs / day",
  slack_reactions_per_day: "Slack reactions / day",
  slack_active_day_rate: "Slack active-day rate",
  slack_desktop_share: "Slack desktop share",
  slack_channel_share: "Slack channel share (vs DM)",
  slack_days_since_active: "Days since last Slack active",
  ai_tokens_log: "AI tokens (log)",
  ai_cost_log: "AI cost (log)",
  ai_n_days: "AI usage days",
  ai_max_models: "Distinct AI models used",
  avg_rating: "Avg perf rating",
  latest_rating: "Latest perf rating",
  rating_count: "Perf review count",
  level_num: "Level number",
};

function prettyName(raw: string): string {
  if (FEATURE_LABELS[raw]) return FEATURE_LABELS[raw];
  // e.g. pillar_Win_On_Data → "Pillar: Win On Data"
  const idx = raw.indexOf("_");
  if (idx > 0) {
    const prefix = raw.slice(0, idx);
    const value = raw.slice(idx + 1).replace(/_/g, " ");
    return `${prefix[0].toUpperCase()}${prefix.slice(1)}: ${value}`;
  }
  return raw;
}

interface Props {
  features: ImpactFeatureImportance[];
  topN?: number;
}

export function FeatureImportanceChart({ features, topN = 18 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;
    const data = features.slice(0, topN);

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const barHeight = 26;
    const margin = { top: 24, right: 80, bottom: 8, left: 220 };
    const height = data.length * barHeight + margin.top + margin.bottom;
    const innerW = width - margin.left - margin.right;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const maxPerm =
      max(data, (d) => Math.max(d.permutation_mean + d.permutation_std, d.impurity)) ?? 1;
    const x = scaleLinear().domain([0, maxPerm]).range([0, innerW]);

    // Baseline axis
    g.append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", -4)
      .attr("y2", -4)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.2);

    // Ticks
    x.ticks(5).forEach((t) => {
      g.append("line")
        .attr("x1", x(t))
        .attr("x2", x(t))
        .attr("y1", -8)
        .attr("y2", data.length * barHeight)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.08);
      g.append("text")
        .attr("x", x(t))
        .attr("y", -12)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.6)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .text(t.toFixed(2));
    });

    data.forEach((d, i) => {
      const y = i * barHeight;
      // impurity bar (lighter)
      g.append("rect")
        .attr("x", 0)
        .attr("y", y + 4)
        .attr("width", Math.max(0, x(d.impurity)))
        .attr("height", 8)
        .attr("fill", "#c4976b")
        .attr("fill-opacity", 0.5)
        .attr("rx", 2);
      // permutation bar (darker)
      g.append("rect")
        .attr("x", 0)
        .attr("y", y + 13)
        .attr("width", Math.max(0, x(Math.max(0, d.permutation_mean))))
        .attr("height", 8)
        .attr("fill", "#9c5d2e")
        .attr("rx", 2);
      // error whisker for permutation
      if (d.permutation_std > 0) {
        const lo = Math.max(0, d.permutation_mean - d.permutation_std);
        const hi = d.permutation_mean + d.permutation_std;
        g.append("line")
          .attr("x1", x(lo))
          .attr("x2", x(hi))
          .attr("y1", y + 17)
          .attr("y2", y + 17)
          .attr("stroke", "#9c5d2e")
          .attr("stroke-opacity", 0.55)
          .attr("stroke-width", 1);
      }
      // label
      g.append("text")
        .attr("x", -10)
        .attr("y", y + 14)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 11)
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.85)
        .text(prettyName(d.name));
      // value
      g.append("text")
        .attr("x", innerW + 8)
        .attr("y", y + 14)
        .attr("dominant-baseline", "middle")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono, ui-monospace)")
        .attr("fill", "currentColor")
        .attr("fill-opacity", 0.7)
        .text(d.permutation_mean.toFixed(3));
    });

    // Legend
    const legend = svg.append("g").attr("transform", `translate(${margin.left},6)`);
    legend
      .append("rect")
      .attr("width", 10)
      .attr("height", 6)
      .attr("fill", "#9c5d2e")
      .attr("rx", 1);
    legend
      .append("text")
      .attr("x", 14)
      .attr("y", 6)
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.7)
      .text("Permutation");
    legend
      .append("rect")
      .attr("x", 100)
      .attr("width", 10)
      .attr("height", 6)
      .attr("fill", "#c4976b")
      .attr("fill-opacity", 0.5)
      .attr("rx", 1);
    legend
      .append("text")
      .attr("x", 114)
      .attr("y", 6)
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.7)
      .text("Impurity (Gini)");
  }, [features, topN]);

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
