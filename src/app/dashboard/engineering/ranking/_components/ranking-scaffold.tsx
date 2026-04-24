import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import {
  bucketNormalisationDeltas,
  type AntiGamingRow,
  type AttributionBundle,
  type AttributionContribution,
  type CompositeBundle,
  type ConfidenceBundle,
  type ConfidenceTieGroup,
  type CorrelationPair,
  type EffectiveSignalWeight,
  type EligibilityEntry,
  type EligibilityStatus,
  type EngineerAttribution,
  type EngineerAttributionMethod,
  type EngineerConfidence,
  type EngineerNormalisation,
  type EngineeringRankingSnapshot,
  type LensDisagreementRow,
  type LensScoreSummary,
  type LensesBundle,
  type MethodologyBundle,
  type MoverCauseKind,
  type MoverEntry,
  type MoversBundle,
  type NormalisationBundle,
  type RankingFreshnessBadge,
  type SignalAudit,
  type StabilityBundle,
  type StabilityEntry,
  type StabilityFlag,
} from "@/lib/data/engineering-ranking";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({
  status,
}: {
  status: EngineeringRankingSnapshot["status"];
}) {
  const label =
    status === "ready"
      ? "Ranking ready"
      : status === "insufficient_data"
        ? "Insufficient data"
        : "Methodology pending";
  const tone =
    status === "ready"
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-warning/40 bg-warning/10 text-warning";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] ${tone}`}
    >
      {label}
    </span>
  );
}

function SignalIcon({
  state,
}: {
  state: "available" | "planned" | "unavailable";
}) {
  if (state === "available") {
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  }
  if (state === "unavailable") {
    return <AlertTriangle className="h-4 w-4 text-warning" />;
  }
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

const ELIGIBILITY_LABEL: Record<EligibilityStatus, string> = {
  competitive: "Competitive",
  ramp_up: "Ramp-up (<90d)",
  insufficient_mapping: "Insufficient GitHub mapping",
  inactive_or_leaver: "Inactive / leaver",
  missing_required_data: "Missing required data",
};

const ELIGIBILITY_TONE: Record<EligibilityStatus, string> = {
  competitive: "border-primary/40 bg-primary/5 text-primary",
  ramp_up: "border-muted-foreground/30 bg-muted/40 text-foreground",
  insufficient_mapping:
    "border-warning/40 bg-warning/5 text-warning",
  inactive_or_leaver:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  missing_required_data:
    "border-destructive/40 bg-destructive/5 text-destructive",
};

function CoverageSection({
  snapshot,
}: {
  snapshot: EngineeringRankingSnapshot;
}) {
  const { entries, coverage, sourceNotes } = snapshot.eligibility;
  const buckets: Array<{ status: EligibilityStatus; count: number }> = [
    { status: "competitive", count: coverage.competitive },
    { status: "ramp_up", count: coverage.rampUp },
    { status: "insufficient_mapping", count: coverage.insufficientMapping },
    { status: "missing_required_data", count: coverage.missingRequiredData },
    { status: "inactive_or_leaver", count: coverage.inactiveOrLeaver },
  ];

  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Eligibility coverage
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Preflight before any ranking claim. Unmapped or under-tenure
            engineers are surfaced, not dropped. Ramp-up threshold:{" "}
            {coverage.rampUpThresholdDays} days.
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>{coverage.totalEngineers} engineers in roster</div>
          <div className="mt-1">
            {coverage.mappedToGitHub} mapped to GitHub ·{" "}
            {coverage.presentInImpactModel} in impact model
          </div>
          {coverage.excludedFutureStart > 0 && (
            <div className="mt-1 normal-case tracking-normal text-foreground/70">
              {coverage.excludedFutureStart} future-start row
              {coverage.excludedFutureStart === 1 ? "" : "s"} excluded
              (start_date &gt; today)
            </div>
          )}
          <div className="mt-1 normal-case tracking-normal text-foreground/70">
            {coverage.squadsRegistryPresent
              ? `Squads registry joined · ${coverage.squadRegistryUnmatched} unmatched hb_squad label${coverage.squadRegistryUnmatched === 1 ? "" : "s"}`
              : "Squads registry not fetched for this snapshot"}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {buckets.map((b) => (
          <div
            key={b.status}
            className={`rounded-md border px-3 py-2 ${ELIGIBILITY_TONE[b.status]}`}
          >
            <div className="text-[10px] uppercase tracking-[0.12em] opacity-80">
              {ELIGIBILITY_LABEL[b.status]}
            </div>
            <div className="mt-1 font-display text-2xl tabular-nums">
              {b.count}
            </div>
          </div>
        ))}
      </div>

      {sourceNotes.length > 0 && (
        <div className="mt-4 rounded-md border border-border/40 bg-background/60 p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Source provenance
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {sourceNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-4 text-xs italic text-muted-foreground">
          Roster preflight is empty — live Mode and GitHub-map fetches have
          not returned data yet. The ranking stays methodology-pending.
        </p>
      ) : (
        <RosterTable entries={entries} />
      )}
    </section>
  );
}

function formatCoveragePct(present: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((present / total) * 100)}%`;
}

function formatRho(rho: number | null): string {
  if (rho === null) return "—";
  return rho.toFixed(2);
}

function findPair(
  audit: SignalAudit,
  a: string,
  b: string,
): CorrelationPair | null {
  if (a === b) {
    return { a, b, rho: 1, n: audit.competitiveCohortSize };
  }
  return (
    audit.correlationMatrix.find(
      (pair) =>
        (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a),
    ) ?? null
  );
}

function SignalAuditSection({
  snapshot,
}: {
  snapshot: EngineeringRankingSnapshot;
}) {
  const { audit } = snapshot;
  const numericMissingness = audit.missingness.filter(
    (m) => m.kind === "numeric",
  );
  const nominalMissingness = audit.missingness.filter(
    (m) => m.kind === "nominal",
  );

  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Signal inventory + orthogonality audit
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Numeric and ordinal signals are checked with Spearman rank
            correlation over paired non-null observations. Nominal dimensions
            such as discipline, squad, PM, and Slack channel id are reported as
            coverage distributions only — they are not ordinal-encoded.
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>{audit.windowDays}d signal window</div>
          <div className="mt-1">
            {audit.competitiveCohortSize} competitive engineers
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Missingness by signal
          </h4>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Signal</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Present</th>
                  <th className="py-2 pr-3 font-medium">Missing</th>
                  <th className="py-2 pr-3 font-medium">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {[...numericMissingness, ...nominalMissingness].map((m) => (
                  <tr key={m.signal} className="border-b border-border/30">
                    <td className="py-2 pr-3 text-foreground">{m.signal}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {m.kind}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {m.present}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {m.missing}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {formatCoveragePct(m.present, m.totalCohort)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border border-border/40 bg-background/60 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Redundant / under-sampled pairs
            </h4>
            {audit.redundantPairs.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No numeric pair with enough overlap crosses |rho| ≥ 0.85.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                {audit.redundantPairs.slice(0, 6).map((pair) => (
                  <li key={`${pair.a}-${pair.b}`}>
                    <span className="text-foreground">{pair.a}</span> ↔{" "}
                    <span className="text-foreground">{pair.b}</span>: ρ{" "}
                    {formatRho(pair.rho)} over {pair.n} engineers
                  </li>
                ))}
              </ul>
            )}
            {audit.underSampledPairs.length > 0 && (
              <p className="mt-3 text-xs text-warning">
                {audit.underSampledPairs.length} pair
                {audit.underSampledPairs.length === 1 ? "" : "s"} have fewer
                than 8 overlapping observations; they are not used for
                redundancy conclusions.
              </p>
            )}
          </div>

          <div className="rounded-md border border-border/40 bg-background/60 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Unavailable signals
            </h4>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              {audit.unavailableSignals.map((signal) => (
                <li key={signal.name}>
                  <span className="text-foreground">{signal.name}:</span>{" "}
                  {signal.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Spearman correlation matrix
        </h4>
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="sticky left-0 z-10 bg-background/95 py-2 pr-3 font-medium">
                  Signal
                </th>
                {audit.numericSignals.map((signal) => (
                  <th
                    key={signal}
                    className="min-w-24 px-2 py-2 text-center font-medium"
                  >
                    {signal}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audit.numericSignals.map((rowSignal) => (
                <tr key={rowSignal} className="border-b border-border/30">
                  <td className="sticky left-0 z-10 max-w-44 bg-background/95 py-2 pr-3 text-foreground">
                    {rowSignal}
                  </td>
                  {audit.numericSignals.map((colSignal) => {
                    const pair = findPair(audit, rowSignal, colSignal);
                    const sampled =
                      pair && pair.n > 0 ? `${pair.n} obs` : "no overlap";
                    return (
                      <td
                        key={`${rowSignal}-${colSignal}`}
                        className="px-2 py-2 text-center tabular-nums text-muted-foreground"
                        title={sampled}
                      >
                        {formatRho(pair?.rho ?? null)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Nominal cohort coverage
        </h4>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Dimension</th>
                <th className="py-2 pr-3 font-medium">Distinct</th>
                <th className="py-2 pr-3 font-medium">Missing</th>
                <th className="py-2 pr-3 font-medium">Largest cohorts</th>
              </tr>
            </thead>
            <tbody>
              {audit.nominalCoverage.map((coverage) => (
                <tr key={coverage.signal} className="border-b border-border/30">
                  <td className="py-2 pr-3 text-foreground">
                    {coverage.signal}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                    {coverage.distinctCategories}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                    {coverage.missing}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {coverage.categories.length === 0
                      ? "—"
                      : coverage.categories
                          .slice(0, 4)
                          .map((c) => `${c.category} (${c.count})`)
                          .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function formatPercentile(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}`;
}

