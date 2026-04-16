"use client";

import { ColumnChart } from "@/components/charts/column-chart";
import { DivergingBarChart } from "@/components/charts/diverging-bar-chart";

interface EngineerProfileChartsProps {
  prSeries: { date: string; value: number }[];
  commitSeries: { date: string; value: number }[];
  additionsSeries: { date: string; value: number }[];
  deletionsSeries: { date: string; value: number }[];
}

export function EngineerProfileCharts({
  prSeries,
  commitSeries,
  additionsSeries,
  deletionsSeries,
}: EngineerProfileChartsProps) {
  const hasData =
    prSeries.some((d) => d.value > 0) || commitSeries.some((d) => d.value > 0);

  if (!hasData) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50">
        <p className="text-sm text-muted-foreground">
          No activity data in this period.
        </p>
      </div>
    );
  }

  // Join additions + deletions into the diverging-bar shape
  const linesDiverging = additionsSeries.map((a, i) => ({
    date: a.date,
    positive: a.value,
    negative: deletionsSeries[i]?.value ?? 0,
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ColumnChart
        data={prSeries}
        title="PRs Merged"
        subtitle="Per week"
        yLabel="PRs"
        yFormatType="number"
        color="#3b3bba"
      />
      <ColumnChart
        data={commitSeries}
        title="Commits"
        subtitle="Per week"
        yLabel="Commits"
        yFormatType="number"
        color="#6b5bbd"
      />
      <DivergingBarChart
        data={linesDiverging}
        title="Lines Changed"
        subtitle="Per week — additions above zero, deletions below"
        positiveLabel="Additions"
        negativeLabel="Deletions"
        positiveColor="#16a34a"
        negativeColor="#dc2626"
        showNetLine={false}
        className="lg:col-span-2"
      />
    </div>
  );
}
