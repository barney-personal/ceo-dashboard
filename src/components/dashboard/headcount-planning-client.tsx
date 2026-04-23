"use client";

import { useMemo } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { HireForecastChart } from "@/components/charts/hire-forecast-chart";
import type {
  CohortProjectionResult,
  HeadcountProjection,
} from "@/lib/data/headcount-planning";

interface HeadcountPlanningClientProps {
  projection: HeadcountProjection;
  /** Diagnostic: pooled Kaplan-Meier curve on individual FTE tenures.
   *  Shown in the cross-check so readers can see how much pooled history
   *  differs from Mode's rolling-12m team-standard curve. */
  kmProjection: HeadcountProjection;
  cohortProjection: CohortProjectionResult;
  rollingRates: { under1yrAnnual: number; over1yrAnnual: number };
  hireScenarios: { low: number; mid: number; high: number };
  activeTpCount: number;
  emptyReason: string | null;
}

function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

// Date the MAE/bias numbers in AttritionCrossCheck were computed from a
// fresh run of scripts/backtest-attrition-curves.ts. If Mode data shifts
// materially (attrition regime change), re-run the script and bump this
// date so the staleness is visible to readers.
const BACKTEST_RUN_DATE = "2026-04-23";

function formatMonth(m: string): string {
  const [y, mo] = m.split("-");
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const idx = Math.max(0, Math.min(11, Number(mo) - 1));
  return `${names[idx]} ${y}`;
}

