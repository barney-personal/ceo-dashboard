/**
 * B-side engineering composite score (pure math).
 *
 * ONE composite, one methodology. Consumed by the B-side engineer view
 * (their own position + aggregates) and the B-side manager view (stack rank,
 * promote/PM candidates, drilldown). A-side ranking remains untouched —
 * B-side deliberately reuses no shared contract because the whole point of
 * the simplification is to retire A-side's five-lens median.
 *
 * Per the M3 audit (worklog/impact-model-audit.md) this module MUST NOT
 * import `src/data/impact-model.json`, `src/lib/data/impact-model.ts`, or
 * `src/lib/data/impact-model.server.ts`. The training target
 * `round(prs * log2(1 + churn/prs))` is an activity proxy, not a defensible
 * performance label, and the monotonic +1 constraint on AI-tooling spend is
 * an unsealable gaming vector.
 *
 * Five signals, weights sum to 1.0, no single weight exceeds 30%:
 *
 *  - delivery (20%)          winsorized log(1 + prs), cohort-P90 cap
 *  - quality (30%)           rubric mean (execution/tests/risk/review),
 *                            difficulty-weighted, min 3 analysed PRs
 *  - reliability (20%)       1 - revertRate from rubric rows
 *  - reviewDiscipline (15%)  fraction of PRs with ≥1 review round
 *  - cycleTime (15%)         inverse of winsorized median time-to-merge
 *
 * Normalisation: z-score within discipline cohort (BE vs FE), converted to a
 * percentile band. Tenure below the signal window (default 180 days) is
 * flagged `partial_window_scored` and the delivery denominator is pro-rated
 * by `windowDays / tenureDays` so a short-tenure engineer is not punished
 * for missing history. Tenure < 30 days is unscored — the window is too
 * short for a defensible cohort compare.
 *
 * Role adjustment: Platform/Infra engineers (by pillar or squad substring)
 * get a `deliveryFactor > 1` so their raw PR count inflates before
 * normalisation, preventing "infra ships fewer = low rank" drift.
 */

import type { Discipline } from "@/lib/data/disciplines";

// -----------------------------------------------------------------------------
// Public constants
// -----------------------------------------------------------------------------

export const COMPOSITE_METHODOLOGY_VERSION = "b-1.0.0" as const;

/** Signal window (days). Matches A-side to keep input semantics comparable. */
export const COMPOSITE_SIGNAL_WINDOW_DAYS = 180 as const;

/** Minimum tenure to produce a score at all. */
export const COMPOSITE_MIN_TENURE_DAYS = 30 as const;

/** Minimum analysed PRs for the quality subscore to populate. */
export const COMPOSITE_MIN_ANALYSED_PRS = 3 as const;

/** Minimum total PRs in window for delivery/reliability to populate. */
export const COMPOSITE_MIN_PRS_FOR_DELIVERY = 2 as const;

/** Minimum cohort size per discipline to run z-scoring. */
export const COMPOSITE_MIN_COHORT_SIZE = 3 as const;

/** Delivery cohort cap percentile (winsorize). Stops volume-spam gaming. */
export const COMPOSITE_DELIVERY_WINSOR_P = 0.9 as const;

/** Cycle-time winsor percentile (faster tail capped so a single 5-minute PR
 *  doesn't dominate). Applied to the median-of-medians. */
export const COMPOSITE_CYCLE_TIME_FLOOR_MIN = 30 as const; // 30 min floor
export const COMPOSITE_CYCLE_TIME_CAP_HOURS = (14 * 24) as number; // 14 day cap

/** Required present signals for a composite score to be emitted. */
export const COMPOSITE_MIN_SIGNALS_FOR_SCORE = 3 as const;

/**
 * Confidence band calibration. K controls the base half-width scaling via
 * `K / sqrt(nEffective)`. Calibrated so a 20-PR / 15-analysed / 5-signal
 * engineer gets ~5pt half-width and a 3-PR / 3-analysed / 3-signal engineer
 * gets ~15pt half-width.
 */
export const CONFIDENCE_K = 20 as const;
export const CONFIDENCE_MIN_HALF_WIDTH = 2 as const;
export const CONFIDENCE_MAX_HALF_WIDTH = 25 as const;
export const CONFIDENCE_TENURE_PENALTY_PER_UNIT = 3 as const;

/**
 * Absolute upper bound on the raw-score gap between two members of the same
 * tie group. Even when the smaller band's half-width would permit a tie, a
 * gap exceeding this cap is treated as too large for "statistically
 * indistinguishable" — protecting the rank from collapsing huge spans of
 * scores into one group when wide bands chain across the cohort.
 */
export const TIE_GROUP_MAX_SCORE_GAP = 4 as const;

/** Minimum scored entries to assign quartile flags. Below this, flags are
 *  suppressed because quartile boundaries are not meaningful. */
export const CONFIDENCE_MIN_ENTRIES_FOR_FLAGS = 4 as const;

export type CompositeSignalKey =
  | "delivery"
  | "quality"
  | "reliability"
  | "reviewDiscipline"
  | "cycleTime";

export const COMPOSITE_SIGNAL_KEYS = [
  "delivery",
  "quality",
  "reliability",
  "reviewDiscipline",
  "cycleTime",
] as const satisfies readonly CompositeSignalKey[];

export const COMPOSITE_WEIGHTS: Record<CompositeSignalKey, number> = {
  delivery: 0.2,
  quality: 0.3,
  reliability: 0.2,
  reviewDiscipline: 0.15,
  cycleTime: 0.15,
};

export const COMPOSITE_MAX_SINGLE_WEIGHT = 0.3 as const;

/**
 * Human-readable signal labels used by the methodology panel and attribution
 * drilldown. Exported so the UI and tests read the same strings.
 */
export const COMPOSITE_SIGNAL_LABELS: Record<CompositeSignalKey, string> = {
  delivery: "Delivery volume",
  quality: "Code-review quality",
  reliability: "Reliability",
  reviewDiscipline: "Review discipline",
  cycleTime: "Cycle time",
};

export const COMPOSITE_SIGNAL_DESCRIPTIONS: Record<CompositeSignalKey, string> = {
  delivery:
    "Winsorized log(1 + PRs merged in the last 180 days). Capped at the cohort 90th percentile so volume spam cannot dominate.",
  quality:
    "Mean of code-review rubric axes (execution, tests, risk, reviewability), weighted by technical difficulty. Requires ≥3 analysed PRs.",
  reliability:
    "1 − fraction of merged PRs reverted within 14 days. Quality gate on rushed merges.",
  reviewDiscipline:
    "Fraction of merged PRs that received ≥1 review round before merge. Requires ≥3 analysed PRs.",
  cycleTime:
    "Inverse of median time-to-merge, winsorized to [30 min, 14 days]. Proxy for unblocked delivery; not a productivity headline.",
};

// -----------------------------------------------------------------------------
// Methodology metadata — single source of truth for the self-defence panel
// -----------------------------------------------------------------------------

/**
 * Per-signal methodology rows. The B-side methodology panels (manager view,
 * engineer view) iterate this array verbatim so every magic number that
 * appears in copy is sourced from the composite module's own constants.
 *
 * Rule: do not put numbers into copy strings here that are not literally
 * derived from the constants above. The methodology cross-check test in
 * `engineering-composite.test.ts` walks each row and asserts every numeric
 * token resolves to a known composite constant; if you add a new line that
 * mentions, say, "≥ 5 reviews", either bump a constant or rephrase.
 */
export interface CompositeMethodologyRow {
  key: CompositeSignalKey;
  label: string;
  weightPct: number; // 0..100
  description: string;
  normalizationRule: string;
  minimumSampleRule: string;
  knownLimitations: string;
}

