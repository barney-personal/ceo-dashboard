import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Info,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";
import type {
  HrConfounder,
  HrContrastSummary,
  HrEngineerEvidence,
  HrEvidencePack,
  HrPerformanceHistory,
  HrRecentPrActivity,
  HrSignalContrast,
  HrVerdict,
} from "@/lib/data/engineering-ranking-hr";
import {
  formatOrdinal,
  HR_VERDICT_LABELS,
  HR_VERDICT_SEVERITY,
} from "@/lib/data/engineering-ranking-hr";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPct(p: number | null, digits = 1): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return `${p.toFixed(digits)}pp`;
}

function formatTenure(days: number | null): string {
  if (days === null) return "—";
  const years = days / 365;
  if (days < 365) {
    const months = Math.round(days / 30.4);
    return `${days}d (~${months}mo)`;
  }
  return `${days}d (~${years.toFixed(1)}y)`;
}

const VERDICT_TONE: Record<HrVerdict, string> = {
  sustained_concern: "border-warning/60 bg-warning/10 text-warning",
  quality_concern: "border-warning/60 bg-warning/10 text-warning",
  single_cycle_only:
    "border-muted-foreground/40 bg-muted/40 text-foreground",
  confounded:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  activity_only:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  insufficient_history:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
};

function VerdictBadge({ verdict }: { verdict: HrVerdict }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] ${VERDICT_TONE[verdict]}`}
    >
      {HR_VERDICT_LABELS[verdict]}
    </span>
  );
}

/**
 * Compact chip surfacing the engineer's historical review-rating shape in the
 * card header (so the reader sees "avg 2.5/5 across 3 cycles" before even
 * expanding the card). Rendered neutral when no history; tinted warning when
 * flagged cycles or a sub-3 average appear.
 */
function PerformanceHistoryChip({
  history,
}: {
  history: HrPerformanceHistory;
}) {
  if (!history.hasHistory) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        No review history
      </span>
    );
  }
  const avg = history.averageRating;
  const rated = history.ratings.filter((r) => r.rating !== null);
  const concerning =
    (avg !== null && avg < 3) || history.flaggedCycleCount > 0;
  const tone = concerning
    ? "border-warning/40 bg-warning/10 text-warning"
    : "border-border/40 bg-muted/40 text-foreground";
  const avgCopy = avg === null ? "—" : `${avg.toFixed(1)}/5`;
  return (
    <span
      title={history.narrative}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${tone}`}
    >
      Avg {avgCopy} · {rated.length}/{history.ratings.length} cycles
      {history.flaggedCycleCount > 0
        ? ` · ${history.flaggedCycleCount} flagged`
        : ""}
    </span>
  );
}