function LensTopTable({ lens }: { lens: LensScoreSummary }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {lens.definition.name}
          </h4>
          <p className="mt-1 max-w-lg text-[11px] leading-relaxed text-muted-foreground">
            {lens.definition.description}
          </p>
        </div>
        <div className="text-right text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>
            {lens.scored} scored · {lens.unscored} unscored
          </div>
          <div className="mt-1 normal-case tracking-normal">
            {lens.definition.components
              .map((c) => `${c.name} (${Math.round(c.weight * 100)}%)`)
              .join(" · ")}
          </div>
        </div>
      </div>
      {lens.definition.limitation && (
        <p className="mt-2 rounded-sm border border-warning/30 bg-warning/5 px-2 py-1 text-[11px] italic text-warning">
          {lens.definition.limitation}
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="w-8 py-2 pr-2 text-right font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Engineer</th>
              <th className="py-2 pr-3 text-right font-medium">Score</th>
              <th className="py-2 pr-3 font-medium">Components present</th>
            </tr>
          </thead>
          <tbody>
            {lens.topN.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="py-3 text-center text-muted-foreground"
                >
                  No engineers have enough components to score this lens yet.
                </td>
              </tr>
            ) : (
              lens.topN.map((engineer, idx) => (
                <tr
                  key={engineer.emailHash || engineer.displayName}
                  className="border-b border-border/30 align-top"
                >
                  <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                    {idx + 1}
                  </td>
                  <td className="py-2 pr-3 text-foreground">
                    {engineer.displayName}
                  </td>
                  <td className="py-2 pr-3 text-right font-display tabular-nums text-foreground">
                    {formatPercentile(engineer.score)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {engineer.presentComponentCount} /{" "}
                    {engineer.components.length}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LensesSection({ lenses }: { lenses: LensesBundle }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Three independent scoring lenses
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            None of these lenses is the final ranking. They are deliberately
            built to disagree — the disagreement table below is where the
            methodology earns its money. The composite above takes the median
            of all four methods (A, B, C, adjusted) so a single noisy lens
            cannot single-handedly drag an engineer's rank.
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>{lenses.windowDays}d window</div>
          <div className="mt-1">
            {lenses.disagreement.rows.length} material disagreements
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <LensTopTable lens={lenses.lenses.output} />
        <LensTopTable lens={lenses.lenses.impact} />
        <LensTopTable lens={lenses.lenses.delivery} />
      </div>

      <DisagreementTable rows={lenses.disagreement.widestGaps} />

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Lens-stage limitations
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {lenses.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function DisagreementTable({ rows }: { rows: LensDisagreementRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-5 rounded-md border border-dashed border-border/50 bg-background/40 p-3 text-xs italic text-muted-foreground">
        No material lens disagreements — either no engineer has ≥2 present
        lenses, or every lens pair agrees within the disagreement epsilon. Ties
        are not a disagreement and are intentionally omitted.
      </p>
    );
  }
  return (
    <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Widest lens disagreements
      </h4>
      <p className="mt-1 max-w-3xl text-[11px] text-muted-foreground">
        Disagreement = max(present lenses) − min(present lenses). The widest
        gaps are where the methodology has to justify itself — a plausible
        explanation for the gap is more important than the score itself at this
        stage.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Engineer</th>
              <th className="py-2 pr-3 text-right font-medium">A output</th>
              <th className="py-2 pr-3 text-right font-medium">B impact</th>
              <th className="py-2 pr-3 text-right font-medium">C delivery</th>
              <th className="py-2 pr-3 text-right font-medium">Δ</th>
              <th className="py-2 pr-3 font-medium">Likely cause</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.emailHash || row.displayName}
                className="border-b border-border/30 align-top"
              >
                <td className="py-2 pr-3 text-foreground">{row.displayName}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {formatPercentile(row.output)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {formatPercentile(row.impact)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {formatPercentile(row.delivery)}
                </td>
                <td className="py-2 pr-3 text-right font-display tabular-nums text-foreground">
                  {row.disagreement === null
                    ? "—"
                    : row.disagreement.toFixed(1)}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {row.likelyCause}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const NORMALISATION_TOP_N = 15 as const;
const NORMALISATION_DELTA_N = 8 as const;

function formatDelta(value: number | null): string {
  if (value === null) return "—";
  const rounded = value.toFixed(1);
  if (value > 0) return `+${rounded}`;
  return rounded;
}

function NormalisationTopTable({ entries }: { entries: EngineerNormalisation[] }) {
  const ranked = [...entries]
    .filter((e) => e.adjustedPercentile !== null)
    .sort((a, b) => (b.adjustedPercentile ?? 0) - (a.adjustedPercentile ?? 0))
    .slice(0, NORMALISATION_TOP_N);
  return (
    <div className="rounded-md border border-border/40 bg-background/60 p-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Top by adjusted percentile
      </h4>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
        Ordered by the adjusted percentile. Raw column shows the un-adjusted
        cross-cohort percentile; Δ shows the lift (or drop) from applying
        discipline, level, and tenure normalisations.
      </p>
      {ranked.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          No engineers have an adjusted percentile yet — persisted GitHub
          activity has not produced a rawScore for the competitive cohort.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="w-8 py-2 pr-2 text-right font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Engineer</th>
                <th className="py-2 pr-3 font-medium">Discipline · Level</th>
                <th className="py-2 pr-3 text-right font-medium">Raw</th>
                <th className="py-2 pr-3 text-right font-medium">Discipline</th>
                <th className="py-2 pr-3 text-right font-medium">Level</th>
                <th className="py-2 pr-3 text-right font-medium">Tenure</th>
                <th className="py-2 pr-3 text-right font-medium">Adjusted</th>
                <th className="py-2 pr-3 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((entry, idx) => (
                <tr
                  key={entry.emailHash || entry.displayName}
                  className="border-b border-border/30 align-top"
                >
                  <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                    {idx + 1}
                  </td>
                  <td className="py-2 pr-3 text-foreground">
                    {entry.displayName}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {entry.discipline} · {entry.levelLabel}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatPercentile(entry.rawPercentile)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatPercentile(entry.disciplinePercentile)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatPercentile(entry.levelAdjustedPercentile)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatPercentile(entry.tenureAdjustedPercentile)}
                  </td>
                  <td className="py-2 pr-3 text-right font-display tabular-nums text-foreground">
                    {formatPercentile(entry.adjustedPercentile)}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums ${
                      entry.adjustmentDelta === null
                        ? "text-muted-foreground"
                        : entry.adjustmentDelta > 0
                          ? "text-primary"
                          : entry.adjustmentDelta < 0
                            ? "text-warning"
                            : "text-muted-foreground"
                    }`}
                  >
                    {formatDelta(entry.adjustmentDelta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NormalisationDeltas({
  entries,
}: {
  entries: EngineerNormalisation[];
}) {
  const { lifts, drops } = bucketNormalisationDeltas(
    entries,
    NORMALISATION_DELTA_N,
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Biggest adjustment lifts
        </h4>
        {lifts.length === 0 ? (
          <p className="mt-3 text-xs italic text-muted-foreground">
            No adjustment lifts — no engineer has an adjusted percentile above
            their raw percentile in the current snapshot.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            {lifts.map((entry) => (
              <li key={`lift-${entry.emailHash || entry.displayName}`}>
                <span className="text-foreground">{entry.displayName}</span>{" "}
                <span className="tabular-nums text-primary">
                  {formatDelta(entry.adjustmentDelta)}
                </span>
                <span className="block text-[11px] normal-case tracking-normal text-muted-foreground/80">
                  {entry.adjustmentsApplied.join(" · ") || "No adjustments applied"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Biggest adjustment drops
        </h4>
        {drops.length === 0 ? (
          <p className="mt-3 text-xs italic text-muted-foreground">
            No adjustment drops — no engineer has an adjusted percentile below
            their raw percentile in the current snapshot.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            {drops.map((entry) => (
              <li key={`drop-${entry.emailHash || entry.displayName}`}>
                <span className="text-foreground">{entry.displayName}</span>{" "}
                <span className="tabular-nums text-warning">
                  {formatDelta(entry.adjustmentDelta)}
                </span>
                <span className="block text-[11px] normal-case tracking-normal text-muted-foreground/80">
                  {entry.adjustmentsApplied.join(" · ") || "No adjustments applied"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NormalisationSection({
  normalisation,
  rampUpCount,
}: {
  normalisation: NormalisationBundle;
  rampUpCount: number;
}) {
  const { entries, disciplineCohorts, levelFit } = normalisation;
  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Tenure and role normalisation
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Raw percentiles would bottom-rank new joiners and junior levels for
            being new and junior. This layer adjusts for discipline (pooled
            when a cohort is below {normalisation.minCohortSize}), level (OLS
            residuals) and tenure exposure, and surfaces both raw and adjusted
            percentiles so the lift is visible, not implicit.
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>{entries.length} competitive engineers</div>
          <div className="mt-1">
            {rampUpCount} ramp-up engineer
            {rampUpCount === 1 ? "" : "s"} held out
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <NormalisationTopTable entries={entries} />

        <NormalisationDeltas entries={entries} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-md border border-border/40 bg-background/60 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Discipline cohorts
            </h4>
            {disciplineCohorts.length === 0 ? (
              <p className="mt-3 text-xs italic text-muted-foreground">
                No competitive engineers yet.
              </p>
            ) : (
              <table className="mt-3 w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Discipline</th>
                    <th className="py-2 pr-3 text-right font-medium">Size</th>
                    <th className="py-2 pr-3 font-medium">Pooled with</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Effective size
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {disciplineCohorts.map((cohort) => (
                    <tr
                      key={cohort.discipline}
                      className="border-b border-border/30"
                    >
                      <td className="py-2 pr-3 text-foreground">
                        {cohort.discipline}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {cohort.size}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {cohort.pooledToAll
                          ? "(all competitive)"
                          : cohort.pooledWith.length > 0
                            ? cohort.pooledWith.join(", ")
                            : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {cohort.effectiveSize}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-md border border-border/40 bg-background/60 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Level OLS fit
            </h4>
            {levelFit ? (
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                <p>
                  rawScore ≈ {levelFit.intercept.toFixed(2)} +{" "}
                  {levelFit.slope.toFixed(2)} × level over{" "}
                  <span className="text-foreground tabular-nums">
                    {levelFit.sampleSize}
                  </span>{" "}
                  engineers.
                </p>
                <p>
                  Positive slope means higher levels have higher expected
                  output; the residual percentile rewards engineers scoring
                  above their level baseline.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs italic text-muted-foreground">
                Fewer than two competitive engineers have both a parsable level
                and a rawScore — level residuals are null for every engineer.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Adjustment logic
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {normalisation.adjustmentNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function CompositeSection({
  composite,
  confidence,
}: {
  composite: CompositeBundle;
  confidence: ConfidenceBundle;
}) {
  const scored = composite.entries.filter(
    (e) => e.composite !== null && e.rank !== null,
  ).length;
  const unscored = composite.entries.length - scored;
  const flagged = composite.effectiveSignalWeights.filter((w) => w.flagged);
  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Composite ranking
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {composite.contract}
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>
            {scored} scored · {unscored} unscored
          </div>
          <div className="mt-1">
            ≥{composite.minPresentMethods} methods required
          </div>
        </div>
      </div>

      {composite.dominanceWarnings.length > 0 && (
        <div
          className={`mt-4 rounded-md border p-3 ${
            composite.dominanceBlocked
              ? "border-destructive/40 bg-destructive/5"
              : "border-warning/40 bg-warning/5"
          }`}
        >
          <h4
            className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              composite.dominanceBlocked ? "text-destructive" : "text-warning"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            {composite.dominanceBlocked
              ? "Dominance check BLOCKING the composite"
              : "Dominance trade-offs"}
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground/80">
            {composite.dominanceWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <CompositeTopTable composite={composite} confidence={confidence} />

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Effective signal weights
          </h4>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            Each composite method carries {formatPct(1 / composite.methods.length)} of
            the composite. Signals repeated across methods (log-impact appears
            in both lens A and the tenure/role-adjusted percentile) have their
            contributions summed. Any signal above{" "}
            {formatPct(composite.maxSingleSignalEffectiveWeight)} must be
            justified on the page; {flagged.length === 0 ? "no signals currently exceed it" : `${flagged.length} signal${flagged.length === 1 ? "" : "s"} currently flagged`}.
          </p>
          <table className="mt-3 w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Signal</th>
                <th className="py-2 pr-3 text-right font-medium">Weight</th>
                <th className="py-2 pr-3 font-medium">Methods</th>
              </tr>
            </thead>
            <tbody>
              {composite.effectiveSignalWeights.map((w) => (
                <tr key={w.signal} className="border-b border-border/30 align-top">
                  <td
                    className={`py-2 pr-3 ${
                      w.flagged ? "text-warning" : "text-foreground"
                    }`}
                  >
                    {w.signal}
                    {w.flagged && w.justification && (
                      <div className="mt-1 text-[10px] italic text-warning/90">
                        {w.justification}
                      </div>
                    )}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums ${
                      w.flagged ? "text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {formatPct(w.totalWeight)}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-muted-foreground">
                    {w.contributions
                      .map(
                        (c) =>
                          `${c.method} @ ${formatPct(c.signalWeightInMethod)}`,
                      )
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Leave-one-method-out sensitivity
          </h4>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            Spearman ρ between the baseline rank and the rank we would get if a
            single method were dropped. Close to 1 means the method could be
            removed without moving the ranking much; lower values show the
            method is pulling the composite around.
          </p>
          <table className="mt-3 w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Remove</th>
                <th className="py-2 pr-3 text-right font-medium">ρ vs baseline</th>
                <th className="py-2 pr-3 text-right font-medium">Scored</th>
                <th className="py-2 pr-3 font-medium">Top movers</th>
              </tr>
            </thead>
            <tbody>
              {composite.leaveOneOut.map((row) => (
                <tr
                  key={row.removed}
                  className="border-b border-border/30 align-top"
                >
                  <td className="py-2 pr-3 text-foreground">
                    {row.removedLabel}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {row.correlationToBaseline === null
                      ? "—"
                      : row.correlationToBaseline.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {row.scoredAfter} / {row.scoredBefore}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-muted-foreground">
                    {row.movers.slice(0, 3).length === 0
                      ? "—"
                      : row.movers
                          .slice(0, 3)
                          .map(
                            (m) =>
                              `${m.displayName} (${
                                m.delta === null
                                  ? "new"
                                  : m.delta > 0
                                    ? `+${m.delta}`
                                    : m.delta
                              })`,
                          )
                          .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Final-rank correlations
        </h4>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
          Spearman ρ of the composite rank against each per-engineer numeric
          signal. PR count and log-impact are pinned as dominance risks — if
          |ρ| &gt; {composite.dominanceCorrelationThreshold} on either, the
          ranking has collapsed into activity volume and the dominance warning
          above blocks the composite.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Signal</th>
                <th className="py-2 pr-3 text-right font-medium">ρ vs rank</th>
                <th className="py-2 pr-3 text-right font-medium">n</th>
                <th className="py-2 pr-3 font-medium">Dominance</th>
              </tr>
            </thead>
            <tbody>
              {composite.finalRankCorrelations.map((c) => (
                <tr
                  key={c.signal}
                  className="border-b border-border/30 align-top"
                >
                  <td
                    className={`py-2 pr-3 ${
                      c.exceedsThreshold
                        ? "text-destructive"
                        : c.dominanceRisk
                          ? "text-warning"
                          : "text-foreground"
                    }`}
                  >
                    {c.signal}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums ${
                      c.exceedsThreshold
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {c.rho === null ? "—" : c.rho.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {c.n}
                  </td>
                  <td className="py-2 pr-3 text-[11px]">
                    {c.dominanceRisk ? (
                      <span
                        className={
                          c.exceedsThreshold
                            ? "text-destructive"
                            : "text-warning"
                        }
                      >
                        {c.exceedsThreshold
                          ? "Exceeds threshold — blocking"
                          : "Risk — within threshold"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">context</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Composite-stage limitations
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {composite.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function TieGroupCard({ group }: { group: ConfidenceTieGroup }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.12em] text-warning">
        <span>Tie group {group.groupId}</span>
        <span>
          ranks {group.rankStart}–{group.rankEnd} · {group.size} engineers
        </span>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {group.members.map((m) => (
          <li
            key={m.emailHash}
            className="flex items-center justify-between gap-3 text-foreground"
          >
            <span>
              <span className="tabular-nums text-muted-foreground">#{m.rank}</span>{" "}
              {m.displayName}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              composite {m.composite.toFixed(0)} · CI {m.ciLow.toFixed(0)}–{m.ciHigh.toFixed(0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfidenceSection({ confidence }: { confidence: ConfidenceBundle }) {
  const scored = confidence.entries.filter(
    (e) => e.composite !== null && e.ciLow !== null,
  );
  const widest = [...scored]
    .filter((e) => e.ciWidth !== null)
    .sort((a, b) => (b.ciWidth ?? 0) - (a.ciWidth ?? 0))
    .slice(0, 5);
  const tightest = [...scored]
    .filter((e) => e.ciWidth !== null)
    .sort((a, b) => (a.ciWidth ?? 0) - (b.ciWidth ?? 0))
    .slice(0, 5);
  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Confidence bands and statistical ties
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {confidence.contract}
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>
            {confidence.bootstrapIterations} bootstrap replicates ·{" "}
            {(confidence.ciCoverage * 100).toFixed(0)}% CI
          </div>
          <div className="mt-1">
            {confidence.globalDominanceApplied
              ? `Global widening ×${confidence.dominanceWidening} (dominance-blocked)`
              : "Per-engineer widening only"}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Statistical-tie groups
          </h4>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Rank-adjacent engineers whose 80% CIs overlap. Read these as
            "the page must not narrate an order between them" — not "they are
            equal in absolute terms".
          </p>
          {confidence.tieGroups.length === 0 ? (
            <p className="mt-3 text-xs italic text-muted-foreground">
              No statistical-tie groups in this snapshot — every rank-adjacent
              pair has bands narrow enough to read as a defensible ordering.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {confidence.tieGroups.map((g) => (
                <TieGroupCard key={g.groupId} group={g} />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Widest and tightest bands
          </h4>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            The widest bands are where the methodology is least confident —
            usually small-sample or short-tenure engineers. The tightest
            bands are where the cohort signal disagreement and missingness
            are lowest.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warning">
                Widest 5
              </div>
              <ul className="mt-1 space-y-1 text-xs">
                {widest.length === 0 && (
                  <li className="italic text-muted-foreground">No scored engineers.</li>
                )}
                {widest.map((e) => (
                  <li
                    key={e.emailHash}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-foreground">
                      <span className="tabular-nums text-muted-foreground">
                        #{e.rank}
                      </span>{" "}
                      {e.displayName}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      ±{((e.ciWidth ?? 0) / 2).toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                Tightest 5
              </div>
              <ul className="mt-1 space-y-1 text-xs">
                {tightest.length === 0 && (
                  <li className="italic text-muted-foreground">No scored engineers.</li>
                )}
                {tightest.map((e) => (
                  <li
                    key={e.emailHash}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-foreground">
                      <span className="tabular-nums text-muted-foreground">
                        #{e.rank}
                      </span>{" "}
                      {e.displayName}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      ±{((e.ciWidth ?? 0) / 2).toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Confidence-stage limitations
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {confidence.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ConfidenceBand({ entry }: { entry: EngineerConfidence | undefined }) {
  if (!entry || entry.composite === null || entry.ciLow === null || entry.ciHigh === null) {
    return <span className="text-[10px] italic text-muted-foreground">no band</span>;
  }
  const low = Math.max(0, Math.min(100, entry.ciLow));
  const high = Math.max(0, Math.min(100, entry.ciHigh));
  const point = Math.max(0, Math.min(100, entry.composite));
  const tone = entry.inTieGroup ? "bg-warning/30" : "bg-primary/25";
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-2 w-32 rounded-full bg-muted/50">
        <div
          className={`absolute top-0 h-2 rounded-full ${tone}`}
          style={{
            left: `${low}%`,
            width: `${Math.max(0.5, high - low)}%`,
          }}
        />
        <div
          className="absolute top-[-2px] h-3 w-[2px] bg-foreground"
          style={{ left: `calc(${point}% - 1px)` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {low.toFixed(0)}–{high.toFixed(0)}
        </span>
        {entry.inTieGroup && entry.tieGroupId !== null && (
          <span className="rounded-sm border border-warning/40 bg-warning/10 px-1 text-warning">
            tie {entry.tieGroupId}
          </span>
        )}
      </div>
    </div>
  );
}

function CompositeTopTable({
  composite,
  confidence,
}: {
  composite: CompositeBundle;
  confidence: ConfidenceBundle;
}) {
  const ciByHash = new Map(confidence.entries.map((c) => [c.emailHash, c]));
  return (
    <div className="mt-4 rounded-md border border-border/40 bg-background/60 p-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Top {composite.topN.length} by composite
      </h4>
      {composite.topN.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          No engineers have a composite yet — fewer than two methods are scored
          for any competitive engineer in this snapshot.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="w-8 py-2 pr-2 text-right font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Engineer</th>
                <th className="py-2 pr-3 font-medium">Discipline · Level</th>
                <th className="py-2 pr-3 text-right font-medium">A output</th>
                <th className="py-2 pr-3 text-right font-medium">B impact</th>
                <th className="py-2 pr-3 text-right font-medium">C delivery</th>
                <th className="py-2 pr-3 text-right font-medium">Adjusted</th>
                <th className="py-2 pr-3 text-right font-medium">Composite</th>
                <th className="py-2 pr-3 font-medium">80% CI</th>
                <th className="py-2 pr-3 text-right font-medium">Rank CI</th>
                <th className="py-2 pr-3 text-right font-medium">Methods</th>
              </tr>
            </thead>
            <tbody>
              {composite.topN.map((e) => {
                const ci = ciByHash.get(e.emailHash);
                return (
                  <tr
                    key={e.emailHash || e.displayName}
                    className="border-b border-border/30 align-top"
                  >
                    <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                      {e.rank}
                    </td>
                    <td className="py-2 pr-3 text-foreground">
                      {e.displayName}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {e.discipline} · {e.levelLabel}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatPercentile(e.output)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatPercentile(e.impact)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatPercentile(e.delivery)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatPercentile(e.adjusted)}
                    </td>
                    <td className="py-2 pr-3 text-right font-display tabular-nums text-foreground">
                      {formatPercentile(e.composite)}
                    </td>
                    <td className="py-2 pr-3">
                      <ConfidenceBand entry={ci} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {ci && ci.ciRankLow !== null && ci.ciRankHigh !== null
                        ? `${ci.ciRankLow}–${ci.ciRankHigh}`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {e.presentMethodCount} / 4
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ATTRIBUTION_TOP_N = 25 as const;

function formatRawValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000 || abs < 0.01) {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    });
  }
  return value.toFixed(2);
}

function formatLift(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function MethodBreakdown({
  method,
}: {
  method: EngineerAttributionMethod;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {method.label}
          </div>
          <div className="text-[11px] italic text-muted-foreground/80">
            {method.presentReason}
          </div>
        </div>
        <div
          className={`font-display text-lg italic tabular-nums ${
            method.present ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {method.present ? formatPercentile(method.score) : "absent"}
        </div>
      </div>
      {method.components.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          No components surfaced for this method.
        </p>
      ) : (
        <table className="mt-2 w-full border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-border/40 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Signal</th>
              <th className="py-1 pr-2 text-right font-medium">Weight</th>
              <th className="py-1 pr-2 text-right font-medium">Raw</th>
              <th className="py-1 pr-2 text-right font-medium">Percentile</th>
              <th className="py-1 pr-2 text-right font-medium">Lift</th>
            </tr>
          </thead>
          <tbody>
            {method.components.map((component) => (
              <tr
                key={`${method.method}-${component.signal}`}
                className="border-b border-border/20 align-top"
              >
                <td
                  className={`py-1 pr-2 ${
                    component.kind === "absent"
                      ? "italic text-muted-foreground"
                      : "text-foreground"
                  }`}
                >
                  {component.signal}
                  {component.kind === "absent" && component.absenceReason && (
                    <div className="text-[10px] italic text-muted-foreground/80">
                      {component.absenceReason}
                    </div>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {(component.weightInMethod * 100).toFixed(0)}%
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {formatRawValue(component.rawValue)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {formatPercentile(component.percentile)}
                </td>
                <td
                  className={`py-1 pr-2 text-right tabular-nums ${
                    component.approxCompositeLift === null
                      ? "text-muted-foreground"
                      : component.approxCompositeLift > 0
                        ? "text-primary"
                        : "text-destructive"
                  }`}
                >
                  {formatLift(component.approxCompositeLift)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DriverList({
  drivers,
  tone,
  emptyText,
}: {
  drivers: AttributionContribution[];
  tone: "positive" | "negative";
  emptyText: string;
}) {
  if (drivers.length === 0) {
    return (
      <p className="text-[11px] italic text-muted-foreground">{emptyText}</p>
    );
  }
  const color = tone === "positive" ? "text-primary" : "text-destructive";
  return (
    <ul className="space-y-1 text-[11px]">
      {drivers.map((driver) => (
        <li
          key={`${driver.method}-${driver.signal}`}
          className="flex items-baseline justify-between gap-2"
        >
          <span className="text-foreground">
            <span className="text-muted-foreground">[{driver.method}]</span>{" "}
            {driver.signal}
          </span>
          <span className={`tabular-nums ${color}`}>
            {formatLift(driver.approxCompositeLift)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EngineerAttributionPanel({
  entry,
}: {
  entry: EngineerAttribution;
}) {
  const rankLabel =
    entry.rank === null ? "Unranked" : `#${entry.rank}`;
  const composite = formatPercentile(entry.compositeScore);
  const reconciliationTone = entry.reconciliation.matches
    ? "text-primary"
    : "text-destructive";
  return (
    <details className="rounded-md border border-border/40 bg-background/60 open:border-border/70 open:bg-background/80">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-3 px-3 py-2 text-xs">
        <span className="w-10 font-mono text-muted-foreground">
          {rankLabel}
        </span>
        <span className="flex-1 font-semibold text-foreground">
          {entry.displayName}
        </span>
        <span className="text-muted-foreground">
          {entry.discipline} · {entry.levelLabel}
        </span>
        <span className="font-display italic text-foreground">
          {composite}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {entry.presentMethodCount} / 4 methods
        </span>
      </summary>
      <div className="space-y-4 border-t border-border/30 p-3">
        <div className="grid gap-3 lg:grid-cols-2">
          {entry.methods.map((method) => (
            <MethodBreakdown key={method.method} method={method} />
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-border/40 bg-background/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              Top lifts (what pushed them up)
            </div>
            <div className="mt-2">
              <DriverList
                drivers={entry.topPositiveDrivers}
                tone="positive"
                emptyText="No present signal lifted this engineer above the neutral 50."
              />
            </div>
          </div>
          <div className="rounded-md border border-border/40 bg-background/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-destructive">
              Top drags (what held them down)
            </div>
            <div className="mt-2">
              <DriverList
                drivers={entry.topNegativeDrivers}
                tone="negative"
                emptyText="No present signal dragged this engineer below the neutral 50."
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
            <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Reconciliation
            </div>
            <p className={`mt-1 italic ${reconciliationTone}`}>
              {entry.reconciliation.matches
                ? "median(methods) = composite"
                : "median(methods) ≠ composite — methodology defect"}
            </p>
            <p className="mt-1 text-muted-foreground">
              recomputed {formatPercentile(entry.reconciliation.recomputedComposite)}
              {" "}·{" "}stored {composite}
            </p>
            <p className="mt-1 text-muted-foreground">
              delta{" "}
              {entry.reconciliation.delta === null
                ? "—"
                : entry.reconciliation.delta.toFixed(3)}
            </p>
          </div>
          <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
            <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Discipline peer comparison
            </div>
            <p className="mt-1 text-muted-foreground">
              {entry.peerComparison.disciplineCohort?.note ??
                "No discipline cohort attached (engineer unscored)."}
            </p>
            <p className="mt-1 text-muted-foreground">
              raw{" "}
              {formatPercentile(entry.peerComparison.rawPercentile)}
              {" "}→ adjusted{" "}
              {formatPercentile(entry.peerComparison.adjustedPercentile)}{" "}
              ({formatLift(entry.peerComparison.adjustmentLift)})
            </p>
          </div>
          <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
            <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Evidence
            </div>
            <p className="mt-1 text-muted-foreground">
              GitHub:{" "}
              {entry.evidence.githubLogin ? (
                entry.evidence.githubPrSearchUrl ? (
                  <a
                    href={entry.evidence.githubPrSearchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {entry.evidence.githubLogin}
                  </a>
                ) : (
                  <span>{entry.evidence.githubLogin}</span>
                )
              ) : (
                <span className="italic">unmapped</span>
              )}
            </p>
            <p className="mt-1 text-muted-foreground">
              Impact model:{" "}
              {entry.evidence.impactModelPresent ? "in training set" : "absent"}
            </p>
            <p className="mt-1 text-muted-foreground">
              Squad context:{" "}
              {entry.evidence.squadContextPresent ? "joined" : "not joined"}
            </p>
            {entry.evidence.notes.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 italic">
                {entry.evidence.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
          <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Manager · squad · pillar
          </div>
          <p className="mt-1 text-muted-foreground">
            Manager: {entry.context.manager ?? "—"}
          </p>
          <p className="mt-1 text-muted-foreground">
            Squad:{" "}
            {entry.context.canonicalSquad?.name ??
              entry.context.rawSquad ??
              "—"}
            {entry.context.canonicalSquad?.pmName
              ? ` · PM ${entry.context.canonicalSquad.pmName}`
              : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            Pillar: {entry.context.canonicalSquad?.pillar ?? entry.context.pillar}
          </p>
        </div>

        {entry.absentSignals.length > 0 && (
          <p className="text-[11px] italic text-muted-foreground">
            Labelled absent for this engineer:{" "}
            {entry.absentSignals.join(", ")}.
          </p>
        )}
      </div>
    </details>
  );
}

function AttributionSection({
  attribution,
}: {
  attribution: AttributionBundle;
}) {
  const scored = attribution.entries.filter(
    (e) => e.rank !== null && e.compositeScore !== null,
  );
  const unscored = attribution.entries.filter(
    (e) => e.rank === null || e.compositeScore === null,
  );
  const surfaced = scored.slice(0, ATTRIBUTION_TOP_N);
  const reconciliationFailures = attribution.entries.filter(
    (e) => !e.reconciliation.matches,
  );
  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Per-engineer attribution
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {attribution.contract}
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>
            {scored.length} scored · {unscored.length} unscored
          </div>
          <div className="mt-1">
            reconciliation tolerance ±{attribution.tolerance}
          </div>
        </div>
      </div>

      {reconciliationFailures.length > 0 && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[11px] text-destructive">
          {reconciliationFailures.length} engineer
          {reconciliationFailures.length === 1 ? "" : "s"} failed the
          reconciliation check — methodology bug, not display noise. Rows are
          tagged below.
        </div>
      )}

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Top {surfaced.length} ranked engineers — click to expand
        </div>
        {surfaced.length === 0 ? (
          <p className="mt-3 text-xs italic text-muted-foreground">
            No scored engineers yet. Live GitHub, impact-model, and Swarmia
            data must be populating the signal rows before the composite can
            produce a ranked drilldown.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {surfaced.map((entry) => (
              <EngineerAttributionPanel
                key={entry.emailHash || entry.displayName}
                entry={entry}
              />
            ))}
          </div>
        )}
      </div>

      {unscored.length > 0 && (
        <details className="mt-4 rounded-md border border-border/40 bg-background/60 p-3 text-xs">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Unscored competitive engineers ({unscored.length})
          </summary>
          <p className="mt-2 text-[11px] italic text-muted-foreground">
            These engineers are in the competitive cohort but fewer than{" "}
            {attribution.totalMethods} / 2 methods returned a score. They are
            deliberately left off the ranked list rather than being given a
            synthesised neutral rank.
          </p>
          <ul className="mt-2 grid gap-1 text-[11px] text-muted-foreground md:grid-cols-2">
            {unscored.map((e) => (
              <li key={e.emailHash || e.displayName}>
                {e.displayName} — {e.discipline} · {e.presentMethodCount} / 4
                methods present
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Attribution-stage limitations
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {attribution.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const MOVER_CAUSE_LABEL: Record<MoverCauseKind, string> = {
  input_drift: "Input drift",
  ambiguous_context: "Ambiguous / context",
  methodology_change: "Methodology change",
  cohort_transition: "Cohort transition",
  unknown: "Unknown",
};

const MOVER_CAUSE_TONE: Record<MoverCauseKind, string> = {
  input_drift: "border-primary/40 bg-primary/5 text-primary",
  ambiguous_context:
    "border-muted-foreground/30 bg-muted/40 text-foreground",
  methodology_change: "border-warning/40 bg-warning/5 text-warning",
  cohort_transition:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  unknown: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
};

function formatMoverRank(value: number | null): string {
  return value === null ? "—" : `#${value}`;
}

function formatMoverDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(0)}`;
}

function formatMoverPercentileDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(1)}pp`;
}

function MoverTable({
  title,
  subtitle,
  rows,
  emptyCopy,
  rankDeltaLegend,
}: {
  title: string;
  subtitle: string;
  rows: MoverEntry[];
  emptyCopy: string;
  rankDeltaLegend: "improvement" | "regression" | "cohort";
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {rankDeltaLegend === "improvement"
            ? "Lower rank = better"
            : rankDeltaLegend === "regression"
              ? "Higher rank = worse"
              : "Roster transition"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          {emptyCopy}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Engineer</th>
                <th className="py-2 pr-3 font-medium">Prior rank</th>
                <th className="py-2 pr-3 font-medium">Current rank</th>
                <th className="py-2 pr-3 font-medium">Δ rank</th>
                <th className="py-2 pr-3 font-medium">Δ percentile</th>
                <th className="py-2 pr-3 font-medium">Likely cause</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.category}-${row.emailHash}`}
                  className="border-b border-border/30 align-top"
                >
                  <td className="py-2 pr-3 text-foreground">
                    {row.displayName}
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {row.category.replace("_", " ")}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {formatMoverRank(row.priorRank)}
                  </td>
                  <td className="py-2 pr-3 text-foreground/80">
                    {formatMoverRank(row.currentRank)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {formatMoverDelta(row.rankDelta)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {formatMoverPercentileDelta(row.percentileDelta)}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${MOVER_CAUSE_TONE[row.causeKind]}`}
                    >
                      {MOVER_CAUSE_LABEL[row.causeKind]}
                    </span>
                    <div className="mt-1 text-[11px] italic text-muted-foreground">
                      {row.likelyCause}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MoversSection({ movers }: { movers: MoversBundle }) {
  const totalRows =
    movers.risers.length +
    movers.fallers.length +
    movers.newEntrants.length +
    movers.cohortExits.length;
  const statusLabel =
    movers.status === "ok"
      ? "Comparable prior snapshot"
      : movers.status === "methodology_changed"
        ? "Methodology changed since prior snapshot"
        : movers.status === "insufficient_gap"
          ? "Prior snapshot too recent"
          : "No prior snapshot yet";
  const statusTone =
    movers.status === "ok"
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-warning/40 bg-warning/10 text-warning";

  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Movers vs the prior comparable snapshot
          </h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {movers.contract}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] ${statusTone}`}
        >
          {statusLabel}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Current
          </dt>
          <dd className="mt-1 text-foreground">
            v{movers.currentSnapshot.methodologyVersion} · {movers.currentSnapshot.snapshotDate}
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Prior
          </dt>
          <dd className="mt-1 text-foreground">
            {movers.priorSnapshot
              ? `v${movers.priorSnapshot.methodologyVersion} · ${movers.priorSnapshot.snapshotDate}`
              : "—"}
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Gap
          </dt>
          <dd className="mt-1 text-foreground">
            {movers.priorSnapshotGapDays === null
              ? "—"
              : `${movers.priorSnapshotGapDays}d`}{" "}
            <span className="text-muted-foreground">
              (min {movers.minGapDays}d)
            </span>
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Rows
          </dt>
          <dd className="mt-1 text-foreground">
            {movers.risers.length} risers · {movers.fallers.length} fallers ·{" "}
            {movers.newEntrants.length} in · {movers.cohortExits.length} out
          </dd>
        </div>
      </dl>

      {movers.notes.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
          {movers.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {movers.status === "ok" || movers.status === "methodology_changed" ? (
        <div className="mt-5 space-y-4">
          <MoverTable
            title="Biggest risers"
            subtitle={`Top ${movers.topN} engineers by rank improvement (most negative Δ rank).`}
            rows={movers.risers}
            emptyCopy="No engineers improved their rank since the prior snapshot."
            rankDeltaLegend="improvement"
          />
          <MoverTable
            title="Biggest fallers"
            subtitle={`Top ${movers.topN} engineers by rank regression (most positive Δ rank).`}
            rows={movers.fallers}
            emptyCopy="No engineers regressed in rank since the prior snapshot."
            rankDeltaLegend="regression"
          />
          <MoverTable
            title="New cohort entrants"
            subtitle="Engineers ranked this snapshot but not the prior one — new hires finishing ramp-up, newly GitHub-mapped engineers, or newly scored rows. Not counted as ordinary movers."
            rows={movers.newEntrants}
            emptyCopy="No engineers entered the competitive cohort since the prior snapshot."
            rankDeltaLegend="cohort"
          />
          <MoverTable
            title="Cohort exits"
            subtitle="Engineers ranked in the prior snapshot but not this one — leavers, lost GitHub mapping, or composite dropped below the minimum present-method count. Not counted as ordinary movers."
            rows={movers.cohortExits}
            emptyCopy="No engineers left the competitive cohort since the prior snapshot."
            rankDeltaLegend="cohort"
          />
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-border/60 bg-background/40 p-4 text-xs italic text-muted-foreground">
          {movers.status === "no_prior_snapshot"
            ? "No comparable prior snapshot has been persisted yet. The movers tables will populate after the next scheduled refresh produces a second snapshot at least " +
              movers.minGapDays +
              " days after the first."
            : "Movers view is paused until a prior snapshot at least " +
              movers.minGapDays +
              " days old exists."}{" "}
          {totalRows > 0 ? `(Raw candidate count: ${totalRows}.)` : null}
        </div>
      )}

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Movers-stage limitations
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {movers.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STABILITY_FLAG_LABEL: Record<StabilityFlag, string> = {
  stable: "Stable",
  input_drift: "Input drift",
  ambiguous_context: "Ambiguous / context",
  context_affected: "Context-affected",
  cohort_transition: "Cohort transition",
  methodology_change: "Methodology change",
  unknown: "Unknown",
};

const STABILITY_FLAG_TONE: Record<StabilityFlag, string> = {
  stable: "border-primary/40 bg-primary/10 text-primary",
  input_drift: "border-primary/40 bg-primary/5 text-primary",
  ambiguous_context: "border-warning/40 bg-warning/10 text-warning",
  context_affected:
    "border-muted-foreground/30 bg-muted/50 text-foreground",
  cohort_transition:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  methodology_change: "border-warning/40 bg-warning/5 text-warning",
  unknown: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
};

function formatStabilityRank(value: number | null): string {
  return value === null ? "—" : `#${value}`;
}

function formatStabilityPercentileDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(1)}pp`;
}

function StabilitySection({ stability }: { stability: StabilityBundle }) {
  const statusLabel =
    stability.status === "ok"
      ? stability.withinTolerance
        ? "Within tolerance"
        : "Out of tolerance"
      : stability.status === "methodology_changed"
        ? "Methodology changed since prior snapshot"
        : stability.status === "insufficient_gap"
          ? "Prior snapshot too recent"
          : "No prior snapshot yet";
  const statusTone =
    stability.status === "ok" && stability.withinTolerance
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-warning/40 bg-warning/10 text-warning";

  const flagged = stability.entries.filter(
    (e) =>
      e.flag === "ambiguous_context" ||
      e.flag === "context_affected" ||
      e.flag === "input_drift" ||
      e.flag === "methodology_change",
  );

  const ambiguousPct =
    stability.ambiguousCohortFraction === null
      ? null
      : (stability.ambiguousCohortFraction * 100).toFixed(1);

  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Stability check vs the prior comparable snapshot
          </h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {stability.contract}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] ${statusTone}`}
        >
          {statusLabel}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Comparable cohort
          </dt>
          <dd className="mt-1 text-foreground">
            {stability.comparableCohortSize} engineer
            {stability.comparableCohortSize === 1 ? "" : "s"}
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Ambiguous share
          </dt>
          <dd className="mt-1 text-foreground">
            {ambiguousPct === null ? "—" : `${ambiguousPct}%`}
            <span className="text-muted-foreground">
              {" "}
              (max{" "}
              {(stability.ambiguousCohortTolerance * 100).toFixed(0)}%)
            </span>
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Max ambiguous shift
          </dt>
          <dd className="mt-1 text-foreground">
            {stability.maxAmbiguousPercentileShift === null
              ? "—"
              : `${stability.maxAmbiguousPercentileShift.toFixed(1)}pp`}
            <span className="text-muted-foreground">
              {" "}
              (threshold {stability.percentileThreshold}pp)
            </span>
          </dd>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Classification
          </dt>
          <dd className="mt-1 text-foreground">
            {stability.stableCount} stable · {stability.inputDriftCount} drift ·{" "}
            {stability.ambiguousContextCount + stability.contextAffectedCount}{" "}
            ambig · {stability.cohortTransitionCount} transition
          </dd>
        </div>
      </dl>

      {stability.notes.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
          {stability.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {flagged.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border/60 bg-background/40 p-4 text-xs italic text-muted-foreground">
          {stability.status === "ok"
            ? "No engineers flagged for stability review this cycle — every comparable engineer is either stable or a cohort transition."
            : "Stability table waits for a comparable prior snapshot under the same methodology version."}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Engineer</th>
                <th className="py-2 pr-3 font-medium">Prior rank</th>
                <th className="py-2 pr-3 font-medium">Current rank</th>
                <th className="py-2 pr-3 font-medium">Δ percentile</th>
                <th className="py-2 pr-3 font-medium">Flag</th>
                <th className="py-2 pr-3 font-medium">Narrative</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((row) => (
                <StabilityRow key={row.emailHash} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Reviewer adversarial questions (answered in each cycle worklog)
        </h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {stability.adversarialQuestions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </div>

      <div className="mt-4 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Stability-stage limitations
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {stability.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function StabilityRow({ row }: { row: StabilityEntry }) {
  return (
    <tr className="border-b border-border/30 align-top">
      <td className="py-2 pr-3 text-foreground">{row.displayName}</td>
      <td className="py-2 pr-3 text-muted-foreground">
        {formatStabilityRank(row.priorRank)}
      </td>
      <td className="py-2 pr-3 text-foreground/80">
        {formatStabilityRank(row.currentRank)}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">
        {formatStabilityPercentileDelta(row.percentileDelta)}
      </td>
      <td className="py-2 pr-3">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${STABILITY_FLAG_TONE[row.flag]}`}
        >
          {STABILITY_FLAG_LABEL[row.flag]}
        </span>
      </td>
      <td className="py-2 pr-3 text-[11px] italic text-muted-foreground">
        {row.narrative}
      </td>
    </tr>
  );
}

const DOWNWEIGHT_LABEL: Record<AntiGamingRow["downweightStatus"], string> = {
  full_weight: "Full weight",
  down_weighted: "Down-weighted",
  scored_flagged: "Scored · above ceiling",
  contextual_only: "Contextual only",
};

const DOWNWEIGHT_TONE: Record<AntiGamingRow["downweightStatus"], string> = {
  full_weight: "border-primary/40 bg-primary/10 text-primary",
  down_weighted: "border-warning/40 bg-warning/10 text-warning",
  scored_flagged: "border-destructive/40 bg-destructive/10 text-destructive",
  contextual_only:
    "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

const FRESHNESS_TONE: Record<
  RankingFreshnessBadge["availability"],
  string
> = {
  available: "border-primary/40 bg-primary/10 text-primary",
  unavailable: "border-destructive/40 bg-destructive/5 text-destructive",
  pending_source: "border-warning/40 bg-warning/10 text-warning",
};

function formatEffectiveWeight(w: EffectiveSignalWeight): string {
  const pct = (w.totalWeight * 100).toFixed(1);
  return `${pct}%`;
}

function MethodologySection({
  methodology,
}: {
  methodology: MethodologyBundle;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-2">
          <h3 className="font-display text-2xl italic tracking-tight text-foreground">
            Methodology panel
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {methodology.contract}
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>Version v{methodology.methodologyVersion}</div>
          <div className="mt-1">
            Rubric {methodology.rubricVersion ?? "not available"}
          </div>
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Composite rule
          </h4>
          <p className="mt-2 text-sm text-foreground">
            {methodology.compositeRule}
          </p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Normalisation layer
          </h4>
          <p className="mt-2 text-sm text-foreground">
            {methodology.normalisationSummary}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Lenses and lens weights
        </h4>
        <ul className="mt-3 space-y-3">
          {methodology.lenses.map((lens) => (
            <li
              key={lens.key}
              className="rounded-md border border-border/40 bg-card p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {lens.label}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {lens.description}
                  </div>
                </div>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {lens.weights.map((w) => (
                  <li
                    key={`${lens.key}-${w.signal}`}
                    className="rounded-full border border-border/40 bg-background/80 px-2.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {w.signal} · {(w.weight * 100).toFixed(0)}%
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Effective signal weights across the composite
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Every signal's share across the four composite methods. Flagged
          signals exceed the 30% ceiling — the dominance panel names the
          trade-off explicitly.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="pb-2 pr-4">Signal</th>
                <th className="pb-2 pr-4">Effective weight</th>
                <th className="pb-2">Justification</th>
              </tr>
            </thead>
            <tbody>
              {methodology.effectiveWeights.map((w) => (
                <tr
                  key={w.signal}
                  className="border-t border-border/30 align-top"
                >
                  <td className="py-2 pr-4 text-foreground">{w.signal}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        w.flagged
                          ? "border-warning/40 bg-warning/10 text-warning"
                          : "border-primary/40 bg-primary/10 text-primary"
                      }`}
                    >
                      {formatEffectiveWeight(w)}
                    </span>
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {w.flagged
                      ? (w.justification ??
                        "No methodology justification recorded.")
                      : "Within ceiling."}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Anti-gaming audit
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          For every signal the ranking touches — scored or contextual — the
          table names the gaming path, the mitigation, the residual weakness,
          and whether the signal is down-weighted.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="pb-2 pr-4">Signal</th>
                <th className="pb-2 pr-4">Gaming path</th>
                <th className="pb-2 pr-4">Mitigation</th>
                <th className="pb-2 pr-4">Residual weakness</th>
                <th className="pb-2">Posture</th>
              </tr>
            </thead>
            <tbody>
              {methodology.antiGamingRows.map((row) => (
                <tr
                  key={row.signal}
                  className="border-t border-border/30 align-top"
                >
                  <td className="py-2 pr-4 font-medium text-foreground">
                    {row.signal}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {row.gamingPath}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {row.mitigation}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {row.residualWeakness}
                  </td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${DOWNWEIGHT_TONE[row.downweightStatus]}`}
                    >
                      {DOWNWEIGHT_LABEL[row.downweightStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Data freshness
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Per-source timestamps and windows used by this ranking run. The
          rubric version stays "not available" until `prReviewAnalyses` lands.
        </p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {methodology.freshness.map((badge) => (
            <li
              key={`${badge.label}-${badge.source}`}
              className="rounded-md border border-border/40 bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {badge.label}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {badge.source}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${FRESHNESS_TONE[badge.availability]}`}
                >
                  {badge.availability === "pending_source"
                    ? "pending"
                    : badge.availability}
                </span>
              </div>
              <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 uppercase tracking-[0.12em]">
                    Timestamp
                  </dt>
                  <dd className="text-foreground">
                    {badge.timestamp ?? "—"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 uppercase tracking-[0.12em]">
                    Window
                  </dt>
                  <dd className="text-foreground">{badge.window ?? "—"}</dd>
                </div>
                {badge.note && (
                  <div className="text-[11px] italic text-muted-foreground">
                    {badge.note}
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Unavailable signals
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Signals the ranking would use if they existed. Listed here so a
          reader never infers their absence from silence.
        </p>
        <ul className="mt-3 space-y-2 text-xs">
          {methodology.unavailableSignals.map((u) => (
            <li
              key={u.name}
              className="rounded-md border border-border/40 bg-card p-3"
            >
              <div className="text-sm font-medium text-foreground">
                {u.name}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {u.reason}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 rounded-md border border-border/40 bg-background/60 p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Manager calibration
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {methodology.managerCalibration.note}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
          <div className="rounded-md border border-border/40 bg-card p-3">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Status
            </dt>
            <dd className="mt-1 text-foreground">
              {methodology.managerCalibration.status.replace("_", " ")}
            </dd>
          </div>
          <div className="rounded-md border border-border/40 bg-card p-3">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Managers with directs
            </dt>
            <dd className="mt-1 text-foreground">
              {methodology.managerCalibration.managersWithDirectReports}
            </dd>
          </div>
          <div className="rounded-md border border-border/40 bg-card p-3">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Direct-report links
            </dt>
            <dd className="mt-1 text-foreground">
              {methodology.managerCalibration.directReportLinks}
            </dd>
          </div>
          <div className="rounded-md border border-border/40 bg-card p-3">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Engineers with mapped manager
            </dt>
            <dd className="mt-1 text-foreground">
              {methodology.managerCalibration.engineersWithMappedManager}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function RosterTable({ entries }: { entries: EligibilityEntry[] }) {
  const preview = entries.slice(0, 12);
  const remaining = entries.length - preview.length;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Engineer</th>
            <th className="py-2 pr-3 font-medium">Discipline</th>
            <th className="py-2 pr-3 font-medium">Squad</th>
            <th className="py-2 pr-3 font-medium">Tenure</th>
            <th className="py-2 pr-3 font-medium">GitHub</th>
            <th className="py-2 pr-3 font-medium">Impact model</th>
            <th className="py-2 pr-3 font-medium">Eligibility</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((e) => (
            <tr
              key={e.emailHash || e.email || e.displayName}
              className="border-b border-border/30 align-top"
            >
              <td className="py-2 pr-3">
                <div className="text-sm text-foreground">{e.displayName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {e.manager ? `Manager: ${e.manager}` : "No manager on row"}
                </div>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.discipline} · {e.levelLabel}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.canonicalSquad ? (
                  <>
                    <div className="text-foreground/80">
                      {e.canonicalSquad.name}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.12em]">
                      {e.canonicalSquad.pillar}
                      {e.canonicalSquad.pmName
                        ? ` · PM ${e.canonicalSquad.pmName}`
                        : ""}
                    </div>
                    <div className="text-[10px] normal-case tracking-normal text-muted-foreground/80">
                      {e.canonicalSquad.channelId
                        ? `Slack: ${e.canonicalSquad.channelId}`
                        : "No Slack channel on squads row"}
                    </div>
                  </>
                ) : e.squad ? (
                  <>
                    <div>{e.squad}</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-warning">
                      not in squads registry
                    </div>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.tenureDays === null ? "—" : `${e.tenureDays}d`}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.githubLogin ?? "unmapped"}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.hasImpactModelRow ? "yes" : "no"}
              </td>
              <td className="py-2 pr-3">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${ELIGIBILITY_TONE[e.eligibility]}`}
                >
                  {ELIGIBILITY_LABEL[e.eligibility]}
                </span>
                <div className="mt-1 text-[11px] italic text-muted-foreground">
                  {e.reason}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {remaining > 0 && (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          Showing first {preview.length} of {entries.length} engineers — the
          full roster will be visible when scoring lands.
        </p>
      )}
    </div>
  );
}

export function RankingScaffold({
  snapshot,
}: {
  snapshot: EngineeringRankingSnapshot;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-3xl italic tracking-tight text-foreground">
                Engineer ranking
              </h2>
              <StatusBadge status={snapshot.status} />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A defensible, methodology-first ranking of every engineer at Cleo
              from the signals we already collect. This page is the artifact;
              the methodology is the product — each cycle should move the
              ranking toward one the CEO can defend for any engineer on it.
            </p>
          </div>
          <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <div>Methodology v{snapshot.methodologyVersion}</div>
            <div className="mt-1">
              Window {formatDate(snapshot.signalWindow.start)} →{" "}
              {formatDate(snapshot.signalWindow.end)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-warning/40 bg-warning/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              Why this ranked list should not be read as final
            </h3>
            <p className="text-sm text-muted-foreground">
              A composite rank now exists for every engineer with at least two
              present methods. The composite is the median of four methods —
              lens A (output), lens B (SHAP impact), lens C (squad-delivery
              context), and the tenure/role-adjusted percentile. Effective
              signal-weight decomposition, leave-one-method-out sensitivity,
              a PR/log-impact dominance check, 80% bootstrap confidence
              bands with statistical-tie groups, per-engineer attribution
              drilldowns, privacy-preserving snapshot persistence (keyed on
              snapshot date + methodology version + email hash, with no
              display name, email, manager, or resolved GitHub login
              written to the database), the movers view (risers /
              fallers / cohort entrants / cohort exits with conservative
              cause narration against the most recent comparable prior
              snapshot), the methodology panel (signal weights,
              anti-gaming audit for every signal, per-source freshness
              badges, and a manager-calibration stub ready for a later
              feedback loop), and the stability check (ambiguous-cohort
              fraction, `withinTolerance` boolean, reviewer adversarial
              questions surfaced on the page) are all live. The rank is an
              evidence composite: graduating to a final adjudication
              additionally requires two consecutive cycles of the stability
              check within tolerance at the same methodology version.
            </p>
          </div>
        </div>
      </section>

      <MethodologySection methodology={snapshot.methodology} />

      <CompositeSection
        composite={snapshot.composite}
        confidence={snapshot.confidence}
      />

      <ConfidenceSection confidence={snapshot.confidence} />

      <AttributionSection attribution={snapshot.attribution} />

      <MoversSection movers={snapshot.movers} />

      <StabilitySection stability={snapshot.stability} />

      <CoverageSection snapshot={snapshot} />

      <SignalAuditSection snapshot={snapshot} />

      <LensesSection lenses={snapshot.lenses} />

      <NormalisationSection
        normalisation={snapshot.normalisation}
        rampUpCount={snapshot.eligibility.coverage.rampUp}
      />

      <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <h3 className="text-sm font-semibold text-foreground">
          Signals this ranking will use
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Availability of each input signal at the time this page was rendered.
          Unavailable signals are documented as known methodology limitations
          and not silently synthesised.
        </p>
        <ul className="mt-4 space-y-2">
          {snapshot.plannedSignals.map((signal) => (
            <li
              key={signal.name}
              className="flex items-start gap-3 rounded-md border border-border/40 bg-background/60 px-3 py-2"
            >
              <SignalIcon state={signal.state} />
              <div className="flex-1">
                <div className="text-sm text-foreground">{signal.name}</div>
                {signal.note && (
                  <div className="text-xs text-muted-foreground">
                    {signal.note}
                  </div>
                )}
              </div>
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {signal.state}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <h3 className="text-sm font-semibold text-foreground">
          Known methodology limitations
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Surfaced on the page so the ranking never claims more than it can
          defend. These are what the next cycles will close.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {snapshot.knownLimitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      {snapshot.engineers.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border/60 bg-background/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No engineers have been scored by the composite yet — every
            competitive engineer currently has fewer than{" "}
            {snapshot.composite.minPresentMethods} present methods. Live
            GitHub, impact-model, and Swarmia data must be populating the
            signal rows before the composite can produce a rank. The
            stability check is live but reports `no_prior_snapshot` until
            a second ranking run has persisted.
          </p>
        </section>
      ) : null}
    </div>
  );
}
