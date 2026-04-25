import { Compass, Target, TrendingUp, Users } from "lucide-react";

import { getCurrentUserWithTimeout } from "@/lib/auth/current-user.server";
import {
  COMPOSITE_METHODOLOGY_ROWS,
  COMPOSITE_METHODOLOGY_SECTIONS,
  COMPOSITE_SIGNAL_KEYS,
  COMPOSITE_SIGNAL_LABELS,
  COMPOSITE_WEIGHTS,
  findEngineerInComposite,
  scopeComposite,
  type CompositeBundle,
  type CompositeEntry,
  type CompositeSignalKey,
} from "@/lib/data/engineering-composite";
import { getEngineeringComposite } from "@/lib/data/engineering-composite.server";
import { hashEmailForRanking } from "@/lib/data/engineering-ranking";

interface EngineerViewProps {
  /**
   * Test / controlled-preview override. Real first-pass B-side access is
   * CEO-only and routes to the manager persona, so the engineer persona is
   * exercised through this prop until a later rollout opens it to engineers.
   */
  viewerEmail?: string | null;
  viewerEmailHash?: string | null;
  /** Optional override for tests to inject a pre-built bundle. */
  bundle?: CompositeBundle;
  /**
   * True when the CEO is previewing the engineer persona via the role-preview
   * cookie. When set, a missing or unscored identity falls through to a
   * banner-labelled layout preview using a representative scored engineer,
   * so the CEO can validate the engineer view itself.
   */
  isCeoPreview?: boolean;
}

interface PercentileBand {
  label: string;
  range: string;
  description: string;
}

interface PositionCard {
  label: string;
  context: string;
  band: PercentileBand | null;
  sampleSize: number;
}

interface GroupAggregate {
  name: string;
  count: number;
  band: PercentileBand | null;
  isOwnGroup: boolean;
}

interface Takeaway {
  key: string;
  heading: string;
  evidence: string;
  detail: string;
}

function bandForPercentile(percentile: number | null): PercentileBand | null {
  if (percentile === null || !Number.isFinite(percentile)) return null;
  if (percentile >= 75) {
    return {
      label: "Top 25%",
      range: "75th-100th percentile band",
      description: "A clear strength in this comparison set.",
    };
  }
  if (percentile >= 50) {
    return {
      label: "50th-75th",
      range: "50th-75th percentile band",
      description: "Above the middle of this comparison set.",
    };
  }
  if (percentile >= 25) {
    return {
      label: "25th-50th",
      range: "25th-50th percentile band",
      description: "Near the middle with visible room to climb.",
    };
  }
  return {
    label: "0th-25th",
    range: "0th-25th percentile band",
    description: "The clearest upside area in this comparison set.",
  };
}

function percentileWithinRows(
  entry: CompositeEntry,
  rows: readonly CompositeEntry[],
): number | null {
  if (entry.score === null || !Number.isFinite(entry.score)) return null;
  const scores = rows
    .map((row) => row.score)
    .filter((score): score is number => score !== null && Number.isFinite(score))
    .sort((a, b) => a - b);
  if (scores.length === 0) return null;

  let below = 0;
  let equal = 0;
  for (const score of scores) {
    if (score < entry.score) below += 1;
    else if (score === entry.score) equal += 1;
  }
  return ((below + 0.5 * equal) / scores.length) * 100;
}

