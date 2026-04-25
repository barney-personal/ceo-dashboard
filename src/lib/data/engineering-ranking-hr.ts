/**
 * HR evidence pack for the engineering ranking page.
 *
 * Pure data module. Takes a fully-populated `EngineeringRankingSnapshot` as
 * its only input and produces an objective per-engineer evidence bundle for
 * the bottom N of the ranked cohort (default 10). The goal is decision
 * *support* for a calibration conversation with a direct manager — not an
 * adjudication, not a dismissal case file.
 *
 * Everything this module emits is derivable from signals the page already
 * surfaces elsewhere (attribution, confidence, movers, eligibility). The
 * module does not fetch, does not hash, does not call into other services.
 * It deliberately joins *concerns* to *confounders* side by side so a reader
 * cannot scan evidence without also seeing what explains it away.
 *
 * The verdict classifier (`classifyHrVerdict`) is exported separately so
 * tests can drive it with synthetic inputs without building a snapshot.
 * Verdict precedence is strict and deterministic:
 *   1. `insufficient_history` — no comparable prior snapshot
 *   2. `activity_only`        — cohort composite is dominance-blocked
 *   3. `confounded`           — short tenure / wide CI / thin methods / tie /
 *                               missing GitHub / missing impact + <1y
 *   4. `quality_concern`      — sustained + lens D dominates negative drivers
 *   5. `sustained_concern`    — prior was also bottom-15, no major confounders
 *   6. `single_cycle_only`    — prior was above bottom-15 (moved down)
 *
 * Only `sustained_concern` is ever a conversation starter on its own, and even
 * then the pack surfaces it as "trigger a calibration conversation with the
 * manager", never as "basis for action".
 */

import type {
  AttributionContribution,
  CompositeMethod,
  EngineeringRankingSnapshot,
  MoverCauseKind,
  MoverEntry,
  EngineerAttribution,
  EngineerCompositeEntry,
  EngineerConfidence,
  EligibilityEntry,
  PerEngineerSignalRow,
  PrReviewAnalysisInput,
} from "./engineering-ranking";
import { RANKING_COMPOSITE_METHOD_LABELS } from "./engineering-ranking";
import type { SlackMemberRow } from "./slack-members";
import type { PerformanceRating } from "./performance";

/** Bottom engineers to profile by default. */
export const HR_BOTTOM_N_DEFAULT = 10 as const;

/**
 * CI width (in composite-percentile points) above which an engineer's rank
 * is too uncertain to defend. The confidence bundle already widens sigmas for
 * low PR count, short tenure, missing SHAP, missing GitHub, and cohort
 * dominance — we just read the resulting width here.
 */
export const HR_MAX_CI_WIDTH = 30 as const;

/**
 * Short-tenure threshold beyond the 90-day ramp-up cut. An engineer past the
 * 90-day gate but still in their first 180 days is past "just arrived" but
 * not yet at steady-state output — we flag this as a confounder, not as
 * ineligibility.
 */
export const HR_SHORT_TENURE_DAYS = 180 as const;

/**
 * First-year threshold. Missing impact-model row combined with tenure under
 * a year is treated as a confounder because the engineer may simply not have
 * been around for the impact-model training window.
 */
export const HR_FIRST_YEAR_DAYS = 365 as const;

/**
 * Minimum number of present composite methods before we consider the
 * composite stable enough to read into. Below this, the verdict is
 * `confounded` regardless of score.
 */
export const HR_MIN_PRESENT_METHODS = 4 as const;

/**
 * Percentile threshold that defines "bottom 15" for historical comparison.
 * An engineer whose prior `compositePercentile` was ≤ 15 counts as
 * sustained-low for the `sustained_concern` / `quality_concern` verdicts.
 */
export const HR_SUSTAINED_PERCENTILE = 15 as const;

export type HrVerdict =
  | "insufficient_history"
  | "activity_only"
  | "confounded"
  | "quality_concern"
  | "sustained_concern"
  | "single_cycle_only";

/** Human-readable label for each verdict (used in summary chips). */
export const HR_VERDICT_LABELS: Record<HrVerdict, string> = {
  insufficient_history: "Insufficient history",
  activity_only: "Activity-only (cohort dominance-blocked)",
  confounded: "Confounded — do not act",
  quality_concern: "Quality concern",
  sustained_concern: "Sustained concern",
  single_cycle_only: "Single-cycle only",
};

/**
 * Severity ordering for the summary bar. `sustained_concern` is the only
 * verdict that might warrant a manager calibration conversation; the rest
 * are either not-actionable or watch-only.
 */
export const HR_VERDICT_SEVERITY: Record<HrVerdict, "action" | "watch" | "neutral" | "none"> = {
  insufficient_history: "none",
  activity_only: "none",
  confounded: "none",
  single_cycle_only: "watch",
  quality_concern: "action",
  sustained_concern: "action",
};

export interface HrMethodScore {
  method: CompositeMethod;
  label: string;
  percentile: number | null;
  present: boolean;
  /** Plain-language reason the method is absent. Empty when `present`. */
  absenceReason: string;
}

export interface HrConcernLine {
  /** Short label (e.g. "PR count in window", "Execution quality"). */
  label: string;
  /** Formatted value for the engineer (e.g. "4", "2.1 / 5"). */
  value: string;
  /** Cohort context when available (e.g. "cohort median 23"). */
  cohortContext: string | null;
  /** Percentile on [0,100] when available, higher = better. */
  driverPercentile: number | null;
  /** Which composite method this concern originates from. */
  method: CompositeMethod;
}

export type HrConfounderKind =
  | "uncertainty_factor"
  | "tie_group"
  | "short_tenure"
  | "few_methods"
  | "dominance_blocked"
  | "missing_github"
  | "missing_impact_model"
  | "no_prior_snapshot"
  | "first_year_no_impact_row";

export interface HrConfounder {
  kind: HrConfounderKind;
  note: string;
}

export interface HrHistorical {
  hasPriorSnapshot: boolean;
  priorRank: number | null;
  priorCompositePercentile: number | null;
  priorSnapshotDate: string | null;
  moverCauseKind: MoverCauseKind | null;
  moverNarrative: string | null;
  /** True when the prior composite percentile was ≤ HR_SUSTAINED_PERCENTILE. */
  priorWasBottom15: boolean;
}

/**
 * Cohort distribution summary for one raw signal. Computed over every engineer
 * who has a non-null value for the signal — the cohort scope is named in
 * `cohortLabel`. Each bottom engineer is compared against this distribution so
 * the reader sees volume gaps ("shipped 4 PRs · cohort median 23 · top-decile
 * 60+") rather than just percentiles.
 *
 * `topDecileMean` is the mean of engineers at or above the 90th percentile —
 * a defensible "top performers" anchor that does not single out any one
 * named engineer.
 */
export interface HrCohortStats {
  cohortLabel: string;
  cohortSize: number;
  min: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
  /** Mean of engineers at or above the 90th percentile. */
  topDecileMean: number | null;
  /** Count at or above the 90th percentile (typically ceil(cohortSize * 0.1)). */
  topDecileCount: number;
}

/** Whether higher or lower values of a signal are "better". */
export type HrSignalDirection = "higher_is_better" | "lower_is_better";

/**
 * One signal row in the contrast table — the single most load-bearing
 * comparison in the HR pack. Renders side-by-side: the engineer's raw value,
 * cohort median, top-decile mean, and their percentile + gap copy.
 *
 * `narrative` is pre-formatted plain English ("Shipped 4 PRs in the window.
 * Cohort median 23. Top-decile median 60.") so the section renders
 * consistently regardless of which signals happen to be present.
 */
export interface HrSignalContrast {
  signal: string;
  label: string;
  direction: HrSignalDirection;
  engineerValue: number | null;
  /** Plain-language rendering of `engineerValue` with units. */
  engineerValueDisplay: string;
  cohort: HrCohortStats;
  disciplineCohort: HrCohortStats | null;
  /**
   * The engineer's rank-percentile against the scope chosen for narration —
   * prefers discipline cohort when it has enough members, else cohort-wide.
   * Higher = better when `direction === "higher_is_better"`, already inverted
   * for the reader.
   */
  engineerPercentile: number | null;
  /** `engineerValue / cohort.median` as a fraction; null when either is null. */
  fractionOfMedian: number | null;
  /** `engineerValue / cohort.topDecileMean` as a fraction; null when null. */
  fractionOfTopDecile: number | null;
  narrative: string;
}

