"use client";

import { useMemo } from "react";
import { LineChart } from "@/components/charts/line-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { AlertTriangle } from "lucide-react";
import {
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  buildTeamChartSeries,
  predictHiresPerRecruiter,
  sumToTeamMonthly,
  type RecruiterSummary,
  type TalentHireRow,
  type TalentTargetRow,
} from "@/lib/data/talent-utils";

interface TalentPageClientProps {
  hireRows: TalentHireRow[];
  targets: TalentTargetRow[];
  modeUrl: string;
  emptyReason: string | null;
}

const PROJECTION_MONTHS = 3;

function formatNumber(n: number, fractionDigits = 1): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  return n.toFixed(fractionDigits);
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

function attainmentClass(attainment: number | null): string {
  if (attainment == null) return "text-muted-foreground";
  if (attainment >= 1) return "text-positive";
  if (attainment >= 0.7) return "text-foreground";
  return "text-negative";
}

function lastActualMonth(rows: TalentHireRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.actionType !== "hires" || !(row.cnt > 0)) continue;
    const month = row.actionDate.slice(0, 7);
    if (!latest || month > latest) latest = month;
  }
  return latest;
}

function formatMonthLabel(month: string | null): string {
  if (!month) return "—";
  const [y, m] = month.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function TalentEmpty({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-warning" />
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}

function RecruiterTable({ summaries }: { summaries: RecruiterSummary[] }) {
  if (summaries.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="border-b border-border/50 px-5 py-3">
        <span className="text-sm font-semibold text-foreground">
          Recruiter performance
        </span>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Last 12 months of activity, per-recruiter trailing-3-month average,
          projected next {PROJECTION_MONTHS} months, and current-quarter hires vs
          target.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Recruiter</th>
              <th className="px-4 py-2.5 font-medium">Pillar</th>
              <th className="px-4 py-2.5 text-right font-medium">
                Hires L12m
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                Trailing 3mo
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                Proj. next {PROJECTION_MONTHS}mo
              </th>
              <th className="px-4 py-2.5 text-right font-medium">QTD</th>
              <th className="px-4 py-2.5 text-right font-medium">Target</th>
              <th className="px-4 py-2.5 text-right font-medium">Attainment</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr
                key={s.recruiter}
                className="border-t border-border/40 hover:bg-muted/30"
              >
                <td className="px-4 py-2.5 font-medium text-foreground">
                  {s.recruiter}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {s.tech ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.hiresLast12m}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatNumber(s.trailing3mAvg)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatNumber(s.projectedNext3m)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.hiresQtd == null ? "—" : formatNumber(s.hiresQtd)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {s.targetQtd == null ? "—" : formatNumber(s.targetQtd)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium tabular-nums ${attainmentClass(s.attainmentQtd)}`}
                >
                  {s.attainmentQtd == null
                    ? "—"
                    : formatPercent(s.attainmentQtd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TalentPageClient({
  hireRows,
  targets,
  modeUrl,
  emptyReason,
}: TalentPageClientProps) {
  const { histories, teamActual, teamProjection, summaries, latestMonth } =
    useMemo(() => {
      const histories = aggregateHiresByRecruiterMonth(hireRows);
      const teamActual = sumToTeamMonthly(histories);
      const teamProjection = sumToTeamMonthly(
        predictHiresPerRecruiter(histories, PROJECTION_MONTHS),
      );
      const summaries = buildRecruiterSummaries(histories, targets);
      const latestMonth = lastActualMonth(hireRows);
      return {
        histories,
        teamActual,
        teamProjection,
        summaries,
        latestMonth,
      };
    }, [hireRows, targets]);

  if (emptyReason) {
    return <TalentEmpty reason={emptyReason} />;
  }

  const trailing3mTeam = teamActual
    .slice(-3)
    .reduce((s, m) => s + m.hires, 0);
  const trailing3mAvgTeam = trailing3mTeam / Math.max(1, Math.min(3, teamActual.length));
  const projectedNext3Total = teamProjection.reduce((s, m) => s + m.hires, 0);
  const hiresLast12m = teamActual
    .slice(-12)
    .reduce((s, m) => s + m.hires, 0);

  const hiresQtdTeam = targets.reduce((s, t) => s + t.hiresQtd, 0);
  const targetQtdTeam = targets.reduce((s, t) => s + t.targetQtd, 0);
  const qtdAttainment =
    targetQtdTeam > 0 ? hiresQtdTeam / targetQtdTeam : null;

  const chartSeries = buildTeamChartSeries(
    teamActual.slice(-24),
    teamProjection,
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Hires · last 12 months"
          value={formatNumber(hiresLast12m, 0)}
          subtitle="total"
          modeUrl={modeUrl}
        />
        <MetricCard
          label="Trailing 3mo avg"
          value={formatNumber(trailing3mAvgTeam)}
          subtitle="hires / month"
        />
        <MetricCard
          label={`Projected next ${PROJECTION_MONTHS}mo`}
          value={formatNumber(projectedNext3Total, 0)}
          subtitle="hires (team)"
        />
        <MetricCard
          label="QTD vs target"
          value={
            qtdAttainment == null
              ? "—"
              : formatPercent(qtdAttainment)
          }
          subtitle={
            qtdAttainment == null
              ? undefined
              : `${formatNumber(hiresQtdTeam)} / ${formatNumber(targetQtdTeam)}`
          }
        />
      </div>

      <SectionDivider
        title="Team trajectory"
        subtitle={`Monthly hires summed across all recruiters. Data through ${formatMonthLabel(
          latestMonth,
        )}; the dashed tail projects ${PROJECTION_MONTHS} months forward at each recruiter's trailing-3-month average.`}
      />

      {chartSeries.length > 0 ? (
        <LineChart
          series={chartSeries}
          title="Team hires per month"
          yLabel="hires"
          yFormatType="number"
          modeUrl={modeUrl}
        />
      ) : (
        <TalentEmpty reason="No hire data to chart yet — refresh the Mode sync." />
      )}

      <SectionDivider
        title="Per-recruiter breakdown"
        subtitle="Current-quarter attainment and projected 3-month output for each recruiter on the target roster."
      />

      <RecruiterTable summaries={summaries} />

      {histories.length === 0 && (
        <TalentEmpty reason="No per-recruiter hire history available." />
      )}
    </>
  );
}
