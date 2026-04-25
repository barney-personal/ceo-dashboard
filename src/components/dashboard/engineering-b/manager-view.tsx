import {
  COMPOSITE_METHODOLOGY_ROWS,
  COMPOSITE_METHODOLOGY_SECTIONS,
  COMPOSITE_MAX_SINGLE_WEIGHT,
  rankWithConfidence,
  scopeComposite,
  type CompositeBundle,
  type CompositeEntry,
  type CompositeScope,
  type RankedCompositeEntry,
} from "@/lib/data/engineering-composite";
import { getEngineeringComposite } from "@/lib/data/engineering-composite.server";
import { StackRankTable } from "./stack-rank-table";

export type ManagerScopeKind = "org" | "directs";

interface ManagerViewProps {
  /**
   * Which scope the manager view should render. "org" — full scored cohort
   * (used for CEO / leadership personas). "directs" — restrict to
   * engineers whose `managerEmail` matches the viewer. The loader prevents
   * real plain managers from reaching B-side in first pass, so this path is
   * exercised only by tests / controlled previews; it is retained so the
   * component contract is complete.
   */
  scope: ManagerScopeKind;
  /** Required when `scope === "directs"`. Ignored for "org". */
  managerEmail?: string | null;
  /** Optional override for tests to inject a pre-built bundle. */
  bundle?: CompositeBundle;
}