function buildMethodologyRows(): readonly CompositeMethodologyRow[] {
  const winsorPct = (COMPOSITE_DELIVERY_WINSOR_P * 100).toFixed(0);
  const minAnalysed = COMPOSITE_MIN_ANALYSED_PRS;
  const minPrs = COMPOSITE_MIN_PRS_FOR_DELIVERY;
  const cycleFloor = COMPOSITE_CYCLE_TIME_FLOOR_MIN;
  const cycleCapDays = (COMPOSITE_CYCLE_TIME_CAP_HOURS / 24).toFixed(0);
  const window = COMPOSITE_SIGNAL_WINDOW_DAYS;

  return [
    {
      key: "delivery",
      label: COMPOSITE_SIGNAL_LABELS.delivery,
      weightPct: COMPOSITE_WEIGHTS.delivery * 100,
      description: COMPOSITE_SIGNAL_DESCRIPTIONS.delivery,
      normalizationRule: `Cohort-relative percentile within discipline. Raw value capped at the cohort ${winsorPct}th percentile (winsorized). Tenure pro-rate inflates the denominator for engineers with tenure < ${window} days.`,
      minimumSampleRule: `Engineer must have ≥ ${minPrs} merged PRs in the last ${window} days for delivery to populate.`,
      knownLimitations:
        "Counts merged PRs only — design work, pairing, and unmerged review effort are not credited here.",
    },
    {
      key: "quality",
      label: COMPOSITE_SIGNAL_LABELS.quality,
      weightPct: COMPOSITE_WEIGHTS.quality * 100,
      description: COMPOSITE_SIGNAL_DESCRIPTIONS.quality,
      normalizationRule:
        "Cohort-relative percentile within discipline. Each rubric axis is confidence-weighted at the per-PR level and difficulty-weighted at aggregation.",
      minimumSampleRule: `Engineer must have ≥ ${minAnalysed} rubric-analysed PRs for quality to populate.`,
      knownLimitations:
        "LLM rubric is the only quality signal; it is calibrated by the per-PR analysisConfidencePct but cannot detect issues invisible to the diff (e.g. coordination, blast-radius decisions).",
    },
    {
      key: "reliability",
      label: COMPOSITE_SIGNAL_LABELS.reliability,
      weightPct: COMPOSITE_WEIGHTS.reliability * 100,
      description: COMPOSITE_SIGNAL_DESCRIPTIONS.reliability,
      normalizationRule:
        "Cohort-relative percentile within discipline of (1 − revertRate). Clamped to [0, 1].",
      minimumSampleRule: `Engineer must have ≥ ${minAnalysed} rubric-analysed PRs for reliability to populate.`,
      knownLimitations:
        "Revert detection follows merge events within 14 days; longer-tail reverts and silently-reverted-but-not-by-PR rollbacks do not count.",
    },
    {
      key: "reviewDiscipline",
      label: COMPOSITE_SIGNAL_LABELS.reviewDiscipline,
      weightPct: COMPOSITE_WEIGHTS.reviewDiscipline * 100,
      description: COMPOSITE_SIGNAL_DESCRIPTIONS.reviewDiscipline,
      normalizationRule:
        "Cohort-relative percentile within discipline. Fraction of analysed PRs with ≥ 1 review round, clamped to [0, 1].",
      minimumSampleRule: `Engineer must have ≥ ${minAnalysed} rubric-analysed PRs for review discipline to populate.`,
      knownLimitations:
        "Self-merging without review is penalised, but a review round that was a rubber-stamp still counts. The signal pairs with quality to defend against rubber-stamp gaming.",
    },
    {
      key: "cycleTime",
      label: COMPOSITE_SIGNAL_LABELS.cycleTime,
      weightPct: COMPOSITE_WEIGHTS.cycleTime * 100,
      description: COMPOSITE_SIGNAL_DESCRIPTIONS.cycleTime,
      normalizationRule: `Cohort-relative percentile within discipline. Median time-to-merge clamped to [${cycleFloor} min, ${cycleCapDays} days] before inversion.`,
      minimumSampleRule: `Engineer must have ≥ ${minAnalysed} rubric-analysed PRs for cycle time to populate.`,
      knownLimitations:
        "Stale-but-eventually-merged PRs are capped at 14 days. Platform/Infra PRs are not separately handled here because longer cycle time is information about the role, not noise.",
    },
  ] as const;
}

/**
 * Iterable methodology rows in canonical order. Source of truth for both
 * B-side methodology panels (engineer view, manager view) and the cross-check
 * test that asserts copy numbers match constants.
 */
export const COMPOSITE_METHODOLOGY_ROWS: readonly CompositeMethodologyRow[] =
  buildMethodologyRows();

export interface CompositeMethodologySection {
  title: string;
  body: string;
}

/**
 * Cross-cutting methodology sections (confidence, ties, flags, role/tenure
 * normalisation, anti-gaming). Numbers in `body` strings are derived from
 * composite constants — no untracked magic numbers in copy.
 */
export const COMPOSITE_METHODOLOGY_SECTIONS: readonly CompositeMethodologySection[] =
  [
    {
      title: "Tenure normalisation",
      body: `Engineers with tenure ≥ ${COMPOSITE_SIGNAL_WINDOW_DAYS} days score against the full window with tenureFactor 1.0. Engineers with tenure between ${COMPOSITE_MIN_TENURE_DAYS} and ${COMPOSITE_SIGNAL_WINDOW_DAYS - 1} days are flagged partial_window_scored and the delivery denominator is pro-rated by windowDays / tenureDays so missing history does not punish them. Tenure < ${COMPOSITE_MIN_TENURE_DAYS} days is unscored.`,
    },
    {
      title: "Role normalisation",
      body: "Platform / Infra engineers (matched on pillar or squad: platform, infra, infrastructure, devops, sre) inflate delivery 1.3× before normalisation so a low-volume infra shipper does not read as low. Cycle time is not adjusted; longer infra cycles carry information.",
    },
    {
      title: "Confidence model",
      body: `Each scored row carries a confidence band derived from PR sample, rubric coverage, and signal completeness. nEffective = prCount × (0.5 + 0.5 × rubricCoverage) × signalCoverage. halfWidth = ${CONFIDENCE_K} / sqrt(nEffective), plus ${CONFIDENCE_TENURE_PENALTY_PER_UNIT} points per unit of tenureFactor − 1 for partial-window engineers, clamped to [${CONFIDENCE_MIN_HALF_WIDTH}, ${CONFIDENCE_MAX_HALF_WIDTH}].`,
    },
    {
      title: "Tie-group rule",
      body: `Tie groups are anchor-based, not transitive. Each engineer is compared to the ANCHOR (the highest-scored member of the current group), not to the previous row, and joins the group only when (a) their confidence bands overlap, (b) the score gap to the anchor is no larger than the smaller band's half-width, and (c) the score gap to the anchor is no larger than ${TIE_GROUP_MAX_SCORE_GAP} points absolute. The anchor rule prevents transitive chains where adjacent band-overlaps would otherwise collapse a wide score span into one group. Members of a tie group share a competition-style displayRank; a within-tie raw-score position is shown for scanning only — the order inside the group is not statistically real.`,
    },
    {
      title: "Flag eligibility",
      body: `Promote (Q4) and performance-manage (Q1) labels apply only when (a) every member of the tie group lies inside the quartile, (b) the tie group's positional index span lies entirely within the top or bottom ceil(n/4), and (c) the band envelope of the tie group is gap-separated from the nearest non-quartile group's band envelope. With fewer than ${CONFIDENCE_MIN_ENTRIES_FOR_FLAGS} scored entries flags are always suppressed.`,
    },
    {
      title: "Anti-gaming",
      body: `Delivery is winsorized at cohort P${(COMPOSITE_DELIVERY_WINSOR_P * 100).toFixed(0)} so volume spam cannot dominate. Cycle time floors at ${COMPOSITE_CYCLE_TIME_FLOOR_MIN} min so micro-PR farming is bounded. There is no AI-spend, LOC, or commit-count input. A single-signal cap of ${(COMPOSITE_MAX_SINGLE_WEIGHT * 100).toFixed(0)}% applies to nominal weights, with effective-weight clamping after missing-signal renormalisation.`,
    },
    {
      title: "Coverage rules",
      body: `unscored_ramp_up: tenure < ${COMPOSITE_MIN_TENURE_DAYS}d. unscored_leaver: marked leaver/inactive in the headcount SSoT. unscored_unmapped: no GitHub login mapping. unscored_small_cohort: discipline cohort below ${COMPOSITE_MIN_COHORT_SIZE}. unscored_insufficient_signals: fewer than ${COMPOSITE_MIN_SIGNALS_FOR_SCORE} of 5 signals present.`,
    },
  ] as const;