export function HeadcountPlanningClient({
  projection,
  kmProjection,
  cohortProjection,
  rollingRates,
  hireScenarios,
  activeTpCount,
  emptyReason,
}: HeadcountPlanningClientProps) {
  const { actual, projection: forecast, startingHeadcount } = projection;

  const dec26 = useMemo(
    () => forecast.find((m) => m.month === "2026-12"),
    [forecast],
  );
  const dec27 = useMemo(
    () => forecast.find((m) => m.month === "2027-12"),
    [forecast],
  );
  const nextMonth = forecast[0] ?? null;

  // Trim historical window: show the trailing 24 months of actuals so the
  // forecast fan isn't squashed against the right edge. Earlier years
  // (pre-2024) are below ~200 FTE — visually irrelevant against today's
  // ~560 scale, and the chart's y-axis gets pulled down by them.
  const ACTUAL_WINDOW_MONTHS = 24;
  const actualSeries = useMemo(
    () =>
      actual.slice(-ACTUAL_WINDOW_MONTHS).map((a) => ({
        date: `${a.month}-01`,
        value: a.headcount,
      })),
    [actual],
  );
  const forecastSeries = useMemo(
    () =>
      forecast.map((m) => ({
        date: `${m.month}-01`,
        low: m.low,
        mid: m.mid,
        high: m.high,
      })),
    [forecast],
  );

  if (emptyReason) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <p className="text-sm text-muted-foreground">{emptyReason}</p>
        </div>
      </div>
    );
  }

  const avgMonthlyNet =
    forecast.length === 0
      ? 0
      : forecast.reduce((s, m) => s + m.netChange, 0) / forecast.length;
  const avgMonthlyDepartures =
    forecast.length === 0
      ? 0
      : forecast.reduce((s, m) => s + m.departures, 0) / forecast.length;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Headcount today"
          value={formatNumber(startingHeadcount)}
          subtitle="Active FTEs"
        />
        <MetricCard
          label="Dec 2026 · projected"
          value={dec26 ? formatNumber(dec26.mid) : "—"}
          subtitle={
            dec26
              ? `${formatNumber(dec26.low)}–${formatNumber(dec26.high)} band`
              : undefined
          }
        />
        <MetricCard
          label="Dec 2027 · projected"
          value={dec27 ? formatNumber(dec27.mid) : "—"}
          subtitle={
            dec27
              ? `${formatNumber(dec27.low)}–${formatNumber(dec27.high)} band`
              : undefined
          }
        />
        <MetricCard
          label="Avg monthly net"
          value={`${avgMonthlyNet >= 0 ? "+" : ""}${formatNumber(avgMonthlyNet, 1)}`}
          subtitle={`+${formatNumber(hireScenarios.mid, 1)} hires − ${formatNumber(avgMonthlyDepartures, 1)} exits`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        {actualSeries.length > 0 ? (
          <HireForecastChart
            title="FTE headcount per month"
            subtitle={`Actuals through today; projection = Σ per-FTE survival + monthly hires × S(tenure). 80% band from the P10/P50/P90 hire scenarios.`}
            actual={actualSeries}
            forecast={forecastSeries}
            yLabel="FTEs"
            callouts={[{ date: "2026-12-01", label: "Dec 2026" }]}
          />
        ) : null}
        <MethodologyCard
          hireScenarios={hireScenarios}
          activeTpCount={activeTpCount}
          rollingRates={rollingRates}
          dec26={dec26 ?? null}
          dec27={dec27 ?? null}
          nextMonth={nextMonth}
        />
      </div>

      <AttritionCrossCheck
        production={projection}
        km={kmProjection}
        cohort={cohortProjection}
        rollingRates={rollingRates}
      />

      <section>
        <h2 className="text-lg font-semibold text-foreground">
          Month-by-month breakdown
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mid-scenario hires and departures. Headcount shown for each of the
          three scenarios — the band represents uncertainty in hire rate, not
          in retention.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border/60 bg-card shadow-warm">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Month</th>
                <th className="px-4 py-2.5 text-right font-medium">Hires</th>
                <th className="px-4 py-2.5 text-right font-medium">Exits</th>
                <th className="px-4 py-2.5 text-right font-medium">Net</th>
                <th className="px-4 py-2.5 text-right font-medium">HC low</th>
                <th className="px-4 py-2.5 text-right font-medium">HC mid</th>
                <th className="px-4 py-2.5 text-right font-medium">HC high</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((m) => (
                <tr
                  key={m.month}
                  className="border-t border-border/40 last:border-b-0"
                >
                  <td className="px-4 py-2 text-foreground">
                    {formatMonth(m.month)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.hires, 1)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.departures, 1)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      m.netChange >= 0 ? "text-foreground" : "text-warning"
                    }`}
                  >
                    {m.netChange >= 0 ? "+" : ""}
                    {formatNumber(m.netChange, 1)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.low)}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">
                    {formatNumber(m.mid)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.high)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function MethodologyCard({
  hireScenarios,
  activeTpCount,
  rollingRates,
  dec26,
  dec27,
  nextMonth,
}: {
  hireScenarios: { low: number; mid: number; high: number };
  activeTpCount: number;
  rollingRates: { under1yrAnnual: number; over1yrAnnual: number };
  dec26: { low: number; mid: number; high: number } | null;
  dec27: { low: number; mid: number; high: number } | null;
  nextMonth: { low: number; mid: number; high: number } | null;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">
          How the plan works
        </span>
      </div>
      <div className="space-y-4 px-4 py-4 text-xs leading-relaxed text-muted-foreground">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            Hires
          </div>
          <p className="mt-1">
            Roster-anchored forecast from the{" "}
            <span className="font-semibold text-foreground">
              {activeTpCount} active Talent Partners
            </span>{" "}
            — P10 / P50 / P90 ={" "}
            <span className="font-mono">
              {hireScenarios.low.toFixed(1)} / {hireScenarios.mid.toFixed(1)} /{" "}
              {hireScenarios.high.toFixed(1)}
            </span>
            &nbsp;hires per month, held flat.
          </p>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            Retention
          </div>
          <p className="mt-1">
            <span className="font-semibold text-foreground">
              Mode rolling-12m tenure rates
            </span>{" "}
            — &lt;1yr:{" "}
            <span className="font-mono text-foreground">
              {(rollingRates.under1yrAnnual * 100).toFixed(1)}%
            </span>
            , &gt;1yr:{" "}
            <span className="font-mono text-foreground">
              {(rollingRates.over1yrAnnual * 100).toFixed(1)}%
            </span>{" "}
            annualised, applied as a piecewise-constant monthly hazard.
            Same source the Talent team uses. Each existing FTE contributes
            S(tenure+k)/S(tenure); each forecasted hire joins a cohort that
            decays at S(t).
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            A pooled Kaplan-Meier curve over individual FTE tenures is
            still computed as a diagnostic — surfaced in the cross-check
            card below.
          </p>
        </div>
        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            Projected FTE headcount · P10 — P50 — P90
          </div>
          <HcRow label="Next month" data={nextMonth} />
          <div className="h-px bg-border/50" />
          <HcRow label="Dec 2026" data={dec26} />
          <HcRow label="Dec 2027" data={dec27} />
        </div>
        <div className="text-[11px] italic text-muted-foreground/70">
          Band reflects hire-rate uncertainty only. Retention curve is a
          point estimate — long-tenure survival has wide CIs that we don&apos;t
          surface here.
        </div>
      </div>
    </div>
  );
}

function HcRow({
  label,
  data,
}: {
  label: string;
  data: { low: number; mid: number; high: number } | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-muted-foreground/80">{label}</span>
      {data ? (
        <span className="tabular-nums">
          <span className="font-mono text-[11px] text-muted-foreground/60">
            {data.low.toFixed(0)}–
          </span>
          <span className="text-sm font-semibold text-foreground">
            {data.mid.toFixed(0)}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/60">
            –{data.high.toFixed(0)}
          </span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground/50">—</span>
      )}
    </div>
  );
}

function AttritionCrossCheck({
  production,
  km,
  cohort,
  rollingRates,
}: {
  production: HeadcountProjection;
  km: HeadcountProjection;
  cohort: CohortProjectionResult;
  rollingRates: { under1yrAnnual: number; over1yrAnnual: number };
}) {
  const get = (p: HeadcountProjection, month: string) =>
    p.projection.find((m) => m.month === month)?.mid ?? null;
  const pDec26 = get(production, "2026-12");
  const pDec27 = get(production, "2027-12");
  const kmDec26 = get(km, "2026-12");
  const kmDec27 = get(km, "2027-12");
  const cDec26 = cohort.projection.find((m) => m.month === "2026-12")?.mid ?? null;
  const cDec27 = cohort.projection.find((m) => m.month === "2027-12")?.mid ?? null;

  const diff = (a: number | null, b: number | null) =>
    a != null && b != null ? a - b : null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Cross-check: three attrition models
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The production forecast uses{" "}
          <span className="font-semibold text-foreground">
            Mode rolling-12m tenure rates
          </span>{" "}
          (&lt;1yr: {(rollingRates.under1yrAnnual * 100).toFixed(1)}%, &gt;1yr:{" "}
          {(rollingRates.over1yrAnnual * 100).toFixed(1)}% annualised) — same
          source the Talent team uses. Chosen by rolling-origin backtest
          over 5 cutoffs at 3 / 6 / 12-month horizons:
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border/60 bg-muted/20">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground/80">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">
                  MAE @ h=3
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  MAE @ h=6
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  MAE @ h=12
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Bias @ h=12
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr className="border-t border-border/40">
                <td className="px-3 py-2 font-semibold text-foreground">
                  Mode rolling-12m ← production
                </td>
                <td className="px-3 py-2 text-right text-foreground">
                  3.46
                </td>
                <td className="px-3 py-2 text-right text-foreground">
                  3.82
                </td>
                <td className="px-3 py-2 text-right font-semibold text-foreground">
                  3.23
                </td>
                <td className="px-3 py-2 text-right text-foreground">
                  −1.34
                </td>
              </tr>
              <tr className="border-t border-border/40 text-muted-foreground">
                <td className="px-3 py-2">Recency-weighted KM (hl=9mo)</td>
                <td className="px-3 py-2 text-right">3.52</td>
                <td className="px-3 py-2 text-right">3.76</td>
                <td className="px-3 py-2 text-right">3.94</td>
                <td className="px-3 py-2 text-right">−3.44</td>
              </tr>
              <tr className="border-t border-border/40 text-muted-foreground">
                <td className="px-3 py-2">Pooled Kaplan-Meier</td>
                <td className="px-3 py-2 text-right">3.56</td>
                <td className="px-3 py-2 text-right">3.91</td>
                <td className="px-3 py-2 text-right">4.05</td>
                <td className="px-3 py-2 text-right">−3.64</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          The 12-month horizon is the key check: the training window
          [cutoff−12, cutoff] and target window [cutoff, cutoff+12] are
          disjoint, so Mode&apos;s advantage isn&apos;t short-horizon
          autocorrelation. Mode still wins by 17-20% MAE, with essentially
          zero bias (−1.34 exits/mo on a base of ~65). Pooled KM
          systematically under-predicts exits by 3/mo — stale retention
          data from older cohorts is dragging the hazard estimate down.
          See{" "}
          <code className="rounded bg-muted/40 px-1 py-[1px] text-[11px]">
            scripts/backtest-attrition-curves.ts
          </code>
          . Numbers above are from a backtest run on{" "}
          <span className="font-mono">{BACKTEST_RUN_DATE}</span> — re-run
          the script if Mode data shifts materially.
        </p>
        <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground/80">
          Honest caveat: Dec 2027 is a 20-month-out projection, beyond the
          12-month window we could validate. The number assumes today&apos;s
          attrition mix holds — composition shifts (e.g., if the future HC
          is much more sub-1yr heavy than today) would invalidate it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ThreeWayCard
          label="Today"
          production={production.startingHeadcount}
          km={km.startingHeadcount}
          cohort={cohort.startingHeadcount}
        />
        <ThreeWayCard
          label="Dec 2026"
          production={pDec26}
          km={kmDec26}
          cohort={cDec26}
        />
        <ThreeWayCard
          label="Dec 2027"
          production={pDec27}
          km={kmDec27}
          cohort={cDec27}
        />
      </div>

      {pDec27 != null && kmDec27 != null ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            Math.abs(diff(kmDec27, pDec27) ?? 0) / pDec27 > 0.05
              ? "border-warning/40 bg-warning/10"
              : "border-border/60 bg-muted/30"
          } text-foreground`}
        >
          <span className="font-semibold">Interpretation:</span>{" "}
          <span className="text-muted-foreground">
            {(() => {
              const delta = (kmDec27 - pDec27) / pDec27;
              const pct = delta * 100;
              if (Math.abs(pct) < 3) {
                return "Production and pooled-KM agree within 3% — retention has been stable.";
              }
              if (delta > 0) {
                return `Pooled KM is ${pct.toFixed(1)}% higher than production at Dec 2027. KM averages 3+ years of FTE tenure; current Mode rates show higher attrition. Recent cohorts are churning harder — trust production (matches team).`;
              }
              return `Pooled KM is ${Math.abs(pct).toFixed(1)}% lower than production. Recent attrition has cooled — trust production (matches team's current numbers).`;
            })()}
          </span>
        </div>
      ) : null}
    </section>
  );
}

function ThreeWayCard({
  label,
  production,
  km,
  cohort,
}: {
  label: string;
  production: number | null;
  km: number | null;
  cohort: number | null;
}) {
  const row = (
    name: string,
    value: number | null,
    emphasis: boolean = false,
  ) => (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] uppercase text-muted-foreground/60">
        {name}
      </span>
      <span
        className={`tabular-nums ${
          emphasis
            ? "text-lg font-semibold text-foreground"
            : "text-sm text-muted-foreground"
        }`}
      >
        {value != null ? value.toFixed(0) : "—"}
      </span>
    </div>
  );
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-warm">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-3 space-y-2">
        {row("Production (Mode L12m)", production, true)}
        {row("Pooled KM (diag)", km)}
        {row("Per-cohort (diag)", cohort)}
      </div>
    </div>
  );
}