/**
 * Compact triage summary of an engineer's activity gap. Rendered above the
 * detailed contrast table so the reader can scan the shape of the problem
 * in seconds:
 *   - `headline` calls out breadth ("7 of 10 signals below cohort median").
 *   - `belowMedianCount` / `bottomDecileCount` / `totalSignals` drive chips.
 *   - `highlights` lists the top-3 most severe signals, pre-formatted.
 * The existing per-signal `narrative` strings are still available on each
 * contrast row for tooltips, but are no longer stitched into a prose
 * paragraph — the table carries the data at a glance.
 */
export interface HrContrastSummary {
  /** One-sentence plain-English headline describing the breadth of the gap. */
  headline: string;
  /** Count of signals where engineer < cohort median (higher-is-better aware). */
  belowMedianCount: number;
  /** Count of signals where engineer sits in the bottom decile of the cohort. */
  bottomDecileCount: number;
  /** Total number of signals with enough cohort data to be narrated. */
  totalSignals: number;
  /** Top-3 most severe signals, pre-formatted for display. */
  highlights: readonly HrContrastHighlight[];
}

/**
 * One entry in the "most severe gaps" list. All fields are pre-formatted so
 * the UI can render them without re-invoking any HR-specific formatting.
 */
export interface HrContrastHighlight {
  signal: string;
  label: string;
  /** e.g. "3" or "US$94". */
  engineerValueDisplay: string;
  /** e.g. "50 (cohort median, n=95)". Null when missing. */
  cohortMedianDisplay: string | null;
  /** e.g. "91 (top-decile mean)". Null when missing. */
  cohortTopDecileDisplay: string | null;
  /** e.g. "6% of median". Null when the fraction is undefined. */
  fractionOfMedianDisplay: string | null;
  /** e.g. "3% of top-decile". Null when undefined. */
  fractionOfTopDecileDisplay: string | null;
  /** e.g. "1st percentile". Null when no percentile is available. */
  percentileOrdinalDisplay: string | null;
}

/**
 * Enriched per-engineer signal row used by the HR contrast table. Carries the
 * canonical GitHub-derived signals from `PerEngineerSignalRow` plus
 * Slack-engagement signals joined from the Slack members snapshot. Nulls on
 * every field; missingness stays explicit through the stack.
 */
export interface HrRichSignalRow {
  emailHash: string;
  // From PerEngineerSignalRow
  prCount: number | null;
  commitCount: number | null;
  additions: number | null;
  deletions: number | null;
  shapPredicted: number | null;
  shapActual: number | null;
  shapResidual: number | null;
  aiTokens: number | null;
  aiSpend: number | null;
  squadCycleTimeHours: number | null;
  squadReviewRatePercent: number | null;
  squadTimeToFirstReviewHours: number | null;
  squadPrsInProgress: number | null;
  // From SlackMemberRow (null when no Slack match)
  slackMsgsPerDay: number | null;
  slackReactionsPerDay: number | null;
  slackEngagementScore: number | null;
  slackDaysSinceLastActive: number | null;
}

/** Raw-signal catalogue used by the contrast table. */
interface SignalCatalogueEntry {
  signal: string;
  label: string;
  direction: HrSignalDirection;
  accessor: (row: HrRichSignalRow) => number | null;
  /** Format engineer/cohort values for display (e.g. "23" vs "£1,200"). */
  format: (value: number | null) => string;
  /** Unit word used in generated narratives ("PRs", "commits", "lines"). */
  unitWord: string;
  /** Minimum cohort size for this signal to be included. */
  minCohortSize: number;
}

const SIGNAL_CATALOGUE: readonly SignalCatalogueEntry[] = [
  {
    signal: "pr_count",
    label: "Merged PRs (window)",
    direction: "higher_is_better",
    accessor: (row) => row.prCount,
    format: (v) => (v === null ? "—" : Math.round(v).toString()),
    unitWord: "PRs",
    minCohortSize: 5,
  },
  {
    signal: "commit_count",
    label: "Commits (window)",
    direction: "higher_is_better",
    accessor: (row) => row.commitCount,
    format: (v) => (v === null ? "—" : Math.round(v).toString()),
    unitWord: "commits",
    minCohortSize: 5,
  },
  {
    signal: "net_lines",
    label: "Net lines added (window)",
    direction: "higher_is_better",
    accessor: (row) =>
      row.additions === null || row.deletions === null
        ? null
        : row.additions - row.deletions,
    format: (v) =>
      v === null ? "—" : v.toLocaleString("en-GB", { maximumFractionDigits: 0 }),
    unitWord: "lines",
    minCohortSize: 5,
  },
  {
    signal: "shap_actual",
    label: "Measured impact (SHAP)",
    direction: "higher_is_better",
    accessor: (row) => row.shapActual,
    format: (v) =>
      v === null
        ? "—"
        : v.toLocaleString("en-GB", { maximumFractionDigits: 0 }),
    unitWord: "impact units",
    minCohortSize: 5,
  },
  {
    signal: "ai_spend",
    label: "AI tooling usage (latest month)",
    direction: "higher_is_better",
    accessor: (row) => row.aiSpend,
    format: (v) =>
      v === null
        ? "—"
        : v.toLocaleString("en-GB", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }),
    unitWord: "AI spend",
    minCohortSize: 10,
  },
  {
    signal: "slack_msgs_per_day",
    label: "Slack messages / day",
    direction: "higher_is_better",
    accessor: (row) => row.slackMsgsPerDay,
    format: (v) => (v === null ? "—" : v.toFixed(1)),
    unitWord: "msgs/day",
    minCohortSize: 10,
  },
  {
    signal: "slack_reactions_per_day",
    label: "Slack reactions / day",
    direction: "higher_is_better",
    accessor: (row) => row.slackReactionsPerDay,
    format: (v) => (v === null ? "—" : v.toFixed(1)),
    unitWord: "reactions/day",
    minCohortSize: 10,
  },
  {
    signal: "slack_engagement_score",
    label: "Slack engagement score",
    direction: "higher_is_better",
    accessor: (row) => row.slackEngagementScore,
    format: (v) => (v === null ? "—" : v.toFixed(0)),
    unitWord: "engagement",
    minCohortSize: 10,
  },
  {
    signal: "slack_days_since_active",
    label: "Days since last Slack activity",
    direction: "lower_is_better",
    accessor: (row) => row.slackDaysSinceLastActive,
    format: (v) => (v === null ? "—" : `${Math.round(v)}d`),
    unitWord: "days inactive",
    minCohortSize: 10,
  },
];

/**
 * Last-30-days GitHub PR activity block. Counts come from the 30-day
 * activity fetch; complexity/quality means come from analysed PRs merged in
 * the same window. `analysedPrCount` is usually less than `prsMerged`
 * because not every PR gets a rubric analysis (small PRs, bot PRs, etc.).
 */
export interface HrRecentPrActivity {
  windowDays: number;
  prsMerged: number;
  commitCount: number;
  netLines: number;
  analysedPrCount: number;
  /** Mean `technicalDifficulty` (1–5) across analysed PRs in the window. */
  complexityMean: number | null;
  /** Mean `executionQuality` (1–5). */
  executionQualityMean: number | null;
  /** Mean `testAdequacy` (1–5). */
  testAdequacyMean: number | null;
  /** Mean `riskHandling` (1–5). */
  riskHandlingMean: number | null;
  /** Mean `reviewability` (1–5). */
  reviewabilityMean: number | null;
  /** Count of PRs reverted within 14 days of merge. */
  revertCount: number;
  /** Cohort median PR count over the same 30-day window (competitive). */
  cohortPrsMerged: number | null;
  /** Cohort median execution quality over the same 30-day window. */
  cohortExecutionQualityMean: number | null;
  /** One-sentence plain-English summary of the block. */
  narrative: string;
}

/**
 * Historical performance-review ratings joined from Mode. Multi-cycle array
 * in chronological order. `averageRating` is the mean of non-null ratings;
 * `flaggedCycleCount` + `missedCycleCount` surface reviewer concerns already
 * captured in the people dashboard.
 */
export interface HrPerformanceHistory {
  hasHistory: boolean;
  ratings: readonly PerformanceRating[];
  averageRating: number | null;
  flaggedCycleCount: number;
  missedCycleCount: number;
  /** Most recent rating (by cycle). Useful for the one-line summary. */
  latestRating: number | null;
  latestCycle: string | null;
  /** One-sentence plain-English summary of the block. */
  narrative: string;
}