// -----------------------------------------------------------------------------
// Input shapes
// -----------------------------------------------------------------------------

/**
 * Per-engineer input row consumed by `buildComposite`. Every field is
 * pre-joined by the server loader (headcount → GitHub login → rubric rows).
 * Null fields are preserved rather than collapsed to zero so missingness
 * stays explicit.
 */
export interface EngineerCompositeInput {
  /** Truncated SHA-256 of lowercased email. Stable across snapshots. */
  emailHash: string;
  displayName: string;
  email: string | null;
  githubLogin: string | null;
  discipline: Discipline;
  pillar: string;
  squad: string | null;
  /** Manager email (from Mode Headcount SSoT). Scoping key for manager view. */
  managerEmail: string | null;
  /** Tenure in days as of `asOf`. */
  tenureDays: number | null;
  /** Whether the engineer is a leaver or on non-active headcount. */
  isLeaverOrInactive: boolean;

  /** Merged PRs in window (from `githubPrs`). */
  prCount: number | null;
  /** Total merged PRs that reached rubric analysis. */
  analysedPrCount: number | null;
  /** Confidence-weighted mean of execution_quality axis [1, 5]. Null < min. */
  executionQualityMean: number | null;
  testAdequacyMean: number | null;
  riskHandlingMean: number | null;
  reviewabilityMean: number | null;
  /** Mean technical difficulty, surfaced for evidence only. */
  technicalDifficultyMean: number | null;
  /** Fraction of analysed PRs reverted within 14d; 0 is best. Null < min. */
  revertRate: number | null;
  /** Fraction of analysed PRs with ≥1 review round. Null < min. */
  reviewParticipationRate: number | null;
  /** Median time-to-merge minutes (from rubric rows). Null < min. */
  medianTimeToMergeMinutes: number | null;
}

export interface BuildCompositeInputs {
  /** `asOf` date — determines tenure cut-off. Defaults to `new Date()`. */
  now?: Date;
  /** Signal window. Defaults to `COMPOSITE_SIGNAL_WINDOW_DAYS`. */
  windowDays?: number;
  engineers: readonly EngineerCompositeInput[];
}

// -----------------------------------------------------------------------------
// Output shapes
// -----------------------------------------------------------------------------

export interface ConfidenceBand {
  lower: number;
  upper: number;
  halfWidth: number;
}

export type QuartileFlag = "promote_candidate" | "performance_manage" | null;

export type CompositeStatus =
  | "scored"
  | "partial_window_scored"
  | "unscored_insufficient_signals"
  | "unscored_ramp_up"
  | "unscored_leaver"
  | "unscored_unmapped"
  | "unscored_small_cohort";

/** A single signal's contribution to one engineer's composite. */
export interface CompositeSignalContribution {
  key: CompositeSignalKey;
  /** Raw input value before any normalisation (null if missing). */
  rawValue: number | null;
  /** Role-adjusted raw value (still in raw space). Equal to rawValue when no adjustment applied. */
  adjustedRawValue: number | null;
  /** Value after winsor/pro-rate, still in raw space. */
  processedValue: number | null;
  /** 0..100 percentile within the engineer's discipline cohort. */
  percentileWithinDiscipline: number | null;
  /** Nominal weight (from COMPOSITE_WEIGHTS). */
  weight: number;
  /** Effective weight after missing-signal re-normalisation. */
  effectiveWeight: number;
  /** Weighted contribution to the composite (effectiveWeight * percentile/100). */
  contribution: number | null;
}

export interface CompositeEntry {
  emailHash: string;
  displayName: string;
  email: string | null;
  githubLogin: string | null;
  discipline: Discipline;
  pillar: string;
  squad: string | null;
  managerEmail: string | null;
  tenureDays: number | null;
  status: CompositeStatus;

  /** 0..100. Null when status is any `unscored_*`. */
  score: number | null;
  /** 0..100 rank within org (all scored engineers). Null when unscored. */
  orgPercentile: number | null;
  /** 0..100 rank within discipline cohort. Null when unscored. */
  disciplinePercentile: number | null;

  signals: Record<CompositeSignalKey, CompositeSignalContribution>;

  /** Normalisation factors applied — visible on the methodology panel. */
  tenureFactor: number;
  roleFactor: {
    isPlatformOrInfra: boolean;
    deliveryFactor: number;
    cycleTimeFactor: number;
    description: string | null;
  };

  /** Falsifiable one-line evidence strings (2-4). */
  evidence: string[];

  /** Human-readable reason when status is any `unscored_*`. Null when scored. */
  unscoredReason: string | null;

  /** Confidence band around the composite score. Null when unscored. */
  confidenceBand: ConfidenceBand | null;
  /** Effective sample size driving the confidence band width. Null when unscored. */
  nEffective: number | null;
}

export interface CompositeCohortSummary {
  discipline: Discipline;
  count: number;
  scoredCount: number;
  scorePercentiles: { p25: number; p50: number; p75: number } | null;
  medians: Partial<Record<CompositeSignalKey, number | null>>;
}

export interface CompositeBundle {
  methodologyVersion: typeof COMPOSITE_METHODOLOGY_VERSION;
  asOf: string; // ISO date (YYYY-MM-DD)
  windowDays: number;
  weights: Record<CompositeSignalKey, number>;
  entries: CompositeEntry[]; // every input (including unscored)
  scored: CompositeEntry[]; // status === "scored" || "partial_window_scored"
  cohorts: CompositeCohortSummary[];
  /** Coverage breakdown by status. */
  coverage: {
    total: number;
    scored: number;
    partialWindowScored: number;
    unscoredRampUp: number;
    unscoredLeaver: number;
    unscoredUnmapped: number;
    unscoredInsufficientSignals: number;
    unscoredSmallCohort: number;
  };
}

