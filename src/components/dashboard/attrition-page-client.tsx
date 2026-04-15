"use client";

import { useState, useMemo } from "react";
import { LineChart } from "@/components/charts/line-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionDivider } from "@/components/dashboard/section-divider";
import {
  AttritionFilters,
  type AttritionFilterState,
} from "@/components/dashboard/attrition-filters";
import {
  getRollingAttritionSeries,
  getAttritionByDepartment,
  getLatestAttritionMetrics,
  getY1AttritionSeries,
  getLatestY1Metrics,
  getRecentLeavers,
  type AttritionRow,
  type Y1AttritionRow,
  type Leaver,
} from "@/lib/data/attrition-utils";
import { AlertTriangle } from "lucide-react";

interface AttritionPageClientProps {
  rollingAttrition: AttritionRow[];
  y1Attrition: Y1AttritionRow[];
  recentLeavers: Leaver[];
  departments: string[];
  tenureBuckets: string[];
  modeUrl: string;
  emptyReason: string | null;
}

function ChartPlaceholder({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="border-b border-border/50 px-5 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex h-48 items-center justify-center gap-3 p-5">
        <AlertTriangle className="h-5 w-5 text-warning" />
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatPpChange(current: number, previous: number): string {
  const diff = (current - previous) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}pp`;
}

function trend(current: number, previous: number): "up" | "down" | "flat" {
  if (current < previous) return "down";
  if (current > previous) return "up";
  return "flat";
}

function AttritionChart({ series, title, subtitle, modeUrl }: {
  series: { label: string; color: string; data: { date: string; value: number }[]; dashed?: boolean }[];
  title: string;
  subtitle: string;
  modeUrl: string;
}) {
  return (
    <LineChart
      series={series}
      title={title}
      subtitle={subtitle}
      yLabel="%"
      yFormatType="percent"
      modeUrl={modeUrl}
    />
  );
}

function LeaversTable({ leavers, department }: { leavers: Leaver[]; department: string | null }) {
  const filtered = useMemo(() => {
    let result = getRecentLeavers(leavers);
    if (department) {
      result = result.filter((l) => l.department === department);
    }
    return result;
  }, [leavers, department]);

  if (filtered.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-warm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 text-left">
            {["Name", "Department", "Squad", "Level", "Tenure", "Left", "Type", "Regretted", "Manager"].map((h) => (
              <th key={h} className="px-4 py-3 font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((leaver, i) => (
            <tr key={`${leaver.name}-${i}`} className="border-b border-border/30 last:border-0">
              <td className="px-4 py-2.5 font-medium">{leaver.name}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{leaver.department}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{leaver.squad}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{leaver.level}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{leaver.tenureMonths}mo</td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {new Date(leaver.terminationDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </td>
              <td className="px-4 py-2.5">
                <span className={leaver.terminationType === "Voluntary" ? "text-warning" : "text-destructive"}>
                  {leaver.terminationType}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className={leaver.regretted === "Regrettable" ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {leaver.regretted || "\u2014"}
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{leaver.managerName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttritionPageClient({
  rollingAttrition,
  y1Attrition,
  recentLeavers,
  departments,
  tenureBuckets,
  modeUrl,
  emptyReason,
}: AttritionPageClientProps) {
  const [filters, setFilters] = useState<AttritionFilterState>({
    department: null,
    tenure: null,
  });

  const dept = filters.department ?? undefined;
  const ten = filters.tenure ?? undefined;

  const rollingSeries = useMemo(() => getRollingAttritionSeries(rollingAttrition, dept, ten), [rollingAttrition, dept, ten]);
  const deptSeries = useMemo(() => getAttritionByDepartment(rollingAttrition), [rollingAttrition]);
  const rollingMetrics = useMemo(() => getLatestAttritionMetrics(rollingAttrition), [rollingAttrition]);
  const underOneYearSeries = useMemo(() => getRollingAttritionSeries(rollingAttrition, dept, "< 1 Year"), [rollingAttrition, dept]);
  const overOneYearSeries = useMemo(() => getRollingAttritionSeries(rollingAttrition, dept, "1+ Year"), [rollingAttrition, dept]);
  const y1Series = useMemo(() => getY1AttritionSeries(y1Attrition, dept), [y1Attrition, dept]);
  const y1Metrics = useMemo(() => getLatestY1Metrics(y1Attrition), [y1Attrition]);

  const hasRollingData = rollingAttrition.length > 0;
  const hasY1Data = y1Attrition.length > 0;

  if (!hasRollingData && !hasY1Data && emptyReason) {
    return <ChartPlaceholder title="Attrition Tracker" reason={emptyReason} />;
  }

  return (
    <div className="space-y-10">
      <AttritionFilters
        departments={departments}
        tenureBuckets={tenureBuckets}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {/* Rolling Attrition Rate */}
      <section className="space-y-6">
        <SectionDivider
          title="Rolling Attrition Rate (12M Average)"
          subtitle="Number of leavers within last 12 months / average headcount of the last 12 months"
        />

        {hasRollingData ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard
                label="Rolling 12M Attrition"
                value={formatPercent(rollingMetrics.currentRate)}
                change={formatPpChange(rollingMetrics.currentRate, rollingMetrics.previousRate)}
                trend={trend(rollingMetrics.currentRate, rollingMetrics.previousRate)}
                subtitle={`${rollingMetrics.leaversL12m} leavers / ${Math.round(rollingMetrics.headcount)} avg HC`}
                modeUrl={modeUrl}
                delay={0}
              />
              <MetricCard
                label="Regretted Attrition"
                value={formatPercent(rollingMetrics.regrettedRate)}
                change={formatPpChange(rollingMetrics.regrettedRate, rollingMetrics.previousRegrettedRate)}
                trend={trend(rollingMetrics.regrettedRate, rollingMetrics.previousRegrettedRate)}
                subtitle="Voluntary regretted leavers"
                modeUrl={modeUrl}
                delay={100}
              />
              <MetricCard
                label="Non-Regretted Attrition"
                value={formatPercent(rollingMetrics.nonRegrettedRate)}
                subtitle="Voluntary non-regretted + involuntary"
                modeUrl={modeUrl}
                delay={200}
              />
            </div>

            <AttritionChart series={rollingSeries} title="Rolling Attrition Rate" subtitle="12-month rolling, by leaver type" modeUrl={modeUrl} />

            {!filters.tenure && (
              <div className="grid gap-6 lg:grid-cols-2">
                <AttritionChart series={underOneYearSeries} title="< 1 Year Tenure" subtitle="Rolling 12M attrition, by leaver type" modeUrl={modeUrl} />
                <AttritionChart series={overOneYearSeries} title="1+ Year Tenure" subtitle="Rolling 12M attrition, by leaver type" modeUrl={modeUrl} />
              </div>
            )}

            {!filters.department && deptSeries.length > 0 && (
              <AttritionChart series={deptSeries} title="Attrition by Department" subtitle="12-month rolling total attrition rate" modeUrl={modeUrl} />
            )}
          </>
        ) : (
          <ChartPlaceholder title="Rolling Attrition" reason={emptyReason ?? "No attrition data available"} />
        )}
      </section>

      {/* First Year (Y1) Attrition Rate */}
      <section className="space-y-6">
        <SectionDivider
          title="First Year (Y1) Attrition Rate"
          subtitle="Number of employees leaving within Y1 since joining / number of new joiners within the last 12 months"
        />

        {hasY1Data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard
                label="Y1 Attrition Rate"
                value={formatPercent(y1Metrics.currentRate)}
                change={formatPpChange(y1Metrics.currentRate, y1Metrics.previousRate)}
                trend={trend(y1Metrics.currentRate, y1Metrics.previousRate)}
                subtitle={`${y1Metrics.leavers} Y1 leavers / ${y1Metrics.starters} starters (L12M)`}
                modeUrl={modeUrl}
                delay={0}
              />
              <MetricCard
                label="Y1 Regretted"
                value={formatPercent(y1Metrics.regrettedRate)}
                subtitle="Regretted Y1 leavers"
                modeUrl={modeUrl}
                delay={100}
              />
            </div>

            <AttritionChart series={y1Series} title="Y1 Attrition Rate" subtitle="12-month rolling, by leaver type" modeUrl={modeUrl} />
          </>
        ) : (
          <ChartPlaceholder title="Y1 Attrition" reason={emptyReason ?? "No Y1 attrition data available"} />
        )}
      </section>

      {/* Recent Leavers */}
      {recentLeavers.length > 0 && (
        <section className="space-y-6">
          <SectionDivider title="Recent Leavers" subtitle="Individual departures from the current leaver list" />
          <LeaversTable leavers={recentLeavers} department={filters.department} />
        </section>
      )}
    </div>
  );
}
