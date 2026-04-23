"use client";

import { useState } from "react";
import type { ImpactGroupedImportance } from "@/lib/data/impact-model";

const GROUP_COLOR: Record<string, string> = {
  Tenure: "#7a5a3e",
  "Slack engagement": "#3f7ca0",
  "AI usage": "#c4673f",
  "Performance review": "#6a8b4c",
  "PR cadence": "#2d6a5c",
  "PR habits": "#4a8b7c",
  "Code style": "#2d6a5c",
  Pillar: "#8b5a9c",
  Discipline: "#9c5d2e",
  Level: "#4a6b7c",
  Gender: "#8e8680",
  Location: "#8e8680",
  Other: "#8e8680",
};

interface FeatureEntry {
  name: string;
  label: string;
}

export function GroupedImportanceChart({
  data,
  featuresByGroup,
}: {
  data: ImpactGroupedImportance[];
  featuresByGroup?: Record<string, FeatureEntry[]>;
}) {
  const sorted = [...data].sort((a, b) => b.mean_abs_shap - a.mean_abs_shap);
  const total = sorted.reduce((s, d) => s + d.mean_abs_shap, 0);
  const maxVal = Math.max(...sorted.map((d) => d.mean_abs_shap));

  return (
    <div className="space-y-1.5">
      {sorted.map((d) => {
        const pct = total > 0 ? (d.mean_abs_shap / total) * 100 : 0;
        const barPct = maxVal > 0 ? (d.mean_abs_shap / maxVal) * 100 : 0;
        const features = featuresByGroup?.[d.group] ?? [];
        return (
          <GroupRow
            key={d.group}
            group={d.group}
            pct={pct}
            barPct={barPct}
            color={GROUP_COLOR[d.group] ?? "#8e8680"}
            features={features}
          />
        );
      })}
    </div>
  );
}

function GroupRow({
  group,
  pct,
  barPct,
  color,
  features,
}: {
  group: string;
  pct: number;
  barPct: number;
  color: string;
  features: FeatureEntry[];
}) {
  const [hover, setHover] = useState(false);
  const hasFeatures = features.length > 0;
  return (
    <div
      className="relative grid grid-cols-[150px_1fr_60px] items-center gap-3 py-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={hasFeatures ? 0 : -1}
      aria-label={hasFeatures ? `${group}: ${features.length} features` : group}
    >
      <span className="text-right text-[13px] font-medium text-foreground">
        {group}
      </span>
      <div className="relative h-6 w-full overflow-hidden rounded-md bg-muted/15">
        <div
          className="h-full rounded-md transition-[width] duration-200"
          style={{ width: `${barPct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-[12px] text-muted-foreground">
        {pct.toFixed(0)}%
      </span>

      {hover && hasFeatures && (
        <div
          role="tooltip"
          className="absolute left-[160px] top-full z-20 mt-1 w-[22rem] max-w-[calc(100vw-32px)] rounded-lg border border-border/60 bg-popover p-3 text-[12px] shadow-lg"
        >
          <p className="mb-2 font-medium text-foreground">
            {group} — {features.length} feature{features.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-1 text-muted-foreground">
            {features.map((f) => (
              <li
                key={f.name}
                className="flex items-baseline justify-between gap-3"
              >
                <span>{f.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground/60">
                  {f.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