// -----------------------------------------------------------------------------
// Helpers — pure math primitives
// -----------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function quantile(sortedAsc: readonly number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (q <= 0) return sortedAsc[0];
  if (q >= 1) return sortedAsc[sortedAsc.length - 1];
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function percentileOf(value: number, sortedAsc: readonly number[]): number {
  // Rank percentile: fraction of cohort strictly below + 0.5 × equal count.
  // Using the mid-rank convention so ties don't inflate the top percentile.
  if (sortedAsc.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const v of sortedAsc) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  const rank = below + 0.5 * equal;
  return (rank / sortedAsc.length) * 100;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

/**
 * Detect a Platform / Infra engineer from their pillar or squad label.
 * Intentionally broad: the point is to avoid punishing low-volume shippers
 * whose role design discourages merging many PRs, not to pick out every
 * possible infra alias.
 */
export function isPlatformOrInfraEngineer(
  pillar: string | null | undefined,
  squad: string | null | undefined,
): boolean {
  const haystack = `${pillar ?? ""} ${squad ?? ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  return /\b(platform|infra|infrastructure|devops|sre)\b/.test(haystack);
}

/**
 * Role adjustment factors. Platform/infra engineers inflate their delivery
 * raw value by 1.3x so a reasonable-volume platform shipper reads as median
 * within the cohort rather than low. Cycle-time is untouched (infra PRs can
 * be slow by design — the signal still carries information).
 */
export function roleAdjustmentFor(input: {
  pillar: string;
  squad: string | null;
}): {
  isPlatformOrInfra: boolean;
  deliveryFactor: number;
  cycleTimeFactor: number;
  description: string | null;
} {
  const platformOrInfra = isPlatformOrInfraEngineer(input.pillar, input.squad);
  if (platformOrInfra) {
    return {
      isPlatformOrInfra: true,
      deliveryFactor: 1.3,
      cycleTimeFactor: 1.0,
      description:
        "Platform / Infrastructure role — delivery volume inflated 1.3× before normalisation so role-design low throughput does not read as underperformance.",
    };
  }
  return {
    isPlatformOrInfra: false,
    deliveryFactor: 1.0,
    cycleTimeFactor: 1.0,
    description: null,
  };
}

/**
 * Pro-rate denominators for partial-window engineers.
 *
 *  - Tenure ≥ windowDays → 1.0 (no scaling)
 *  - Tenure < windowDays but ≥ MIN → windowDays / tenureDays (so a 60-day
 *    tenure reads as 3× its raw delivery; missing history can't sink them)
 *  - Tenure < MIN → returns null (engineer is unscored)
 */
export function tenureFactorFor(
  tenureDays: number | null,
  windowDays: number,
): number | null {
  if (tenureDays === null || !Number.isFinite(tenureDays)) return null;
  if (tenureDays < COMPOSITE_MIN_TENURE_DAYS) return null;
  if (tenureDays >= windowDays) return 1.0;
  return windowDays / Math.max(tenureDays, 1);
}

// -----------------------------------------------------------------------------
// Signal extraction (per-engineer pre-normalisation values)
// -----------------------------------------------------------------------------

function extractDeliveryRaw(input: EngineerCompositeInput): number | null {
  if (input.prCount === null || !Number.isFinite(input.prCount)) return null;
  if (input.prCount < COMPOSITE_MIN_PRS_FOR_DELIVERY) return null;
  // log(1 + prs) compresses the long tail so a 70-PR superspammer doesn't
  // read as 5× a steady 14-PR shipper.
  return Math.log(1 + input.prCount);
}

function extractQualityRaw(input: EngineerCompositeInput): number | null {
  if (
    input.analysedPrCount === null ||
    input.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS
  ) {
    return null;
  }
  const axes = [
    input.executionQualityMean,
    input.testAdequacyMean,
    input.riskHandlingMean,
    input.reviewabilityMean,
  ].filter((v): v is number => v !== null && Number.isFinite(v));
  if (axes.length === 0) return null;
  // Mean of available axes on [1, 5].
  return axes.reduce((a, b) => a + b, 0) / axes.length;
}

function extractReliabilityRaw(input: EngineerCompositeInput): number | null {
  if (
    input.revertRate === null ||
    !Number.isFinite(input.revertRate) ||
    input.analysedPrCount === null ||
    input.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS
  ) {
    return null;
  }
  return clamp(1 - input.revertRate, 0, 1);
}

function extractReviewDisciplineRaw(
  input: EngineerCompositeInput,
): number | null {
  if (
    input.reviewParticipationRate === null ||
    !Number.isFinite(input.reviewParticipationRate) ||
    input.analysedPrCount === null ||
    input.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS
  ) {
    return null;
  }
  return clamp(input.reviewParticipationRate, 0, 1);
}

function extractCycleTimeRaw(input: EngineerCompositeInput): number | null {
  if (
    input.medianTimeToMergeMinutes === null ||
    !Number.isFinite(input.medianTimeToMergeMinutes) ||
    input.medianTimeToMergeMinutes <= 0 ||
    input.analysedPrCount === null ||
    input.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS
  ) {
    return null;
  }
  // Winsorize to [FLOOR, CAP_HOURS] minutes. Low floor stops a 2-minute PR
  // from dominating; cap stops an abandoned-but-eventually-merged stale PR
  // from reading as catastrophic.
  const minutes = clamp(
    input.medianTimeToMergeMinutes,
    COMPOSITE_CYCLE_TIME_FLOOR_MIN,
    COMPOSITE_CYCLE_TIME_CAP_HOURS * 60,
  );
  // Invert so higher = better. Units are 1/hours after dividing back.
  return 1 / (minutes / 60);
}

// -----------------------------------------------------------------------------
// Winsorization & normalisation
// -----------------------------------------------------------------------------

function winsorizeAtPercentile(
  values: readonly number[],
  pUpper: number,
): readonly number[] {
  if (values.length === 0) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const cap = quantile(sorted, pUpper);
  if (cap === null) return values;
  return values.map((v) => (v > cap ? cap : v));
}

// -----------------------------------------------------------------------------
// Confidence band — pure computation
// -----------------------------------------------------------------------------

/**
 * Compute the confidence band around a composite score. The band width is
 * driven by `nEffective` which combines PR sample size, rubric coverage, and
 * signal completeness. Partial-window engineers (tenureFactor > 1) receive an
 * additive penalty because the delivery pro-rate adds estimation uncertainty.
 *
 * Exported so the methodology panel and tests can exercise the formula
 * independently of the full buildComposite pipeline.
 */
export function computeConfidenceBand(params: {
  score: number;
  prCount: number;
  analysedPrCount: number;
  presentSignalCount: number;
  tenureFactor: number;
}): { band: ConfidenceBand; nEffective: number } {
  const { score, prCount, analysedPrCount, presentSignalCount, tenureFactor } =
    params;

  const rubricCoverage =
    prCount > 0 ? Math.min(analysedPrCount / prCount, 1) : 0;
  const signalCoverage =
    COMPOSITE_SIGNAL_KEYS.length > 0
      ? presentSignalCount / COMPOSITE_SIGNAL_KEYS.length
      : 0;

  const nEffective = Math.max(
    prCount * (0.5 + 0.5 * rubricCoverage) * signalCoverage,
    0.5,
  );

  let halfWidth = CONFIDENCE_K / Math.sqrt(nEffective);

  if (tenureFactor > 1) {
    halfWidth += (tenureFactor - 1) * CONFIDENCE_TENURE_PENALTY_PER_UNIT;
  }

  halfWidth = clamp(
    halfWidth,
    CONFIDENCE_MIN_HALF_WIDTH,
    CONFIDENCE_MAX_HALF_WIDTH,
  );

  return {
    band: {
      lower: Math.max(0, score - halfWidth),
      upper: Math.min(100, score + halfWidth),
      halfWidth,
    },
    nEffective,
  };
}

// -----------------------------------------------------------------------------
// Main builder
// -----------------------------------------------------------------------------

interface IntermediateEntry {
  input: EngineerCompositeInput;
  status: CompositeStatus;
  unscoredReason: string | null;
  tenureFactor: number;
  roleFactor: CompositeEntry["roleFactor"];
  signals: Record<
    CompositeSignalKey,
    {
      rawValue: number | null;
      adjustedRawValue: number | null;
      processedValue: number | null;
    }
  >;
}

function initSignalContribution(
  key: CompositeSignalKey,
): CompositeSignalContribution {
  return {
    key,
    rawValue: null,
    adjustedRawValue: null,
    processedValue: null,
    percentileWithinDiscipline: null,
    weight: COMPOSITE_WEIGHTS[key],
    effectiveWeight: 0,
    contribution: null,
  };
}

function initSignalContributionMap(): Record<
  CompositeSignalKey,
  CompositeSignalContribution
> {
  return {
    delivery: initSignalContribution("delivery"),
    quality: initSignalContribution("quality"),
    reliability: initSignalContribution("reliability"),
    reviewDiscipline: initSignalContribution("reviewDiscipline"),
    cycleTime: initSignalContribution("cycleTime"),
  };
}

function makeEntryFromIntermediate(
  inter: IntermediateEntry,
  signalContribs: Record<CompositeSignalKey, CompositeSignalContribution>,
  score: number | null,
  orgPercentile: number | null,
  disciplinePercentile: number | null,
  evidence: string[],
): CompositeEntry {
  return {
    emailHash: inter.input.emailHash,
    displayName: inter.input.displayName,
    email: inter.input.email,
    githubLogin: inter.input.githubLogin,
    discipline: inter.input.discipline,
    pillar: inter.input.pillar,
    squad: inter.input.squad,
    managerEmail: inter.input.managerEmail,
    tenureDays: inter.input.tenureDays,
    status: inter.status,
    score,
    orgPercentile,
    disciplinePercentile,
    signals: signalContribs,
    tenureFactor: inter.tenureFactor,
    roleFactor: inter.roleFactor,
    evidence,
    unscoredReason: inter.unscoredReason,
    confidenceBand: null,
    nEffective: null,
  };
}

/**
 * Build the composite bundle from pre-joined engineer inputs. Pure and
 * deterministic given the same inputs and `now` — the server loader shells
 * out to this and tests drive it with fixtures.
 */
export function buildComposite(inputs: BuildCompositeInputs): CompositeBundle {
  const now = inputs.now ?? new Date();
  const windowDays = inputs.windowDays ?? COMPOSITE_SIGNAL_WINDOW_DAYS;
  const asOf = toIsoDate(now);

  // --- Weight sanity ------------------------------------------------------
  // Defended by tests, but throw here too so an accidental edit to the
  // weights constant can never ship a broken composite silently.
  const weightSum = Object.values(COMPOSITE_WEIGHTS).reduce(
    (a, b) => a + b,
    0,
  );
  if (Math.abs(weightSum - 1) > 1e-6) {
    throw new Error(
      `COMPOSITE_WEIGHTS must sum to 1.0, got ${weightSum.toFixed(6)}`,
    );
  }
  for (const [k, w] of Object.entries(COMPOSITE_WEIGHTS)) {
    if (w > COMPOSITE_MAX_SINGLE_WEIGHT + 1e-9) {
      throw new Error(
        `COMPOSITE_WEIGHTS.${k} = ${w} exceeds COMPOSITE_MAX_SINGLE_WEIGHT (${COMPOSITE_MAX_SINGLE_WEIGHT})`,
      );
    }
  }

  // --- Phase 1: triage + raw extraction -----------------------------------
  const intermediates: IntermediateEntry[] = [];

  for (const input of inputs.engineers) {
    const signals = {
      delivery: {
        rawValue: null as number | null,
        adjustedRawValue: null as number | null,
        processedValue: null as number | null,
      },
      quality: {
        rawValue: null as number | null,
        adjustedRawValue: null as number | null,
        processedValue: null as number | null,
      },
      reliability: {
        rawValue: null as number | null,
        adjustedRawValue: null as number | null,
        processedValue: null as number | null,
      },
      reviewDiscipline: {
        rawValue: null as number | null,
        adjustedRawValue: null as number | null,
        processedValue: null as number | null,
      },
      cycleTime: {
        rawValue: null as number | null,
        adjustedRawValue: null as number | null,
        processedValue: null as number | null,
      },
    };

    const role = roleAdjustmentFor({
      pillar: input.pillar,
      squad: input.squad,
    });

    // Leaver / inactive rows: short-circuit, never scored. They still appear
    // in entries so the coverage count is honest.
    if (input.isLeaverOrInactive) {
      intermediates.push({
        input,
        status: "unscored_leaver",
        unscoredReason:
          "Leaver or inactive headcount — excluded from ranking so rank movement does not read as a regression.",
        tenureFactor: 1,
        roleFactor: role,
        signals,
      });
      continue;
    }

    // Unmapped GitHub: no PR data can be joined, no composite possible.
    if (input.githubLogin === null) {
      intermediates.push({
        input,
        status: "unscored_unmapped",
        unscoredReason:
          "No githubEmployeeMap entry — PR/rubric rows cannot be joined. Map the GitHub login in admin to include in ranking.",
        tenureFactor: 1,
        roleFactor: role,
        signals,
      });
      continue;
    }

    const tenureFactor = tenureFactorFor(input.tenureDays, windowDays);
    if (tenureFactor === null) {
      intermediates.push({
        input,
        status: "unscored_ramp_up",
        unscoredReason: `Tenure < ${COMPOSITE_MIN_TENURE_DAYS}d — signal window too short for a defensible cohort compare. Ranked once tenure passes ${COMPOSITE_MIN_TENURE_DAYS} days.`,
        tenureFactor: 1,
        roleFactor: role,
        signals,
      });
      continue;
    }

    // Raw extraction. Each helper returns null when the input is missing or
    // below its minimum-sample threshold.
    signals.delivery.rawValue = extractDeliveryRaw(input);
    signals.quality.rawValue = extractQualityRaw(input);
    signals.reliability.rawValue = extractReliabilityRaw(input);
    signals.reviewDiscipline.rawValue = extractReviewDisciplineRaw(input);
    signals.cycleTime.rawValue = extractCycleTimeRaw(input);

    // Apply role adjustment (pre-normalisation). Delivery gets
    // deliveryFactor; cycleTime gets cycleTimeFactor; others are identity.
    signals.delivery.adjustedRawValue =
      signals.delivery.rawValue === null
        ? null
        : signals.delivery.rawValue * role.deliveryFactor;
    signals.quality.adjustedRawValue = signals.quality.rawValue;
    signals.reliability.adjustedRawValue = signals.reliability.rawValue;
    signals.reviewDiscipline.adjustedRawValue = signals.reviewDiscipline.rawValue;
    signals.cycleTime.adjustedRawValue =
      signals.cycleTime.rawValue === null
        ? null
        : signals.cycleTime.rawValue * role.cycleTimeFactor;

    // Apply tenure pro-rating to volume-like signals (delivery only — the
    // others are rate/mean signals that self-normalise over whatever PRs
    // the engineer did merge).
    signals.delivery.processedValue =
      signals.delivery.adjustedRawValue === null
        ? null
        : signals.delivery.adjustedRawValue * tenureFactor;
    signals.quality.processedValue = signals.quality.adjustedRawValue;
    signals.reliability.processedValue = signals.reliability.adjustedRawValue;
    signals.reviewDiscipline.processedValue =
      signals.reviewDiscipline.adjustedRawValue;
    signals.cycleTime.processedValue = signals.cycleTime.adjustedRawValue;

    // Partial-window status tracks tenure pro-rating 1:1 so no rank-affecting
    // normalisation stays hidden from the self-defence panel. If
    // `tenureFactor > 1` the engineer's delivery was inflated, so their
    // status must signal it. Otherwise they read as fully `scored`.
    const isPartialWindow = tenureFactor > 1;

    intermediates.push({
      input,
      status: isPartialWindow ? "partial_window_scored" : "scored",
      unscoredReason: null,
      tenureFactor,
      roleFactor: role,
      signals,
    });
  }

  // --- Phase 2: cohort winsorize + percentile ------------------------------
  // Group candidates by discipline for BE/FE cohort-relative scoring.
  const byDiscipline = new Map<Discipline, IntermediateEntry[]>();
  for (const inter of intermediates) {
    if (
      inter.status !== "scored" &&
      inter.status !== "partial_window_scored"
    ) {
      continue;
    }
    const bucket = byDiscipline.get(inter.input.discipline) ?? [];
    bucket.push(inter);
    byDiscipline.set(inter.input.discipline, bucket);
  }

  // Winsorize delivery per-discipline at cohort P90, in-place on processedValue.
  const disciplineWinsorCaps = new Map<Discipline, number | null>();
  for (const [discipline, bucket] of byDiscipline.entries()) {
    const deliveryVals = bucket
      .map((e) => e.signals.delivery.processedValue)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const sorted = [...deliveryVals].sort((a, b) => a - b);
    const cap = quantile(sorted, COMPOSITE_DELIVERY_WINSOR_P);
    disciplineWinsorCaps.set(discipline, cap);
    if (cap === null) continue;
    for (const e of bucket) {
      if (e.signals.delivery.processedValue !== null) {
        e.signals.delivery.processedValue = Math.min(
          e.signals.delivery.processedValue,
          cap,
        );
      }
    }
  }

  // Compute per-signal cohort percentile per discipline. For cycleTime we
  // already inverted so higher=better; same direction as delivery/quality/etc.
  const disciplineCohortTooSmall = new Set<Discipline>();
  for (const [discipline, bucket] of byDiscipline.entries()) {
    if (bucket.length < COMPOSITE_MIN_COHORT_SIZE) {
      disciplineCohortTooSmall.add(discipline);
    }
  }

  // --- Phase 3: compose -----------------------------------------------------
  const allEntries: CompositeEntry[] = [];
  const scoredByDiscipline = new Map<
    Discipline,
    Array<{ inter: IntermediateEntry; score: number }>
  >();

  for (const inter of intermediates) {
    const signalContribs = initSignalContributionMap();
    for (const key of COMPOSITE_SIGNAL_KEYS) {
      signalContribs[key].rawValue = inter.signals[key].rawValue;
      signalContribs[key].adjustedRawValue = inter.signals[key].adjustedRawValue;
      signalContribs[key].processedValue = inter.signals[key].processedValue;
    }

    // Leaver / unmapped / ramp-up already short-circuited to an unscored
    // state in phase 1. Copy their signals through but skip composing.
    if (
      inter.status === "unscored_leaver" ||
      inter.status === "unscored_unmapped" ||
      inter.status === "unscored_ramp_up"
    ) {
      allEntries.push(
        makeEntryFromIntermediate(inter, signalContribs, null, null, null, []),
      );
      continue;
    }

    const discipline = inter.input.discipline;
    const cohort = byDiscipline.get(discipline) ?? [];

    // Cohort too small to z-score meaningfully: force unscored_small_cohort.
    if (disciplineCohortTooSmall.has(discipline)) {
      const updated: IntermediateEntry = {
        ...inter,
        status: "unscored_small_cohort",
        unscoredReason: `Discipline cohort has < ${COMPOSITE_MIN_COHORT_SIZE} scorable engineers — cohort-relative ranking refuses to fabricate precision. Snapshot will score them once the cohort grows.`,
      };
      allEntries.push(
        makeEntryFromIntermediate(
          updated,
          signalContribs,
          null,
          null,
          null,
          [],
        ),
      );
      continue;
    }

    // Compute per-signal percentile within discipline cohort.
    for (const key of COMPOSITE_SIGNAL_KEYS) {
      const myVal = signalContribs[key].processedValue;
      if (myVal === null) continue;
      const cohortVals = cohort
        .map((e) => e.signals[key].processedValue)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (cohortVals.length === 0) continue;
      const sorted = [...cohortVals].sort((a, b) => a - b);
      signalContribs[key].percentileWithinDiscipline = percentileOf(
        myVal,
        sorted,
      );
    }

    // Count present signals and re-normalise weights within the present set.
    const presentKeys = COMPOSITE_SIGNAL_KEYS.filter(
      (k) => signalContribs[k].percentileWithinDiscipline !== null,
    );
    if (presentKeys.length < COMPOSITE_MIN_SIGNALS_FOR_SCORE) {
      const updated: IntermediateEntry = {
        ...inter,
        status: "unscored_insufficient_signals",
        unscoredReason: `Only ${presentKeys.length} of ${COMPOSITE_SIGNAL_KEYS.length} signals available — below the ${COMPOSITE_MIN_SIGNALS_FOR_SCORE}-signal minimum. Missing inputs noted so coverage is honest about absent signals.`,
      };
      allEntries.push(
        makeEntryFromIntermediate(
          updated,
          signalContribs,
          null,
          null,
          null,
          [],
        ),
      );
      continue;
    }

    const presentWeightTotal = presentKeys.reduce(
      (acc, k) => acc + COMPOSITE_WEIGHTS[k],
      0,
    );
    let score = 0;
    for (const key of COMPOSITE_SIGNAL_KEYS) {
      const perc = signalContribs[key].percentileWithinDiscipline;
      if (perc === null) {
        signalContribs[key].effectiveWeight = 0;
        signalContribs[key].contribution = null;
        continue;
      }
      const effWeight = COMPOSITE_WEIGHTS[key] / presentWeightTotal;
      // Guardrail: even after re-normalisation, no single signal may carry
      // more than COMPOSITE_MAX_SINGLE_WEIGHT of the effective composite.
      // If the guard kicks in, cap it and redistribute the excess
      // proportionally. This stops a 1-signal engineer from looking like a
      // top-composite engineer on sheer signal absence elsewhere.
      const cappedWeight = Math.min(effWeight, COMPOSITE_MAX_SINGLE_WEIGHT);
      signalContribs[key].effectiveWeight = cappedWeight;
      signalContribs[key].contribution = (perc / 100) * cappedWeight;
      score += signalContribs[key].contribution ?? 0;
    }

    // If cap kicks in, score may be < 1.0 of what a full-weight engineer
    // reaches — that's deliberate. A missing signal must not fully redistribute
    // to remaining signals or the composite becomes a one-signal proxy.
    const finalScore = score * 100;

    scoredByDiscipline.set(discipline, [
      ...(scoredByDiscipline.get(discipline) ?? []),
      { inter, score: finalScore },
    ]);

    const { band: confidenceBand, nEffective } = computeConfidenceBand({
      score: finalScore,
      prCount: inter.input.prCount ?? 0,
      analysedPrCount: inter.input.analysedPrCount ?? 0,
      presentSignalCount: presentKeys.length,
      tenureFactor: inter.tenureFactor,
    });

    allEntries.push({
      emailHash: inter.input.emailHash,
      displayName: inter.input.displayName,
      email: inter.input.email,
      githubLogin: inter.input.githubLogin,
      discipline: inter.input.discipline,
      pillar: inter.input.pillar,
      squad: inter.input.squad,
      managerEmail: inter.input.managerEmail,
      tenureDays: inter.input.tenureDays,
      status: inter.status,
      score: finalScore,
      orgPercentile: null, // filled in phase 4
      disciplinePercentile: null,
      signals: signalContribs,
      tenureFactor: inter.tenureFactor,
      roleFactor: inter.roleFactor,
      evidence: buildEvidenceStrings(inter.input, signalContribs, cohort),
      unscoredReason: null,
      confidenceBand,
      nEffective,
    });
  }

  // --- Phase 4: org & discipline percentile + cohort medians ---------------
  const scoredEntries = allEntries.filter(
    (e) => e.score !== null && Number.isFinite(e.score),
  );
  const orgScoresSorted = scoredEntries
    .map((e) => e.score as number)
    .sort((a, b) => a - b);
  for (const entry of scoredEntries) {
    entry.orgPercentile = percentileOf(entry.score as number, orgScoresSorted);
  }

  for (const [discipline, bucket] of scoredByDiscipline.entries()) {
    const disciplineScores = bucket.map((b) => b.score).sort((a, b) => a - b);
    for (const entry of scoredEntries) {
      if (entry.discipline === discipline) {
        entry.disciplinePercentile = percentileOf(
          entry.score as number,
          disciplineScores,
        );
      }
    }
  }

  // Build cohort summaries for each represented discipline (scored only).
  const cohorts: CompositeCohortSummary[] = [];
  for (const [discipline, bucket] of scoredByDiscipline.entries()) {
    const scores = bucket.map((b) => b.score).sort((a, b) => a - b);
    const p25 = quantile(scores, 0.25);
    const p50 = quantile(scores, 0.5);
    const p75 = quantile(scores, 0.75);
    const medians: Partial<Record<CompositeSignalKey, number | null>> = {};
    for (const key of COMPOSITE_SIGNAL_KEYS) {
      const vals = bucket
        .map((b) => b.inter.signals[key].processedValue)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      medians[key] = median(vals);
    }
    cohorts.push({
      discipline,
      count:
        (byDiscipline.get(discipline) ?? []).length +
        // Add small-cohort/insufficient-signal rows that didn't pass through
        // `scoredByDiscipline`. We only want a rough count for the cohort
        // summary, not the definition of who's scored.
        0,
      scoredCount: bucket.length,
      scorePercentiles:
        p25 !== null && p50 !== null && p75 !== null
          ? { p25, p50, p75 }
          : null,
      medians,
    });
  }

  // --- Phase 5: coverage ---------------------------------------------------
  const coverage = {
    total: allEntries.length,
    scored: allEntries.filter((e) => e.status === "scored").length,
    partialWindowScored: allEntries.filter(
      (e) => e.status === "partial_window_scored",
    ).length,
    unscoredRampUp: allEntries.filter((e) => e.status === "unscored_ramp_up")
      .length,
    unscoredLeaver: allEntries.filter((e) => e.status === "unscored_leaver")
      .length,
    unscoredUnmapped: allEntries.filter(
      (e) => e.status === "unscored_unmapped",
    ).length,
    unscoredInsufficientSignals: allEntries.filter(
      (e) => e.status === "unscored_insufficient_signals",
    ).length,
    unscoredSmallCohort: allEntries.filter(
      (e) => e.status === "unscored_small_cohort",
    ).length,
  };

  // Sort final entries: scored descending by score, then alphabetically.
  allEntries.sort((a, b) => {
    const aScore = a.score ?? -Infinity;
    const bScore = b.score ?? -Infinity;
    if (aScore !== bScore) return bScore - aScore;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    methodologyVersion: COMPOSITE_METHODOLOGY_VERSION,
    asOf,
    windowDays,
    weights: { ...COMPOSITE_WEIGHTS },
    entries: allEntries,
    scored: allEntries.filter(
      (e) =>
        e.status === "scored" || e.status === "partial_window_scored",
    ),
    cohorts,
    coverage,
  };
}

// -----------------------------------------------------------------------------
// Evidence — falsifiable one-liners drawn from raw values
// -----------------------------------------------------------------------------

function buildEvidenceStrings(
  input: EngineerCompositeInput,
  signals: Record<CompositeSignalKey, CompositeSignalContribution>,
  cohort: IntermediateEntry[],
): string[] {
  const evidence: string[] = [];

  // Delivery evidence: raw PR count + cohort median.
  if (input.prCount !== null && signals.delivery.rawValue !== null) {
    const cohortPrs = cohort
      .map((e) => e.input.prCount)
      .filter((v): v is number => v !== null);
    const med = median(cohortPrs);
    const medStr = med !== null ? `vs cohort median ${med.toFixed(0)}` : "";
    evidence.push(
      `Merged ${input.prCount} PRs in the last 180 days ${medStr}`.trim(),
    );
  }

  // Quality evidence: rubric mean on [1, 5] + cohort median rubric.
  const rubricMean = signals.quality.rawValue;
  if (rubricMean !== null && input.analysedPrCount !== null) {
    const cohortRubric = cohort
      .map((e) => e.signals.quality.rawValue)
      .filter((v): v is number => v !== null);
    const med = median(cohortRubric);
    const medStr = med !== null ? `vs cohort median ${med.toFixed(2)}` : "";
    evidence.push(
      `Rubric quality ${rubricMean.toFixed(2)}/5 across ${input.analysedPrCount} analysed PRs ${medStr}`.trim(),
    );
  }

  // Reliability evidence: revert count and rate.
  if (
    input.revertRate !== null &&
    input.analysedPrCount !== null &&
    input.analysedPrCount >= COMPOSITE_MIN_ANALYSED_PRS
  ) {
    const revertCount = Math.round(input.revertRate * input.analysedPrCount);
    if (input.revertRate === 0) {
      evidence.push(
        `Zero reverts across ${input.analysedPrCount} analysed PRs`,
      );
    } else {
      evidence.push(
        `${revertCount} of ${input.analysedPrCount} analysed PRs reverted within 14d (${(input.revertRate * 100).toFixed(0)}%)`,
      );
    }
  }

  // Cycle-time evidence: median in hours.
  if (
    input.medianTimeToMergeMinutes !== null &&
    signals.cycleTime.rawValue !== null
  ) {
    const hours = input.medianTimeToMergeMinutes / 60;
    const unit = hours >= 48 ? "days" : "hours";
    const val = unit === "days" ? (hours / 24).toFixed(1) : hours.toFixed(1);
    evidence.push(`Median PR time-to-merge ${val} ${unit}`);
  }

  // Review discipline evidence.
  if (
    input.reviewParticipationRate !== null &&
    input.analysedPrCount !== null &&
    input.analysedPrCount >= COMPOSITE_MIN_ANALYSED_PRS
  ) {
    const rate = (input.reviewParticipationRate * 100).toFixed(0);
    evidence.push(
      `${rate}% of analysed PRs received ≥1 review round before merge`,
    );
  }

  // Trim to at most 4 items — the prompt requires 2–4 specific takeaways.
  return evidence.slice(0, 4);
}

// -----------------------------------------------------------------------------
// Scoping — engineer / manager views consume via scopeComposite
// -----------------------------------------------------------------------------

export interface CompositeScope {
  /** Organisation-wide scope. Default. */
  org?: true;
  /** Restrict to a pillar. */
  pillar?: string;
  /** Restrict to a squad. */
  squad?: string;
  /** Restrict to direct reports of the given manager email. */
  managerEmail?: string;
  /**
   * Only scored entries. Defaults to `true` so manager stack-rank callers
   * never surface leavers/unmapped/ramp-up rows by omission. Pass `false`
   * explicitly for coverage/drilldown views that want every row.
   */
  scoredOnly?: boolean;
}

export function scopeComposite(
  bundle: CompositeBundle,
  scope: CompositeScope,
): CompositeEntry[] {
  let rows = bundle.entries;
  if (scope.pillar) {
    const target = scope.pillar.trim().toLowerCase();
    rows = rows.filter((e) => e.pillar.trim().toLowerCase() === target);
  }
  if (scope.squad) {
    const target = scope.squad.trim().toLowerCase();
    rows = rows.filter(
      (e) => (e.squad ?? "").trim().toLowerCase() === target,
    );
  }
  if (scope.managerEmail) {
    const target = scope.managerEmail.trim().toLowerCase();
    rows = rows.filter(
      (e) => (e.managerEmail ?? "").trim().toLowerCase() === target,
    );
  }
  // `scoredOnly` defaults to `true` to match the stack-rank contract. Callers
  // must pass `scoredOnly: false` explicitly to include leavers, unmapped,
  // ramp-up, insufficient-signal, and small-cohort rows.
  const scoredOnly = scope.scoredOnly ?? true;
  if (scoredOnly) {
    rows = rows.filter(
      (e) =>
        e.status === "scored" || e.status === "partial_window_scored",
    );
  }
  return rows;
}

/**
 * Find a single engineer's entry by `emailHash`. Used by the engineer-view
 * page to surface the viewer's own row without leaking other individuals.
 */
export function findEngineerInComposite(
  bundle: CompositeBundle,
  emailHash: string,
): CompositeEntry | null {
  return bundle.entries.find((e) => e.emailHash === emailHash) ?? null;
}

// -----------------------------------------------------------------------------
// Ranking with confidence — tie groups + quartile flags
// -----------------------------------------------------------------------------

export interface RankedCompositeEntry extends CompositeEntry {
  /**
   * Stable positional index in the sorted output (1-based). Used internally
   * for layout, sort assertions, and tests that need a deterministic order.
   * NOT for user-visible rank labels — multiple entries in the same tie group
   * still receive distinct `rank` values so rendering remains deterministic.
   */
  rank: number;
  /**
   * Competition-style rank shown in the UI. Every member of a tie group
   * receives the rank of the group's first positional index (1-based), so a
   * two-way tie at the top renders as `#1, #1, #3` rather than `#1, #2, #3`.
   * The visible label must use this value — not `rank` — to avoid implying an
   * ordering inside the tie group that the confidence band says is not real.
   */
  displayRank: number;
  tieGroupId: number;
  quartile: 1 | 2 | 3 | 4;
  quartileFlag: QuartileFlag;
  flagEligible: boolean;
}

function bandsOverlap(a: ConfidenceBand, b: ConfidenceBand): boolean {
  return a.lower <= b.upper && b.lower <= a.upper;
}

/**
 * Tie-group membership test. Used by the (non-transitive) anchor-based
 * walker — `candidate` is a member of the tie group anchored at `anchor`
 * iff:
 *
 *   (1) Their confidence bands overlap.
 *   (2) Their score gap is no larger than the smaller of the two band
 *       half-widths (statistical indistinguishability — if either side has
 *       a narrow band, that side's precision sets the bar).
 *   (3) Their score gap is no larger than `TIE_GROUP_MAX_SCORE_GAP` —
 *       absolute hard cap, protecting against pathological cases where
 *       both bands are wide and the gap is large in absolute terms.
 *
 * The walker compares each candidate to the group's ANCHOR (the first row
 * that opened the group), not to the previous adjacent row. This is the
 * key fix for transitive chaining: when N adjacent overlaps each touch but
 * their cumulative score span is large, the previous-row test would lump
 * them all together; the anchor test catches the gap to the start of the
 * group and breaks the chain at the first member that is no longer
 * statistically indistinguishable from the anchor.
 */
function tiedWithAnchor(
  anchor: { score: number; confidenceBand: ConfidenceBand },
  candidate: { score: number; confidenceBand: ConfidenceBand },
): boolean {
  if (!bandsOverlap(anchor.confidenceBand, candidate.confidenceBand))
    return false;
  const scoreGap = Math.abs(anchor.score - candidate.score);
  if (scoreGap > TIE_GROUP_MAX_SCORE_GAP) return false;
  const minHalfWidth = Math.min(
    anchor.confidenceBand.halfWidth,
    candidate.confidenceBand.halfWidth,
  );
  return scoreGap <= minHalfWidth;
}

/**
 * Rank a set of composite entries (expected to be pre-scoped via
 * `scopeComposite`) and assign tie groups + quartile flags.
 *
 * Only scored entries with valid confidence bands are ranked. Unscored entries
 * are silently dropped — callers must pre-filter via `scopeComposite()`'s
 * default `scoredOnly: true` or pass scored entries explicitly.
 *
 * Tie groups: adjacent entries (sorted by score desc) whose confidence bands
 * overlap are collapsed into a shared tie group (transitive).
 *
 * Quartile flags: promote_candidate (Q4) and performance_manage (Q1) are
 * assigned ONLY when (a) every member of the tie group falls inside the
 * quartile, AND (b) the confidence gap between the group's band envelope and
 * the nearest non-quartile group's band envelope is real (non-overlapping).
 * When either condition fails the flag is null.
 */
export function rankWithConfidence(
  entries: readonly CompositeEntry[],
): RankedCompositeEntry[] {
  const scorable = entries.filter(
    (
      e,
    ): e is CompositeEntry & {
      score: number;
      confidenceBand: ConfidenceBand;
    } =>
      e.score !== null &&
      e.confidenceBand !== null &&
      (e.status === "scored" || e.status === "partial_window_scored"),
  );

  if (scorable.length === 0) return [];

  const sorted = [...scorable].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.displayName.localeCompare(b.displayName);
  });

  // --- Tie groups (anchor-based, non-transitive) ---
  // Each new entry is compared to the ANCHOR of the current tie group (the
  // first row that opened it), not to the previous row. This breaks the
  // transitive chain that previously collapsed wide score spans into one
  // group when adjacent bands kept barely touching.
  const tieGroupIds: number[] = [0];
  let currentGroupId = 0;
  let groupAnchor = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (tiedWithAnchor(groupAnchor, sorted[i])) {
      tieGroupIds.push(currentGroupId);
    } else {
      currentGroupId++;
      tieGroupIds.push(currentGroupId);
      groupAnchor = sorted[i];
    }
  }

  // --- Quartile thresholds ---
  const sortedScoresAsc = sorted
    .map((e) => e.score)
    .sort((a, b) => a - b);
  const p25 = quantile(sortedScoresAsc, 0.25) ?? 0;
  const p50 = quantile(sortedScoresAsc, 0.5) ?? 50;
  const p75 = quantile(sortedScoresAsc, 0.75) ?? 100;

  function assignQuartile(score: number): 1 | 2 | 3 | 4 {
    if (score <= p25) return 1;
    if (score <= p50) return 2;
    if (score <= p75) return 3;
    return 4;
  }

  // --- Group metadata ---
  interface TieGroup {
    indices: number[];
    lowerEnvelope: number;
    upperEnvelope: number;
    quartiles: Set<1 | 2 | 3 | 4>;
  }
  const groups = new Map<number, TieGroup>();
  for (let i = 0; i < sorted.length; i++) {
    const gid = tieGroupIds[i];
    const entry = sorted[i];
    const existing = groups.get(gid);
    if (existing) {
      existing.indices.push(i);
      existing.lowerEnvelope = Math.min(
        existing.lowerEnvelope,
        entry.confidenceBand.lower,
      );
      existing.upperEnvelope = Math.max(
        existing.upperEnvelope,
        entry.confidenceBand.upper,
      );
      existing.quartiles.add(assignQuartile(entry.score));
    } else {
      groups.set(gid, {
        indices: [i],
        lowerEnvelope: entry.confidenceBand.lower,
        upperEnvelope: entry.confidenceBand.upper,
        quartiles: new Set([assignQuartile(entry.score)]),
      });
    }
  }

  // --- Positional quartile boundaries ---
  // Score-threshold quartiles can collapse when many entries share the same
  // score: all 8 entries at score 50 produce p25=50, so assignQuartile(50)
  // returns Q1 for every entry, making the whole cohort look bottom-quartile.
  // We add a positional check: a tie group may only receive promote /
  // performance-manage flags when its entire index span falls within the
  // positional top / bottom 25% of the sorted array.
  const n = sorted.length;
  const topQSize = Math.ceil(n / 4);
  const bottomQStart = n - Math.ceil(n / 4);

  // --- Flag eligibility per group ---
  const groupFlags = new Map<
    number,
    { flag: QuartileFlag; eligible: boolean }
  >();

  const tooFewForFlags = sorted.length < CONFIDENCE_MIN_ENTRIES_FOR_FLAGS;

  for (const [gid, group] of groups.entries()) {
    if (tooFewForFlags) {
      groupFlags.set(gid, { flag: null, eligible: false });
      continue;
    }

    const allQ4 = group.quartiles.size === 1 && group.quartiles.has(4);
    const allQ1 = group.quartiles.size === 1 && group.quartiles.has(1);

    if (!allQ4 && !allQ1) {
      groupFlags.set(gid, { flag: null, eligible: false });
      continue;
    }

    const minIdx = Math.min(...group.indices);
    const maxIdx = Math.max(...group.indices);

    if (allQ4) {
      if (maxIdx >= topQSize) {
        groupFlags.set(gid, { flag: null, eligible: false });
        continue;
      }
      let nearestNonQ4Upper = -Infinity;
      for (const [otherGid, otherGroup] of groups.entries()) {
        if (otherGid === gid) continue;
        const hasNonQ4 = [...otherGroup.quartiles].some((q) => q !== 4);
        if (hasNonQ4) {
          nearestNonQ4Upper = Math.max(
            nearestNonQ4Upper,
            otherGroup.upperEnvelope,
          );
        }
      }
      const gapReal =
        nearestNonQ4Upper === -Infinity ||
        group.lowerEnvelope > nearestNonQ4Upper;
      groupFlags.set(gid, {
        flag: gapReal ? "promote_candidate" : null,
        eligible: gapReal,
      });
    } else {
      if (minIdx < bottomQStart) {
        groupFlags.set(gid, { flag: null, eligible: false });
        continue;
      }
      let nearestNonQ1Lower = Infinity;
      for (const [otherGid, otherGroup] of groups.entries()) {
        if (otherGid === gid) continue;
        const hasNonQ1 = [...otherGroup.quartiles].some((q) => q !== 1);
        if (hasNonQ1) {
          nearestNonQ1Lower = Math.min(
            nearestNonQ1Lower,
            otherGroup.lowerEnvelope,
          );
        }
      }
      const gapReal =
        nearestNonQ1Lower === Infinity ||
        group.upperEnvelope < nearestNonQ1Lower;
      groupFlags.set(gid, {
        flag: gapReal ? "performance_manage" : null,
        eligible: gapReal,
      });
    }
  }

  // --- Display rank per group (competition-rank) ---
  // Every member of a tie group shares the rank of the group's first member.
  // Subsequent groups jump to their own positional index, so a two-way tie at
  // the top yields ranks [1, 1, 3, ...] not [1, 2, 3, ...].
  const groupDisplayRank = new Map<number, number>();
  for (let i = 0; i < sorted.length; i++) {
    const gid = tieGroupIds[i];
    if (!groupDisplayRank.has(gid)) {
      groupDisplayRank.set(gid, i + 1);
    }
  }

  // --- Assemble output ---
  return sorted.map((entry, i) => {
    const gid = tieGroupIds[i];
    const { flag, eligible } = groupFlags.get(gid) ?? {
      flag: null,
      eligible: false,
    };
    return {
      ...entry,
      rank: i + 1,
      displayRank: groupDisplayRank.get(gid) ?? i + 1,
      tieGroupId: gid,
      quartile: assignQuartile(entry.score),
      quartileFlag: flag,
      flagEligible: eligible,
    };
  });
}
