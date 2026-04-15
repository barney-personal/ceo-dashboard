"use client";

import { LineChart, type LineChartSeries } from "@/components/charts/line-chart";

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
  const prChartSeries: LineChartSeries[] = [
    { label: "PRs Merged", color: "#3b3bba", data: prSeries },
  ];

  const commitChartSeries: LineChartSeries[] = [
    { label: "Commits", color: "#6b5bbd", data: commitSeries },
  ];

  const linesChartSeries: LineChartSeries[] = [
    { label: "Additions", color: "#16a34a", data: additionsSeries },
    { label: "Deletions", color: "#dc2626", data: deletionsSeries },
  ];

  const hasData =
    prSeries.some((d) => d.value > 0) ||
    commitSeries.some((d) => d.value > 0);

  if (!hasData) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50">
        <p className="text-sm text-muted-foreground">
          No activity data in this period.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <LineChart
        series={prChartSeries}
        title="PRs Merged"
        subtitle="Per week"
        yLabel="PRs"
        yFormatType="number"
      />
      <LineChart
        series={commitChartSeries}
        title="Commits"
        subtitle="Per week"
        yLabel="Commits"
        yFormatType="number"
      />
      <LineChart
        series={linesChartSeries}
        title="Lines Changed"
        subtitle="Per week"
        yLabel="Lines"
        yFormatType="number"
        className="lg:col-span-2"
      />
    </div>
  );
}