export interface HrEngineerEvidence {
  emailHash: string;
  // Identity — this block is CEO-sensitive and only ever reaches the client
  // when `engineering.ranking.hr` permits the viewer.
  displayName: string;
  email: string;
  githubLogin: string | null;
  githubPrSearchUrl: string | null;
  manager: string | null;
  squad: string | null;
  pillar: string | null;
  levelLabel: string;
  discipline: string;
  tenureDays: number | null;
  startDate: string | null;
  // Ranking position
  rank: number | null;
  totalScored: number;
  compositeScore: number | null;
  compositePercentile: number | null;
  ciLowPercentile: number | null;
  ciHighPercentile: number | null;
  ciWidth: number | null;
  inTieGroup: boolean;
  tieGroupId: number | null;
  /** Email hashes of other engineers sharing this tie group (empty if none). */
  tieGroupMemberHashes: readonly string[];
  // Signal evidence
  methodBreakdown: HrMethodScore[];
  topNegativeDrivers: AttributionContribution[];
  concernLines: HrConcernLine[];
  /**
   * Activity & engagement contrast vs the cohort — the single most
   * load-bearing block in the HR pack. Shows raw volume gaps (PRs, commits,
   * lines, impact) against both cohort-wide and discipline-scoped stats.
   */
  contrasts: HrSignalContrast[];
  /**
   * Structured scannable summary of the activity gap — headline + counts +
   * top-3 most severe signals. Designed for fast triage, not narrative
   * reading: the table below carries the full detail.
   */
  contrastSummary: HrContrastSummary;
  /** Last-30-days GitHub PR activity block. */
  recentPrActivity: HrRecentPrActivity;
  /** Historical performance review ratings joined from Mode. */
  performanceHistory: HrPerformanceHistory;
  // Confounders
  confounders: HrConfounder[];
  // Historical
  historical: HrHistorical;
  // Verdict
  verdict: HrVerdict;
  verdictReason: string;
}

export interface HrEvidencePack {
  /** Bottom N configuration used to build the pack. */
  bottomN: number;
  totalScored: number;
  /** True when `snapshot.composite.dominanceBlocked` — every verdict is `activity_only`. */
  cohortDominanceBlocked: boolean;
  generatedAt: string;
  signalWindow: { start: string; end: string };
  currentSnapshotDate: string;
  methodologyVersion: string;
  priorSnapshotDate: string | null;
  /** Plain-language warning rendered above the pack. */
  headerWarning: string;
  /**
   * Cohort-level notes (e.g. dominance-blocked, no prior snapshot available,
   * empty when the ranking has not produced a scored cohort yet).
   */
  cohortNotes: string[];
  /** Per-engineer evidence, lowest-rank first (rank descending from the top). */
  engineers: HrEngineerEvidence[];
  /** Count of each verdict kind across `engineers`. */
  verdictCounts: Record<HrVerdict, number>;
}

/**
 * Predicate inputs for the verdict classifier. Kept as a flat object so tests
 * can exercise every branch without constructing a full snapshot.
 */
export interface HrVerdictInputs {
  /** Cohort-level: composite collapsed into activity volume. */
  cohortDominanceBlocked: boolean;
  /** True iff we have a comparable prior snapshot for this engineer. */
  hasPriorSnapshot: boolean;
  /** Prior composite percentile ≤ HR_SUSTAINED_PERCENTILE. */
  priorWasBottom15: boolean;
  tenureDays: number | null;
  ciWidth: number | null;
  presentMethodCount: number;
  inTieGroupWithOutsideBottom: boolean;
  hasGithubLogin: boolean;
  hasImpactModelRow: boolean;
  /** True when the dominant negative driver is on lens D (code quality). */
  qualityIsDominantNegative: boolean;
}

/**
 * Classify the verdict for one engineer. Precedence is strict — the first
 * matching branch wins, and the reason sentence names the exact rule that
 * fired so the output is defensible line by line.
 */
export function classifyHrVerdict(
  inputs: HrVerdictInputs,
): { verdict: HrVerdict; reason: string } {
  if (!inputs.hasPriorSnapshot) {
    return {
      verdict: "insufficient_history",
      reason:
        "No comparable prior snapshot for this engineer — cannot assess whether this cycle reflects a sustained pattern or a single-cycle dip.",
    };
  }

  if (inputs.cohortDominanceBlocked) {
    return {
      verdict: "activity_only",
      reason:
        "Cohort composite is dominance-blocked — raw activity volume (PR count / log-impact) correlates too strongly with final rank, so bottom positions in this cycle partly reflect low volume rather than low quality. No verdict in a dominance-blocked cycle should drive action.",
    };
  }

  const confounderReasons: string[] = [];
  if (inputs.tenureDays !== null && inputs.tenureDays < HR_SHORT_TENURE_DAYS) {
    confounderReasons.push(
      `tenure ${inputs.tenureDays}d is below the ${HR_SHORT_TENURE_DAYS}d short-tenure threshold`,
    );
  }
  if (inputs.ciWidth !== null && inputs.ciWidth > HR_MAX_CI_WIDTH) {
    confounderReasons.push(
      `confidence band width ${inputs.ciWidth.toFixed(1)}pp exceeds the ${HR_MAX_CI_WIDTH}pp defensibility ceiling`,
    );
  }
  if (inputs.presentMethodCount < HR_MIN_PRESENT_METHODS) {
    confounderReasons.push(
      `only ${inputs.presentMethodCount} of 5 composite methods present (need ≥${HR_MIN_PRESENT_METHODS})`,
    );
  }
  if (inputs.inTieGroupWithOutsideBottom) {
    confounderReasons.push(
      "statistical tie group includes a rank-neighbour outside the bottom decile",
    );
  }
  if (!inputs.hasGithubLogin) {
    confounderReasons.push("no GitHub mapping — every activity signal is missing");
  }
  if (
    !inputs.hasImpactModelRow &&
    inputs.tenureDays !== null &&
    inputs.tenureDays < HR_FIRST_YEAR_DAYS
  ) {
    confounderReasons.push(
      `first-year hire and not in the impact-model training set (tenure ${inputs.tenureDays}d < ${HR_FIRST_YEAR_DAYS}d)`,
    );
  }
  if (confounderReasons.length > 0) {
    return {
      verdict: "confounded",
      reason: `Confounded by: ${confounderReasons.join("; ")}. This cycle cannot carry a defensible read of the engineer's performance.`,
    };
  }

  if (!inputs.priorWasBottom15) {
    return {
      verdict: "single_cycle_only",
      reason:
        "Prior snapshot had this engineer above the bottom 15th percentile. One cycle of low placement does not establish a pattern — bears watching in the next cycle, not a conversation starter on its own.",
    };
  }

  if (inputs.qualityIsDominantNegative) {
    return {
      verdict: "quality_concern",
      reason:
        "Prior snapshot was also bottom 15. The dominant negative driver this cycle is on the code-quality lens (D) rather than activity-volume lenses — suggests the concern is about *how* work ships, not *how much*. This is a calibration topic for the direct manager and Engineering leadership, not a performance action.",
    };
  }

  return {
    verdict: "sustained_concern",
    reason:
      "Prior snapshot was also bottom 15, major confounders are absent, and code-quality is not the dominant driver. A calibration conversation with the direct manager is warranted to understand context the ranking cannot see. This is not, on its own, a basis for action.",
  };
}

/**
 * Format a CI band as "Xpp → Ypp" with one decimal. Returns a placeholder
 * when either end is null, which happens for unscored engineers we would not
 * include in the pack anyway — defensive only.
 */
function formatCi(ciLow: number | null, ciHigh: number | null): string {
  if (ciLow === null || ciHigh === null) return "unavailable";
  return `${ciLow.toFixed(1)}pp → ${ciHigh.toFixed(1)}pp`;
}

function formatPercentile(p: number | null): string {
  if (p === null) return "n/a";
  return `${p.toFixed(1)}pp`;
}

/**
 * Build concern lines from the engineer's per-method attribution. We take
 * present methods whose percentile is below 25 (bottom quartile on that
 * method) and format them with cohort context — the percentile itself is
 * the cohort context, so we render it as "you are at the Nth percentile on
 * this method".
 */