function VerdictChip({
  verdict,
  count,
}: {
  verdict: HrVerdict;
  count: number;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${VERDICT_TONE[verdict]}`}
    >
      <span className="tabular-nums">{count}</span>
      <span className="uppercase tracking-[0.08em]">
        {HR_VERDICT_LABELS[verdict]}
      </span>
    </div>
  );
}

function VerdictSummary({ pack }: { pack: HrEvidencePack }) {
  const order: HrVerdict[] = [
    "sustained_concern",
    "quality_concern",
    "single_cycle_only",
    "confounded",
    "activity_only",
    "insufficient_history",
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {order.map((v) => (
        <VerdictChip key={v} verdict={v} count={pack.verdictCounts[v]} />
      ))}
    </div>
  );
}

function ConfounderList({ confounders }: { confounders: readonly HrConfounder[] }) {
  const leaveReminder = (
    <li className="flex gap-2 rounded-md border border-dashed border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
      <span>
        <span className="font-medium">Check leave status manually.</span> The
        ranking pipeline does not currently ingest HiBob leave data, so sick /
        parental / sabbatical leave during the 180-day window is invisible
        here. Any engineer whose metrics drop because they were out of work
        must be excluded from a performance read — confirm with their direct
        manager before treating any gap above as a performance signal.
      </span>
    </li>
  );
  if (confounders.length === 0) {
    return (
      <ul className="space-y-1.5">
        {leaveReminder}
        <li className="text-xs italic text-muted-foreground">
          No additional confounders flagged. This does not mean the ranking is
          complete — it means the known-confounder checks all passed. Context
          the data cannot see still belongs to the direct manager.
        </li>
      </ul>
    );
  }
  return (
    <ul className="space-y-1.5 text-xs text-foreground">
      {leaveReminder}
      {confounders.map((c, idx) => (
        <li
          key={`${c.kind}-${idx}`}
          className="flex gap-2 rounded-md border border-border/40 bg-background/60 px-3 py-2"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span>{c.note}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Colour the engineer's raw value by how far below the cohort median they
 * are — anything below 50% of median reads as a hard gap, 50-80% as a soft
 * gap, above 80% as close-to-parity. Direction-aware for
 * lower-is-better signals.
 */
function gapTone(contrast: HrSignalContrast): string {
  if (contrast.engineerValue === null) return "text-muted-foreground";
  const frac = contrast.fractionOfMedian;
  if (frac === null) return "text-foreground";
  const directional = contrast.direction === "higher_is_better" ? frac : 1 / Math.max(frac, 1e-9);
  if (directional < 0.5) return "text-destructive font-medium";
  if (directional < 0.8) return "text-warning";
  return "text-foreground";
}

function formatRawNumber(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) {
    return v.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  }
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

function formatFractionChip(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  if (pct < 1) return "<1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function ContrastSummaryBlock({ summary }: { summary: HrContrastSummary }) {
  const belowPct =
    summary.totalSignals === 0
      ? 0
      : Math.round((summary.belowMedianCount / summary.totalSignals) * 100);
  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-foreground">{summary.headline}</p>
      {summary.totalSignals > 0 ? (
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.08em]">
          <span className="inline-flex items-center rounded-full border border-border/40 bg-background/70 px-2.5 py-0.5 text-muted-foreground">
            <span className="mr-1 tabular-nums text-foreground">
              {summary.belowMedianCount}
            </span>
            / {summary.totalSignals} below median
            <span className="ml-1 text-muted-foreground/70">({belowPct}%)</span>
          </span>
          {summary.bottomDecileCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-destructive">
              <span className="mr-1 tabular-nums">
                {summary.bottomDecileCount}
              </span>
              in bottom decile
            </span>
          ) : null}
        </div>
      ) : null}
      {summary.highlights.length > 0 ? (
        <div>
          <h5 className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Most severe gaps
          </h5>
          <ul className="mt-2 space-y-1.5">
            {summary.highlights.map((h) => (
              <li
                key={h.signal}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-border/40 bg-background/60 px-3 py-2 text-xs"
              >
                <span className="font-medium text-foreground">{h.label}</span>
                {h.percentileOrdinalDisplay ? (
                  <span className="rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-destructive">
                    {h.percentileOrdinalDisplay}
                  </span>
                ) : null}
                <span className="text-muted-foreground">
                  <span className="tabular-nums text-foreground">
                    {h.engineerValueDisplay}
                  </span>
                  {h.cohortMedianDisplay
                    ? ` · vs ${h.cohortMedianDisplay}`
                    : ""}
                  {h.fractionOfMedianDisplay
                    ? ` — ${h.fractionOfMedianDisplay}`
                    : ""}
                  {h.fractionOfTopDecileDisplay
                    ? ` · ${h.fractionOfTopDecileDisplay}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ContrastTable({ engineer }: { engineer: HrEngineerEvidence }) {
  if (engineer.contrasts.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        No raw-signal contrast could be computed — the cohort is too small on
        every tracked signal to anchor a defensible comparison this cycle.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/40 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <th className="py-1.5 pr-2 text-left font-medium">Signal</th>
            <th className="py-1.5 pr-2 text-right font-medium">This engineer</th>
            <th className="py-1.5 pr-2 text-right font-medium">Cohort median</th>
            <th className="py-1.5 pr-2 text-right font-medium">Top-decile mean</th>
            <th className="py-1.5 pr-2 text-right font-medium">% of median</th>
            <th className="py-1.5 pr-2 text-right font-medium">% of top</th>
            <th className="py-1.5 text-right font-medium">Percentile</th>
          </tr>
        </thead>
        <tbody>
          {engineer.contrasts.map((c) => (
            <tr key={c.signal} className="border-b border-border/20 align-top">
              <td className="py-1.5 pr-2 text-foreground">
                <div>{c.label}</div>
                {c.disciplineCohort ? (
                  <div className="text-[10px] text-muted-foreground">
                    vs {c.disciplineCohort.cohortLabel}: median{" "}
                    {formatRawNumber(c.disciplineCohort.median)} · top-decile{" "}
                    {formatRawNumber(c.disciplineCohort.topDecileMean)}
                  </div>
                ) : null}
              </td>
              <td className={`py-1.5 pr-2 text-right tabular-nums ${gapTone(c)}`}>
                {c.engineerValueDisplay}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-foreground">
                {formatRawNumber(c.cohort.median)}
                <div className="text-[10px] text-muted-foreground">
                  n={c.cohort.cohortSize}
                </div>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-foreground">
                {formatRawNumber(c.cohort.topDecileMean)}
              </td>
              <td className={`py-1.5 pr-2 text-right tabular-nums ${gapTone(c)}`}>
                {formatFractionChip(c.fractionOfMedian)}
              </td>
              <td className={`py-1.5 pr-2 text-right tabular-nums ${gapTone(c)}`}>
                {formatFractionChip(c.fractionOfTopDecile)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-foreground">
                {c.engineerPercentile === null
                  ? "—"
                  : formatOrdinal(c.engineerPercentile)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] italic text-muted-foreground">
        Values in <span className="text-destructive font-medium">red</span>{" "}
        are below 50% of the cohort median; <span className="text-warning">amber</span>{" "}
        is 50–80%. Discipline cohort is used for the percentile where n ≥ 5,
        else the whole cohort.
      </p>
    </div>
  );
}

function RecentPrActivityPanel({
  activity,
}: {
  activity: HrRecentPrActivity;
}) {
  const qualityRow = (
    label: string,
    value: number | null,
    cohort: number | null,
  ) => {
    if (value === null) return null;
    return (
      <div className="flex items-center justify-between border-b border-border/20 py-1.5 text-xs">
        <span className="text-foreground">{label}</span>
        <span className="flex items-baseline gap-2">
          <span className="tabular-nums text-foreground">
            {value.toFixed(1)} / 5
          </span>
          {cohort !== null ? (
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              cohort median {cohort.toFixed(1)}
            </span>
          ) : null}
        </span>
      </div>
    );
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground">{activity.narrative}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            PRs merged
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {activity.prsMerged}
          </div>
          {activity.cohortPrsMerged !== null ? (
            <div className="text-[10px] text-muted-foreground">
              cohort median {activity.cohortPrsMerged.toFixed(1)}
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Commits
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {activity.commitCount}
          </div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Net lines
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {activity.netLines.toLocaleString("en-GB")}
          </div>
        </div>
      </div>
      {activity.analysedPrCount > 0 ? (
        <div>
          <h5 className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Rubric analysis ({activity.analysedPrCount} PR
            {activity.analysedPrCount === 1 ? "" : "s"} analysed)
          </h5>
          <div className="rounded-md border border-border/40 bg-background/60 px-3">
            {qualityRow(
              "Technical difficulty",
              activity.complexityMean,
              null,
            )}
            {qualityRow(
              "Execution quality",
              activity.executionQualityMean,
              activity.cohortExecutionQualityMean,
            )}
            {qualityRow("Test adequacy", activity.testAdequacyMean, null)}
            {qualityRow("Risk handling", activity.riskHandlingMean, null)}
            {qualityRow("Reviewability", activity.reviewabilityMean, null)}
          </div>
          {activity.revertCount > 0 ? (
            <p className="mt-2 text-[11px] text-destructive">
              {activity.revertCount} of {activity.analysedPrCount} analysed
              PRs were reverted within 14 days of merge.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PerformanceHistoryPanel({
  history,
}: {
  history: HrPerformanceHistory;
}) {
  if (!history.hasHistory) {
    return (
      <p className="text-xs italic text-muted-foreground">
        {history.narrative}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground">{history.narrative}</p>
      <div className="overflow-hidden rounded-md border border-border/40 bg-background/60">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/40 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              <th className="py-1.5 px-3 text-left font-medium">Cycle</th>
              <th className="py-1.5 px-3 text-right font-medium">Rating</th>
              <th className="py-1.5 px-3 text-left font-medium">Reviewer</th>
              <th className="py-1.5 px-3 text-left font-medium">Flag</th>
            </tr>
          </thead>
          <tbody>
            {history.ratings.map((r) => (
              <tr
                key={`${r.reviewCycle}-${r.reviewerName}`}
                className="border-b border-border/20 last:border-b-0"
              >
                <td className="py-1.5 px-3 text-foreground">{r.reviewCycle}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-foreground">
                  {r.missed ? (
                    <span className="italic text-muted-foreground">missed</span>
                  ) : r.rating === null ? (
                    "—"
                  ) : (
                    `${r.rating}/5`
                  )}
                </td>
                <td className="py-1.5 px-3 text-muted-foreground">
                  {r.reviewerName || "—"}
                </td>
                <td className="py-1.5 px-3">
                  {r.flagged ? (
                    <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-warning">
                      Flagged
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MethodTable({ engineer }: { engineer: HrEngineerEvidence }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-border/40 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          <th className="py-1.5 text-left font-medium">Method</th>
          <th className="py-1.5 text-right font-medium">Percentile</th>
          <th className="py-1.5 text-left font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {engineer.methodBreakdown.map((m) => (
          <tr key={m.method} className="border-b border-border/20">
            <td className="py-1.5 pr-2 text-foreground">{m.label}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums text-foreground">
              {m.present ? formatPct(m.percentile) : "—"}
            </td>
            <td className="py-1.5 text-muted-foreground">
              {m.present ? (
                <span>present</span>
              ) : (
                <span title={m.absenceReason}>absent · {m.absenceReason || "not scored"}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConcernLines({ engineer }: { engineer: HrEngineerEvidence }) {
  if (engineer.concernLines.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        No method-level or driver-level signals fall in the bottom quartile.
        Even though this engineer is in the overall bottom {engineer.totalScored > 0 ? engineer.totalScored : "N"}, no individual signal dominates the negative read.
      </p>
    );
  }
  // Dedup by `label` because method-level concerns and driver-level lines can
  // collide on the same signal — we prefer the richer driver line when both
  // exist. First seen wins (methods render first).
  const seen = new Set<string>();
  const lines = engineer.concernLines.filter((l) => {
    if (seen.has(l.label)) return false;
    seen.add(l.label);
    return true;
  });
  return (
    <ul className="space-y-1.5 text-xs">
      {lines.map((line) => (
        <li
          key={line.label}
          className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-background/60 px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground">{line.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {line.value}
            </span>
          </div>
          {line.cohortContext ? (
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {line.cohortContext}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function HistoricalBlock({ engineer }: { engineer: HrEngineerEvidence }) {
  const h = engineer.historical;
  if (!h.hasPriorSnapshot) {
    return (
      <p className="text-xs italic text-muted-foreground">
        No comparable prior snapshot for this engineer. Until a second
        comparable snapshot lands, we cannot distinguish a single-cycle dip
        from a sustained pattern — the verdict defaults to{" "}
        <span className="font-medium">insufficient_history</span>.
      </p>
    );
  }
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-3 text-foreground">
        <span>
          Prior rank <span className="tabular-nums">#{h.priorRank}</span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span>
          prior percentile{" "}
          <span className="tabular-nums">
            {formatPct(h.priorCompositePercentile)}
          </span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span>as of {formatDate(h.priorSnapshotDate)}</span>
        {h.priorWasBottom15 ? (
          <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-warning">
            Prior was bottom 15
          </span>
        ) : (
          <span className="rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Prior was above bottom 15
          </span>
        )}
      </div>
      {h.moverNarrative ? (
        <p className="text-muted-foreground">
          <span className="uppercase tracking-[0.08em]">
            Movers cause ({h.moverCauseKind ?? "unknown"})
          </span>
          : {h.moverNarrative}
        </p>
      ) : null}
    </div>
  );
}

function EngineerCard({
  engineer,
  profileSlug,
}: {
  engineer: HrEngineerEvidence;
  profileSlug: string | undefined;
}) {
  const displayRank =
    engineer.rank === null ? "—" : `#${engineer.rank} of ${engineer.totalScored}`;
  return (
    <details className="group rounded-xl border border-border/60 bg-card shadow-warm open:shadow-warm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 marker:hidden [&::-webkit-details-marker]:hidden">
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg italic leading-tight text-foreground">
              {engineer.displayName}
            </span>
            <span className="text-xs text-muted-foreground">
              {engineer.levelLabel} · {engineer.discipline}
            </span>
            <VerdictBadge verdict={engineer.verdict} />
            <PerformanceHistoryChip history={engineer.performanceHistory} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums text-foreground">{displayRank}</span>
            <span>·</span>
            <span>
              composite{" "}
              <span className="tabular-nums text-foreground">
                {formatPct(engineer.compositePercentile)}
              </span>{" "}
              (CI {formatPct(engineer.ciLowPercentile)} →{" "}
              {formatPct(engineer.ciHighPercentile)})
            </span>
            <span>·</span>
            <span>
              {engineer.squad ?? "no squad"} / {engineer.pillar ?? "no pillar"}
            </span>
            {engineer.manager ? (
              <>
                <span>·</span>
                <span>manager: {engineer.manager}</span>
              </>
            ) : null}
          </div>
        </div>
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground group-open:hidden">
          expand
        </span>
        <span className="hidden text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground group-open:inline">
          collapse
        </span>
      </summary>

      <div className="space-y-5 border-t border-border/40 px-5 py-4">
        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-4">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Email
              </dt>
              <dd className="mt-0.5 break-all text-foreground">
                {engineer.email}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                GitHub
              </dt>
              <dd className="mt-0.5 text-foreground">
                {engineer.githubLogin ? (
                  engineer.githubPrSearchUrl ? (
                    <a
                      href={engineer.githubPrSearchUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    >
                      @{engineer.githubLogin}
                    </a>
                  ) : (
                    <>@{engineer.githubLogin}</>
                  )
                ) : (
                  <span className="italic text-muted-foreground">
                    no mapping
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Tenure
              </dt>
              <dd className="mt-0.5 text-foreground">
                {formatTenure(engineer.tenureDays)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Start date
              </dt>
              <dd className="mt-0.5 text-foreground">
                {formatDate(engineer.startDate)}
              </dd>
            </div>
          </dl>
          {profileSlug ? (
            <div className="mt-3 text-[11px]">
              <a
                href={`/dashboard/people/${profileSlug}`}
                className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                Open people profile →
              </a>
            </div>
          ) : null}
        </div>

        <div
          className={`rounded-md border px-4 py-3 text-xs ${VERDICT_TONE[engineer.verdict]}`}
        >
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em]">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Verdict · {HR_VERDICT_LABELS[engineer.verdict]}</span>
          </div>
          <p>{engineer.verdictReason}</p>
        </div>

        <div className="rounded-md border border-destructive/30 bg-destructive/[0.04] p-4">
          <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
            <TrendingDown className="h-3.5 w-3.5 text-destructive" />
            Activity & engagement gap vs cohort
          </h4>
          <ContrastSummaryBlock summary={engineer.contrastSummary} />
          <div className="mt-4">
            <ContrastTable engineer={engineer} />
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/40 p-4">
          <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            Last 30 days — volume, complexity, quality
          </h4>
          <div className="mt-3">
            <RecentPrActivityPanel activity={engineer.recentPrActivity} />
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/40 p-4">
          <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
            <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
            Prior performance review ratings
          </h4>
          <div className="mt-3">
            <PerformanceHistoryPanel history={engineer.performanceHistory} />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-border/40 bg-background/40 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Signal evidence (concerns)
            </h4>
            <div className="mt-3 space-y-3">
              <MethodTable engineer={engineer} />
              <div>
                <h5 className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Method-level & driver-level concerns
                </h5>
                <ConcernLines engineer={engineer} />
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border/40 bg-background/40 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Confounders (context the ranking cannot see)
            </h4>
            <div className="mt-3">
              <ConfounderList confounders={engineer.confounders} />
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/40 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Historical pattern
          </h4>
          <div className="mt-3">
            <HistoricalBlock engineer={engineer} />
          </div>
        </div>
      </div>
    </details>
  );
}

export function HrReviewSection({
  pack,
  profileSlugByHash,
}: {
  pack: HrEvidencePack;
  profileSlugByHash: Record<string, string>;
}) {
  // Being in the bottom N is itself the trigger for a manager calibration
  // conversation — that's what the pack exists for. The verdict counts below
  // don't gate whether a conversation should happen; they characterise *what
  // kind* each conversation should be (priority vs watch vs confirm-context).
  const totalInReview = pack.engineers.length;
  const priorityCount =
    pack.verdictCounts.sustained_concern + pack.verdictCounts.quality_concern;
  const watchCount = pack.verdictCounts.single_cycle_only;
  const contextFirstCount =
    pack.verdictCounts.confounded +
    pack.verdictCounts.activity_only +
    pack.verdictCounts.insufficient_history;

  return (
    <section className="rounded-xl border border-destructive/30 bg-destructive/[0.03] p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold text-foreground">
              HR review — bottom {pack.bottomN} evidence pack
            </h3>
            <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-destructive">
              Sensitive · CEO-gated
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Decision support for a calibration conversation with the direct
            manager. <span className="font-medium">Not a case file.</span>{" "}
            Evidence is rendered alongside confounders so neither can be read
            in isolation.
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>
            Methodology v{pack.methodologyVersion}
          </div>
          <div className="mt-1">
            Window {formatDate(pack.signalWindow.start)} →{" "}
            {formatDate(pack.signalWindow.end)}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-4">
        <div className="flex items-start gap-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
          <p>{pack.headerWarning}</p>
        </div>
      </div>

      {pack.cohortNotes.length > 0 ? (
        <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
          {pack.cohortNotes.map((n) => (
            <li
              key={n}
              className="rounded-md border border-border/40 bg-background/60 px-3 py-2"
            >
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <p className="text-xs text-foreground">
          <span className="font-medium">All {totalInReview} engineers in this pack warrant a calibration conversation with their direct manager</span>
          {" — "}being in the bottom of the composite ranking is itself the
          trigger. The breakdown below characterises{" "}
          <em>what kind</em> of conversation the data supports:{" "}
          <span className="font-medium text-warning">priority</span> (signals
          already converge),{" "}
          <span className="font-medium">watch</span> (single-cycle dip —
          revisit next snapshot), or{" "}
          <span className="font-medium">confirm context first</span>{" "}
          (confounders or missing history make the signal too weak to act on
          alone). None of these numbers gate whether a conversation happens.
        </p>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            In review
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {totalInReview}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              engineer{totalInReview === 1 ? "" : "s"}
            </span>
          </dd>
        </div>
        <div
          className={`rounded-md border p-3 ${
            priorityCount > 0
              ? "border-warning/40 bg-warning/10"
              : "border-border/40 bg-background/60"
          }`}
        >
          <dt
            className={`text-[10px] uppercase tracking-[0.12em] ${
              priorityCount > 0 ? "text-warning" : "text-muted-foreground"
            }`}
          >
            Priority — data supports acting
          </dt>
          <dd
            className={`mt-1 text-lg font-semibold tabular-nums ${
              priorityCount > 0 ? "text-warning" : "text-foreground"
            }`}
          >
            {priorityCount}
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Watch next cycle
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {watchCount}
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Confirm context first
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {contextFirstCount}
          </dd>
        </div>
      </div>

      <div className="mt-4">
        <VerdictSummary pack={pack} />
      </div>

      {pack.engineers.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-border/60 bg-background/40 p-6 text-center text-sm italic text-muted-foreground">
          No engineers currently scored — the composite has not produced a rank
          yet. Nothing to review.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {pack.engineers.map((engineer) => {
            const severity = HR_VERDICT_SEVERITY[engineer.verdict];
            void severity;
            return (
              <EngineerCard
                key={engineer.emailHash}
                engineer={engineer}
                profileSlug={profileSlugByHash[engineer.emailHash]}
              />
            );
          })}
        </div>
      )}

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          How to read this section
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>
            Every engineer in this pack is in the bottom of the composite
            rank — each warrants a calibration conversation with their direct
            manager. The verdict on each card characterises{" "}
            <em>what kind</em> of conversation, not whether one should happen.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Sustained / Quality concern
            </span>{" "}
            — the data already supports acting. Lead the conversation with
            specifics from the activity gap and the historical pattern.
          </li>
          <li>
            <span className="font-medium text-foreground">Single-cycle only</span>{" "}
            — bottom this cycle, fine before. Conversation is about
            understanding what changed; re-check next snapshot before forming
            a longer-term view.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Confounded / Activity-only / Insufficient history
            </span>{" "}
            — the signal is too weak or missing context to act on alone.
            Conversation is about filling in what the data cannot see
            (leave, role change, squad context, onboarding status), not about
            the rank itself.
          </li>
          <li>
            Nothing on this page is a substitute for a formal Performance
            Improvement Plan, nor evidence for dismissal. Rankings see signals
            only; a PIP decision requires manager context, HR oversight, and a
            documented process.
          </li>
        </ul>
      </div>
    </section>
  );
}