function MethodologyPanel() {
  return (
    <section
      data-testid="engineering-b-methodology"
      className="rounded-xl border border-border/60 bg-card px-5 py-4 shadow-warm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base italic text-foreground">
          One composite score — the whole methodology, on one page
        </h3>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          no impact model · no competing ranks
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Each engineer is scored 0–100 on a single composite, computed as a
        weighted mean of cohort-relative percentiles (within discipline). Every
        weight is below the {(COMPOSITE_MAX_SINGLE_WEIGHT * 100).toFixed(0)}%
        single-signal cap, no signal is a proxy for pay-to-win (no AI spend, no
        LOC, no commit count). Confidence bands come from PR sample size,
        rubric coverage, signal completeness, and a tenure-pro-rate penalty.
        Promote / performance-manage labels are withheld unless the whole tie
        group sits inside the quartile and the confidence gap to the next group
        is real.
      </p>
      <div
        data-testid="engineering-b-methodology-signals"
        className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
      >
        {COMPOSITE_METHODOLOGY_ROWS.map((row) => (
          <div
            key={row.key}
            data-methodology-signal={row.key}
            className="rounded-md border border-border/40 bg-background/60 p-3"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {row.label}
              </span>
              <span className="font-display text-sm italic text-foreground">
                {row.weightPct.toFixed(0)}%
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {row.description}
            </p>
            <dl className="mt-2 space-y-1 text-[10px] leading-snug text-muted-foreground">
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                  Normalisation
                </dt>
                <dd className="text-muted-foreground">
                  {row.normalizationRule}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                  Minimum sample
                </dt>
                <dd className="text-muted-foreground">{row.minimumSampleRule}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                  Limitations
                </dt>
                <dd className="text-muted-foreground">{row.knownLimitations}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <div
        data-testid="engineering-b-methodology-sections"
        className="mt-4 grid gap-2 sm:grid-cols-2"
      >
        {COMPOSITE_METHODOLOGY_SECTIONS.map((section) => (
          <div
            key={section.title}
            data-methodology-section={section.title}
            className="rounded-md border border-border/30 bg-background/40 p-3"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
              {section.title}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

interface ConfidentStandouts {
  promote: RankedCompositeEntry[];
  performanceManage: RankedCompositeEntry[];
}

/**
 * Filter the ranked cohort to engineers the methodology actually flags with
 * confidence — i.e. flagEligible is true (whole tie group sits inside the
 * quartile and the band gap to the next group is real). Without this panel,
 * the top of the table is dominated by huge "TIED · N" groups and the manager
 * has nothing decision-ready to act on.
 */
function selectConfidentStandouts(
  ranked: readonly RankedCompositeEntry[],
): ConfidentStandouts {
  const promote: RankedCompositeEntry[] = [];
  const performanceManage: RankedCompositeEntry[] = [];
  for (const entry of ranked) {
    if (!entry.flagEligible) continue;
    if (entry.quartileFlag === "promote_candidate") promote.push(entry);
    else if (entry.quartileFlag === "performance_manage")
      performanceManage.push(entry);
  }
  return { promote, performanceManage };
}

function StandoutChip({
  entry,
  variant,
}: {
  entry: RankedCompositeEntry;
  variant: "promote" | "pm";
}) {
  const tone =
    variant === "promote"
      ? "border-primary/40 bg-primary/5 text-primary"
      : "border-destructive/40 bg-destructive/5 text-destructive";
  return (
    <div
      data-testid={`confident-${variant}-${entry.emailHash}`}
      className={`flex items-baseline justify-between gap-3 rounded-md border ${tone} px-3 py-2`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {entry.displayName}
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {entry.pillar}
          {entry.squad ? ` · ${entry.squad}` : ""} · {entry.discipline}
        </div>
      </div>
      <div className="text-right">
        <div className="font-display text-base italic tabular-nums text-foreground">
          {entry.score === null ? "—" : entry.score.toFixed(1)}
        </div>
        <div className="text-[10px] tabular-nums text-muted-foreground">
          ±
          {entry.confidenceBand
            ? entry.confidenceBand.halfWidth.toFixed(1)
            : "—"}
        </div>
      </div>
    </div>
  );
}

function ConfidentStandoutsPanel({
  ranked,
}: {
  ranked: readonly RankedCompositeEntry[];
}) {
  const { promote, performanceManage } = selectConfidentStandouts(ranked);
  const hasAny = promote.length + performanceManage.length > 0;
  return (
    <section
      data-testid="engineering-b-confident-standouts"
      data-has-standouts={hasAny ? "true" : "false"}
      className="rounded-xl border border-border/60 bg-card px-5 py-4 shadow-warm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base italic text-foreground">
          Confident standouts
        </h3>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          flag-eligible only · band gap real
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Engineers whose confidence band sits cleanly inside the top or bottom
        quartile and whose band gap to the neighbouring group is real. The full
        stack rank below shows everyone, but{" "}
        <span className="font-medium text-foreground">
          this is the decision-ready subset
        </span>{" "}
        — make promote / performance-manage calls from here, treat the rest as
        context.
      </p>
      {hasAny ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div data-testid="confident-promote-group">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              Promote candidates · {promote.length}
            </div>
            {promote.length === 0 ? (
              <p className="mt-2 text-[11px] italic text-muted-foreground">
                None — top quartile is too wide a tie group to call confidently.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {promote.map((entry) => (
                  <li key={entry.emailHash}>
                    <StandoutChip entry={entry} variant="promote" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div data-testid="confident-pm-group">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-destructive">
              Performance-manage candidates · {performanceManage.length}
            </div>
            {performanceManage.length === 0 ? (
              <p className="mt-2 text-[11px] italic text-muted-foreground">
                None — bottom quartile is too wide a tie group to call
                confidently.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {performanceManage.map((entry) => (
                  <li key={entry.emailHash}>
                    <StandoutChip entry={entry} variant="pm" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div
          data-testid="confident-standouts-empty"
          className="mt-3 rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-4 text-sm text-muted-foreground"
        >
          <p className="font-medium text-foreground">
            No confident calls yet.
          </p>
          <p className="mt-1 text-[12px] leading-snug">
            Confidence bands are wider than the gaps between tie groups, so the
            methodology refuses to label promote / performance-manage
            candidates. Read the full stack rank below as raw context, but
            don&apos;t use it as a promote/PM list — coverage and rubric volume
            need to grow first. The within-tie raw-score order is shown for
            scanning only.
          </p>
        </div>
      )}
    </section>
  );
}

function UnmappedEngineersPanel({
  bundle,
}: {
  bundle: CompositeBundle;
}) {
  const unmapped: CompositeEntry[] = bundle.entries.filter(
    (entry) => entry.status === "unscored_unmapped",
  );
  if (unmapped.length === 0) return null;
  // Stable display order: alphabetic by displayName.
  const sorted = [...unmapped].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  return (
    <section
      data-testid="engineering-b-unmapped-engineers"
      className="rounded-xl border border-border/60 bg-card px-5 py-4 shadow-warm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base italic text-foreground">
          Unmapped engineers · {sorted.length}
        </h3>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          fix in github_employee_map
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        These engineers exist in the headcount source-of-truth but have no
        GitHub login mapping, so the composite cannot score them. Until they
        are mapped, no PR or rubric data feeds the rank — they are invisible
        to the manager view.
      </p>
      <ul className="mt-3 grid gap-1 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((entry) => (
          <li
            key={entry.emailHash}
            data-testid={`unmapped-${entry.emailHash}`}
            className="flex items-baseline justify-between gap-2 rounded-md border border-border/30 bg-background/60 px-2 py-1"
          >
            <span className="truncate text-foreground">{entry.displayName}</span>
            <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {entry.pillar}
              {entry.squad ? ` · ${entry.squad}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoverageLine({ bundle }: { bundle: CompositeBundle }) {
  const c = bundle.coverage;
  const parts: string[] = [];
  if (c.scored > 0) parts.push(`${c.scored} scored`);
  if (c.partialWindowScored > 0)
    parts.push(`${c.partialWindowScored} partial-window`);
  if (c.unscoredRampUp > 0) parts.push(`${c.unscoredRampUp} ramp-up`);
  if (c.unscoredLeaver > 0) parts.push(`${c.unscoredLeaver} leaver/inactive`);
  if (c.unscoredUnmapped > 0) parts.push(`${c.unscoredUnmapped} unmapped`);
  if (c.unscoredInsufficientSignals > 0)
    parts.push(`${c.unscoredInsufficientSignals} insufficient signals`);
  if (c.unscoredSmallCohort > 0)
    parts.push(`${c.unscoredSmallCohort} small-cohort`);
  return (
    <p className="text-xs text-muted-foreground">
      Coverage: {c.total} engineers — {parts.join(", ") || "none"}. As of{" "}
      {bundle.asOf}. Window {bundle.windowDays} days. Methodology{" "}
      <span className="font-medium text-foreground">
        {bundle.methodologyVersion}
      </span>
      .
    </p>
  );
}

export async function ManagerView({
  scope,
  managerEmail,
  bundle: injectedBundle,
}: ManagerViewProps) {
  const bundle = injectedBundle ?? (await getEngineeringComposite());

  const scopeArgs: CompositeScope = {};
  if (scope === "directs") {
    if (!managerEmail) {
      return (
        <section data-testid="engineering-b-manager-view" className="space-y-6">
          <MethodologyPanel />
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-5 py-8 text-center">
            <p className="font-display text-base italic text-muted-foreground">
              No direct-reports scope available
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The manager-scoped stack rank requires a managerEmail. Non-CEO
              plain managers cannot reach B-side in this first pass.
            </p>
          </div>
        </section>
      );
    }
    scopeArgs.managerEmail = managerEmail;
  }

  const scoped = scopeComposite(bundle, scopeArgs);
  const ranked = rankWithConfidence(scoped);

  return (
    <section
      data-testid="engineering-b-manager-view"
      data-scope={scope}
      className="space-y-6"
    >
      <MethodologyPanel />
      <ConfidentStandoutsPanel ranked={ranked} />
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl italic text-foreground">
            {scope === "directs"
              ? "Your direct reports — stack rank"
              : "Engineering stack rank"}
          </h2>
          <CoverageLine bundle={bundle} />
        </div>
        <StackRankTable ranked={ranked} />
      </div>
      <UnmappedEngineersPanel bundle={bundle} />
    </section>
  );
}

export const __testing = {
  MethodologyPanel,
  ConfidentStandoutsPanel,
  UnmappedEngineersPanel,
  selectConfidentStandouts,
};