function buildConcernLines(attribution: EngineerAttribution): HrConcernLine[] {
  const lines: HrConcernLine[] = [];
  for (const method of attribution.methods) {
    if (!method.present) continue;
    if (method.score === null) continue;
    if (method.score >= 25) continue;
    lines.push({
      label: method.label,
      value: `${method.score.toFixed(1)}pp (cohort percentile)`,
      cohortContext: "bottom quartile on this method",
      driverPercentile: method.score,
      method: method.method,
    });
  }
  // Add per-component lines from `topNegativeDrivers` so the reader sees the
  // specific raw signals dragging the rank down — these are deduped against
  // the method-level lines above because they always belong to a *component*
  // not the whole method.
  for (const driver of attribution.topNegativeDrivers) {
    if (driver.kind !== "present") continue;
    if (driver.percentile === null) continue;
    lines.push({
      label: driver.signal,
      value:
        driver.rawValue !== null
          ? `raw ${driver.rawValue.toFixed(2)} · percentile ${driver.percentile.toFixed(1)}pp`
          : `percentile ${driver.percentile.toFixed(1)}pp`,
      cohortContext: `weight ${(driver.weightInMethod * 100).toFixed(0)}% in ${RANKING_COMPOSITE_METHOD_LABELS[driver.method]}`,
      driverPercentile: driver.percentile,
      method: driver.method,
    });
  }
  return lines;
}

/**
 * Build the confounder list for one engineer. We pull the plain-language
 * uncertainty factors the confidence bundle already composed for us, then add
 * discrete flags for the verdict classifier's predicates so the rendered
 * evidence and the verdict reason share a single vocabulary.
 */
function buildConfounders(args: {
  eligibility: EligibilityEntry;
  confidence: EngineerConfidence;
  attribution: EngineerAttribution;
  tieGroupMembers: readonly string[];
  tieGroupWithOutsideBottom: boolean;
  cohortDominanceBlocked: boolean;
  hasPriorSnapshot: boolean;
  presentMethodCount: number;
}): HrConfounder[] {
  const out: HrConfounder[] = [];

  for (const factor of args.confidence.uncertaintyFactors) {
    out.push({ kind: "uncertainty_factor", note: factor });
  }

  if (args.confidence.inTieGroup) {
    if (args.tieGroupWithOutsideBottom) {
      out.push({
        kind: "tie_group",
        note: `In statistical tie with ${args.tieGroupMembers.length} rank-neighbour(s), at least one of whom sits outside the bottom decile. The ordering within this group is not defensible.`,
      });
    } else {
      out.push({
        kind: "tie_group",
        note: `In statistical tie with ${args.tieGroupMembers.length} rank-neighbour(s). Individual rank positions within the tie group should not be read as ordered.`,
      });
    }
  }

  if (
    args.eligibility.tenureDays !== null &&
    args.eligibility.tenureDays < HR_SHORT_TENURE_DAYS
  ) {
    out.push({
      kind: "short_tenure",
      note: `Tenure ${args.eligibility.tenureDays}d is below the ${HR_SHORT_TENURE_DAYS}d short-tenure threshold — past ramp-up but not yet at steady-state output.`,
    });
  }

  if (args.presentMethodCount < HR_MIN_PRESENT_METHODS) {
    const missing = args.attribution.methods
      .filter((m) => !m.present)
      .map((m) => m.label)
      .join(", ");
    out.push({
      kind: "few_methods",
      note: `Only ${args.presentMethodCount} of 5 composite methods are present. Missing: ${missing || "none listed"}.`,
    });
  }

  if (args.cohortDominanceBlocked) {
    out.push({
      kind: "dominance_blocked",
      note:
        "Cohort composite is dominance-blocked — raw activity volume correlates too strongly with final rank. Any bottom-rank read in this cycle partly reflects volume, not quality.",
    });
  }

  if (!args.eligibility.githubLogin) {
    out.push({
      kind: "missing_github",
      note:
        "No GitHub mapping — every activity signal (PRs, commits, lines) is silently absent from the score.",
    });
  }

  if (
    !args.eligibility.hasImpactModelRow &&
    args.eligibility.tenureDays !== null &&
    args.eligibility.tenureDays < HR_FIRST_YEAR_DAYS
  ) {
    out.push({
      kind: "first_year_no_impact_row",
      note: `First-year employee (tenure ${args.eligibility.tenureDays}d) and not in the impact-model training set. The SHAP lens is silent for this engineer in this cycle.`,
    });
  } else if (!args.eligibility.hasImpactModelRow) {
    out.push({
      kind: "missing_impact_model",
      note:
        "Not in the impact-model training set — the SHAP lens is silent for this engineer.",
    });
  }

  if (!args.hasPriorSnapshot) {
    out.push({
      kind: "no_prior_snapshot",
      note:
        "No comparable prior snapshot for this engineer — this is our first cycle with a rank to compare against.",
    });
  }

  return out;
}

/**
 * Compute the dominant negative-driver method. Returns the method whose
 * `topNegativeDrivers` contributes the largest absolute `approxCompositeLift`.
 * `null` when no drivers present or all lifts null.
 */
function dominantNegativeMethod(
  attribution: EngineerAttribution,
): CompositeMethod | null {
  let bestMethod: CompositeMethod | null = null;
  let bestLift = 0;
  for (const driver of attribution.topNegativeDrivers) {
    if (driver.approxCompositeLift === null) continue;
    const abs = Math.abs(driver.approxCompositeLift);
    if (abs > bestLift) {
      bestLift = abs;
      bestMethod = driver.method;
    }
  }
  return bestMethod;
}

function buildMethodBreakdown(
  attribution: EngineerAttribution,
): HrMethodScore[] {
  return attribution.methods.map((m) => ({
    method: m.method,
    label: m.label,
    percentile: m.score,
    present: m.present,
    absenceReason: m.presentReason,
  }));
}

function findPriorMover(
  emailHash: string,
  movers: EngineeringRankingSnapshot["movers"],
): MoverEntry | null {
  if (movers.status !== "ok") return null;
  const pools: readonly MoverEntry[][] = [
    movers.fallers,
    movers.risers,
    movers.newEntrants,
    movers.cohortExits,
  ];
  for (const pool of pools) {
    const hit = pool.find((m) => m.emailHash === emailHash);
    if (hit) return hit;
  }
  return null;
}

/** Arithmetic mean of a nullable-number array; null when no values present. */
function mean(values: readonly (number | null)[]): number | null {
  const nums: number[] = [];
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) nums.push(v);
  }
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Build the last-30-days PR activity block for one engineer. `activity30d`
 * is the 30-day GitHub-activity map; `analyses30d` is the 30-day subset of
 * the rubric analyses. Cohort context (`cohortPrsMerged`, quality mean) is
 * computed across the full competitive roster so the reader can anchor the
 * engineer's numbers against a defensible median.
 */
function buildRecentPrActivity(args: {
  githubLogin: string | null;
  emailHash: string;
  activity30d: Map<
    string,
    {
      prCount: number;
      commitCount: number;
      additions: number;
      deletions: number;
    }
  >;
  analyses30d: readonly PrReviewAnalysisInput[];
  competitiveHashes: ReadonlySet<string>;
  loginByHash: Map<string, string | null>;
}): HrRecentPrActivity {
  const activity = args.githubLogin
    ? args.activity30d.get(args.githubLogin)
    : undefined;
  const prsMerged = activity?.prCount ?? 0;
  const commitCount = activity?.commitCount ?? 0;
  const netLines =
    activity === undefined ? 0 : activity.additions - activity.deletions;

  const analysed = args.analyses30d.filter(
    (a) => a.emailHash === args.emailHash,
  );
  const revertCount = analysed.filter((a) => a.revertWithin14d).length;

  const complexityMean = mean(analysed.map((a) => a.technicalDifficulty));
  const executionQualityMean = mean(analysed.map((a) => a.executionQuality));
  const testAdequacyMean = mean(analysed.map((a) => a.testAdequacy));
  const riskHandlingMean = mean(analysed.map((a) => a.riskHandling));
  const reviewabilityMean = mean(analysed.map((a) => a.reviewability));

  // Cohort PR count in 30d window — aggregate across competitive logins.
  const cohortPrValues: number[] = [];
  for (const hash of args.competitiveHashes) {
    const login = args.loginByHash.get(hash);
    if (!login) continue;
    const row = args.activity30d.get(login);
    // We include zero-activity engineers: the absence of PRs *is* a data
    // point and skipping zeros would bias the cohort median upward.
    cohortPrValues.push(row?.prCount ?? 0);
  }
  const cohortPrsMerged = medianOf(cohortPrValues);

  // Cohort execution-quality mean across competitive engineers' analyses.
  const cohortQualityMeansPerEngineer: number[] = [];
  const analysesByHash = new Map<string, PrReviewAnalysisInput[]>();
  for (const a of args.analyses30d) {
    const bucket = analysesByHash.get(a.emailHash);
    if (bucket) bucket.push(a);
    else analysesByHash.set(a.emailHash, [a]);
  }
  for (const hash of args.competitiveHashes) {
    const rows = analysesByHash.get(hash) ?? [];
    const m = mean(rows.map((r) => r.executionQuality));
    if (m !== null) cohortQualityMeansPerEngineer.push(m);
  }
  const cohortExecutionQualityMean = medianOf(cohortQualityMeansPerEngineer);

  // Narrative is deterministic and purposefully bland so comparisons across
  // engineers don't gain rhetorical weight from varied phrasing.
  const parts: string[] = [];
  parts.push(`Last 30 days: ${prsMerged} PR${prsMerged === 1 ? "" : "s"} merged, ${commitCount} commits, ${netLines.toLocaleString("en-GB")} net lines.`);
  if (cohortPrsMerged !== null) {
    parts.push(`Cohort median PRs: ${cohortPrsMerged.toFixed(1)}.`);
  }
  if (analysed.length > 0) {
    const cmp =
      complexityMean !== null ? complexityMean.toFixed(1) : "—";
    const q =
      executionQualityMean !== null ? executionQualityMean.toFixed(1) : "—";
    parts.push(`${analysed.length} PR${analysed.length === 1 ? "" : "s"} analysed — complexity ${cmp}/5, execution quality ${q}/5.`);
    if (cohortExecutionQualityMean !== null) {
      parts.push(`Cohort median execution quality: ${cohortExecutionQualityMean.toFixed(1)}/5.`);
    }
    if (revertCount > 0) {
      parts.push(`${revertCount} reverted within 14d.`);
    }
  } else if (prsMerged > 0) {
    parts.push(`No PRs in the 30-day window were analysed by the rubric — complexity/quality not available.`);
  } else {
    parts.push(`No PRs merged in the 30-day window.`);
  }

  return {
    windowDays: 30,
    prsMerged,
    commitCount,
    netLines,
    analysedPrCount: analysed.length,
    complexityMean,
    executionQualityMean,
    testAdequacyMean,
    riskHandlingMean,
    reviewabilityMean,
    revertCount,
    cohortPrsMerged,
    cohortExecutionQualityMean,
    narrative: parts.join(" "),
  };
}

