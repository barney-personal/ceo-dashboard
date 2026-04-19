import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { ColumnChart } from "@/components/charts/column-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  currentMonth,
  getEnpsDistribution,
  getEnpsMonthlyTrend,
  getEnpsReasonExcerpts,
  getEnpsResponseRate,
  type EnpsMonthlyAggregate,
} from "@/lib/data/enps";
import { Heart } from "lucide-react";

export default async function EnpsAdminPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) redirect("/dashboard");

  const month = currentMonth();

  const [trend, distribution, responseRate, reasons] = await Promise.all([
    getEnpsMonthlyTrend(12),
    getEnpsDistribution(month),
    getEnpsResponseRate(month),
    getEnpsReasonExcerpts(50),
  ]);

  const latest = trend[trend.length - 1] as EnpsMonthlyAggregate | undefined;
  const hasAnyData = trend.length > 0;

  const distributionData = distribution.map((d) => ({
    date: String(d.score),
    value: d.count,
  }));

  const averageTrend = trend.map((t) => ({
    date: `${t.month}-01`,
    value: t.average ?? 0,
  }));

  const enpsTrend = trend
    .filter((t) => t.enps !== null)
    .map((t) => ({
      date: `${t.month}-01`,
      value: t.enps ?? 0,
    }));

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Employee Happiness"
        description="Monthly eNPS pulse — anonymous to the team, CEO-only view"
      />

      {!hasAnyData && (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/50 bg-card/50">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Heart className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              No responses yet
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              The takeover shows on next login — responses will appear here as
              the team answers.
            </p>
          </div>
        </div>
      )}

      {hasAnyData && (
        <>
          {/* Current month summary */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Current eNPS"
              value={formatEnps(latest?.enps ?? null)}
              subtitle={latest ? formatMonthLabel(latest.month) : "—"}
            />
            <MetricCard
              label="Avg score"
              value={
                latest?.average != null ? latest.average.toFixed(1) : "—"
              }
              subtitle={
                latest?.responseCount
                  ? `${latest.responseCount} responses`
                  : "No responses"
              }
            />
            <MetricCard
              label="Response rate"
              value={
                responseRate.rate != null
                  ? `${Math.round(responseRate.rate * 100)}%`
                  : "—"
              }
              subtitle={`${responseRate.responded} of ${responseRate.prompted} prompted`}
            />
            <MetricCard
              label="Breakdown"
              value={
                latest
                  ? `${latest.promoters}·${latest.passives}·${latest.detractors}`
                  : "—"
              }
              subtitle="Promoters · Passives · Detractors"
            />
          </section>

          {/* eNPS trend */}
          <section className="space-y-6">
            <SectionDivider
              title="eNPS Trend"
              subtitle="Monthly score: % promoters (9–10) minus % detractors (0–6)"
            />
            {enpsTrend.length > 0 ? (
              <ColumnChart
                data={enpsTrend}
                title="eNPS by Month"
                subtitle="Range −100 to 100"
                yLabel="eNPS"
                yFormatType="number"
                color="#3b3bba"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Not enough responses yet for a trend.
              </p>
            )}
          </section>

          {/* Average score */}
          <section className="space-y-6">
            <SectionDivider
              title="Average Score"
              subtitle="Monthly average (0–10)"
            />
            <ColumnChart
              data={averageTrend}
              title="Average happiness"
              subtitle="Out of 10"
              yLabel="Score"
              yFormatType="number"
              color="oklch(0.6 0.15 25)"
            />
          </section>

          {/* Distribution for the current month */}
          <section className="space-y-6">
            <SectionDivider
              title="This Month's Distribution"
              subtitle={`Score counts for ${formatMonthLabel(month)}`}
            />
            <ColumnChart
              data={distributionData}
              title="Responses by score"
              subtitle="0 = not happy, 10 = love it here"
              yLabel="Responses"
              yFormatType="number"
              color="#3b3bba"
            />
          </section>

          {/* Reasons */}
          <section className="space-y-6">
            <SectionDivider
              title="Recent Reasons"
              subtitle="Free-text answers, newest first (linked to employee for testing)"
            />
            {reasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No written reasons yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {reasons.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10"
                  >
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                      <span
                        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold ${toneFor(r.score)}`}
                      >
                        {r.score}
                      </span>
                      <span>{formatMonthLabel(r.month)}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <time>{new Date(r.createdAt).toLocaleDateString()}</time>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {r.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function formatEnps(enps: number | null): string {
  if (enps == null) return "—";
  return (enps >= 0 ? "+" : "") + enps.toFixed(0);
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function toneFor(score: number): string {
  if (score >= 9) return "bg-positive/15 text-positive";
  if (score >= 7) return "bg-muted text-foreground";
  return "bg-destructive/10 text-destructive";
}