function buildPositionCards(
  bundle: CompositeBundle,
  entry: CompositeEntry,
): PositionCard[] {
  const orgRows = scopeComposite(bundle, {});
  const pillarRows = scopeComposite(bundle, { pillar: entry.pillar });
  const squadRows = entry.squad
    ? scopeComposite(bundle, { squad: entry.squad })
    : [];

  return [
    {
      label: "Organisation",
      context: "All scored engineers",
      band: bandForPercentile(entry.orgPercentile),
      sampleSize: orgRows.length,
    },
    {
      label: `${entry.pillar} pillar`,
      context: "Your pillar cohort",
      band: bandForPercentile(percentileWithinRows(entry, pillarRows)),
      sampleSize: pillarRows.length,
    },
    {
      label: entry.squad ? `${entry.squad} squad` : "Unassigned squad",
      context: "Your squad cohort",
      band: bandForPercentile(percentileWithinRows(entry, squadRows)),
      sampleSize: squadRows.length,
    },
  ];
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildGroupAggregates(
  scoredRows: readonly CompositeEntry[],
  ownGroupName: string,
  groupFor: (entry: CompositeEntry) => string,
): GroupAggregate[] {
  const buckets = new Map<string, CompositeEntry[]>();
  for (const row of scoredRows) {
    const group = groupFor(row).trim() || "Unassigned";
    buckets.set(group, [...(buckets.get(group) ?? []), row]);
  }

  const means = Array.from(buckets.entries()).map(([name, rows]) => ({
    name,
    rows,
    averageScore: mean(
      rows
        .map((row) => row.score)
        .filter(
          (score): score is number => score !== null && Number.isFinite(score),
        ),
    ),
  }));
  const sortedAverages = means
    .map((item) => item.averageScore)
    .filter((score): score is number => score !== null && Number.isFinite(score))
    .sort((a, b) => a - b);

  return means
    .map((item) => {
      let percentile: number | null = null;
      if (item.averageScore !== null && sortedAverages.length > 0) {
        let below = 0;
        let equal = 0;
        for (const score of sortedAverages) {
          if (score < item.averageScore) below += 1;
          else if (score === item.averageScore) equal += 1;
        }
        percentile = ((below + 0.5 * equal) / sortedAverages.length) * 100;
      }
      return {
        name: item.name,
        count: item.rows.length,
        band: bandForPercentile(percentile),
        isOwnGroup: item.name.toLowerCase() === ownGroupName.toLowerCase(),
      };
    })
    .sort((a, b) => {
      const aOwn = a.isOwnGroup ? 1 : 0;
      const bOwn = b.isOwnGroup ? 1 : 0;
      if (aOwn !== bOwn) return bOwn - aOwn;
      const aBand = a.band?.label ?? "";
      const bBand = b.band?.label ?? "";
      if (aBand !== bBand) return bBand.localeCompare(aBand);
      return a.name.localeCompare(b.name);
    });
}

function evidenceForSignal(
  entry: CompositeEntry,
  key: CompositeSignalKey,
): string | null {
  const evidence = entry.evidence;
  if (key === "delivery") {
    return evidence.find((line) => line.startsWith("Merged ")) ?? null;
  }
  if (key === "quality") {
    return evidence.find((line) => line.startsWith("Rubric quality")) ?? null;
  }
  if (key === "reliability") {
    return (
      evidence.find(
        (line) =>
          line.startsWith("Zero reverts") || line.includes("reverted within"),
      ) ?? null
    );
  }
  if (key === "reviewDiscipline") {
    return (
      evidence.find(
        (line) => line.includes("received ") && line.includes("review round"),
      ) ??
      null
    );
  }
  return evidence.find((line) => line.startsWith("Median PR time-to-merge")) ?? null;
}

function buildTakeaways(entry: CompositeEntry): Takeaway[] {
  const candidates = COMPOSITE_SIGNAL_KEYS.flatMap((key) => {
    const signal = entry.signals[key];
    const percentile = signal.percentileWithinDiscipline;
    const evidence = evidenceForSignal(entry, key);
    if (percentile === null || evidence === null) return [];
    const weight = signal.effectiveWeight || COMPOSITE_WEIGHTS[key];
    const upwardRoom = Math.max(0, 75 - percentile);
    const sortValue = weight * (upwardRoom + 10);
    const band = bandForPercentile(percentile);
    return [{ key, signal, percentile, evidence, sortValue, band }];
  }).sort((a, b) => b.sortValue - a.sortValue);

  const takeaways: Takeaway[] = candidates.slice(0, 4).map((item) => {
    const weightPct = (
      (item.signal.effectiveWeight || COMPOSITE_WEIGHTS[item.key]) *
      100
    ).toFixed(0);
    const bandCopy = item.band?.range ?? "an unavailable percentile band";
    const heading =
      item.percentile >= 75
        ? `${COMPOSITE_SIGNAL_LABELS[item.key]} is a strength to protect`
        : `${COMPOSITE_SIGNAL_LABELS[item.key]} is an upward lever`;
    const detail =
      item.percentile >= 75
        ? `${bandCopy}; it carries ${weightPct}% effective weight, so keeping this signal steady protects your current band.`
        : `${bandCopy}; it carries ${weightPct}% effective weight, so moving it toward the next band is one of the clearest ways to climb.`;
    return {
      key: item.key,
      heading,
      evidence: item.evidence,
      detail,
    };
  });

  for (const line of entry.evidence) {
    if (takeaways.length >= 2) break;
    if (takeaways.some((takeaway) => takeaway.evidence === line)) continue;
    takeaways.push({
      key: `evidence-${takeaways.length}`,
      heading: "Contribution evidence to watch",
      evidence: line,
      detail:
        "This line comes directly from the composite evidence pack and is the next concrete data point to move.",
    });
  }

  return takeaways;
}

async function resolveViewerEmailHash({
  viewerEmail,
  viewerEmailHash,
}: Pick<EngineerViewProps, "viewerEmail" | "viewerEmailHash">): Promise<
  string | null
> {
  if (viewerEmailHash?.trim()) return viewerEmailHash.trim();
  if (viewerEmail?.trim()) return hashEmailForRanking(viewerEmail.trim());

  const result = await getCurrentUserWithTimeout();
  if (result.status !== "authenticated") return null;

  const email =
    result.user.primaryEmailAddress?.emailAddress ??
    result.user.emailAddresses?.[0]?.emailAddress ??
    null;
  return email ? hashEmailForRanking(email) : null;
}

function MethodologyNote({ bundle }: { bundle: CompositeBundle }) {
  return (
    <section
      data-testid="engineering-b-engineer-methodology"
      className="rounded-xl border border-border/60 bg-card px-5 py-4 shadow-warm"
    >
      <div className="flex items-start gap-3">
        <Compass className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <div className="w-full">
          <h3 className="font-display text-base italic text-foreground">
            How to read this view
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the same single composite used by the manager view, but
            shown as percentile bands and aggregate group positions. You see
            your own row only. Other engineers&apos; names, scores, ranks, and
            drilldowns are not rendered in this persona.
          </p>
          <div
            data-testid="engineering-b-engineer-methodology-signals"
            className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
          >
            {COMPOSITE_METHODOLOGY_ROWS.map((row) => (
              <div
                key={row.key}
                data-methodology-signal={row.key}
                className="rounded-md border border-border/40 bg-background/60 p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
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
                    <dd className="text-muted-foreground">
                      {row.minimumSampleRule}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                      Limitations
                    </dt>
                    <dd className="text-muted-foreground">
                      {row.knownLimitations}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <div
            data-testid="engineering-b-engineer-methodology-sections"
            className="mt-3 grid gap-2 sm:grid-cols-2"
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
          <p className="mt-3 text-[11px] text-muted-foreground">
            Window {bundle.windowDays} days. Methodology{" "}
            <span className="font-medium text-foreground">
              {bundle.methodologyVersion}
            </span>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

function PositionCards({ cards }: { cards: readonly PositionCard[] }) {
  return (
    <section className="grid gap-3 md:grid-cols-3" aria-label="Your position">
      {cards.map((card) => (
        <div
          key={card.label}
          data-testid={`engineer-position-${card.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          className="rounded-xl border border-border/60 bg-card p-4 shadow-warm"
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Target className="h-3.5 w-3.5 text-primary" />
            {card.context}
          </div>
          <div className="mt-3 font-display text-xl italic text-foreground">
            {card.band?.label ?? "Not enough data"}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {card.label}
            {card.band ? ` - ${card.band.range}` : ""}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {card.band?.description ??
              "This comparison set does not yet have enough scored engineers."}{" "}
            {card.sampleSize > 0 && (
              <span className="tabular-nums">n={card.sampleSize}</span>
            )}
          </p>
        </div>
      ))}
    </section>
  );
}

function TakeawayList({ takeaways }: { takeaways: readonly Takeaway[] }) {
  if (takeaways.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-5 py-6">
        <p className="font-display text-base italic text-muted-foreground">
          Not enough scored signals for specific takeaways yet
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Once at least three composite signals are present, this panel shows
          the clearest contribution-data levers.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="font-display text-lg italic text-foreground">
          What would move your band most
        </h3>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {takeaways.map((takeaway) => (
          <article
            key={takeaway.key}
            data-testid="engineer-takeaway"
            className="rounded-md border border-border/40 bg-background/60 p-3"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              {takeaway.heading}
            </div>
            <p className="mt-2 text-sm text-foreground">{takeaway.evidence}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {takeaway.detail}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GroupCompetition({
  title,
  ownLabel,
  groups,
}: {
  title: string;
  ownLabel: string;
  groups: readonly GroupAggregate[];
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="font-display text-lg italic text-foreground">{title}</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Aggregate comparison by group. The highlighted row is your {ownLabel}.
      </p>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {groups.map((group) => (
          <div
            key={group.name}
            data-testid={`engineer-group-${ownLabel}-${group.name}`}
            className={
              group.isOwnGroup
                ? "rounded-md border border-primary/40 bg-primary/5 p-3"
                : "rounded-md border border-border/40 bg-background/60 p-3"
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {group.name}
                </div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {group.isOwnGroup ? `your ${ownLabel}` : ownLabel}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-base italic text-foreground">
                  {group.band?.label ?? "No band"}
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  n={group.count}
                </div>
              </div>
            </div>
            {group.band && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {group.band.range}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function MissingIdentityState({ bundle }: { bundle: CompositeBundle }) {
  return (
    <section
      data-testid="engineering-b-engineer-view"
      className="space-y-6"
    >
      <MethodologyNote bundle={bundle} />
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-5 py-8 text-center">
        <p className="font-display text-base italic text-muted-foreground">
          No engineer identity available
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          The engineer persona needs the viewer&apos;s own email to find one
          composite row. It does not fall back to showing a cohort table.
        </p>
      </div>
    </section>
  );
}

function UnscoredEngineerState({
  bundle,
  entry,
}: {
  bundle: CompositeBundle;
  entry: CompositeEntry;
}) {
  return (
    <section
      data-testid="engineering-b-engineer-view"
      className="space-y-6"
    >
      <MethodologyNote bundle={bundle} />
      <div className="rounded-xl border border-border/60 bg-card px-5 py-6 shadow-warm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Your engineering band
        </p>
        <h2 className="mt-2 font-display text-xl italic text-foreground">
          {entry.displayName} is not scored yet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {entry.unscoredReason ??
            "The composite does not have enough contribution data to produce a percentile band."}
        </p>
      </div>
    </section>
  );
}

/**
 * Pick a representative scored entry for CEO layout preview. Chooses the
 * engineer closest to the median score so the rendered cards and takeaways
 * reflect a realistic mid-cohort experience, not a top/bottom outlier.
 */
function pickPreviewEntry(bundle: CompositeBundle): CompositeEntry | null {
  const scored = bundle.scored.filter(
    (entry) => entry.score !== null && Number.isFinite(entry.score),
  );
  if (scored.length === 0) return null;
  const sorted = [...scored].sort(
    (a, b) => (a.score as number) - (b.score as number),
  );
  return sorted[Math.floor(sorted.length / 2)];
}

function PreviewBanner({ engineerName }: { engineerName: string }) {
  return (
    <div
      data-testid="engineering-b-engineer-preview-banner"
      className="rounded-xl border border-warning/40 bg-warning/10 px-5 py-3 text-warning"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">
        CEO preview · layout demo only
      </div>
      <p className="mt-1 text-sm">
        You aren&apos;t in the GitHub mapping, so the engineer view is rendered
        for{" "}
        <span className="font-medium text-foreground">{engineerName}</span> as
        a layout demo. A real engineer only ever sees their own row.
      </p>
    </div>
  );
}

export async function EngineerView({
  viewerEmail,
  viewerEmailHash,
  bundle: injectedBundle,
  isCeoPreview = false,
}: EngineerViewProps) {
  const bundle = injectedBundle ?? (await getEngineeringComposite());
  const emailHash = await resolveViewerEmailHash({
    viewerEmail,
    viewerEmailHash,
  });

  let entry = emailHash
    ? findEngineerInComposite(bundle, emailHash) ?? null
    : null;
  let isPreviewFallback = false;

  if ((!entry || entry.score === null) && isCeoPreview) {
    const preview = pickPreviewEntry(bundle);
    if (preview) {
      entry = preview;
      isPreviewFallback = true;
    }
  }

  if (!entry) return <MissingIdentityState bundle={bundle} />;

  if (entry.score === null) {
    return <UnscoredEngineerState bundle={bundle} entry={entry} />;
  }

  const scoredRows = scopeComposite(bundle, {});
  const positionCards = buildPositionCards(bundle, entry);
  const takeaways = buildTakeaways(entry);
  const squadName = entry.squad ?? "Unassigned squad";
  const squadAggregates = buildGroupAggregates(
    scoredRows,
    squadName,
    (row) => row.squad ?? "Unassigned squad",
  );
  const pillarAggregates = buildGroupAggregates(
    scoredRows,
    entry.pillar,
    (row) => row.pillar,
  );

  return (
    <section
      data-testid="engineering-b-engineer-view"
      data-preview={isPreviewFallback ? "true" : undefined}
      className="space-y-6"
    >
      {isPreviewFallback && <PreviewBanner engineerName={entry.displayName} />}
      <div className="rounded-xl border border-border/60 bg-card px-5 py-5 shadow-warm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Where do I stand?
        </p>
        <h2 className="mt-2 font-display text-2xl italic text-foreground">
          {entry.displayName}
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Your view uses percentile bands instead of rank numbers. It shows
          your own position, the clearest contribution-data levers, and squad /
          pillar aggregate competition.
        </p>
      </div>

      <PositionCards cards={positionCards} />
      <TakeawayList takeaways={takeaways} />
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupCompetition
          title="Squad aggregate position"
          ownLabel="squad"
          groups={squadAggregates}
        />
        <GroupCompetition
          title="Pillar aggregate position"
          ownLabel="pillar"
          groups={pillarAggregates}
        />
      </div>
      <MethodologyNote bundle={bundle} />
    </section>
  );
}

export const __testing = {
  bandForPercentile,
  buildTakeaways,
  buildGroupAggregates,
  percentileWithinRows,
};