/**
 * Build the historical performance review block for one engineer. Empty
 * state is explicit: when no ratings exist for this email, we still return
 * the block with `hasHistory: false` and a plain-English note — so the HR
 * section never silently omits the block when we simply don't have data.
 */
function buildPerformanceHistory(args: {
  email: string;
  performanceByEmail: Map<string, readonly PerformanceRating[]>;
}): HrPerformanceHistory {
  const ratings = args.performanceByEmail.get(args.email.toLowerCase()) ?? [];
  if (ratings.length === 0) {
    return {
      hasHistory: false,
      ratings: [],
      averageRating: null,
      flaggedCycleCount: 0,
      missedCycleCount: 0,
      latestRating: null,
      latestCycle: null,
      narrative:
        "No historical performance ratings found for this engineer in the synced review cycles.",
    };
  }
  // Cycles are lexicographically sortable (e.g. "2026 H1-A").
  const sorted = [...ratings].sort((a, b) =>
    a.reviewCycle.localeCompare(b.reviewCycle),
  );
  const rated = sorted.filter((r) => r.rating !== null) as Array<
    PerformanceRating & { rating: number }
  >;
  const averageRating =
    rated.length === 0 ? null : mean(rated.map((r) => r.rating));
  const flaggedCycleCount = sorted.filter((r) => r.flagged).length;
  const missedCycleCount = sorted.filter((r) => r.missed).length;
  const latest = sorted[sorted.length - 1];

  const parts: string[] = [];
  parts.push(`${sorted.length} review cycle${sorted.length === 1 ? "" : "s"} on record.`);
  if (averageRating !== null) {
    parts.push(`Average rating: ${averageRating.toFixed(1)}/5 across ${rated.length} rated cycle${rated.length === 1 ? "" : "s"}.`);
  }
  if (latest.rating !== null) {
    parts.push(`Most recent (${latest.reviewCycle}): ${latest.rating}/5.`);
  } else if (latest.missed) {
    parts.push(`Most recent (${latest.reviewCycle}): missed.`);
  }
  if (flaggedCycleCount > 0) {
    parts.push(`${flaggedCycleCount} cycle${flaggedCycleCount === 1 ? "" : "s"} flagged by reviewer.`);
  }
  if (missedCycleCount > 0) {
    parts.push(`${missedCycleCount} cycle${missedCycleCount === 1 ? "" : "s"} missed.`);
  }

  return {
    hasHistory: true,
    ratings: sorted,
    averageRating,
    flaggedCycleCount,
    missedCycleCount,
    latestRating: latest.rating,
    latestCycle: latest.reviewCycle,
    narrative: parts.join(" "),
  };
}

function buildHistorical(
  emailHash: string,
  movers: EngineeringRankingSnapshot["movers"],
): HrHistorical {
  const prior = findPriorMover(emailHash, movers);
  const priorSnapshotDate = movers.priorSnapshot?.snapshotDate ?? null;

  if (!prior || prior.priorRank === null) {
    return {
      hasPriorSnapshot: false,
      priorRank: null,
      priorCompositePercentile: null,
      priorSnapshotDate,
      moverCauseKind: null,
      moverNarrative: null,
      priorWasBottom15: false,
    };
  }

  const priorPct = prior.priorCompositePercentile;
  return {
    hasPriorSnapshot: true,
    priorRank: prior.priorRank,
    priorCompositePercentile: priorPct,
    priorSnapshotDate,
    moverCauseKind: prior.causeKind,
    moverNarrative: prior.likelyCause,
    priorWasBottom15: priorPct !== null && priorPct <= HR_SUSTAINED_PERCENTILE,
  };
}

const HEADER_WARNING =
  "This section is decision support for manager-calibration conversations, not an adjudication of performance. Rankings reflect only the signals we persist (GitHub activity, SHAP impact, squad delivery context, LLM code-quality review, tenure/role normalisation). A `sustained_concern` verdict is a trigger to have a conversation with the engineer's direct manager about what the data cannot see — not a basis for performance action. Nothing in this pack should be used in isolation to support a dismissal decision.";

/**
 * Build the HR evidence pack from a ranking snapshot. Pure — no I/O, no
 * fetches. The snapshot's own `composite.ranked` is already in ascending
 * rank order (1 = best), so the bottom N is the last slice. Engineers
 * without a composite entry are excluded from the ranked pool by
 * construction and therefore cannot appear in the pack.
 */
