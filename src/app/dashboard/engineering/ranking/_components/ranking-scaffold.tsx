import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import {
  bucketNormalisationDeltas,
  type CorrelationPair,
  type EligibilityEntry,
  type EligibilityStatus,
  type EngineerNormalisation,
  type EngineeringRankingSnapshot,
  type LensDisagreementRow,
  type LensScoreSummary,
  type LensesBundle,
  type NormalisationBundle,
  type SignalAudit,
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
            methodology earns its money. The M10 composite is built from the
            adjusted lenses only once the disagreements are understood.
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
              Why there is no ranked list yet
            </h3>
            <p className="text-sm text-muted-foreground">
              Eligibility, the signal orthogonality audit, three independent
              scoring lenses, and tenure/role normalisation are all implemented
              and visible below as exploratory inputs. The final composite
              score, confidence bands, per-engineer attribution drilldowns,
              ranking snapshots, the movers view, and the stability check are
              still pending — so the page deliberately does not yet present a
              single ranked list, because any rank would be defended against a
              composite that has not been agreed.
            </p>
          </div>
        </div>
      </section>

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
            No engineers are ranked yet. Eligibility, the signal audit, the
            three scoring lenses, and tenure/role normalisation above are the
            inputs the final composite will draw on — the composite, confidence
            bands, and per-engineer attribution are the remaining work before
            any ranked list is shown.
          </p>
        </section>
      ) : null}
    </div>
  );
}
