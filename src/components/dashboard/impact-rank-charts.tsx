"use client";

import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";

export interface ImpactRankMonth {
  month: string;
  prs: number;
  lines: number;
  impact: number;
  rank: number | null;
  totalEngineers: number;
}

export function ImpactRankCharts({ monthly }: { monthly: ImpactRankMonth[] }) {
  if (monthly.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50">
        <p className="text-sm text-muted-foreground">
          No merged PRs in this window.
        </p>
      </div>
    );
  }

  const impactData = monthly.map((m) => ({
    date: m.month,
    value: m.impact,
  }));

  // Percentile = 1 - (rank - 1) / totalEngineers, scaled to 0–100.
  // Rank 1 of 50 → 100. Rank 50 of 50 → 2. Null rank months are dropped.
  const percentileSeries = {
    label: "Percentile",
    color: "#3b3bba",
    data: monthly
      .filter((m) => m.rank !== null && m.totalEngineers > 0)
      .map((m) => ({
        date: m.month,
        value: Math.round((1 - (m.rank! - 1) / m.totalEngineers) * 100),
      })),
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ColumnChart
        title="Impact score"
        subtitle="Monthly · PRs × log₂(1 + lines/PR)"
        data={impactData}
        yLabel="Impact"
        yFormatType="compact"
      />
      <LineChart
        title="Relative rank"
        subtitle="Percentile among engineers active that month (100 = top)"
        series={[percentileSeries]}
        yLabel="Percentile"
        yFormatType="number"
      />
    </div>
  );
}