export function buildHrEvidencePack(
  snapshot: EngineeringRankingSnapshot,
  options?: {
    bottomN?: number;
    signals?: readonly PerEngineerSignalRow[];
    /**
     * Slack member rows; joined on `employeeEmail`. Entries with null
     * `employeeEmail` are dropped silently — they are Slack accounts not
     * mapped to a Mode SSoT employee.
     */
    slackRows?: readonly SlackMemberRow[];
    /**
     * Last-30-days GitHub activity per author login. Same shape as the
     * 180-day map used by the ranking itself.
     */
    recent30dByLogin?: Map<
      string,
      {
        prCount: number;
        commitCount: number;
        additions: number;
        deletions: number;
      }
    >;
    /**
     * PR review analyses merged in the last 30 days, already hashed. Drives
     * complexity / execution quality / revert counts for the recent window.
     */
    recent30dAnalyses?: readonly PrReviewAnalysisInput[];
    /**
     * Historical performance review ratings keyed by lowercased email.
     */
    performanceByEmail?: Map<string, readonly PerformanceRating[]>;
  },
): HrEvidencePack {
  const bottomN = Math.max(1, Math.floor(options?.bottomN ?? HR_BOTTOM_N_DEFAULT));
  const signalsInput = options?.signals ?? [];
  const slackRows = options?.slackRows ?? [];
  const recent30dByLogin = options?.recent30dByLogin ?? new Map();
  const recent30dAnalyses = options?.recent30dAnalyses ?? [];
  const performanceByEmail: Map<string, readonly PerformanceRating[]> =
    options?.performanceByEmail ?? new Map();

  const emptyCounts: Record<HrVerdict, number> = {
    insufficient_history: 0,
    activity_only: 0,
    confounded: 0,
    quality_concern: 0,
    sustained_concern: 0,
    single_cycle_only: 0,
  };

  const basePack: Omit<HrEvidencePack, "engineers" | "cohortNotes" | "verdictCounts"> = {
    bottomN,
    totalScored: snapshot.composite.ranked.length,
    cohortDominanceBlocked: snapshot.composite.dominanceBlocked,
    generatedAt: snapshot.generatedAt,
    signalWindow: snapshot.signalWindow,
    currentSnapshotDate: snapshot.movers.currentSnapshot.snapshotDate,
    methodologyVersion: snapshot.methodologyVersion,
    priorSnapshotDate: snapshot.movers.priorSnapshot?.snapshotDate ?? null,
    headerWarning: HEADER_WARNING,
  };

  const cohortNotes: string[] = [];
  if (snapshot.composite.dominanceBlocked) {
    cohortNotes.push(
      "Cohort composite is dominance-blocked. Every bottom-rank verdict in this cycle is `activity_only` — low rank partly reflects low volume rather than low quality. No verdict in this cycle should drive action.",
    );
  }
  if (snapshot.movers.status !== "ok") {
    cohortNotes.push(
      `No comparable prior snapshot available (${snapshot.movers.status}). Every verdict falls back to "insufficient_history" — we need a second comparable snapshot before we can distinguish single-cycle dips from sustained patterns.`,
    );
  }

  if (snapshot.composite.ranked.length === 0) {
    cohortNotes.push(
      "No engineers currently scored — the composite has not produced a rank yet. The HR pack is empty by construction until the ranking itself is populated.",
    );
    return {
      ...basePack,
      engineers: [],
      cohortNotes,
      verdictCounts: emptyCounts,
    };
  }

  const ranked = snapshot.composite.ranked;
  const totalScored = ranked.length;
  const bottomSlice = ranked.slice(-bottomN);
  const eligibilityByHash = new Map(
    snapshot.eligibility.entries.map((e) => [e.emailHash, e]),
  );
  const attributionByHash = new Map(
    snapshot.attribution.entries.map((a) => [a.emailHash, a]),
  );
  const confidenceByHash = new Map(
    snapshot.confidence.entries.map((c) => [c.emailHash, c]),
  );

  // Build a per-engineer view of whether the tie group includes anyone
  // outside the bottom decile. "Bottom decile" here is the bottom 10% of
  // scored engineers, floored at 1 — so a cohort of 30 has a bottom-decile
  // cutoff of rank 27. Tie-group members above this rank count as "outside
  // the bottom decile" and turn the verdict into `confounded`.
  const bottomDecileCutoffRank =
    totalScored - Math.max(1, Math.floor(totalScored * 0.1)) + 1;
  const rankByHash = new Map<string, number>();
  for (const entry of ranked) {
    if (entry.rank !== null) rankByHash.set(entry.emailHash, entry.rank);
  }

  // Signal-row lookup + discipline map for the contrast table. We restrict the
  // cohort used for contrast to COMPETITIVE engineers (ramp-up, leavers, and
  // non-rankable roles would distort the comparison) — the eligibility entry
  // itself tells us who qualifies.
  const competitiveHashes = new Set(
    snapshot.eligibility.entries
      .filter((e) => e.eligibility === "competitive")
      .map((e) => e.emailHash),
  );
  const disciplineByHash = new Map<string, string>();
  const emailByHash = new Map<string, string>();
  const loginByHash = new Map<string, string | null>();
  for (const e of snapshot.eligibility.entries) {
    disciplineByHash.set(e.emailHash, String(e.discipline));
    emailByHash.set(e.emailHash, e.email.toLowerCase());
    loginByHash.set(e.emailHash, e.githubLogin);
  }

  // Slack member lookup keyed on the (lowercased) employee email. Rows
  // without an `employeeEmail` are dropped because we cannot join them to
  // the SSoT engineer list.
  const slackByEmail = new Map<string, SlackMemberRow>();
  for (const row of slackRows) {
    if (!row.employeeEmail) continue;
    slackByEmail.set(row.employeeEmail.toLowerCase(), row);
  }

  // Raw GitHub/impact signals keyed by hash — used to enrich each rich row.
  const rawSignalsByHash = new Map<string, PerEngineerSignalRow>();
  for (const row of signalsInput) {
    rawSignalsByHash.set(row.emailHash, row);
  }

  /**
   * Build the enriched HR signal row for one engineer — merges the pure
   * `PerEngineerSignalRow` fields with Slack engagement fields joined by
   * email. Null-on-miss for every field so missingness propagates through
   * to the contrast table rather than being implicitly zero.
   */
  const buildRichSignalRow = (hash: string): HrRichSignalRow => {
    const signalRow = rawSignalsByHash.get(hash);
    const email = emailByHash.get(hash);
    const slack = email ? slackByEmail.get(email) ?? null : null;
    const slackMsgs = slack?.msgsPerCalendarDay ?? null;
    const slackReacts = slack?.reactionsPerCalendarDay ?? null;
    const slackEngagement =
      slack && Number.isFinite(slack.engagementScore)
        ? slack.engagementScore
        : null;
    const slackDaysInactive =
      slack?.daysSinceLastActive !== undefined
        ? slack.daysSinceLastActive
        : null;
    return {
      emailHash: hash,
      prCount: signalRow?.prCount ?? null,
      commitCount: signalRow?.commitCount ?? null,
      additions: signalRow?.additions ?? null,
      deletions: signalRow?.deletions ?? null,
      shapPredicted: signalRow?.shapPredicted ?? null,
      shapActual: signalRow?.shapActual ?? null,
      shapResidual: signalRow?.shapResidual ?? null,
      aiTokens: signalRow?.aiTokens ?? null,
      aiSpend: signalRow?.aiSpend ?? null,
      squadCycleTimeHours: signalRow?.squadCycleTimeHours ?? null,
      squadReviewRatePercent: signalRow?.squadReviewRatePercent ?? null,
      squadTimeToFirstReviewHours:
        signalRow?.squadTimeToFirstReviewHours ?? null,
      squadPrsInProgress: signalRow?.squadPrsInProgress ?? null,
      slackMsgsPerDay: slackMsgs,
      slackReactionsPerDay: slackReacts,
      slackEngagementScore: slackEngagement,
      slackDaysSinceLastActive: slackDaysInactive,
    };
  };

  const richSignalsByHash = new Map<string, HrRichSignalRow>();
  const competitiveRichSignals: HrRichSignalRow[] = [];
  // Build rich rows for every hash we've seen — including those with no
  // PerEngineerSignalRow, so Slack-only rows still land in the cohort.
  for (const hash of emailByHash.keys()) {
    const rich = buildRichSignalRow(hash);
    richSignalsByHash.set(hash, rich);
    if (competitiveHashes.has(hash)) competitiveRichSignals.push(rich);
  }

  const verdictCounts: Record<HrVerdict, number> = { ...emptyCounts };
  const engineers: HrEngineerEvidence[] = [];

  for (const rankedEntry of bottomSlice) {
    const eligibility = eligibilityByHash.get(rankedEntry.emailHash);
    const attribution = attributionByHash.get(rankedEntry.emailHash);
    const confidence = confidenceByHash.get(rankedEntry.emailHash);
    if (!eligibility || !attribution || !confidence) {
      // A ranked engineer must appear in all three bundles — the snapshot
      // builder invariant. If not, skip defensively rather than render an
      // incomplete row.
      continue;
    }

    const historical = buildHistorical(rankedEntry.emailHash, snapshot.movers);

    // Tie-group resolution: look up the engineer's tie group (if any), and
    // decide whether any sibling sits outside the bottom decile.
    const tieGroupMembers: string[] = [];
    let tieGroupWithOutsideBottom = false;
    if (confidence.inTieGroup && confidence.tieGroupId !== null) {
      const group = snapshot.confidence.tieGroups.find(
        (g) => g.groupId === confidence.tieGroupId,
      );
      if (group) {
        for (const member of group.members) {
          if (member.emailHash !== rankedEntry.emailHash) {
            tieGroupMembers.push(member.emailHash);
          }
          const memberRank = rankByHash.get(member.emailHash);
          if (memberRank !== undefined && memberRank < bottomDecileCutoffRank) {
            tieGroupWithOutsideBottom = true;
          }
        }
      }
    }

    const presentMethodCount = countPresentMethods(rankedEntry);
    const dominantNegMethod = dominantNegativeMethod(attribution);
    const qualityIsDominantNegative = dominantNegMethod === "quality";

    const { verdict, reason } = classifyHrVerdict({
      cohortDominanceBlocked: snapshot.composite.dominanceBlocked,
      hasPriorSnapshot: historical.hasPriorSnapshot,
      priorWasBottom15: historical.priorWasBottom15,
      tenureDays: eligibility.tenureDays,
      ciWidth: confidence.ciWidth,
      presentMethodCount,
      inTieGroupWithOutsideBottom: tieGroupWithOutsideBottom,
      hasGithubLogin: Boolean(eligibility.githubLogin),
      hasImpactModelRow: eligibility.hasImpactModelRow,
      qualityIsDominantNegative,
    });

    verdictCounts[verdict] += 1;

    // Build contrast rows per signal in the catalogue. A signal is skipped
    // entirely when the cohort has fewer than its minimum members — we never
    // narrate a gap against a cohort that is too small to anchor on.
    const contrasts: HrSignalContrast[] = [];
    for (const catalogueEntry of SIGNAL_CATALOGUE) {
      const row = buildContrastForSignal({
        entry: catalogueEntry,
        engineerHash: rankedEntry.emailHash,
        engineerDiscipline: String(eligibility.discipline),
        signalsByHash: richSignalsByHash,
        disciplineByHash,
        allCompetitiveSignals: competitiveRichSignals,
      });
      if (row) contrasts.push(row);
    }
    const contrastSummary = buildContrastSummary(contrasts, eligibility.displayName);

    const recentPrActivity = buildRecentPrActivity({
      githubLogin: eligibility.githubLogin,
      emailHash: rankedEntry.emailHash,
      activity30d: recent30dByLogin,
      analyses30d: recent30dAnalyses,
      competitiveHashes,
      loginByHash,
    });
    const performanceHistory = buildPerformanceHistory({
      email: eligibility.email,
      performanceByEmail,
    });

    engineers.push({
      emailHash: rankedEntry.emailHash,
      displayName: eligibility.displayName,
      email: eligibility.email,
      githubLogin: eligibility.githubLogin,
      githubPrSearchUrl: attribution.evidence.githubPrSearchUrl,
      manager: eligibility.manager,
      squad: rankedEntry.squad ?? eligibility.squad,
      pillar: rankedEntry.pillar ?? eligibility.pillar,
      levelLabel: eligibility.levelLabel,
      discipline: eligibility.discipline,
      tenureDays: eligibility.tenureDays,
      startDate: eligibility.startDate,
      rank: rankedEntry.rank,
      totalScored,
      compositeScore: rankedEntry.composite,
      compositePercentile: rankedEntry.compositePercentile,
      ciLowPercentile: confidence.ciLow,
      ciHighPercentile: confidence.ciHigh,
      ciWidth: confidence.ciWidth,
      inTieGroup: confidence.inTieGroup,
      tieGroupId: confidence.tieGroupId,
      tieGroupMemberHashes: tieGroupMembers,
      methodBreakdown: buildMethodBreakdown(attribution),
      topNegativeDrivers: attribution.topNegativeDrivers,
      concernLines: buildConcernLines(attribution),
      contrasts,
      contrastSummary,
      recentPrActivity,
      performanceHistory,
      confounders: buildConfounders({
        eligibility,
        confidence,
        attribution,
        tieGroupMembers,
        tieGroupWithOutsideBottom,
        cohortDominanceBlocked: snapshot.composite.dominanceBlocked,
        hasPriorSnapshot: historical.hasPriorSnapshot,
        presentMethodCount,
      }),
      historical,
      verdict,
      verdictReason: reason,
    });
  }

  // Order the pack lowest-rank first (the engineer at rank N, then N-1, ...)
  // so the reader sees the worst position at the top.
  engineers.reverse();

  return {
    ...basePack,
    engineers,
    cohortNotes,
    verdictCounts,
  };
}

/**
 * Pick quantiles from a sorted numeric array. Uses linear interpolation on a
 * 0..n-1 index; for n=1 we return the single value for every quantile.
 */
function quantileFromSorted(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * Compute one `HrCohortStats` summary for an already-extracted array of
 * non-null values. `cohortLabel` is carried onto the result so the reader can
 * see whether this is the whole cohort or a discipline cut.
 */
function computeCohortStats(
  values: readonly number[],
  cohortLabel: string,
): HrCohortStats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return {
      cohortLabel,
      cohortSize: 0,
      min: null,
      median: null,
      p75: null,
      p90: null,
      max: null,
      topDecileMean: null,
      topDecileCount: 0,
    };
  }
  const median = quantileFromSorted(sorted, 0.5);
  const p75 = quantileFromSorted(sorted, 0.75);
  const p90 = quantileFromSorted(sorted, 0.9);
  const topDecileCount = Math.max(1, Math.ceil(n * 0.1));
  const topSlice = sorted.slice(n - topDecileCount);
  const topDecileMean =
    topSlice.length === 0
      ? null
      : topSlice.reduce((a, b) => a + b, 0) / topSlice.length;
  return {
    cohortLabel,
    cohortSize: n,
    min: sorted[0],
    median,
    p75,
    p90,
    max: sorted[n - 1],
    topDecileMean,
    topDecileCount,
  };
}

/**
 * Rank-percentile (0..100, higher-is-better by the signal's semantic
 * direction) of `value` in the given sorted array. Returns null if
 * `value === null`. Uses the "strict below + half-ties" convention so a
 * value equal to the median comes out at ~50, not 0 or 100.
 */
function rankPercentileForValue(
  sorted: readonly number[],
  value: number,
  direction: HrSignalDirection,
): number {
  if (sorted.length === 0) return 0;
  let strictlyBelow = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) strictlyBelow += 1;
    else if (v === value) equal += 1;
  }
  const ranked = strictlyBelow + equal / 2;
  const pct = (ranked / sorted.length) * 100;
  return direction === "higher_is_better" ? pct : 100 - pct;
}

/** Formatter for a percentage-of-median fragment. */
function formatFraction(fraction: number | null): string | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  const pct = fraction * 100;
  if (pct < 1) return "<1% of";
  if (pct < 10) return `${pct.toFixed(1)}% of`;
  return `${Math.round(pct)}% of`;
}

/**
 * Render a non-negative integer as an English ordinal: 1→1st, 2→2nd, 3→3rd,
 * 11→11th, 21→21st, etc. The teen exceptions (11/12/13) all take "th".
 * Exported for the HR UI which also needs ordinals in the contrast table.
 */
export function formatOrdinal(n: number): string {
  const rounded = Math.round(n);
  const absLastTwo = Math.abs(rounded) % 100;
  const absLast = Math.abs(rounded) % 10;
  let suffix = "th";
  if (absLastTwo < 11 || absLastTwo > 13) {
    if (absLast === 1) suffix = "st";
    else if (absLast === 2) suffix = "nd";
    else if (absLast === 3) suffix = "rd";
  }
  return `${rounded}${suffix}`;
}

/**
 * Build the single-engineer narrative for one signal:
 * "Shipped 4 PRs in the window. Cohort median 23 (this engineer at 17% of
 *  median) · top-decile median 60 (7%). 12th percentile overall."
 * Kept deterministic and stitched from parts so the wording is identical
 * across engineers and the CEO can compare runs side by side.
 */
function buildContrastNarrative(args: {
  entry: SignalCatalogueEntry;
  engineerValue: number | null;
  cohort: HrCohortStats;
  disciplineCohort: HrCohortStats | null;
  engineerPercentile: number | null;
  fractionOfMedian: number | null;
  fractionOfTopDecile: number | null;
}): string {
  const {
    entry,
    engineerValue,
    cohort,
    disciplineCohort,
    engineerPercentile,
    fractionOfMedian,
    fractionOfTopDecile,
  } = args;

  if (engineerValue === null) {
    return `No ${entry.unitWord} recorded for this engineer in the window. Cohort median ${entry.format(cohort.median)} (n=${cohort.cohortSize}).`;
  }

  const valueCopy = `${entry.format(engineerValue)} ${entry.unitWord}`;
  const medianCopy =
    cohort.median === null
      ? null
      : `cohort median ${entry.format(cohort.median)} (n=${cohort.cohortSize})`;
  const topCopy =
    cohort.topDecileMean === null
      ? null
      : `top-decile mean ${entry.format(cohort.topDecileMean)}`;

  const fracMedianCopy = formatFraction(fractionOfMedian);
  const fracTopCopy = formatFraction(fractionOfTopDecile);

  const disciplineCopy =
    disciplineCohort && disciplineCohort.median !== null
      ? `Within ${disciplineCohort.cohortLabel} (n=${disciplineCohort.cohortSize}): median ${entry.format(disciplineCohort.median)}, top-decile mean ${entry.format(disciplineCohort.topDecileMean)}.`
      : null;

  const percentileCopy =
    engineerPercentile === null
      ? null
      : `${formatOrdinal(engineerPercentile)} percentile on this signal.`;

  const parts = [
    `${valueCopy}.`,
    medianCopy && fracMedianCopy
      ? `${medianCopy} — this engineer ${fracMedianCopy} median.`
      : medianCopy
        ? `${medianCopy}.`
        : null,
    topCopy && fracTopCopy
      ? `${topCopy} — this engineer ${fracTopCopy} top-decile.`
      : topCopy
        ? `${topCopy}.`
        : null,
    disciplineCopy,
    percentileCopy,
  ].filter((p): p is string => p !== null);

  return parts.join(" ");
}

/**
 * Extract values for one signal across a set of signal rows, dropping nulls.
 * Returns the raw array (unsorted) — callers sort where needed.
 */
function extractSignalValues(
  rows: readonly HrRichSignalRow[],
  accessor: (row: HrRichSignalRow) => number | null,
): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = accessor(row);
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Compute cohort + discipline-scoped stats and the per-engineer contrast row
 * for one signal. Returns `null` when the cohort is too small to narrate
 * responsibly (below the signal's `minCohortSize`).
 */
function buildContrastForSignal(args: {
  entry: SignalCatalogueEntry;
  engineerHash: string;
  engineerDiscipline: string;
  signalsByHash: Map<string, HrRichSignalRow>;
  disciplineByHash: Map<string, string>;
  allCompetitiveSignals: readonly HrRichSignalRow[];
}): HrSignalContrast | null {
  const {
    entry,
    engineerHash,
    engineerDiscipline,
    signalsByHash,
    disciplineByHash,
    allCompetitiveSignals,
  } = args;

  const cohortValues = extractSignalValues(
    allCompetitiveSignals,
    entry.accessor,
  );
  if (cohortValues.length < entry.minCohortSize) {
    return null;
  }
  const cohortStats = computeCohortStats(cohortValues, "whole cohort");

  const disciplineRows = allCompetitiveSignals.filter((r) => {
    const disc = disciplineByHash.get(r.emailHash);
    return disc === engineerDiscipline;
  });
  const disciplineValues = extractSignalValues(disciplineRows, entry.accessor);
  const disciplineStats =
    disciplineValues.length >= entry.minCohortSize
      ? computeCohortStats(disciplineValues, `${engineerDiscipline} discipline`)
      : null;

  const signal = signalsByHash.get(engineerHash);
  const engineerValue = signal ? entry.accessor(signal) : null;

  const narrationScope = disciplineStats ?? cohortStats;
  const narrationValues =
    narrationScope === disciplineStats ? disciplineValues : cohortValues;
  const engineerPercentile =
    engineerValue === null
      ? null
      : rankPercentileForValue(
          [...narrationValues].sort((a, b) => a - b),
          engineerValue,
          entry.direction,
        );

  const fractionOfMedian =
    engineerValue !== null && cohortStats.median !== null && cohortStats.median !== 0
      ? engineerValue / cohortStats.median
      : null;
  const fractionOfTopDecile =
    engineerValue !== null &&
    cohortStats.topDecileMean !== null &&
    cohortStats.topDecileMean !== 0
      ? engineerValue / cohortStats.topDecileMean
      : null;

  const narrative = buildContrastNarrative({
    entry,
    engineerValue,
    cohort: cohortStats,
    disciplineCohort: disciplineStats,
    engineerPercentile,
    fractionOfMedian,
    fractionOfTopDecile,
  });

  return {
    signal: entry.signal,
    label: entry.label,
    direction: entry.direction,
    engineerValue,
    engineerValueDisplay: entry.format(engineerValue),
    cohort: cohortStats,
    disciplineCohort: disciplineStats,
    engineerPercentile,
    fractionOfMedian,
    fractionOfTopDecile,
    narrative,
  };
}

/**
 * Stitch a single-paragraph summary from the three most informative contrasts
 * (by how far below the cohort median the engineer is). Keeps the HR pack's
 * lead sentence substantive even when a signal or two is absent.
 */
/**
 * `severity` ranks contrasts so the "most severe gaps" highlights list is
 * ordered by how much the engineer under-performs the cohort median —
 * smaller score = more severe. Nulls go to the end.
 *
 * For higher-is-better signals, fractionOfMedian itself measures severity
 * (0.05 = 5% of median is worse than 0.5 = 50% of median). For lower-is-
 * better signals, we invert so a "3x the median" latency is more severe
 * than "1.5x the median".
 */
function contrastSeverity(c: HrSignalContrast): number {
  if (c.fractionOfMedian === null) return Number.POSITIVE_INFINITY;
  return c.direction === "higher_is_better"
    ? c.fractionOfMedian
    : 1 / Math.max(c.fractionOfMedian, 1e-9);
}

/**
 * A contrast is "below median" when the engineer is worse than the cohort
 * median on that signal — direction-aware. A null fraction never counts as
 * below because we can't say.
 */
function isBelowMedian(c: HrSignalContrast): boolean {
  if (c.fractionOfMedian === null) return false;
  return c.direction === "higher_is_better"
    ? c.fractionOfMedian < 1
    : c.fractionOfMedian > 1;
}

/**
 * A contrast is "bottom decile" when the engineer's percentile is ≤ 10.
 * The percentile field is already direction-aware (higher = better).
 */
function isBottomDecile(c: HrSignalContrast): boolean {
  return c.engineerPercentile !== null && c.engineerPercentile <= 10;
}

function toHighlight(c: HrSignalContrast): HrContrastHighlight {
  const fracMed = formatFraction(c.fractionOfMedian);
  const fracTop = formatFraction(c.fractionOfTopDecile);
  return {
    signal: c.signal,
    label: c.label,
    engineerValueDisplay: c.engineerValueDisplay,
    cohortMedianDisplay:
      c.cohort.median === null
        ? null
        : `${numberDisplay(c.cohort.median)} (cohort median, n=${c.cohort.cohortSize})`,
    cohortTopDecileDisplay:
      c.cohort.topDecileMean === null
        ? null
        : `${numberDisplay(c.cohort.topDecileMean)} (top-decile mean)`,
    fractionOfMedianDisplay:
      fracMed === null ? null : fracMed.replace(" of", " of median"),
    fractionOfTopDecileDisplay:
      fracTop === null ? null : fracTop.replace(" of", " of top-decile"),
    percentileOrdinalDisplay:
      c.engineerPercentile === null
        ? null
        : `${formatOrdinal(c.engineerPercentile)} percentile`,
  };
}

/**
 * Compact numeric display used inside the highlights. We keep this tight so
 * a highlight line reads clearly: "50" not "50.0000", "1,234" for thousands.
 */
function numberDisplay(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) {
    return v.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  }
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

/**
 * Build the structured contrast summary shown above the detail table. This
 * replaces an earlier prose narrative that was hard for a reader to scan:
 * the table already carries the numbers, so the summary's job is to tell
 * the reader *breadth* (how many signals) and *where to look first* (which
 * three signals are the most severe).
 */
function buildContrastSummary(
  contrasts: readonly HrSignalContrast[],
  displayName: string,
): HrContrastSummary {
  if (contrasts.length === 0) {
    return {
      headline: `No raw-signal contrast could be computed for ${displayName} in this cycle — the cohort is too small on every tracked signal.`,
      belowMedianCount: 0,
      bottomDecileCount: 0,
      totalSignals: 0,
      highlights: [],
    };
  }
  const total = contrasts.length;
  const below = contrasts.filter(isBelowMedian).length;
  const bottomDecile = contrasts.filter(isBottomDecile).length;

  const sortedBySeverity = [...contrasts].sort(
    (a, b) => contrastSeverity(a) - contrastSeverity(b),
  );
  const top3 = sortedBySeverity.slice(0, 3);

  let headline: string;
  if (below === 0) {
    headline = `No signals below cohort median across ${total} tracked — the ranking gap is not driven by activity volume or engagement.`;
  } else if (bottomDecile === 0) {
    headline = `Below cohort median on ${below} of ${total} signals; none in the bottom decile. Most severe gaps listed below.`;
  } else {
    headline = `Below cohort median on ${below} of ${total} signals, with ${bottomDecile} in the bottom decile. Most severe gaps listed below.`;
  }

  return {
    headline,
    belowMedianCount: below,
    bottomDecileCount: bottomDecile,
    totalSignals: total,
    highlights: top3.map(toHighlight),
  };
}

function countPresentMethods(entry: EngineerCompositeEntry): number {
  const methodValues: Array<number | null> = [
    entry.output,
    entry.impact,
    entry.delivery,
    entry.quality,
    entry.adjusted,
  ];
  return methodValues.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  ).length;
}

// Also export a helper for downstream formatting (used by the HR section).
export { formatCi, formatPercentile };
