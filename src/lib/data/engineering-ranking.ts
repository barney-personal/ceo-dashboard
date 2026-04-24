/**
 * Engineering ranking data loader (pure).
 *
 * This file holds the methodology-first data contract for the ranking page.
 * The loader remains deliberately pure — it owns types, the email-hash
 * convention, and the `buildEligibleRoster` preflight. Server-side fetching
 * (Mode headcount, GitHub employee map, etc.) lives in
 * `engineering-ranking.server.ts` so the page picks up real data while unit
 * tests can exercise the ranking math against fixtures without booting the
 * database.
 *
 * Downstream callers must treat the current composite as an evidence rank,
 * not a final adjudication: the stability check is still pending until
 * `EngineeringRankingSnapshot.status === "ready"`. Confidence bands and
 * statistical-tie groups (M14) are live and travel on the snapshot via
 * `confidence`. Per-engineer attribution drilldowns (M15) are live and
 * travel on the snapshot via `attribution`. Privacy-preserving ranking
 * snapshot persistence (M16) is live via `buildRankingSnapshotRows` +
 * `engineeringRankingSnapshots` — rows carry only the email hash, never
 * display name, email, manager, or resolved GitHub login. Movers view (M18)
 * is live and travels on the snapshot via `movers`. Methodology panel,
 * anti-gaming audit, freshness badges, and manager-calibration stub (M21)
 * are live and travel on the snapshot via `methodology`.
 */

import { createHash } from "node:crypto";

/**
 * Methodology version stamped onto every snapshot. Bump this whenever the
 * ranking math changes in a way that makes new snapshots incomparable with
 * older ones — the M16 snapshot table and M17 movers view both use this
 * field to refuse cross-methodology comparisons.
 *
 * Version history:
 * - `0.1.0-scaffold` — M1-M6 scaffold and eligibility preflight only; no
 *   engineers ever materialised into `snapshot.engineers`.
 * - `0.5.0-composite` — M12 composite is live. `buildRankingSnapshot()`
 *   populates ranked engineers as the median of four methods (A output,
 *   B SHAP impact, C squad delivery, tenure/role-adjusted). Confidence,
 *   attribution, snapshots, movers, anti-gaming, and stability are still
 *   pending, so the snapshot `status` stays `methodology_pending`.
 * - `0.6.0-confidence` — M14 confidence bands are live. Every scored
 *   engineer carries an 80% bootstrap CI in composite-percentile and rank
 *   space, statistical-tie groups are emitted when neighbouring bands
 *   overlap, and dominance-blocked snapshots widen sigmas globally so the
 *   page does not narrate precise rank certainty when the composite has
 *   collapsed into activity volume. Snapshot `status` still stays
 *   `methodology_pending` until attribution, snapshots, movers, anti-gaming,
 *   and stability also land.
 * - `0.7.0-attribution` — M15 per-engineer attribution is live. Every
 *   competitive engineer carries a visible per-method component breakdown,
 *   top positive/negative drivers, a composite reconciliation check, a
 *   discipline-cohort peer comparison, an evidence block (GitHub login,
 *   PR-search URL for the window, impact-model presence), and
 *   manager/squad/pillar context. Absent signals are labelled with a reason
 *   rather than implied by omission, so every ranked position can be
 *   defended from visible contributions. Snapshot `status` still stays
 *   `methodology_pending` until snapshots, movers, anti-gaming, and
 *   stability also land.
 * - `0.8.0-snapshots` — M16 privacy-preserving ranking snapshot persistence
 *   is live. `buildRankingSnapshotRows` produces plain POJO rows keyed on
 *   (snapshotDate, methodologyVersion, emailHash); the Drizzle table
 *   `engineeringRankingSnapshots` stores only the email hash, methodology
 *   metadata, composite + method scores, confidence CI, an `inputHash` for
 *   M18 movers to distinguish input drift from methodology drift, and a
 *   narrow non-identifying metadata jsonb. Display name, email, manager,
 *   and resolved GitHub login are never persisted. Methodology bumps
 *   produce a parallel snapshot slice so M18 movers compare like-for-like.
 *   Snapshot `status` still stays `methodology_pending` until movers,
 *   anti-gaming, and stability also land.
 * - `0.9.0-movers` — M18 movers view is live. `buildMovers` diffs the
 *   current snapshot against the most recent prior snapshot at least
 *   `RANKING_MOVERS_MIN_GAP_DAYS` calendar days old, preferring the same
 *   methodology version. Cause narration is conservative: methodology
 *   mismatches produce `methodology_change` for every row; cohort
 *   entrants/exits are categorised separately so new hires, leavers, and
 *   newly-scored engineers are never narrated as ordinary rank movement;
 *   unchanged `inputHash` with rank movement is `ambiguous_context`
 *   rather than methodology noise because tenure/discipline/manager/squad
 *   and normalisation-cohort transitions are not encoded in the hash.
 *   Snapshot `status` still stays `methodology_pending` until the
 *   methodology panel / anti-gaming audit and the stability check also land.
 * - `1.0.0-methodology` — M21 methodology panel, anti-gaming audit,
 *   freshness badges, and manager-calibration stub are live. Every signal
 *   the ranking touches carries an explicit anti-gaming row (gaming path,
 *   mitigation, residual weakness, down-weight posture). Freshness badges
 *   surface the impact-model training date, signal window, per-source
 *   windows, AI latest-month vs 180-day GitHub/Swarmia windows, Mode
 *   headcount sync timestamp when available, and the rubric version as
 *   "not available" until `prReviewAnalyses` lands. Every engineer's
 *   attribution drilldown carries a manager-calibration stub (manager
 *   email hash, direct-report list, `not_requested` status) so a later
 *   manager-feedback loop can validate directs without changing the
 *   ranking core. Snapshot `status` stays `methodology_pending` until the
 *   stability check (M22) also lands.
 */
export const RANKING_METHODOLOGY_VERSION = "1.0.0-methodology" as const;

/** Signals are audited over the last six months by default. */
export const RANKING_SIGNAL_WINDOW_DAYS = 180 as const;

/**
 * Spearman |rho| at or above this threshold is treated as redundant — the
 * two signals are moving in lock-step and using both would double-count.
 * 0.85 is deliberately strict so near-duplicate signals don't sneak through.
 */
export const RANKING_REDUNDANT_RHO_THRESHOLD = 0.85 as const;

/**
 * Below this number of paired non-null observations a correlation is too
 * weakly supported to draw a redundancy conclusion from. Pairs below this
 * count surface on `underSampledPairs` instead of `redundantPairs`, so the
 * page distinguishes "truly redundant" from "we just haven't seen them
 * overlap enough times".
 */
export const RANKING_MIN_OVERLAP_SAMPLES = 8 as const;

/** Approximate days-per-month used for tenure conversion. */
const DAYS_PER_MONTH = 30.4375 as const;

/** High-level state machine for the ranking page. */
export type RankingStatus =
  | "methodology_pending"
  | "insufficient_data"
  | "ready";

export type EligibilityStatus =
  | "competitive"
  | "ramp_up"
  | "insufficient_mapping"
  | "inactive_or_leaver"
  | "missing_required_data";

export type Discipline =
  | "BE"
  | "FE"
  | "EM"
  | "QA"
  | "ML"
  | "Ops"
  | "Other";

/**
 * Days below which an engineer is routed to the Ramp-up cohort rather than
 * competitive ranking. Exported so the UI can render the threshold verbatim.
 */
export const RANKING_RAMP_UP_DAYS = 90 as const;

/**
 * Per-engineer ranking entry. Populated by `buildRankingSnapshot()` from the
 * M12 composite for every competitive engineer with at least
 * `RANKING_COMPOSITE_MIN_METHODS` present scoring methods, sorted ascending
 * by composite rank. Engineers below that threshold remain visible in
 * `eligibility.entries` and `composite.entries` but are deliberately absent
 * from this array so a reader never confuses "in the roster" with "ranked".
 */
export interface EngineerRankingEntry {
  emailHash: string;
  displayName: string;
  rank: number | null;
  compositeScore: number | null;
  adjustedPercentile: number | null;
  rawPercentile: number | null;
  eligibility: EligibilityStatus;
  confidence: {
    low: number;
    high: number;
  } | null;
}

/**
 * Canonical squad metadata sourced from the `squads` registry at request
 * time. Attached to an eligibility entry only when the server loader
 * actually fetched the registry and the engineer's squad name matches.
 *
 * `channelId` is included so the page's "Slack channel joined at request
 * time" provenance claim is truthful — the field must actually travel from
 * the registry through the snapshot to the page. A null value means the
 * matched squad row has no channel configured, not that the join failed.
 */
export interface CanonicalSquadMetadata {
  name: string;
  pillar: string;
  pmName: string | null;
  channelId: string | null;
}

/**
 * Eligibility-preflight entry. One row per engineer in the headcount spine,
 * with a visible reason for their eligibility status. All fields are resolved
 * at request time — this shape is never persisted, so display name, email and
 * manager are safe to carry here.
 */
export interface EligibilityEntry {
  emailHash: string;
  displayName: string;
  email: string;
  githubLogin: string | null;
  discipline: Discipline;
  levelLabel: string;
  squad: string | null;
  pillar: string;
  /**
   * Squad metadata joined from the `squads` registry. `null` when the
   * registry was not supplied to the preflight or the engineer's squad
   * name does not match a registry row. This is the only field that
   * legitimately carries canonical squad name, pillar, and PM — Mode
   * headcount owns only the raw `hb_squad` label on `squad`.
   */
  canonicalSquad: CanonicalSquadMetadata | null;
  /** Manager email/name as surfaced on the headcount row. */
  manager: string | null;
  startDate: string | null;
  tenureDays: number | null;
  isLeaverOrInactive: boolean;
  hasImpactModelRow: boolean;
  eligibility: EligibilityStatus;
  /** Human-readable explanation of the eligibility status. */
  reason: string;
}

export interface EligibilityCoverage {
  totalEngineers: number;
  competitive: number;
  rampUp: number;
  insufficientMapping: number;
  inactiveOrLeaver: number;
  missingRequiredData: number;
  mappedToGitHub: number;
  presentInImpactModel: number;
  /**
   * Headcount rows whose `start_date` is in the future relative to the
   * snapshot `now`. Excluded from `entries` and `totalEngineers` so the
   * active-roster count mirrors Mode's `selectModeFteActive` policy.
   * Surfaced in coverage so the preflight is transparent about
   * exclusions.
   */
  excludedFutureStart: number;
  /**
   * Engineers whose `hb_squad` did not match a row in the `squads` registry
   * (including the case where the registry was not supplied). Useful when
   * the methodology panel wants to attribute any missing canonical squad
   * metadata to a concrete cause.
   */
  squadRegistryUnmatched: number;
  rampUpThresholdDays: number;
  /** True iff the squads registry was supplied to the preflight. */
  squadsRegistryPresent: boolean;
}

export interface EngineeringRankingSnapshot {
  status: RankingStatus;
  methodologyVersion: string;
  generatedAt: string;
  /** Inclusive UTC signal window used for the snapshot. */
  signalWindow: {
    start: string;
    end: string;
  };
  /** Engineers included in the ranking. Empty while `status !== "ready"`. */
  engineers: EngineerRankingEntry[];
  /** Eligibility preflight — always computed, even before scoring lands. */
  eligibility: {
    entries: EligibilityEntry[];
    coverage: EligibilityCoverage;
    /**
     * Human-readable provenance notes surfaced on the page so the reader can
     * see which source owns which field without reading the code.
     */
    sourceNotes: string[];
  };
  /** Signal inventory + orthogonality audit over the competitive cohort. */
  audit: SignalAudit;
  /**
   * Three independent scoring lenses (A output / B SHAP impact /
   * C squad-delivery context) plus the disagreement table that surfaces
   * engineers whose lenses most disagree with each other. Not a final
   * composite — the composite is synthesised in a later milestone once the
   * lenses are trusted and the M10 adjustments are applied on top.
   */
  lenses: LensesBundle;
  /**
   * Tenure and role normalisation layer over the competitive cohort:
   * discipline-partitioned percentiles (with documented pooling), level
   * residual percentiles (OLS fit of rawScore on level number), and
   * tenure/exposure-adjusted rates. Surfaces both `rawPercentile` and
   * `adjustedPercentile` for every engineer so the lift from normalisation
   * is visible, not implicit.
   */
  normalisation: NormalisationBundle;
  /**
   * Composite ranking (median of the four methods: A output, B impact,
   * C delivery, adjusted) plus effective-weight decomposition, leave-one-
   * method-out sensitivity, final-rank correlations against raw signals, and
   * the dominance warning state. Confidence bands sit on top of this
   * composite via the `confidence` bundle below.
   */
  composite: CompositeBundle;
  /**
   * Bootstrap 80% confidence bands and statistical-tie groups for every
   * scored engineer. Computed in composite-percentile and rank space so
   * the page can render bands visually next to the composite table and
   * label tied positions where the bands overlap. Sigmas widen with low PR
   * count, short tenure, missing impact-model rows, missing GitHub mapping,
   * lens disagreement, and a global dominance-blocked composite — so a
   * thin signal cohort never reads as a precise rank.
   */
  confidence: ConfidenceBundle;
  /**
   * Per-engineer attribution drilldown for every competitive engineer. Each
   * entry carries per-method component breakdowns, top positive/negative
   * drivers, a composite reconciliation check (so "the rank is median of
   * methods" is visible, not just a sort order), a discipline-cohort peer
   * comparison, an evidence block (GitHub login + PR-search URL, impact-model
   * presence, squad context), and manager/squad/pillar context. Absent
   * signals are labelled with a reason — the methodology never implies
   * availability by silent omission.
   */
  attribution: AttributionBundle;
  /**
   * Movers view: differences between this snapshot and the most recent
   * comparable prior snapshot (at least `RANKING_MOVERS_MIN_GAP_DAYS` days
   * old, preferring the same methodology version). Surfaces risers,
   * fallers, new entrants, and cohort exits with likely-cause narration
   * derived from persisted state alone — methodology version, scoring
   * `inputHash`, and cohort presence. The loader emits a helpful empty
   * state when no comparable prior snapshot exists.
   */
  movers: MoversBundle;
  /**
   * Methodology panel bundle (M21): a self-describing on-page description of
   * what this ranking actually does. Composes the already-computed lens
   * weights, composite rule, normalisation summary, effective signal weights
   * and unavailable signals into a single, printable contract; adds the
   * anti-gaming audit, freshness badges (impact-model training date, ranking
   * snapshot date, signal window, per-source windows, rubric version) and a
   * read-only manager-calibration stub so a later manager validation feedback
   * loop can be wired without changing the ranking core.
   */
  methodology: MethodologyBundle;
  /** Known methodology limitations, surfaced verbatim on the page. */
  knownLimitations: string[];
  /** Signals the loader plans to incorporate, and their current availability. */
  plannedSignals: Array<{
    name: string;
    state: "available" | "planned" | "unavailable";
    note?: string;
  }>;
}

/** Category a signal belongs to for audit purposes. */
export type SignalKind = "numeric" | "nominal";

/**
 * Per-signal presence/missingness counts over the competitive cohort.
 * `totalCohort` is the competitive roster size so downstream code can phrase
 * "N of M engineers have this signal" without passing the cohort size
 * separately.
 */
export interface SignalMissingness {
  signal: string;
  kind: SignalKind;
  present: number;
  missing: number;
  totalCohort: number;
}

/**
 * Cohort distribution for a nominal (categorical) signal. Reported instead
 * of, never alongside, a Spearman correlation — arbitrary ordinal encoding
 * of nominal dimensions (discipline, squad name, Slack channel id) would
 * fabricate precision the data does not support.
 */
export interface NominalSignalCoverage {
  signal: string;
  categories: Array<{ category: string; count: number }>;
  missing: number;
  distinctCategories: number;
}

/** One pairwise cell in the Spearman correlation matrix. */
export interface CorrelationPair {
  a: string;
  b: string;
  /** Spearman rho on paired non-null observations; null when undefined
   *  (fewer than 2 overlapping points or a zero-variance rank series). */
  rho: number | null;
  /** Count of pairs of non-null observations contributing to `rho`. */
  n: number;
}

export interface UnavailableSignal {
  name: string;
  reason: string;
}

/**
 * Signal inventory and orthogonality audit for the competitive cohort.
 * Numeric signals are audited with Spearman rank correlations (ties handled
 * with average ranks, nulls handled via pairwise deletion). Nominal signals
 * report cohort distributions only.
 */
export interface SignalAudit {
  competitiveCohortSize: number;
  windowDays: number;
  numericSignals: string[];
  nominalSignals: string[];
  missingness: SignalMissingness[];
  nominalCoverage: NominalSignalCoverage[];
  /** Upper-triangle of pairwise Spearman correlations over numeric signals. */
  correlationMatrix: CorrelationPair[];
  /** Pairs whose |rho| >= `RANKING_REDUNDANT_RHO_THRESHOLD`. */
  redundantPairs: Array<CorrelationPair & { rho: number }>;
  /** Pairs whose overlap count `n < RANKING_MIN_OVERLAP_SAMPLES`. */
  underSampledPairs: CorrelationPair[];
  /**
   * Signals whose source is not persisted in the current schema. Emitted on
   * the page so the reader sees what is not in scoring instead of inferring
   * absence from a silent exclusion.
   */
  unavailableSignals: UnavailableSignal[];
}

/**
 * Per-engineer signal row consumed by the orthogonality audit. The server
 * loader is responsible for producing these rows by joining GitHub/impact
 * model/AI usage to the competitive roster; tests can supply fixtures.
 *
 * All numeric signals are `number | null` so missingness is explicit at the
 * call site rather than silently collapsed into zero.
 */
export interface PerEngineerSignalRow {
  emailHash: string;
  prCount: number | null;
  commitCount: number | null;
  additions: number | null;
  deletions: number | null;
  /**
   * SHAP-predicted impact (dollars/year or equivalent) from the impact
   * model. Null when the engineer was not in the training set.
   */
  shapPredicted: number | null;
  /** Measured impact target from the impact model. */
  shapActual: number | null;
  /** actual - predicted; over-delivery when positive. */
  shapResidual: number | null;
  /** AI tooling spend for the latest month in the AI usage dashboard. */
  aiTokens: number | null;
  aiSpend: number | null;
  /**
   * Squad-level delivery-health context from Swarmia. These are contextual
   * team signals, not individual labels; they are audited for orthogonality
   * but later scoring must cap/down-weight them to avoid ecological fallacy.
   */
  squadCycleTimeHours: number | null;
  squadReviewRatePercent: number | null;
  squadTimeToFirstReviewHours: number | null;
  squadPrsInProgress: number | null;
}

/**
 * Hash an email for ranking. Matches the convention in
 * `src/lib/data/impact-model.server.ts` so the SHAP model lookups align with
 * the roster keys in a single snapshot.
 */
export function hashEmailForRanking(email: string): string {
  return createHash("sha256")
    .update(email.toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function classifyDiscipline(
  rpSpecialisation: string | undefined,
  jobTitle: string | undefined,
): Discipline {
  const s = (rpSpecialisation ?? "").trim().toLowerCase();
  const j = (jobTitle ?? "").toLowerCase();
  if (s === "backend engineer" || s === "python engineer") return "BE";
  if (s === "frontend engineer") return "FE";
  if (s === "engineering manager") return "EM";
  if (s === "qa engineer") return "QA";
  if (
    s === "machine learning engineer" ||
    s === "ml ops engineer" ||
    s === "head of machine learning" ||
    s === "machine learning engineering manager"
  ) {
    return "ML";
  }
  if (s === "technical operations") return "Ops";
  if (s.includes("backend") || j.includes("backend")) return "BE";
  if (s.includes("frontend") || j.includes("frontend")) return "FE";
  if (s.includes("engineering manager") || j.includes("engineering manager")) {
    return "EM";
  }
  if (s.includes("qa") || j.includes("qa")) return "QA";
  if (s.includes("machine learning") || s.includes("ml ") || j.includes("ml ")) {
    return "ML";
  }
  if (s.includes("python")) return "BE";
  if (s.includes("technical operations")) return "Ops";
  return "Other";
}

function classifyLevel(raw: string | undefined | null): string {
  if (!raw) return "unknown";
  const r = raw.toUpperCase();
  const match = /^([A-Z]+)(\d+)$/.exec(r);
  if (!match) return raw;
  const [, prefix, numStr] = match;
  const num = parseInt(numStr, 10);
  if (prefix === "EM") return `EM${num}`;
  if (prefix === "QE") return `QE${num}`;
  if (prefix === "EG" || prefix === "DS" || prefix === "EXEC") return raw;
  return `L${num}`;
}

function cleanPillar(deptName: string | null | undefined): string {
  if (!deptName) return "Unknown";
  return deptName.replace(/\s+Pillar$/i, "").trim();
}

export interface EligibilityHeadcountRow {
  email?: string | null;
  preferred_name?: string | null;
  rp_full_name?: string | null;
  hb_function?: string | null;
  hb_level?: string | null;
  hb_squad?: string | null;
  rp_specialisation?: string | null;
  rp_department_name?: string | null;
  job_title?: string | null;
  manager?: string | null;
  line_manager_email?: string | null;
  start_date?: string | null;
  termination_date?: string | null;
  headcount_label?: string | null;
}

export interface EligibilityGithubMapRow {
  githubLogin: string;
  employeeEmail: string | null;
  isBot: boolean;
}

export interface EligibilityImpactModelView {
  engineers: Array<{ email_hash: string }>;
  /**
   * ISO timestamp the committed impact model was generated. Threaded through
   * from `src/data/impact-model.json` by the server loader so the methodology
   * freshness panel can show the model's training date. Optional because
   * tests often construct minimal fixtures without the metadata.
   */
  generated_at?: string;
}

/**
 * Row shape for the canonical squads registry input. Matches the subset of
 * `squads` columns the ranking preflight needs — name, pillar, PM name, and
 * active state. Manager fields are deliberately absent because the `squads`
 * table does not store them.
 */
export interface EligibilitySquadsRegistryRow {
  name: string;
  pillar: string;
  pmName: string | null;
  /**
   * Slack channel id for the squad, if configured on the `squads` row. Kept
   * optional at the row level but rendered into `CanonicalSquadMetadata` as
   * `channelId: string | null` so the page can truthfully claim the channel
   * is part of the joined provenance.
   */
  channelId: string | null;
  isActive: boolean;
}

export interface EligibilityInputs {
  headcountRows: EligibilityHeadcountRow[];
  githubMap: EligibilityGithubMapRow[];
  impactModel: EligibilityImpactModelView;
  /**
   * Optional canonical squads registry. When present the preflight joins
   * each engineer's `hb_squad` to the registry and surfaces the squads
   * provenance note. When absent, the page must not claim the squads
   * registry as a live source.
   */
  squads?: EligibilitySquadsRegistryRow[];
  /**
   * Optional per-engineer signal rows indexed by `emailHash`. Supplied by
   * the server loader once GitHub PR/commit aggregates, impact-model stats,
   * and AI usage have been joined. When absent, the audit runs in a
   * "data-pending" state that still emits the unavailable-signal list and
   * the nominal coverage table drawn from the roster itself.
   */
  signals?: PerEngineerSignalRow[];
  /**
   * Whether individual review-graph / review-turnaround / PR-level cycle
   * time signals are persisted in the current GitHub schema. Defaults to
   * `false` — a future schema/sync change that persists reviewer
   * identities/timestamps can flip this and unblock those signals. The
   * audit always emits them as unavailable today.
   */
  reviewSignalsPersisted?: boolean;
  /** Defaults to new Date() — injectable so tests can pin "today". */
  now?: Date;
  /** Defaults to RANKING_RAMP_UP_DAYS. */
  rampUpDays?: number;
  /** Analysis window in days. Defaults to 180. */
  windowDays?: number;
  /**
   * Optional GitHub org (e.g. `meetcleo`) used to build stable PR-search
   * evidence URLs in the attribution drilldown. Null/undefined means no
   * PR-search URL is emitted — the attribution then surfaces the missing
   * login or org as an absent-evidence note rather than fabricating a link.
   */
  githubOrg?: string | null;
  /**
   * Optional prior ranking snapshot slice used by the M18 movers view.
   * Every row MUST share the same `(snapshotDate, methodologyVersion)`.
   * The server loader picks the most recent slice at least
   * `RANKING_MOVERS_MIN_GAP_DAYS` days old, preferring the same methodology
   * version. If no slice is old enough, the server loader falls through to
   * the most recent slice on or before the current snapshot date — including
   * same-day slices from an earlier POST — so the bundle renders
   * `insufficient_gap` with the real `priorSnapshotGapDays` (including
   * 0-day gaps) instead of `no_prior_snapshot`. When absent/empty, the
   * bundle still emits `no_prior_snapshot`.
   */
  priorSnapshotRows?: readonly RankingSnapshotRow[];
  /** Optional override for the movers minimum gap (tests). */
  moversMinGapDays?: number;
  /** Optional override for the movers top-N count (tests). */
  moversTopN?: number;
  /**
   * Optional ISO timestamp for when the Mode headcount SSoT was most recently
   * synced. Surfaced on the methodology freshness panel. Null/undefined when
   * the server loader does not currently have a sync timestamp to expose
   * (the Mode sync pipeline writes to `modeReportData` but the age surface is
   * not always joined through to the ranking page).
   */
  headcountGeneratedAt?: string | null;
  /**
   * Optional ISO month (YYYY-MM-DD) for the most recent AI usage month the
   * server loader has aggregated. Surfaced on the methodology freshness panel
   * to call out the AI-usage-vs-180-day-window window mismatch. Null when
   * AI usage has not been fetched.
   */
  aiUsageLatestMonth?: string | null;
}

function isEngineerRow(row: EligibilityHeadcountRow): boolean {
  const func = (row.hb_function ?? "").toLowerCase();
  return func.includes("engineer");
}

function diffDays(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.slice(0, 10);
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Build the eligibility roster for the ranking page.
 *
 * Spine: engineering rows from Mode Headcount SSoT (any FTE/CS/contractor
 * with `hb_function` containing "engineer"). Augmented with:
 * - `githubEmployeeMap` (email → login), filtered to non-bot mappings
 * - impact-model presence (by `email_hash` only — the JSON is anonymised)
 * - the canonical `squads` registry (when supplied) for squad/pillar/PM
 *   metadata joined by lowercased squad name
 *
 * No active engineer is dropped silently: unmapped or missing-data engineers
 * still appear in `entries` with an explicit `eligibility` and `reason`.
 * Manager chain is sourced from the headcount row (`manager` with
 * `line_manager_email` fallback), never from the squads registry.
 *
 * Rows whose `start_date` is in the future relative to `now` are excluded
 * from the active roster (mirrors Mode's `selectModeFteActive` policy) so
 * future hires cannot be counted as negative-tenure ramp-up engineers. The
 * exclusion count is surfaced on `coverage.excludedFutureStart`.
 */
export function buildEligibleRoster(inputs: EligibilityInputs): {
  entries: EligibilityEntry[];
  coverage: EligibilityCoverage;
} {
  const now = inputs.now ?? new Date();
  const rampUpDays = inputs.rampUpDays ?? RANKING_RAMP_UP_DAYS;

  const emailToLogin = new Map<string, string>();
  for (const m of inputs.githubMap) {
    if (m.isBot) continue;
    if (!m.employeeEmail) continue;
    emailToLogin.set(m.employeeEmail.toLowerCase(), m.githubLogin);
  }

  const impactHashes = new Set(
    inputs.impactModel.engineers.map((e) => e.email_hash),
  );

  // Registry is "present" only when the caller supplied a non-empty list.
  // An empty array provides no rows to join and is observationally
  // indistinguishable from not fetching — both the coverage flag and the
  // source-notes text must agree on this so the page never claims a joined
  // source in one panel and an unfetched source in the next.
  const squadsRegistryPresent = Boolean(
    inputs.squads && inputs.squads.length > 0,
  );
  const squadByName = new Map<string, EligibilitySquadsRegistryRow>();
  if (inputs.squads) {
    for (const s of inputs.squads) {
      if (!s.isActive) continue;
      squadByName.set(s.name.trim().toLowerCase(), s);
    }
  }

  const entries: EligibilityEntry[] = [];
  let excludedFutureStart = 0;

  for (const row of inputs.headcountRows) {
    if (!isEngineerRow(row)) continue;

    const emailRaw = row.email ?? "";
    const email = emailRaw.toLowerCase();
    const displayName =
      row.preferred_name?.trim() ||
      row.rp_full_name?.trim() ||
      email ||
      "(unknown)";

    const canonicalSquad = resolveCanonicalSquad(row.hb_squad, squadByName);

    if (!email || !row.start_date) {
      entries.push({
        emailHash: email ? hashEmailForRanking(email) : "",
        displayName,
        email,
        githubLogin: null,
        discipline: classifyDiscipline(
          row.rp_specialisation ?? undefined,
          row.job_title ?? undefined,
        ),
        levelLabel: classifyLevel(row.hb_level),
        squad: row.hb_squad ?? null,
        pillar: cleanPillar(row.rp_department_name),
        canonicalSquad,
        manager: row.manager?.trim() || row.line_manager_email?.trim() || null,
        startDate: row.start_date ?? null,
        tenureDays: null,
        isLeaverOrInactive: false,
        hasImpactModelRow: false,
        eligibility: "missing_required_data",
        reason: !email
          ? "Headcount row missing email — cannot hash or join to GitHub."
          : "Headcount row missing start_date — tenure cannot be computed.",
      });
      continue;
    }

    const startDate = parseDate(row.start_date);
    // Future starts are excluded from the active roster. Mirrors Mode's
    // `selectModeFteActive` filter (`start_date > asOf` → not active).
    // Surfaced on coverage.excludedFutureStart rather than emitted as a
    // negative-tenure ramp-up engineer.
    if (startDate && startDate.getTime() > now.getTime()) {
      excludedFutureStart += 1;
      continue;
    }
    const termDate = parseDate(row.termination_date);
    const tenureDays = startDate ? diffDays(startDate, now) : null;
    // A termination_date that precedes start_date is a rehire artefact in
    // HiBob — treat as active (mirrors selectModeFteActive in people.ts).
    const isLeaverOrInactive = Boolean(
      termDate &&
        termDate.getTime() <= now.getTime() &&
        (!startDate || termDate.getTime() >= startDate.getTime()),
    );

    const githubLogin = emailToLogin.get(email) ?? null;
    const emailHash = hashEmailForRanking(email);
    const hasImpactModelRow = impactHashes.has(emailHash);

    let eligibility: EligibilityStatus;
    let reason: string;
    if (isLeaverOrInactive) {
      eligibility = "inactive_or_leaver";
      const termIso = termDate ? termDate.toISOString().slice(0, 10) : "";
      reason = termIso
        ? `Left Cleo on ${termIso}; excluded from competitive ranking so rank movement does not read as a regression.`
        : "Inactive headcount row; excluded from competitive ranking.";
    } else if (tenureDays === null) {
      eligibility = "missing_required_data";
      reason = "Start date unparseable — tenure cannot be computed.";
    } else if (tenureDays < rampUpDays) {
      eligibility = "ramp_up";
      reason = `In Ramp-up cohort (${tenureDays}d < ${rampUpDays}d). Ranked separately so recency of hire does not read as low output.`;
    } else if (!githubLogin) {
      eligibility = "insufficient_mapping";
      reason =
        "No githubEmployeeMap entry. Appears with low confidence until the GitHub login is mapped in admin.";
    } else {
      eligibility = "competitive";
      reason = `Eligible: ${tenureDays}d tenure, GitHub login ${githubLogin}, ${hasImpactModelRow ? "present in" : "absent from"} impact model.`;
    }

    entries.push({
      emailHash,
      displayName,
      email,
      githubLogin,
      discipline: classifyDiscipline(
        row.rp_specialisation ?? undefined,
        row.job_title ?? undefined,
      ),
      levelLabel: classifyLevel(row.hb_level),
      squad: row.hb_squad ?? null,
      pillar: cleanPillar(row.rp_department_name),
      canonicalSquad,
      manager: row.manager?.trim() || row.line_manager_email?.trim() || null,
      startDate: row.start_date,
      tenureDays,
      isLeaverOrInactive,
      hasImpactModelRow,
      eligibility,
      reason,
    });
  }

  const bucketOrder: Record<EligibilityStatus, number> = {
    competitive: 0,
    ramp_up: 1,
    insufficient_mapping: 2,
    missing_required_data: 3,
    inactive_or_leaver: 4,
  };
  entries.sort((a, b) => {
    const ba = bucketOrder[a.eligibility];
    const bb = bucketOrder[b.eligibility];
    if (ba !== bb) return ba - bb;
    return a.displayName.localeCompare(b.displayName);
  });

  const coverage: EligibilityCoverage = {
    totalEngineers: entries.length,
    competitive: entries.filter((e) => e.eligibility === "competitive").length,
    rampUp: entries.filter((e) => e.eligibility === "ramp_up").length,
    insufficientMapping: entries.filter(
      (e) => e.eligibility === "insufficient_mapping",
    ).length,
    inactiveOrLeaver: entries.filter(
      (e) => e.eligibility === "inactive_or_leaver",
    ).length,
    missingRequiredData: entries.filter(
      (e) => e.eligibility === "missing_required_data",
    ).length,
    mappedToGitHub: entries.filter((e) => e.githubLogin !== null).length,
    presentInImpactModel: entries.filter((e) => e.hasImpactModelRow).length,
    excludedFutureStart,
    squadRegistryUnmatched: entries.filter(
      (e) => e.squad !== null && e.canonicalSquad === null,
    ).length,
    rampUpThresholdDays: rampUpDays,
    squadsRegistryPresent,
  };

  return { entries, coverage };
}

function resolveCanonicalSquad(
  hbSquad: string | null | undefined,
  squadByName: Map<string, EligibilitySquadsRegistryRow>,
): CanonicalSquadMetadata | null {
  if (squadByName.size === 0) return null;
  const raw = (hbSquad ?? "").trim();
  if (!raw) return null;
  const match = squadByName.get(raw.toLowerCase());
  if (!match) return null;
  return {
    name: match.name,
    pillar: match.pillar,
    pmName: match.pmName,
    channelId: match.channelId,
  };
}

type NumericSignalSpec = {
  name: string;
  getValue: (
    entry: EligibilityEntry,
    signal: PerEngineerSignalRow | undefined,
  ) => number | null;
};

type NominalSignalSpec = {
  name: string;
  getValue: (entry: EligibilityEntry) => string | null;
};

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function netLines(signal: PerEngineerSignalRow | undefined): number | null {
  const additions = finiteOrNull(signal?.additions);
  const deletions = finiteOrNull(signal?.deletions);
  if (additions === null || deletions === null) return null;
  return additions - deletions;
}

function logImpact(signal: PerEngineerSignalRow | undefined): number | null {
  const prs = finiteOrNull(signal?.prCount);
  const additions = finiteOrNull(signal?.additions);
  const deletions = finiteOrNull(signal?.deletions);
  if (prs === null || additions === null || deletions === null) return null;
  if (prs <= 0) return 0;
  return prs * Math.log2(1 + (additions + deletions) / prs);
}

function levelNumber(levelLabel: string): number | null {
  const match = /(\d+)/.exec(levelLabel);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function nominalValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const NUMERIC_SIGNAL_SPECS: readonly NumericSignalSpec[] = [
  {
    name: "PR count",
    getValue: (_entry, signal) => finiteOrNull(signal?.prCount),
  },
  {
    name: "Commit count",
    getValue: (_entry, signal) => finiteOrNull(signal?.commitCount),
  },
  {
    name: "Net lines",
    getValue: (_entry, signal) => netLines(signal),
  },
  {
    name: "Log impact",
    getValue: (_entry, signal) => logImpact(signal),
  },
  {
    name: "SHAP predicted impact",
    getValue: (_entry, signal) => finiteOrNull(signal?.shapPredicted),
  },
  {
    name: "SHAP actual impact",
    getValue: (_entry, signal) => finiteOrNull(signal?.shapActual),
  },
  {
    name: "SHAP residual",
    getValue: (_entry, signal) => finiteOrNull(signal?.shapResidual),
  },
  {
    name: "Tenure months",
    getValue: (entry) =>
      entry.tenureDays === null ? null : entry.tenureDays / DAYS_PER_MONTH,
  },
  {
    name: "Level number",
    getValue: (entry) => levelNumber(entry.levelLabel),
  },
  {
    name: "Squad cycle time hours",
    getValue: (_entry, signal) => finiteOrNull(signal?.squadCycleTimeHours),
  },
  {
    name: "Squad review rate %",
    getValue: (_entry, signal) => finiteOrNull(signal?.squadReviewRatePercent),
  },
  {
    name: "Squad time to first review hours",
    getValue: (_entry, signal) =>
      finiteOrNull(signal?.squadTimeToFirstReviewHours),
  },
  {
    name: "Squad PRs in progress",
    getValue: (_entry, signal) => finiteOrNull(signal?.squadPrsInProgress),
  },
  {
    name: "AI tokens",
    getValue: (_entry, signal) => finiteOrNull(signal?.aiTokens),
  },
  {
    name: "AI spend",
    getValue: (_entry, signal) => finiteOrNull(signal?.aiSpend),
  },
];

const NOMINAL_SIGNAL_SPECS: readonly NominalSignalSpec[] = [
  { name: "Discipline", getValue: (entry) => entry.discipline },
  { name: "Raw headcount squad", getValue: (entry) => entry.squad },
  { name: "Raw headcount pillar", getValue: (entry) => entry.pillar },
  {
    name: "Canonical squad",
    getValue: (entry) => entry.canonicalSquad?.name ?? null,
  },
  {
    name: "Canonical squad pillar",
    getValue: (entry) => entry.canonicalSquad?.pillar ?? null,
  },
  {
    name: "Squad PM",
    getValue: (entry) => entry.canonicalSquad?.pmName ?? null,
  },
  {
    name: "Slack channel id",
    getValue: (entry) => entry.canonicalSquad?.channelId ?? null,
  },
];

export const RANKING_NUMERIC_SIGNAL_NAMES = NUMERIC_SIGNAL_SPECS.map(
  (s) => s.name,
);

export const RANKING_NOMINAL_SIGNAL_NAMES = NOMINAL_SIGNAL_SPECS.map(
  (s) => s.name,
);

function rank(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      return a.index - b.index;
    });

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j += 1;
    // Average of 1-based ranks for the tied run.
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) {
      ranks[sorted[k].index] = avgRank;
    }
    i = j;
  }
  return ranks;
}

/**
 * Spearman rank correlation with pairwise null deletion and average ranks
 * for ties. Returns `rho: null` when the correlation is undefined (too few
 * paired observations or zero variance in either rank series).
 */
export function computeSpearmanRho(
  left: Array<number | null | undefined>,
  right: Array<number | null | undefined>,
): { rho: number | null; n: number } {
  const pairs: Array<{ left: number; right: number }> = [];
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const a = finiteOrNull(left[i]);
    const b = finiteOrNull(right[i]);
    if (a === null || b === null) continue;
    pairs.push({ left: a, right: b });
  }

  if (pairs.length < 2) return { rho: null, n: pairs.length };

  const leftRanks = rank(pairs.map((p) => p.left));
  const rightRanks = rank(pairs.map((p) => p.right));
  const meanLeft =
    leftRanks.reduce((sum, value) => sum + value, 0) / leftRanks.length;
  const meanRight =
    rightRanks.reduce((sum, value) => sum + value, 0) / rightRanks.length;

  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let i = 0; i < leftRanks.length; i += 1) {
    const dl = leftRanks[i] - meanLeft;
    const dr = rightRanks[i] - meanRight;
    numerator += dl * dr;
    leftSquares += dl * dl;
    rightSquares += dr * dr;
  }

  const denom = Math.sqrt(leftSquares * rightSquares);
  if (denom === 0) return { rho: null, n: pairs.length };
  const rho = numerator / denom;
  return {
    rho: Math.max(-1, Math.min(1, rho)),
    n: pairs.length,
  };
}

function unavailableSignalsForAudit(
  reviewSignalsPersisted: boolean,
): UnavailableSignal[] {
  const unavailable: UnavailableSignal[] = [
    {
      name: "Per-PR LLM rubric",
      reason:
        "`prReviewAnalyses` / `RUBRIC_VERSION` are not present in this codebase, so no per-PR quality rubric enters the audit or scoring.",
    },
  ];

  if (!reviewSignalsPersisted) {
    unavailable.push(
      {
        name: "Individual PR reviewer graph",
        reason:
          "`githubPrs` and `githubPrMetrics` do not persist reviewer identities or review edges.",
      },
      {
        name: "Individual review turnaround",
        reason:
          "No first-review / approval timestamps are persisted for individual engineers.",
      },
      {
        name: "Individual PR cycle time",
        reason:
          "`githubPrs` stores `merged_at` but not opened-at or ready-for-review timestamps.",
      },
    );
  }

  return unavailable;
}

export function buildSignalAudit({
  entries,
  signals = [],
  windowDays = RANKING_SIGNAL_WINDOW_DAYS,
  reviewSignalsPersisted = false,
}: {
  entries: EligibilityEntry[];
  signals?: PerEngineerSignalRow[];
  windowDays?: number;
  reviewSignalsPersisted?: boolean;
}): SignalAudit {
  const competitiveEntries = entries.filter(
    (entry) => entry.eligibility === "competitive",
  );
  const signalByHash = new Map(signals.map((s) => [s.emailHash, s]));

  const numericValues = new Map<string, Array<number | null>>();
  for (const spec of NUMERIC_SIGNAL_SPECS) {
    numericValues.set(
      spec.name,
      competitiveEntries.map((entry) =>
        spec.getValue(entry, signalByHash.get(entry.emailHash)),
      ),
    );
  }

  const missingness: SignalMissingness[] = [];
  for (const spec of NUMERIC_SIGNAL_SPECS) {
    const values = numericValues.get(spec.name) ?? [];
    const present = values.filter((value) => finiteOrNull(value) !== null).length;
    missingness.push({
      signal: spec.name,
      kind: "numeric",
      present,
      missing: competitiveEntries.length - present,
      totalCohort: competitiveEntries.length,
    });
  }

  const nominalCoverage: NominalSignalCoverage[] = [];
  for (const spec of NOMINAL_SIGNAL_SPECS) {
    const counts = new Map<string, number>();
    let missing = 0;
    for (const entry of competitiveEntries) {
      const value = nominalValue(spec.getValue(entry));
      if (!value) {
        missing += 1;
        continue;
      }
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const present = competitiveEntries.length - missing;
    missingness.push({
      signal: spec.name,
      kind: "nominal",
      present,
      missing,
      totalCohort: competitiveEntries.length,
    });
    nominalCoverage.push({
      signal: spec.name,
      categories: [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
      missing,
      distinctCategories: counts.size,
    });
  }

  const correlationMatrix: CorrelationPair[] = [];
  const redundantPairs: Array<CorrelationPair & { rho: number }> = [];
  const underSampledPairs: CorrelationPair[] = [];
  for (let i = 0; i < NUMERIC_SIGNAL_SPECS.length; i += 1) {
    for (let j = i + 1; j < NUMERIC_SIGNAL_SPECS.length; j += 1) {
      const a = NUMERIC_SIGNAL_SPECS[i].name;
      const b = NUMERIC_SIGNAL_SPECS[j].name;
      const { rho, n } = computeSpearmanRho(
        numericValues.get(a) ?? [],
        numericValues.get(b) ?? [],
      );
      const pair: CorrelationPair = { a, b, rho, n };
      correlationMatrix.push(pair);
      if (n < RANKING_MIN_OVERLAP_SAMPLES) {
        underSampledPairs.push(pair);
      } else if (rho !== null && Math.abs(rho) >= RANKING_REDUNDANT_RHO_THRESHOLD) {
        redundantPairs.push({ ...pair, rho });
      }
    }
  }

  return {
    competitiveCohortSize: competitiveEntries.length,
    windowDays,
    numericSignals: [...RANKING_NUMERIC_SIGNAL_NAMES],
    nominalSignals: [...RANKING_NOMINAL_SIGNAL_NAMES],
    missingness,
    nominalCoverage,
    correlationMatrix,
    redundantPairs,
    underSampledPairs,
    unavailableSignals: unavailableSignalsForAudit(reviewSignalsPersisted),
  };
}

/* --------------------------------------------------------------------------
 * M8 — three independent scoring lenses + disagreement investigation
 * ------------------------------------------------------------------------ */

/**
 * Identifier for each of the three independent scoring lenses. These are
 * NOT the final composite — the composite lands in a later milestone once
 * the lenses are trusted and their disagreements are understood.
 */
export type LensKey = "output" | "impact" | "delivery";

/**
 * Top N engineers surfaced per lens on the page. Chosen large enough to
 * include the full top end of any competitive cohort we expect today, small
 * enough that a reader can scan it without scrolling for a minute.
 */
export const RANKING_LENS_TOP_N = 20 as const;

/**
 * Top N widest-disagreement engineers surfaced on the page. 10 is enough to
 * prompt investigation of the lenses without drowning the reader in cases.
 */
export const RANKING_DISAGREEMENT_TOP_N = 10 as const;

/** Minimum present lens count for a row to appear in disagreement analysis. */
export const RANKING_DISAGREEMENT_MIN_LENSES = 2 as const;

/**
 * Minimum `max(present) - min(present)` lens-score gap (in percentile points)
 * for a row to count as a material disagreement. Rows at or below this
 * threshold are treated as agreement, never as a disagreement — otherwise a
 * tied or near-tied pair would be surfaced as a widest-gap row with a
 * directional `top>bottom` narrative even though the lenses agree.
 *
 * 0.5 percentile points is within rounding noise of the `((rank - 0.5) / n)`
 * rank-percentile grid this methodology uses, so any gap larger than this is
 * the smallest difference that cannot be explained by tie-breaking alone.
 */
export const RANKING_DISAGREEMENT_EPSILON = 0.5 as const;

/**
 * Per-component contribution to a lens score for a given engineer. `rawValue`
 * is the un-normalised signal on the competitive cohort scale (e.g. PR count
 * or SHAP actual dollars). `percentile` is the engineer's rank-percentile
 * for that component on [0, 100], null when the raw value is missing.
 */
export interface LensComponentValue {
  name: string;
  weight: number;
  /**
   * True when the underlying signal orders lower-is-better (e.g. cycle time,
   * time-to-first-review). The percentile is inverted (100 - rank percentile)
   * so that, consistently across every component, a higher percentile always
   * means "better by this signal".
   */
  invertedForScore: boolean;
  rawValue: number | null;
  percentile: number | null;
}

/** Lens score for one engineer, with per-component contribution visible. */
export interface EngineerLensScore {
  emailHash: string;
  displayName: string;
  /**
   * Weighted mean of present-component percentiles on [0, 100]. Null when
   * no component value was present for this engineer (e.g. lens B for an
   * engineer not in the impact model training set).
   */
  score: number | null;
  presentComponentCount: number;
  components: LensComponentValue[];
}

/** Static description of a lens, surfaced on the methodology panel. */
export interface LensDefinition {
  key: LensKey;
  name: string;
  description: string;
  components: Array<{ name: string; weight: number }>;
  /**
   * Plain-language limitation of this lens, rendered on the page alongside
   * the top-N list so the reader never reads the lens as a clean label.
   */
  limitation: string | null;
}

/** Per-lens summary: definition + scored/unscored counts + full + top entries. */
export interface LensScoreSummary {
  definition: LensDefinition;
  scored: number;
  unscored: number;
  /** All competitive engineers. Null scores kept so attribution is complete. */
  entries: EngineerLensScore[];
  /** Top `RANKING_LENS_TOP_N` entries by score descending; nulls excluded. */
  topN: EngineerLensScore[];
}

/** One row in the disagreement table. */
export interface LensDisagreementRow {
  emailHash: string;
  displayName: string;
  output: number | null;
  impact: number | null;
  delivery: number | null;
  presentLensCount: number;
  /** max(present lenses) - min(present lenses), null when <2 lenses present. */
  disagreement: number | null;
  likelyCause: string;
}

/** Output of `buildLenses` — the bundle stored on the snapshot. */
export interface LensesBundle {
  windowDays: number;
  definitions: LensDefinition[];
  lenses: {
    output: LensScoreSummary;
    impact: LensScoreSummary;
    delivery: LensScoreSummary;
  };
  disagreement: {
    /** All eligible rows (presentLensCount >= 2), sorted by disagreement desc. */
    rows: LensDisagreementRow[];
    /** Top `RANKING_DISAGREEMENT_TOP_N` for the on-page summary. */
    widestGaps: LensDisagreementRow[];
  };
  /** Plain-language limitations surfaced next to the lenses on the page. */
  limitations: string[];
}

function logSignedMagnitude(value: number | null): number | null {
  if (value === null) return null;
  const sign = Math.sign(value);
  return sign * Math.log10(1 + Math.abs(value));
}

function sqrtDamp(value: number | null): number | null {
  if (value === null) return null;
  if (value < 0) return null;
  return Math.sqrt(value);
}

/**
 * Rank-percentile a parallel array of nullable numbers. Nulls stay null.
 * Present values are converted to [0, 100] using ((rank - 0.5) / n) * 100
 * with average ranks for ties. A lone present value returns 50 — the neutral
 * percentile — so small-sample engineers do not look suspiciously extreme.
 */
function rankPercentiles(values: Array<number | null>): Array<number | null> {
  const presentIndices: number[] = [];
  const presentValues: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    presentIndices.push(i);
    presentValues.push(v);
  }
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (presentValues.length === 0) return out;
  const ranks = rank(presentValues);
  const n = presentValues.length;
  for (let k = 0; k < presentIndices.length; k += 1) {
    out[presentIndices[k]] = ((ranks[k] - 0.5) / n) * 100;
  }
  return out;
}

/**
 * Lens-agnostic component spec used by `buildLens`. `rawValues` is the
 * parallel array of per-engineer values (already damped / transformed) in
 * the same order as `entries`.
 */
interface LensComponentSpec {
  name: string;
  weight: number;
  invertedForScore: boolean;
  rawValues: Array<number | null>;
}

function buildLens({
  definition,
  entries,
  components,
}: {
  definition: LensDefinition;
  entries: EligibilityEntry[];
  components: LensComponentSpec[];
}): LensScoreSummary {
  const percentileMatrix = components.map((c) => ({
    ...c,
    percentiles: rankPercentiles(c.rawValues),
  }));

  const lensEntries: EngineerLensScore[] = entries.map((entry, idx) => {
    const contributions: LensComponentValue[] = percentileMatrix.map((c) => {
      const basePct = c.percentiles[idx];
      const pct =
        basePct === null ? null : c.invertedForScore ? 100 - basePct : basePct;
      return {
        name: c.name,
        weight: c.weight,
        invertedForScore: c.invertedForScore,
        rawValue: c.rawValues[idx],
        percentile: pct,
      };
    });
    let totalWeight = 0;
    let weighted = 0;
    for (const c of contributions) {
      if (c.percentile === null) continue;
      totalWeight += c.weight;
      weighted += c.percentile * c.weight;
    }
    const score = totalWeight > 0 ? weighted / totalWeight : null;
    const presentComponentCount = contributions.filter(
      (c) => c.percentile !== null,
    ).length;
    return {
      emailHash: entry.emailHash,
      displayName: entry.displayName,
      score,
      presentComponentCount,
      components: contributions,
    };
  });

  const scored = lensEntries.filter((e) => e.score !== null).length;
  const unscored = lensEntries.length - scored;

  const topN = [...lensEntries]
    .filter((e): e is EngineerLensScore & { score: number } => e.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, RANKING_LENS_TOP_N);

  return {
    definition,
    scored,
    unscored,
    entries: lensEntries,
    topN,
  };
}

function likelyDisagreementCause(row: {
  output: number | null;
  impact: number | null;
  delivery: number | null;
}): string {
  const present: Array<{ key: LensKey; score: number }> = [];
  if (row.output !== null) present.push({ key: "output", score: row.output });
  if (row.impact !== null) present.push({ key: "impact", score: row.impact });
  if (row.delivery !== null)
    present.push({ key: "delivery", score: row.delivery });

  if (present.length < RANKING_DISAGREEMENT_MIN_LENSES) {
    return "Insufficient lens coverage — at least two lenses must score this engineer to produce a disagreement reading.";
  }

  const sorted = [...present].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  // Tied / near-tied scores must never be narrated as a directional
  // `top>bottom` pattern — that would dress up agreement as disagreement.
  if (top.score - bottom.score <= RANKING_DISAGREEMENT_EPSILON) {
    return "No material lens disagreement — present lens scores agree within the disagreement epsilon.";
  }
  const tag = `${top.key}>${bottom.key}` as const;
  // Narratives are written to describe the pattern, not to pre-judge the
  // engineer — disagreement is where the methodology earns its money, so the
  // phrasing points the reader at what to look for rather than labelling.
  switch (tag) {
    case "output>impact":
      return "Output volume above SHAP model impact — activity is visible but the impact model does not reward it strongly; look for low-impact PR/commit patterns or a model training gap.";
    case "impact>output":
      return "SHAP impact above activity volume — impact model scores highly but merged-PR throughput is low; look for low-count, high-impact work (infra, ML, review-heavy, pairing).";
    case "output>delivery":
      return "Individual output above squad-delivery context — engineer ships more than the squad's aggregate delivery health; C is squad-context and may mask individual signal.";
    case "delivery>output":
      return "Squad delivery health above individual output — team-level signals may be carrying this row; individual output is the lens to trust for an individual ranking.";
    case "impact>delivery":
      return "SHAP impact above squad-delivery context — impact is model-driven individual, delivery is team-level; favours the individual reading.";
    case "delivery>impact":
      return "Squad delivery above SHAP impact — squad-level context is more favourable than individual impact; C is squad-context only and should not be read as individual impact.";
    default:
      return "Lenses disagree; see component breakdown for attribution.";
  }
}

function buildDisagreementTable(lenses: {
  output: LensScoreSummary;
  impact: LensScoreSummary;
  delivery: LensScoreSummary;
}): LensesBundle["disagreement"] {
  const byHash = new Map<string, LensDisagreementRow>();
  const register = (
    engineerEntry: EngineerLensScore,
    key: LensKey,
  ): void => {
    const existing = byHash.get(engineerEntry.emailHash) ?? {
      emailHash: engineerEntry.emailHash,
      displayName: engineerEntry.displayName,
      output: null,
      impact: null,
      delivery: null,
      presentLensCount: 0,
      disagreement: null,
      likelyCause: "",
    };
    if (key === "output") existing.output = engineerEntry.score;
    if (key === "impact") existing.impact = engineerEntry.score;
    if (key === "delivery") existing.delivery = engineerEntry.score;
    byHash.set(engineerEntry.emailHash, existing);
  };

  for (const e of lenses.output.entries) register(e, "output");
  for (const e of lenses.impact.entries) register(e, "impact");
  for (const e of lenses.delivery.entries) register(e, "delivery");

  const rows: LensDisagreementRow[] = [];
  for (const row of byHash.values()) {
    const present: number[] = [];
    if (row.output !== null) present.push(row.output);
    if (row.impact !== null) present.push(row.impact);
    if (row.delivery !== null) present.push(row.delivery);
    row.presentLensCount = present.length;
    if (present.length < RANKING_DISAGREEMENT_MIN_LENSES) {
      row.disagreement = null;
      row.likelyCause = likelyDisagreementCause(row);
      continue;
    }
    const gap = Math.max(...present) - Math.min(...present);
    row.disagreement = gap;
    row.likelyCause = likelyDisagreementCause(row);
    // Non-material gaps (ties / near-ties within the epsilon) are not
    // disagreements and must not appear in the table, otherwise agreement
    // gets dressed up as evidence that the lenses disagree.
    if (gap <= RANKING_DISAGREEMENT_EPSILON) continue;
    rows.push(row);
  }

  rows.sort((a, b) => {
    const da = a.disagreement ?? -Infinity;
    const db = b.disagreement ?? -Infinity;
    if (db !== da) return db - da;
    return a.displayName.localeCompare(b.displayName);
  });

  const widestGaps = rows.slice(0, RANKING_DISAGREEMENT_TOP_N);
  return { rows, widestGaps };
}

const LENS_DEFINITIONS: readonly LensDefinition[] = [
  {
    key: "output",
    name: "A — Individual output",
    description:
      "Merged PRs, commits, and log-damped code volume from persisted GitHub data. Damping prevents raw PR/commit spam from dominating, but this lens still rewards volume and must be paired with impact and delivery views to avoid over-rewarding activity.",
    components: [
      { name: "Log-impact composite", weight: 0.5 },
      { name: "PR count (sqrt-damped)", weight: 0.2 },
      { name: "Commit count (sqrt-damped)", weight: 0.15 },
      { name: "Net lines (log-signed)", weight: 0.15 },
    ],
    limitation:
      "Activity-volume-adjacent; high ranks here should not be read as impact without lens B confirming. AI usage is excluded so token inflation cannot raise this score.",
  },
  {
    key: "impact",
    name: "B — SHAP impact model",
    description:
      "Predicted, actual, and residual impact from the ML impact model (`src/data/impact-model.json`). Engineers absent from the training set score null here, not mid-percentile — the methodology refuses to invent a neutral reading.",
    components: [
      { name: "SHAP predicted impact", weight: 0.4 },
      { name: "SHAP actual impact", weight: 0.4 },
      { name: "SHAP residual (over/under-delivery)", weight: 0.2 },
    ],
    limitation:
      "Only scores engineers present in impact-model training data. Absent engineers surface as unscored so readers see the gap rather than inferring a neutral rank.",
  },
  {
    key: "delivery",
    name: "C — Squad delivery context",
    description:
      "Squad-level delivery-health signals from Swarmia (review rate, cycle time, time-to-first-review). Individual review/cycle-time signals are not persisted in `githubPrs` or `githubPrMetrics`, so this lens is intentionally squad-context, not an individual label. Every engineer on the same squad shares the same C score.",
    components: [
      { name: "Squad review rate %", weight: 0.4 },
      { name: "Squad cycle time (inverted)", weight: 0.3 },
      { name: "Squad time-to-first-review (inverted)", weight: 0.3 },
    ],
    limitation:
      "Squad-context only. Cannot differentiate engineers within the same squad. Capped at the lens level so it does not pretend to be an individual delivery-health label.",
  },
];

export const RANKING_LENS_DEFINITIONS = LENS_DEFINITIONS;

/**
 * Build the three scoring lenses for the competitive cohort and the
 * disagreement table over lens pairs. Keeps AI tokens/spend out of any lens
 * scoring so direct AI-token inflation cannot raise a row's score.
 */
export function buildLenses({
  entries,
  signals = [],
}: {
  entries: EligibilityEntry[];
  signals?: PerEngineerSignalRow[];
}): LensesBundle {
  const competitive = entries.filter((e) => e.eligibility === "competitive");
  const signalByHash = new Map(signals.map((s) => [s.emailHash, s]));

  const signalRows = competitive.map((entry) => signalByHash.get(entry.emailHash));

  const outputComponents: LensComponentSpec[] = [
    {
      name: "Log-impact composite",
      weight: 0.5,
      invertedForScore: false,
      rawValues: signalRows.map((s) => logImpact(s)),
    },
    {
      name: "PR count (sqrt-damped)",
      weight: 0.2,
      invertedForScore: false,
      rawValues: signalRows.map((s) => sqrtDamp(finiteOrNull(s?.prCount))),
    },
    {
      name: "Commit count (sqrt-damped)",
      weight: 0.15,
      invertedForScore: false,
      rawValues: signalRows.map((s) => sqrtDamp(finiteOrNull(s?.commitCount))),
    },
    {
      name: "Net lines (log-signed)",
      weight: 0.15,
      invertedForScore: false,
      rawValues: signalRows.map((s) => logSignedMagnitude(netLines(s))),
    },
  ];

  const impactComponents: LensComponentSpec[] = [
    {
      name: "SHAP predicted impact",
      weight: 0.4,
      invertedForScore: false,
      rawValues: signalRows.map((s) => finiteOrNull(s?.shapPredicted)),
    },
    {
      name: "SHAP actual impact",
      weight: 0.4,
      invertedForScore: false,
      rawValues: signalRows.map((s) => finiteOrNull(s?.shapActual)),
    },
    {
      name: "SHAP residual (over/under-delivery)",
      weight: 0.2,
      invertedForScore: false,
      rawValues: signalRows.map((s) => finiteOrNull(s?.shapResidual)),
    },
  ];

  const deliveryComponents: LensComponentSpec[] = [
    {
      name: "Squad review rate %",
      weight: 0.4,
      invertedForScore: false,
      rawValues: signalRows.map((s) => finiteOrNull(s?.squadReviewRatePercent)),
    },
    {
      name: "Squad cycle time (inverted)",
      weight: 0.3,
      invertedForScore: true,
      rawValues: signalRows.map((s) => finiteOrNull(s?.squadCycleTimeHours)),
    },
    {
      name: "Squad time-to-first-review (inverted)",
      weight: 0.3,
      invertedForScore: true,
      rawValues: signalRows.map((s) =>
        finiteOrNull(s?.squadTimeToFirstReviewHours),
      ),
    },
  ];

  const definitionByKey = new Map(LENS_DEFINITIONS.map((d) => [d.key, d]));

  const output = buildLens({
    definition: definitionByKey.get("output")!,
    entries: competitive,
    components: outputComponents,
  });
  const impact = buildLens({
    definition: definitionByKey.get("impact")!,
    entries: competitive,
    components: impactComponents,
  });
  const delivery = buildLens({
    definition: definitionByKey.get("delivery")!,
    entries: competitive,
    components: deliveryComponents,
  });

  const lenses = { output, impact, delivery };
  const disagreement = buildDisagreementTable(lenses);

  return {
    windowDays: RANKING_SIGNAL_WINDOW_DAYS,
    definitions: LENS_DEFINITIONS.map((d) => ({
      ...d,
      components: d.components.map((c) => ({ ...c })),
    })),
    lenses,
    disagreement,
    limitations: [
      "AI tokens and AI spend are excluded from every lens, so direct AI-token inflation cannot raise an engineer's lens score — AI usage remains latest-month context, not a 180-day score input.",
      "Lens C is squad-delivery context, not an individual review/cycle-time signal. Individual review turnaround and PR cycle time are not persisted in the current GitHub schema.",
      "Engineers absent from the impact-model training set score null on lens B — the methodology refuses to fabricate a neutral-looking impact reading.",
      `Disagreement table only surfaces rows where max(present lenses) − min(present lenses) exceeds ${RANKING_DISAGREEMENT_EPSILON} percentile points. Ties and near-ties are treated as agreement and omitted, so the table never presents a directional narrative for lenses that actually agree.`,
      "These three lenses feed the composite — they are one input each to the median-of-four methods the composite takes, alongside the tenure/role-adjusted percentile. Lens A/B/C scores are never the final ranking in isolation; read them as evidence, and read disagreements as where the methodology earns its money.",
    ],
  };
}

/* --------------------------------------------------------------------------
 * M10 — tenure and role normalisation
 * ------------------------------------------------------------------------ */

/**
 * Minimum number of engineers required before a discipline cohort is treated
 * as its own cohort for percentile calculations. Cohorts below this size
 * pool with a documented fallback (e.g. ML → BE) instead of producing fake
 * precision from a sample of one or two engineers.
 */
export const RANKING_MIN_COHORT_SIZE = 3 as const;

/**
 * Fallback order for pooling a small discipline cohort into a larger one
 * before falling all the way through to "(all)". Order matters — the first
 * discipline in the list is tried first, then the second is added, etc.,
 * until `RANKING_MIN_COHORT_SIZE` is reached. Each entry must be a real
 * `Discipline` so the pooling note on the page names the engineers the
 * cohort was actually merged with.
 *
 * BE is not included in its own fallback because it is the largest IC
 * cohort at Cleo and should never need pooling. Each smaller cohort pools
 * with BE as the first fallback — backend is the nearest engineering
 * neighbour for most disciplines (ML writes backend code, Ops and QA
 * both work closely with backend, FE at least speaks the same language).
 * EM pools with BE and FE because engineering managers typically come
 * from an IC background and share workflow characteristics with ICs.
 * Other catches miscellaneous-specialisation rows and pools generously.
 */
export const DISCIPLINE_POOL_FALLBACK: Readonly<Record<Discipline, readonly Discipline[]>> = {
  BE: [],
  FE: ["BE"],
  EM: ["BE", "FE"],
  QA: ["BE"],
  ML: ["BE"],
  Ops: ["BE"],
  Other: ["BE", "FE"],
};

/**
 * Description of the discipline cohort used to percentile a given engineer.
 * `effectiveMembers` is the set of disciplines whose engineers participated
 * in the percentile calculation — the engineer's own discipline is always
 * first. `pooledWith` is the list of other disciplines added by pooling.
 * `pooledToAll` signals that own + fallback chain still did not reach
 * `RANKING_MIN_COHORT_SIZE`, and every competitive engineer was pooled in.
 */
export interface DisciplineCohortInfo {
  discipline: Discipline;
  effectiveMembers: readonly Discipline[];
  effectiveSize: number;
  pooled: boolean;
  pooledWith: readonly Discipline[];
  pooledToAll: boolean;
  note: string;
}

/** Aggregate view of a discipline cohort for the page summary. */
export interface DisciplineCohortSummary {
  discipline: Discipline;
  size: number;
  pooled: boolean;
  pooledWith: Discipline[];
  pooledToAll: boolean;
  effectiveSize: number;
}

/** OLS fit of rawScore against level number for the level-adjustment residual. */
export interface LevelFit {
  slope: number;
  intercept: number;
  sampleSize: number;
}

/**
 * Normalised view of one engineer. `rawPercentile` preserves the
 * un-adjusted view on the cohort so readers can see the lift (or drop) the
 * adjustments produce. `adjustedPercentile` is the mean of the three
 * present adjusted components (discipline / level / tenure), falling back
 * to `rawPercentile` only when no adjustment is computable.
 */
export interface EngineerNormalisation {
  emailHash: string;
  displayName: string;
  discipline: Discipline;
  levelLabel: string;
  levelNumber: number | null;
  tenureDays: number | null;
  /** `min(tenureDays, windowDays)` — the number of signal-window days the
   *  engineer was actually on the team. Engineers with tenure < windowDays
   *  get proportional lift from the tenure-exposure adjustment so a recent
   *  joiner is not penalised for partial window exposure. */
  tenureWindowDays: number;

  /** Log-impact composite — same formula as lens A's largest weight. */
  rawScore: number | null;
  /** Cross-cohort rank-percentile of `rawScore` on [0, 100]. */
  rawPercentile: number | null;

  disciplineCohort: DisciplineCohortInfo;
  /** Rank-percentile of `rawScore` within the effective discipline cohort. */
  disciplinePercentile: number | null;

  /** `intercept + slope * levelNumber` from the OLS fit; null when no fit. */
  levelBaseline: number | null;
  /** `rawScore - levelBaseline`. Higher residual = better than level expectation. */
  levelAdjustedResidual: number | null;
  /** Cross-cohort percentile of level residuals. */
  levelAdjustedPercentile: number | null;

  /** `rawScore * (windowDays / tenureWindowDays)`. Null when exposure is zero. */
  tenureAdjustedRate: number | null;
  /** Cross-cohort percentile of `tenureAdjustedRate`. */
  tenureAdjustedPercentile: number | null;

  /** Mean of the three present adjusted percentiles; falls back to raw. */
  adjustedPercentile: number | null;
  /** `adjustedPercentile - rawPercentile` — positive means adjustments lifted. */
  adjustmentDelta: number | null;

  /** Plain-language adjustment trail per engineer. */
  adjustmentsApplied: string[];
}

export interface NormalisationBundle {
  /** Human-readable description of the raw signal fed into normalisation. */
  sourceSignal: string;
  /** The minimum-cohort threshold used for discipline pooling. */
  minCohortSize: number;
  /** Signal window in days — also the ceiling on tenure-exposure boost. */
  windowDays: number;
  /** Ramp-up threshold in days (below this, engineers are non-competitive). */
  rampUpDays: number;
  /** All competitive engineers with their normalisation values. */
  entries: EngineerNormalisation[];
  /** Discipline cohort summary table, sorted by cohort size descending. */
  disciplineCohorts: DisciplineCohortSummary[];
  /** OLS fit details for the level-residual adjustment. */
  levelFit: LevelFit | null;
  /** Plain-language summary of the adjustments applied, shown on the page. */
  adjustmentNotes: string[];
}

function linearFit(
  points: Array<{ x: number; y: number }>,
): LevelFit | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let denom = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    denom += (p.x - meanX) ** 2;
  }
  if (denom === 0) return null;
  const slope = num / denom;
  return { slope, intercept: meanY - slope * meanX, sampleSize: n };
}

function resolveDisciplineCohort(
  discipline: Discipline,
  sizesByDiscipline: Map<Discipline, number>,
  minSize: number,
  totalCompetitive: number,
): DisciplineCohortInfo {
  const own = sizesByDiscipline.get(discipline) ?? 0;
  if (own >= minSize) {
    return {
      discipline,
      effectiveMembers: [discipline],
      effectiveSize: own,
      pooled: false,
      pooledWith: [],
      pooledToAll: false,
      note: `Own cohort (${own} engineers)`,
    };
  }
  const fallback = DISCIPLINE_POOL_FALLBACK[discipline] ?? [];
  const members: Discipline[] = [discipline];
  const pooledWith: Discipline[] = [];
  let size = own;
  for (const other of fallback) {
    if (other === discipline) continue;
    const otherSize = sizesByDiscipline.get(other) ?? 0;
    members.push(other);
    pooledWith.push(other);
    size += otherSize;
    if (size >= minSize) {
      return {
        discipline,
        effectiveMembers: members,
        effectiveSize: size,
        pooled: true,
        pooledWith,
        pooledToAll: false,
        note: `Pooled with ${pooledWith.join("+")} (${size} engineers)`,
      };
    }
  }
  // Own + fallback chain still too small → fall through to every competitive
  // engineer. Members become every discipline observed in the cohort.
  const allDisciplines = [...sizesByDiscipline.keys()];
  const extraPooled = allDisciplines.filter(
    (d) => d !== discipline && !pooledWith.includes(d),
  );
  return {
    discipline,
    effectiveMembers: allDisciplines,
    effectiveSize: totalCompetitive,
    pooled: true,
    pooledWith: [...pooledWith, ...extraPooled],
    pooledToAll: true,
    note: `Pooled to all competitive engineers (${totalCompetitive} engineers) — own discipline plus fallback chain still below ${minSize}`,
  };
}

/**
 * Build the tenure/role normalisation layer.
 *
 * Pipeline:
 * 1. Filter to competitive entries and compute the log-impact rawScore from
 *    persisted GitHub signals.
 * 2. Compute the cross-cohort rank-percentile (`rawPercentile`).
 * 3. For each distinct discipline, resolve the effective cohort via the
 *    pooling fallback and compute the rank-percentile of `rawScore` within
 *    that cohort. Documented on the page so the reader sees what pool each
 *    engineer was ranked against.
 * 4. OLS fit of rawScore on level number gives a level baseline. Residual
 *    percentiles reward engineers scoring above their level's expectation.
 * 5. Tenure-exposure adjusts rawScore by `windowDays / min(tenureDays, windowDays)`
 *    so engineers with `rampUpDays <= tenure < windowDays` get proportional
 *    lift, not a penalty for partial-window exposure.
 * 6. `adjustedPercentile` = mean of present adjusted components; falls back
 *    to `rawPercentile` when no adjustment is computable.
 */
export function buildNormalisation({
  entries,
  signals = [],
  windowDays = RANKING_SIGNAL_WINDOW_DAYS,
  rampUpDays = RANKING_RAMP_UP_DAYS,
  minCohortSize = RANKING_MIN_COHORT_SIZE,
}: {
  entries: EligibilityEntry[];
  signals?: PerEngineerSignalRow[];
  windowDays?: number;
  rampUpDays?: number;
  minCohortSize?: number;
}): NormalisationBundle {
  const competitive = entries.filter((e) => e.eligibility === "competitive");
  const signalByHash = new Map(signals.map((s) => [s.emailHash, s]));

  const rawScores: Array<number | null> = competitive.map((entry) =>
    logImpact(signalByHash.get(entry.emailHash)),
  );
  const rawPercentiles = rankPercentiles(rawScores);

  const disciplineSizes = new Map<Discipline, number>();
  for (const entry of competitive) {
    disciplineSizes.set(
      entry.discipline,
      (disciplineSizes.get(entry.discipline) ?? 0) + 1,
    );
  }

  const cohortByDiscipline = new Map<Discipline, DisciplineCohortInfo>();
  for (const d of disciplineSizes.keys()) {
    cohortByDiscipline.set(
      d,
      resolveDisciplineCohort(d, disciplineSizes, minCohortSize, competitive.length),
    );
  }

  const disciplinePercentiles: Array<number | null> = new Array(
    competitive.length,
  ).fill(null);
  for (let i = 0; i < competitive.length; i += 1) {
    const engineer = competitive[i];
    const cohort = cohortByDiscipline.get(engineer.discipline);
    if (!cohort) continue;
    const memberSet = new Set<Discipline>(cohort.effectiveMembers);
    const indicesInCohort: number[] = [];
    const valuesInCohort: Array<number | null> = [];
    for (let j = 0; j < competitive.length; j += 1) {
      if (!memberSet.has(competitive[j].discipline)) continue;
      indicesInCohort.push(j);
      valuesInCohort.push(rawScores[j]);
    }
    const cohortPcts = rankPercentiles(valuesInCohort);
    const localIdx = indicesInCohort.indexOf(i);
    if (localIdx >= 0) {
      disciplinePercentiles[i] = cohortPcts[localIdx];
    }
  }

  const levelPoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < competitive.length; i += 1) {
    const lvl = levelNumber(competitive[i].levelLabel);
    const raw = rawScores[i];
    if (lvl === null || raw === null) continue;
    levelPoints.push({ x: lvl, y: raw });
  }
  const levelFit = linearFit(levelPoints);

  const levelResiduals: Array<number | null> = competitive.map((entry, i) => {
    const lvl = levelNumber(entry.levelLabel);
    const raw = rawScores[i];
    if (lvl === null || raw === null || !levelFit) return null;
    const predicted = levelFit.intercept + levelFit.slope * lvl;
    return raw - predicted;
  });
  const levelAdjustedPercentiles = rankPercentiles(levelResiduals);

  const tenureRates: Array<number | null> = competitive.map((entry, i) => {
    const raw = rawScores[i];
    if (raw === null) return null;
    const td = entry.tenureDays;
    if (td === null || td <= 0) return null;
    const exposure = Math.min(td, windowDays);
    if (exposure <= 0) return null;
    return raw * (windowDays / exposure);
  });
  const tenureAdjustedPercentiles = rankPercentiles(tenureRates);

  const normalisedEntries: EngineerNormalisation[] = competitive.map(
    (entry, i) => {
      const cohort =
        cohortByDiscipline.get(entry.discipline) ??
        resolveDisciplineCohort(
          entry.discipline,
          disciplineSizes,
          minCohortSize,
          competitive.length,
        );
      const lvl = levelNumber(entry.levelLabel);
      const raw = rawScores[i];
      const td = entry.tenureDays;
      const exposure = td !== null && td > 0 ? Math.min(td, windowDays) : 0;
      const levelBaseline =
        lvl !== null && levelFit
          ? levelFit.intercept + levelFit.slope * lvl
          : null;

      const present: number[] = [];
      const disciplinePct = disciplinePercentiles[i];
      const levelPct = levelAdjustedPercentiles[i];
      const tenurePct = tenureAdjustedPercentiles[i];
      if (disciplinePct !== null) present.push(disciplinePct);
      if (levelPct !== null) present.push(levelPct);
      if (tenurePct !== null) present.push(tenurePct);

      const rawPct = rawPercentiles[i];
      const adjusted =
        present.length === 0
          ? rawPct
          : present.reduce((s, v) => s + v, 0) / present.length;
      const adjustmentDelta =
        adjusted !== null && rawPct !== null ? adjusted - rawPct : null;

      const adjustmentsApplied: string[] = [];
      if (disciplinePct !== null) {
        adjustmentsApplied.push(
          cohort.pooled
            ? `Discipline: pooled to ${cohort.effectiveMembers.join("+")} (${cohort.effectiveSize} engineers)`
            : `Discipline: ${entry.discipline} cohort (${cohort.effectiveSize} engineers)`,
        );
      }
      if (levelPct !== null && levelFit) {
        adjustmentsApplied.push(
          `Level residual: L${lvl} baseline ${levelBaseline!.toFixed(2)}, slope ${levelFit.slope.toFixed(2)} on ${levelFit.sampleSize} engineers`,
        );
      }
      if (tenurePct !== null && td !== null) {
        const boost = exposure > 0 ? windowDays / exposure : 1;
        adjustmentsApplied.push(
          `Tenure exposure: ${exposure}/${windowDays}d${
            boost > 1 ? ` (×${boost.toFixed(2)} rate lift)` : ""
          }`,
        );
      }

      return {
        emailHash: entry.emailHash,
        displayName: entry.displayName,
        discipline: entry.discipline,
        levelLabel: entry.levelLabel,
        levelNumber: lvl,
        tenureDays: td,
        tenureWindowDays: exposure,
        rawScore: raw,
        rawPercentile: rawPct,
        disciplineCohort: cohort,
        disciplinePercentile: disciplinePct,
        levelBaseline,
        levelAdjustedResidual: levelResiduals[i],
        levelAdjustedPercentile: levelPct,
        tenureAdjustedRate: tenureRates[i],
        tenureAdjustedPercentile: tenurePct,
        adjustedPercentile: adjusted,
        adjustmentDelta,
        adjustmentsApplied,
      };
    },
  );

  const disciplineCohorts: DisciplineCohortSummary[] = [
    ...disciplineSizes.entries(),
  ]
    .map(([discipline, size]) => {
      const info =
        cohortByDiscipline.get(discipline) ??
        resolveDisciplineCohort(
          discipline,
          disciplineSizes,
          minCohortSize,
          competitive.length,
        );
      return {
        discipline,
        size,
        pooled: info.pooled,
        pooledWith: [...info.pooledWith],
        pooledToAll: info.pooledToAll,
        effectiveSize: info.effectiveSize,
      };
    })
    .sort((a, b) => b.size - a.size || a.discipline.localeCompare(b.discipline));

  const adjustmentNotes: string[] = [
    `Raw score is the log-impact composite from persisted GitHub PR data (same formula as lens A's dominant component). AI tokens, AI spend, and per-PR LLM rubric are deliberately excluded so adjustments cannot be inflated by gameable inputs.`,
    `Discipline percentile: rank-percentile within the engineer's discipline cohort. Cohorts with fewer than ${minCohortSize} competitive engineers pool via the documented fallback (e.g. ML → BE; EM → BE+FE) and fall through to the full competitive cohort only if the pool is still too small. Pooling is named in the per-engineer adjustment trail.`,
    `Level-adjusted residual: OLS fit of rawScore on level number across ${levelFit?.sampleSize ?? 0} competitive engineers${
      levelFit
        ? ` (slope ${levelFit.slope.toFixed(2)}, intercept ${levelFit.intercept.toFixed(2)})`
        : " (fit unavailable — <2 engineers with both level and rawScore)"
    }. Residual percentiles reward scoring above the engineer's level baseline; two engineers with the same rawScore but different levels receive different adjusted percentiles.`,
    `Tenure-exposure adjusted rate: rawScore × (${windowDays} / min(tenureDays, ${windowDays})). Engineers in the ${rampUpDays}–${windowDays}d tenure band receive proportional rate lift so partial-window exposure is not read as low output. Engineers with tenure ≥ ${windowDays}d receive no lift; the adjustment never penalises long-tenured engineers.`,
    `Ramp-up cohort (< ${rampUpDays}d tenure) is excluded from competitive normalisation and kept in the eligibility roster only, so a new joiner is never competitively ranked at the bottom for being new.`,
    `adjustedPercentile = mean of the three present adjusted components (discipline / level / tenure). Engineers with all three adjustments null (e.g. no rawScore because they have no persisted PR activity in the window) fall back to rawPercentile, and their adjustmentDelta is null.`,
  ];

  return {
    sourceSignal: "Log-impact composite (PR count × log2(1 + churn/PR))",
    minCohortSize,
    windowDays,
    rampUpDays,
    entries: normalisedEntries,
    disciplineCohorts,
    levelFit,
    adjustmentNotes,
  };
}

/**
 * Split normalisation entries into strictly-positive "lifts" and strictly-
 * negative "drops" by `adjustmentDelta`, each sorted by magnitude and capped
 * at `limit`. Null or non-finite deltas are excluded from both buckets; zero
 * deltas are excluded too — a zero delta is neither a lift nor a drop and
 * must never appear under either heading.
 */
export function bucketNormalisationDeltas(
  entries: readonly EngineerNormalisation[],
  limit: number,
): { lifts: EngineerNormalisation[]; drops: EngineerNormalisation[] } {
  const finite = entries.filter(
    (e) => e.adjustmentDelta !== null && Number.isFinite(e.adjustmentDelta),
  );
  const lifts = finite
    .filter((e) => (e.adjustmentDelta as number) > 0)
    .slice()
    .sort((a, b) => (b.adjustmentDelta as number) - (a.adjustmentDelta as number))
    .slice(0, limit);
  const drops = finite
    .filter((e) => (e.adjustmentDelta as number) < 0)
    .slice()
    .sort((a, b) => (a.adjustmentDelta as number) - (b.adjustmentDelta as number))
    .slice(0, limit);
  return { lifts, drops };
}

/* --------------------------------------------------------------------------
 * M12 — composite score contract + sensitivity and dominance checks
 * ------------------------------------------------------------------------ */

/**
 * Minimum number of scored methods (A output, B impact, C delivery, adjusted)
 * an engineer must have present for the composite median to be computed.
 * Below this threshold the composite is null — we refuse to synthesise a
 * ranking from a single method because it would collapse into that one
 * method's bias.
 */
export const RANKING_COMPOSITE_MIN_METHODS = 2 as const;

/**
 * Any single raw signal whose effective weight in the composite exceeds this
 * threshold must be explicitly justified in the methodology panel — otherwise
 * the composite is dominated by one signal and the page surfaces a dominance
 * warning.
 */
export const RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT = 0.3 as const;

/**
 * If the final composite rank is Spearman-correlated with raw PR count (or
 * log-impact) above this threshold the methodology has collapsed into
 * activity volume — surface a dominance warning and block the ranking from
 * being read as a final adjudication until the correlation falls.
 */
export const RANKING_MAX_ACTIVITY_CORRELATION = 0.75 as const;

/** Engineers surfaced in the composite top-N on the page. */
export const RANKING_COMPOSITE_TOP_N = 25 as const;

/** Top N movers surfaced per leave-one-method-out row. */
export const RANKING_LEAVE_ONE_OUT_TOP_MOVERS = 10 as const;

/**
 * The four methods combined into the composite. A/B/C are the M8 lenses;
 * `adjusted` is the M10 tenure/role-adjusted percentile. Equal-method median
 * is robust to one noisy method — a single lens producing a bad reading
 * (e.g. SHAP disagreement on one engineer) cannot drag the composite more
 * than the other three methods allow.
 */
export type CompositeMethod = "output" | "impact" | "delivery" | "adjusted";

/** Human-readable label for each composite method, shown on the page. */
export const RANKING_COMPOSITE_METHOD_LABELS: Record<CompositeMethod, string> = {
  output: "A — Individual output",
  impact: "B — SHAP impact",
  delivery: "C — Squad delivery context",
  adjusted: "Tenure/role-adjusted percentile",
};

/**
 * The raw-signal weights each composite method carries. Used only for the
 * effective signal-weight decomposition — the composite itself is the median
 * of the four method scores, not a weighted sum. `adjusted` is 100%
 * log-impact because the M10 normalisation layer's rawScore is the log-impact
 * composite and all three sub-adjustments (discipline, level, tenure) operate
 * on that one raw signal.
 */
export const RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS: Record<
  CompositeMethod,
  readonly { signal: string; weight: number }[]
> = {
  output: [
    { signal: "Log-impact composite", weight: 0.5 },
    { signal: "PR count (sqrt-damped)", weight: 0.2 },
    { signal: "Commit count (sqrt-damped)", weight: 0.15 },
    { signal: "Net lines (log-signed)", weight: 0.15 },
  ],
  impact: [
    { signal: "SHAP predicted impact", weight: 0.4 },
    { signal: "SHAP actual impact", weight: 0.4 },
    { signal: "SHAP residual", weight: 0.2 },
  ],
  delivery: [
    { signal: "Squad review rate %", weight: 0.4 },
    { signal: "Squad cycle time (inverted)", weight: 0.3 },
    { signal: "Squad time-to-first-review (inverted)", weight: 0.3 },
  ],
  adjusted: [
    // Every sub-adjustment in the M10 normalisation layer uses log-impact as
    // the rawScore. Surfaced as 100% log-impact so the effective-weight sum
    // truthfully reflects this overlap with lens A.
    { signal: "Log-impact composite", weight: 1.0 },
  ],
};

/** Per-engineer composite entry. Carries each method's percentile + composite. */
export interface EngineerCompositeEntry {
  emailHash: string;
  displayName: string;
  discipline: Discipline;
  levelLabel: string;
  output: number | null;
  impact: number | null;
  delivery: number | null;
  adjusted: number | null;
  presentMethodCount: number;
  /** Median of present methods on [0, 100]; null if fewer than the min methods. */
  composite: number | null;
  /** Cross-cohort rank-percentile of `composite`; null when composite is null. */
  compositePercentile: number | null;
  /** 1-indexed rank among engineers with a non-null composite; null otherwise. */
  rank: number | null;
  /** Plain-language description of how the composite was formed for this row. */
  methodsSummary: string;
}

/** One effective signal weight broken down per contributing method. */
export interface EffectiveSignalWeightContribution {
  method: CompositeMethod;
  methodWeight: number;
  signalWeightInMethod: number;
  effectiveWeight: number;
}

/** Aggregated effective weight for a single raw signal across the composite. */
export interface EffectiveSignalWeight {
  signal: string;
  totalWeight: number;
  contributions: EffectiveSignalWeightContribution[];
  /** True when `totalWeight > RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT`. */
  flagged: boolean;
  /** Methodology justification; null unless flagged. */
  justification: string | null;
}

/** One leave-one-method-out sensitivity row. */
export interface LeaveOneMethodOut {
  removed: CompositeMethod;
  removedLabel: string;
  scoredBefore: number;
  scoredAfter: number;
  /**
   * Spearman rho between the baseline composite rank and the rank that would
   * result from dropping this method. Computed over engineers scored in both.
   * `null` when either side has fewer than two scored engineers.
   */
  correlationToBaseline: number | null;
  /** Top engineers by absolute rank delta when the method is removed. */
  movers: Array<{
    emailHash: string;
    displayName: string;
    baselineRank: number | null;
    newRank: number | null;
    delta: number | null;
  }>;
}

/** Spearman rho of the final composite rank against a specific signal. */
export interface FinalRankCorrelation {
  signal: string;
  rho: number | null;
  n: number;
  /** Raw-activity signals we pin as dominance risks (PR count, log-impact). */
  dominanceRisk: boolean;
  /** `|rho| > RANKING_MAX_ACTIVITY_CORRELATION`; only meaningful when `dominanceRisk`. */
  exceedsThreshold: boolean;
}

export interface CompositeBundle {
  /** Plain-language description of how the composite is formed. */
  contract: string;
  /** The methods combined into the composite. */
  methods: readonly CompositeMethod[];
  /** Minimum present-method count to produce a composite (`null` below this). */
  minPresentMethods: number;
  /** Effective-weight threshold above which a signal must be justified. */
  maxSingleSignalEffectiveWeight: number;
  /** Dominance-correlation threshold against PR count / log-impact. */
  dominanceCorrelationThreshold: number;
  /** Every competitive engineer, scored or unscored. */
  entries: EngineerCompositeEntry[];
  /** Top `RANKING_COMPOSITE_TOP_N` scored engineers by composite. */
  topN: EngineerCompositeEntry[];
  /** Decomposition of the composite's raw-signal weights. */
  effectiveSignalWeights: EffectiveSignalWeight[];
  /** One row per composite method, measuring that method's leverage on the rank. */
  leaveOneOut: LeaveOneMethodOut[];
  /** Spearman of composite rank against each per-engineer numeric signal. */
  finalRankCorrelations: FinalRankCorrelation[];
  /** Plain-language dominance warnings surfaced next to the ranking. */
  dominanceWarnings: string[];
  /** True when any dominance-risk signal exceeds the activity correlation. */
  dominanceBlocked: boolean;
  /** Plain-language composite-stage limitations shown on the page. */
  limitations: string[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Justifications surfaced when an effective signal weight exceeds the
 * `RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT` threshold. Documented here
 * rather than synthesised at render time so the page's methodology panel
 * and the worklog stay in sync.
 */
const EFFECTIVE_SIGNAL_JUSTIFICATIONS: Record<string, string> = {
  "Log-impact composite":
    "Log-impact appears in both lens A (the largest weighted component) and the M10 normalisation layer (which is built on this single rawScore), so its effective weight across the composite exceeds 30%. Until the per-PR LLM rubric or individual review/cycle-time signals land, no higher-quality per-engineer input exists to dilute the share — this is an explicit methodology trade-off, not an oversight, and is named on the dominance panel.",
};

/**
 * Raw numeric signals we treat as dominance risks. If the final composite
 * rank correlates with any of these above `RANKING_MAX_ACTIVITY_CORRELATION`
 * the ranking has collapsed into activity volume and the page must warn.
 */
const DOMINANCE_RISK_SIGNALS = new Set<string>([
  "PR count",
  "Log impact",
]);

function computeEffectiveSignalWeights(
  methods: readonly CompositeMethod[],
): EffectiveSignalWeight[] {
  if (methods.length === 0) return [];
  const methodWeight = 1 / methods.length;
  const byName = new Map<string, EffectiveSignalWeight>();
  for (const method of methods) {
    for (const { signal, weight } of RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS[
      method
    ]) {
      const contribution: EffectiveSignalWeightContribution = {
        method,
        methodWeight,
        signalWeightInMethod: weight,
        effectiveWeight: methodWeight * weight,
      };
      const existing = byName.get(signal);
      if (existing) {
        existing.totalWeight += contribution.effectiveWeight;
        existing.contributions.push(contribution);
      } else {
        byName.set(signal, {
          signal,
          totalWeight: contribution.effectiveWeight,
          contributions: [contribution],
          flagged: false,
          justification: null,
        });
      }
    }
  }
  const totals = [...byName.values()].sort(
    (a, b) => b.totalWeight - a.totalWeight || a.signal.localeCompare(b.signal),
  );
  for (const t of totals) {
    if (t.totalWeight > RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT) {
      t.flagged = true;
      t.justification = EFFECTIVE_SIGNAL_JUSTIFICATIONS[t.signal] ?? null;
    }
  }
  return totals;
}

function rankScoredEntries(
  scores: Array<number | null>,
): Array<number | null> {
  const present: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < scores.length; i += 1) {
    const s = scores[i];
    if (s === null || !Number.isFinite(s)) continue;
    present.push({ index: i, score: s });
  }
  present.sort((a, b) => b.score - a.score);
  const ranks = new Array<number | null>(scores.length).fill(null);
  for (let i = 0; i < present.length; i += 1) {
    ranks[present[i].index] = i + 1;
  }
  return ranks;
}

function methodsPresentSummary(
  methodScores: Array<{ key: CompositeMethod; value: number | null }>,
): string {
  const present = methodScores
    .filter((m) => m.value !== null)
    .map((m) => RANKING_COMPOSITE_METHOD_LABELS[m.key]);
  if (present.length === 0) return "No methods present — composite null.";
  if (present.length < RANKING_COMPOSITE_MIN_METHODS) {
    return `Only ${present.join(", ")} present — below the ${RANKING_COMPOSITE_MIN_METHODS}-method minimum for composite.`;
  }
  return `Median of ${present.join(", ")} (${present.length}/4 methods present).`;
}

/**
 * Build the composite ranking bundle.
 *
 * Contract:
 *   composite = median(present methods)
 *   where the methods are A (output), B (impact), C (delivery), adjusted
 *
 * The median is deliberately chosen over a weighted mean so a single noisy
 * lens cannot single-handedly drag an engineer's rank. An engineer must have
 * at least `RANKING_COMPOSITE_MIN_METHODS` present methods to be scored —
 * below this the composite is null, not a synthesised neutral.
 *
 * In addition to the per-engineer composite this function computes:
 *  - Effective raw-signal weight decomposition across all four methods and
 *    flags any signal that exceeds the 30% ceiling without a justification.
 *  - Leave-one-method-out sensitivity: the Spearman correlation between the
 *    baseline rank and the rank that results when each method is dropped,
 *    plus the top engineers whose rank moves the most.
 *  - Spearman correlation of the composite rank against each per-engineer
 *    numeric signal, with a dominance flag when PR count / log-impact
 *    correlates above `RANKING_MAX_ACTIVITY_CORRELATION`.
 */
export function buildComposite({
  entries,
  lenses,
  normalisation,
  signals = [],
}: {
  entries: EligibilityEntry[];
  lenses: LensesBundle;
  normalisation: NormalisationBundle;
  signals?: PerEngineerSignalRow[];
}): CompositeBundle {
  const competitive = entries.filter((e) => e.eligibility === "competitive");
  const signalByHash = new Map(signals.map((s) => [s.emailHash, s]));

  const methods: readonly CompositeMethod[] = [
    "output",
    "impact",
    "delivery",
    "adjusted",
  ];

  const outputByHash = new Map(
    lenses.lenses.output.entries.map((e) => [e.emailHash, e.score]),
  );
  const impactByHash = new Map(
    lenses.lenses.impact.entries.map((e) => [e.emailHash, e.score]),
  );
  const deliveryByHash = new Map(
    lenses.lenses.delivery.entries.map((e) => [e.emailHash, e.score]),
  );
  const adjustedByHash = new Map(
    normalisation.entries.map((e) => [e.emailHash, e.adjustedPercentile]),
  );

  const rawEntries: EngineerCompositeEntry[] = competitive.map((entry) => {
    const output = outputByHash.get(entry.emailHash) ?? null;
    const impact = impactByHash.get(entry.emailHash) ?? null;
    const delivery = deliveryByHash.get(entry.emailHash) ?? null;
    const adjusted = adjustedByHash.get(entry.emailHash) ?? null;

    const methodScores: Array<{ key: CompositeMethod; value: number | null }> =
      [
        { key: "output", value: output },
        { key: "impact", value: impact },
        { key: "delivery", value: delivery },
        { key: "adjusted", value: adjusted },
      ];
    const presentValues = methodScores
      .map((m) => m.value)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const composite =
      presentValues.length < RANKING_COMPOSITE_MIN_METHODS
        ? null
        : median(presentValues);

    return {
      emailHash: entry.emailHash,
      displayName: entry.displayName,
      discipline: entry.discipline,
      levelLabel: entry.levelLabel,
      output,
      impact,
      delivery,
      adjusted,
      presentMethodCount: presentValues.length,
      composite,
      compositePercentile: null,
      rank: null,
      methodsSummary: methodsPresentSummary(methodScores),
    };
  });

  const compositeScores = rawEntries.map((e) => e.composite);
  const compositePercentiles = rankPercentiles(compositeScores);
  const ranks = rankScoredEntries(compositeScores);
  const entriesOut: EngineerCompositeEntry[] = rawEntries.map((entry, i) => ({
    ...entry,
    compositePercentile: compositePercentiles[i],
    rank: ranks[i],
  }));

  const topN = [...entriesOut]
    .filter(
      (e): e is EngineerCompositeEntry & { composite: number; rank: number } =>
        e.composite !== null && e.rank !== null,
    )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, RANKING_COMPOSITE_TOP_N);

  const effectiveSignalWeights = computeEffectiveSignalWeights(methods);

  const leaveOneOut: LeaveOneMethodOut[] = methods.map((removed) => {
    const kept: CompositeMethod[] = methods.filter((m) => m !== removed);
    const altScores: Array<number | null> = rawEntries.map((e) => {
      const keep: number[] = [];
      for (const k of kept) {
        const v =
          k === "output"
            ? e.output
            : k === "impact"
              ? e.impact
              : k === "delivery"
                ? e.delivery
                : e.adjusted;
        if (v !== null && Number.isFinite(v)) keep.push(v);
      }
      if (keep.length < RANKING_COMPOSITE_MIN_METHODS) return null;
      return median(keep);
    });
    const altRanks = rankScoredEntries(altScores);
    const moverRows = entriesOut
      .map((e, i) => ({
        emailHash: e.emailHash,
        displayName: e.displayName,
        baselineRank: e.rank,
        newRank: altRanks[i],
        delta:
          e.rank !== null && altRanks[i] !== null
            ? altRanks[i]! - e.rank
            : null,
      }))
      .filter((row) => row.baselineRank !== null || row.newRank !== null);
    const sortedMovers = [...moverRows].sort((a, b) => {
      const da = a.delta === null ? -Infinity : Math.abs(a.delta);
      const db = b.delta === null ? -Infinity : Math.abs(b.delta);
      if (db !== da) return db - da;
      return a.displayName.localeCompare(b.displayName);
    });
    const scoredBefore = entriesOut.filter((e) => e.rank !== null).length;
    const scoredAfter = altRanks.filter((r) => r !== null).length;
    const { rho } = computeSpearmanRho(
      entriesOut.map((e) => e.rank),
      altRanks,
    );
    return {
      removed,
      removedLabel: RANKING_COMPOSITE_METHOD_LABELS[removed],
      scoredBefore,
      scoredAfter,
      correlationToBaseline: rho,
      movers: sortedMovers.slice(0, RANKING_LEAVE_ONE_OUT_TOP_MOVERS),
    };
  });

  const compositeRanks = entriesOut.map((e) => e.rank);
  const finalRankCorrelations: FinalRankCorrelation[] = [];
  for (const spec of NUMERIC_SIGNAL_SPECS) {
    const values: Array<number | null> = competitive.map((entry) =>
      spec.getValue(entry, signalByHash.get(entry.emailHash)),
    );
    // Correlate composite rank (ascending = better) against the signal.
    // Invert rank so that a larger number = better rank, which is what
    // "positive correlation" with a better signal should produce.
    const rankScores = compositeRanks.map((r) =>
      r === null ? null : -r,
    );
    const { rho, n } = computeSpearmanRho(rankScores, values);
    const dominanceRisk = DOMINANCE_RISK_SIGNALS.has(spec.name);
    const exceedsThreshold =
      dominanceRisk &&
      rho !== null &&
      Math.abs(rho) > RANKING_MAX_ACTIVITY_CORRELATION;
    finalRankCorrelations.push({
      signal: spec.name,
      rho,
      n,
      dominanceRisk,
      exceedsThreshold,
    });
  }

  const dominanceWarnings: string[] = [];
  for (const w of effectiveSignalWeights) {
    if (w.flagged) {
      const pct = (w.totalWeight * 100).toFixed(1);
      dominanceWarnings.push(
        `${w.signal} carries ${pct}% effective weight in the composite — above the ${(
          RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT * 100
        ).toFixed(0)}% ceiling. ${w.justification ?? "No methodology justification recorded."}`,
      );
    }
  }
  let dominanceBlocked = false;
  for (const c of finalRankCorrelations) {
    if (c.exceedsThreshold) {
      dominanceBlocked = true;
      dominanceWarnings.push(
        `Final composite rank is Spearman ρ ${c.rho!.toFixed(
          2,
        )} against ${c.signal} (n=${c.n}) — above the ${RANKING_MAX_ACTIVITY_CORRELATION} activity-dominance threshold. The ranking has collapsed into activity volume; additional orthogonal signals are required before it is safe to read as a final adjudication.`,
      );
    }
  }

  return {
    contract:
      "Composite = median of the four methods (A output, B impact, C delivery, tenure/role-adjusted percentile). Equal-method median — a single noisy method cannot single-handedly drag the rank. Engineers with fewer than " +
      `${RANKING_COMPOSITE_MIN_METHODS} present methods are unscored, not assigned a synthesised neutral rank.`,
    methods,
    minPresentMethods: RANKING_COMPOSITE_MIN_METHODS,
    maxSingleSignalEffectiveWeight: RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT,
    dominanceCorrelationThreshold: RANKING_MAX_ACTIVITY_CORRELATION,
    entries: entriesOut,
    topN,
    effectiveSignalWeights,
    leaveOneOut,
    finalRankCorrelations,
    dominanceWarnings,
    dominanceBlocked,
    limitations: [
      "Composite is the median of present methods. It is explicit about what is scored and what is not — engineers with fewer than 2 present methods are unscored, not ranked at the bottom.",
      "Log-impact appears in both lens A and the M10 normalisation layer, which pushes its effective weight above the 30% ceiling. The dominance panel names this trade-off; the rank should not be read as final until per-PR quality signals dilute its share.",
      "Dominance check: if the final rank's Spearman correlation with PR count or log-impact exceeds 0.75 the ranking has collapsed into activity volume and the page warns. Do not override the warning without a methodology change.",
      "Confidence bands (M14) sit on top of the composite via the dedicated confidence bundle and the on-page CI rendering. Per-engineer attribution drilldowns (M15) are live via the attribution bundle. Privacy-preserving ranking snapshot persistence (M16) is live — snapshots key on (snapshotDate, methodologyVersion, emailHash) and never store display name, email, manager, or resolved GitHub login. Movers view (M18) is live — risers, fallers, cohort entrants, and cohort exits are diffed against the most recent comparable prior snapshot with conservative cause narration. The methodology panel, anti-gaming audit, freshness badges, and manager-calibration stub (M21) are live. The stability check is still pending — the composite is an evidence rank, not a final adjudication until it lands.",
    ],
  };
}

/* ------------------------------------------------------------------------ */
/* M14 confidence bands and statistical tie handling                        */
/* ------------------------------------------------------------------------ */

/**
 * Number of bootstrap iterations used to build per-engineer confidence
 * intervals. The plan's lower bound is 200; we keep this exact so the
 * bootstrap is deterministic and fast enough to run on every request.
 */
export const RANKING_BOOTSTRAP_ITERATIONS = 200 as const;

/**
 * Coverage of the per-engineer confidence interval expressed as a
 * proportion (0.8 = 80% CI). The matching quantiles are 0.10 and 0.90.
 */
export const RANKING_CI_COVERAGE = 0.8 as const;

/**
 * Multiplier applied to every per-engineer sigma when the composite is
 * `dominanceBlocked`. The plan asks for "wider or labelled confidence"
 * when the rank has collapsed into activity volume — widening every band
 * by a fixed factor surfaces this on the page without inventing a separate
 * label that the reader has to learn.
 */
export const RANKING_DOMINANCE_WIDENING = 1.5 as const;

/**
 * PR count below which the per-engineer sigma is widened. An engineer with
 * fewer than 10 merged PRs in the window has a much smaller sample of
 * activity than the cohort median, so the confidence band should reflect
 * that.
 */
export const RANKING_LOW_PR_COUNT_THRESHOLD = 10 as const;

/**
 * Tenure (in days) below which the per-engineer sigma is widened. The plan
 * uses "<12 months" — i.e. 365 days — as the cutoff for a tenure-driven
 * uncertainty bump that sits on top of the M10 normalisation layer.
 */
export const RANKING_LOW_TENURE_DAYS_FOR_CONFIDENCE = 365 as const;

/**
 * Floor and ceiling for the per-engineer sigma so bootstraps never collapse
 * to a precise point estimate (low end) or resample so wildly that the CI
 * spans the whole cohort (high end). Both are in composite-percentile units.
 */
export const RANKING_MIN_SIGMA = 1.5 as const;
export const RANKING_MAX_SIGMA = 30 as const;

/**
 * Seeded RNG constant for the M14 bootstrap. Snapshots are deterministic so
 * the M22 stability check can compare consecutive runs without picking up
 * methodology noise. Bumping the seed counts as a methodology change.
 */
export const RANKING_BOOTSTRAP_SEED = 0x9e_37_79_b1 as const;

/** Per-engineer confidence row attached to the M14 confidence bundle. */
export interface EngineerConfidence {
  emailHash: string;
  displayName: string;
  rank: number | null;
  composite: number | null;
  /** Standard error in composite-percentile units used by the bootstrap. */
  sigma: number | null;
  /** Lower bound of the CI in composite-percentile space (0..100). */
  ciLow: number | null;
  /** Upper bound of the CI in composite-percentile space (0..100). */
  ciHigh: number | null;
  /** Width of the CI in composite-percentile points (`ciHigh - ciLow`). */
  ciWidth: number | null;
  /** Lower bound of the CI in rank space (smaller = better). */
  ciRankLow: number | null;
  /** Upper bound of the CI in rank space. */
  ciRankHigh: number | null;
  /** Plain-language reasons the band was widened, named in the order applied. */
  uncertaintyFactors: string[];
  /** True when this engineer shares overlapping bands with at least one rank-neighbour. */
  inTieGroup: boolean;
  /** 1-indexed group id when `inTieGroup`, else null. */
  tieGroupId: number | null;
}

/** A connected run of rank-adjacent engineers with overlapping bands. */
export interface ConfidenceTieGroup {
  groupId: number;
  rankStart: number;
  rankEnd: number;
  size: number;
  members: Array<{
    emailHash: string;
    displayName: string;
    rank: number;
    composite: number;
    ciLow: number;
    ciHigh: number;
  }>;
}

export interface ConfidenceBundle {
  /** Plain-language description of the confidence methodology. */
  contract: string;
  bootstrapIterations: number;
  /** Coverage of the CI expressed as a proportion (0.8 = 80% CI). */
  ciCoverage: number;
  dominanceWidening: number;
  /** True when every sigma was widened by `dominanceWidening`. */
  globalDominanceApplied: boolean;
  /** All competitive engineers, scored or unscored. */
  entries: EngineerConfidence[];
  /** Statistical-tie groups in rank order; each group has at least 2 members. */
  tieGroups: ConfidenceTieGroup[];
  /** Plain-language confidence-stage limitations shown on the page. */
  limitations: string[];
}

/**
 * Mulberry32 — a 32-bit seeded PRNG. Deterministic, order-independent, and
 * fast. We use it instead of `Math.random` so the bootstrap is reproducible:
 * the same inputs always produce the same CI, which is what M21 stability
 * comparisons rely on.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Box-Muller transform — turn two uniforms into one standard-normal draw.
 * We discard the second draw to keep the function purely a "next sample"
 * helper; performance is fine at 200 iterations × ~50 engineers.
 */
function randnFromRng(rng: () => number): number {
  let u = rng();
  while (u <= Number.EPSILON) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

interface SigmaInputs {
  presentMethodCount: number;
  methodSpread: number;
  prCount: number | null;
  tenureDays: number | null;
  hasImpactModel: boolean;
  hasGithubLogin: boolean;
  globalDominance: boolean;
}

/**
 * Compute the per-engineer sigma (standard error) used by the bootstrap,
 * and the human-readable list of factors that widened it. The base sigma
 * is `methodSpread / 4 + RANKING_MIN_SIGMA` — the more lenses disagree,
 * the wider the prior — and individual factors multiply on top.
 *
 * Factor multipliers are deliberately small but non-trivial. The goal is
 * that a low-PR / short-tenure / SHAP-absent engineer ends up with a band
 * wide enough to overlap their rank-neighbour, so the page does not read
 * as a precise ordering at the bottom of the cohort.
 */
function computeSigmaFromInputs(inputs: SigmaInputs): {
  sigma: number;
  factors: string[];
} {
  const factors: string[] = [];
  let sigma = inputs.methodSpread / 4 + RANKING_MIN_SIGMA;

  if (inputs.presentMethodCount <= 2) {
    sigma *= 1.5;
    factors.push("Only 2 of 4 composite methods present — minimum-method scoring widens the band by 1.5×.");
  } else if (inputs.presentMethodCount === 3) {
    sigma *= 1.2;
    factors.push("3 of 4 composite methods present — one missing method widens the band by 1.2×.");
  }

  if (inputs.prCount !== null && inputs.prCount < RANKING_LOW_PR_COUNT_THRESHOLD) {
    sigma *= 1.4;
    factors.push(
      `PR count ${inputs.prCount} < ${RANKING_LOW_PR_COUNT_THRESHOLD} in the window — small-sample activity widens the band by 1.4×.`,
    );
  }

  if (
    inputs.tenureDays !== null &&
    inputs.tenureDays < RANKING_LOW_TENURE_DAYS_FOR_CONFIDENCE
  ) {
    sigma *= 1.3;
    factors.push(
      `Tenure ${inputs.tenureDays}d < ${RANKING_LOW_TENURE_DAYS_FOR_CONFIDENCE}d — short-tenure exposure widens the band by 1.3×.`,
    );
  }

  if (!inputs.hasImpactModel) {
    sigma *= 1.2;
    factors.push("Not in the impact-model training set — missing SHAP signal widens the band by 1.2×.");
  }

  if (!inputs.hasGithubLogin) {
    sigma *= 1.5;
    factors.push("No GitHub mapping — every activity signal is missing, widens the band by 1.5×.");
  }

  if (inputs.globalDominance) {
    sigma *= RANKING_DOMINANCE_WIDENING;
    factors.push(
      `Composite is dominance-blocked — every band is widened by ${RANKING_DOMINANCE_WIDENING}× until additional orthogonal signals dilute the activity dominance.`,
    );
  }

  if (sigma < RANKING_MIN_SIGMA) sigma = RANKING_MIN_SIGMA;
  if (sigma > RANKING_MAX_SIGMA) sigma = RANKING_MAX_SIGMA;
  return { sigma, factors };
}

/**
 * Build the M14 confidence bundle. For each scored engineer we:
 *  1. Estimate a sigma in composite-percentile units from method spread,
 *     PR count, tenure, impact-model presence, GitHub mapping, and the
 *     global dominance state.
 *  2. Resample the composite via `RANKING_BOOTSTRAP_ITERATIONS` jittered
 *     replicates and re-rank the cohort each replicate.
 *  3. Take the 0.10 and 0.90 quantiles of the resulting composite and rank
 *     distributions to form the 80% CI.
 *  4. Walk the engineers in rank order and group consecutive engineers
 *     whose CI bands overlap into statistical-tie groups (size ≥ 2).
 *
 * Engineers without a composite stay in `entries` with all band fields
 * null and an empty factor list — they are deliberately not bootstrapped
 * because the methodology refuses to synthesise a CI for an unscored row.
 */
export function buildConfidence({
  entries,
  composite,
  signals = [],
  iterations = RANKING_BOOTSTRAP_ITERATIONS,
  ciCoverage = RANKING_CI_COVERAGE,
  seed = RANKING_BOOTSTRAP_SEED,
}: {
  entries: EligibilityEntry[];
  composite: CompositeBundle;
  signals?: PerEngineerSignalRow[];
  iterations?: number;
  ciCoverage?: number;
  seed?: number;
}): ConfidenceBundle {
  const competitive = entries.filter((e) => e.eligibility === "competitive");
  const competitiveByHash = new Map(competitive.map((e) => [e.emailHash, e]));
  const signalByHash = new Map(signals.map((s) => [s.emailHash, s]));
  const compositeByHash = new Map(
    composite.entries.map((e) => [e.emailHash, e]),
  );

  const globalDominance = composite.dominanceBlocked;
  const lowQ = (1 - ciCoverage) / 2;
  const highQ = 1 - lowQ;

  // Order matches `composite.entries` so the bootstrap re-ranks the same
  // cohort the composite ranked. Unscored composite rows still take a slot
  // (with composite=null) so the rank distribution reflects the true cohort
  // size.
  const baseEntries = composite.entries;
  const baseComposites = baseEntries.map((c) => c.composite);
  const sigmaPerEntry: Array<number | null> = baseEntries.map((c) => {
    if (c.composite === null) return null;
    const eligibility = competitiveByHash.get(c.emailHash);
    const signal = signalByHash.get(c.emailHash);
    const presentValues = [c.output, c.impact, c.delivery, c.adjusted].filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    const methodSpread =
      presentValues.length === 0
        ? 0
        : Math.max(...presentValues) - Math.min(...presentValues);
    const { sigma } = computeSigmaFromInputs({
      presentMethodCount: c.presentMethodCount,
      methodSpread,
      prCount: signal?.prCount ?? null,
      tenureDays: eligibility?.tenureDays ?? null,
      hasImpactModel: Boolean(eligibility?.hasImpactModelRow),
      hasGithubLogin: Boolean(eligibility?.githubLogin),
      globalDominance,
    });
    return sigma;
  });
  const factorsPerEntry: string[][] = baseEntries.map((c) => {
    if (c.composite === null) return [];
    const eligibility = competitiveByHash.get(c.emailHash);
    const signal = signalByHash.get(c.emailHash);
    const presentValues = [c.output, c.impact, c.delivery, c.adjusted].filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    const methodSpread =
      presentValues.length === 0
        ? 0
        : Math.max(...presentValues) - Math.min(...presentValues);
    const { factors } = computeSigmaFromInputs({
      presentMethodCount: c.presentMethodCount,
      methodSpread,
      prCount: signal?.prCount ?? null,
      tenureDays: eligibility?.tenureDays ?? null,
      hasImpactModel: Boolean(eligibility?.hasImpactModelRow),
      hasGithubLogin: Boolean(eligibility?.githubLogin),
      globalDominance,
    });
    return factors;
  });

  const compositeSamples: number[][] = baseEntries.map(() => []);
  const rankSamples: number[][] = baseEntries.map(() => []);

  if (iterations > 0) {
    const rng = mulberry32(seed);
    for (let b = 0; b < iterations; b += 1) {
      const replicate: Array<number | null> = baseEntries.map((c, i) => {
        if (c.composite === null) return null;
        const sigma = sigmaPerEntry[i] ?? RANKING_MIN_SIGMA;
        let sample = c.composite + randnFromRng(rng) * sigma;
        if (sample < 0) sample = 0;
        if (sample > 100) sample = 100;
        return sample;
      });
      const replicateRanks = rankScoredEntries(replicate);
      for (let i = 0; i < baseEntries.length; i += 1) {
        const v = replicate[i];
        const r = replicateRanks[i];
        if (v !== null) compositeSamples[i].push(v);
        if (r !== null) rankSamples[i].push(r);
      }
    }
  }

  const confidenceEntries: EngineerConfidence[] = baseEntries.map((c, i) => {
    if (c.composite === null || c.rank === null) {
      return {
        emailHash: c.emailHash,
        displayName: c.displayName,
        rank: c.rank,
        composite: c.composite,
        sigma: null,
        ciLow: null,
        ciHigh: null,
        ciWidth: null,
        ciRankLow: null,
        ciRankHigh: null,
        uncertaintyFactors: [],
        inTieGroup: false,
        tieGroupId: null,
      };
    }
    const compSorted = [...compositeSamples[i]].sort((a, b) => a - b);
    const rankSorted = [...rankSamples[i]].sort((a, b) => a - b);
    const ciLow = compSorted.length > 0 ? quantileSorted(compSorted, lowQ) : c.composite;
    const ciHigh = compSorted.length > 0 ? quantileSorted(compSorted, highQ) : c.composite;
    const ciRankLow = rankSorted.length > 0 ? Math.round(quantileSorted(rankSorted, lowQ)) : c.rank;
    const ciRankHigh = rankSorted.length > 0 ? Math.round(quantileSorted(rankSorted, highQ)) : c.rank;
    return {
      emailHash: c.emailHash,
      displayName: c.displayName,
      rank: c.rank,
      composite: c.composite,
      sigma: sigmaPerEntry[i] ?? null,
      ciLow,
      ciHigh,
      ciWidth: ciHigh - ciLow,
      ciRankLow,
      ciRankHigh,
      uncertaintyFactors: factorsPerEntry[i],
      inTieGroup: false,
      tieGroupId: null,
    };
  });

  // Tie-group assembly: walk in rank order. Two consecutive engineers (a
  // higher rank, b next) share a statistical-tie group when a's lower
  // bound sits at or below b's upper bound — the bands meet, so the
  // ordering between them is not statistically distinguishable.
  const scored = confidenceEntries
    .filter(
      (e): e is EngineerConfidence & {
        rank: number;
        composite: number;
        ciLow: number;
        ciHigh: number;
      } =>
        e.rank !== null &&
        e.composite !== null &&
        e.ciLow !== null &&
        e.ciHigh !== null,
    )
    .sort((a, b) => a.rank - b.rank);

  const tieGroups: ConfidenceTieGroup[] = [];
  let currentGroup: typeof scored = [];
  const flushGroup = () => {
    if (currentGroup.length < 2) return;
    const groupId = tieGroups.length + 1;
    const ranks = currentGroup.map((e) => e.rank);
    tieGroups.push({
      groupId,
      rankStart: Math.min(...ranks),
      rankEnd: Math.max(...ranks),
      size: currentGroup.length,
      members: currentGroup.map((e) => ({
        emailHash: e.emailHash,
        displayName: e.displayName,
        rank: e.rank,
        composite: e.composite,
        ciLow: e.ciLow,
        ciHigh: e.ciHigh,
      })),
    });
    for (const member of currentGroup) {
      const target = confidenceEntries.find(
        (entry) => entry.emailHash === member.emailHash,
      );
      if (target) {
        target.inTieGroup = true;
        target.tieGroupId = groupId;
      }
    }
  };

  for (let idx = 0; idx < scored.length; idx += 1) {
    const e = scored[idx];
    if (currentGroup.length === 0) {
      currentGroup = [e];
      continue;
    }
    const prev = currentGroup[currentGroup.length - 1];
    // `prev` has the better (smaller) rank → higher composite. Bands overlap
    // when prev.ciLow <= e.ciHigh, i.e. prev's lower bound has fallen into
    // e's upper bound region.
    const overlap = prev.ciLow <= e.ciHigh;
    if (overlap) {
      currentGroup.push(e);
    } else {
      flushGroup();
      currentGroup = [e];
    }
  }
  flushGroup();

  const contract = `Confidence bands are an 80% bootstrap interval over ${RANKING_BOOTSTRAP_ITERATIONS} replicates. Per-engineer sigma starts from the spread between present composite methods and is widened by minimum-method scoring, low PR count (<${RANKING_LOW_PR_COUNT_THRESHOLD}), short tenure (<${RANKING_LOW_TENURE_DAYS_FOR_CONFIDENCE}d), missing impact-model rows, missing GitHub mapping, and a global dominance-blocked composite. Statistical-tie groups are runs of rank-adjacent engineers whose bands overlap; the page must not present an order between members of the same tie group as a defensible adjudication.`;

  return {
    contract,
    bootstrapIterations: iterations,
    ciCoverage,
    dominanceWidening: RANKING_DOMINANCE_WIDENING,
    globalDominanceApplied: globalDominance,
    entries: confidenceEntries,
    tieGroups,
    limitations: [
      `Confidence bands are an 80% bootstrap CI on the composite percentile. They are not a hypothesis test against the cohort median; they only express "given the methodology, this is the range of percentile values this engineer would land on under signal jitter".`,
      `Sigma is a deterministic function of method spread and the documented uncertainty factors (low PR count, short tenure, missing impact-model row, unmapped GitHub login, dominance-blocked composite). The factors are intentionally simple — better-calibrated sigmas need a labelled validation set we do not have today.`,
      `Statistical-tie groups are detected by rank-adjacent band overlap only. A more principled definition (e.g. all-pairs overlap inside a cluster) is a deferred refinement; today's groups should be read as "the page must not narrate an order here", not "these engineers are all equal in absolute terms".`,
      `Per-engineer attribution drilldowns (M15) are live and travel on the snapshot via the attribution bundle. Privacy-preserving ranking snapshot persistence (M16) is live — rows carry only the email hash, never display name / email / manager / resolved GitHub login. Movers view (M18) is live and attached to the snapshot via the movers bundle. The methodology panel, anti-gaming audit, freshness badges, and manager-calibration stub (M21) are live. The stability check remains the only outstanding methodology milestone.`,
    ],
  };
}

/* ------------------------------------------------------------------------ */
/* M15 per-engineer attribution drilldown                                   */
/* ------------------------------------------------------------------------ */

/**
 * Number of top positive/negative drivers surfaced per engineer in the
 * attribution drilldown. Small enough to keep the drilldown readable;
 * large enough that a CEO defending a rank can see more than one signal.
 */
export const RANKING_ATTRIBUTION_TOP_DRIVERS = 5 as const;

/**
 * Acceptable absolute error between the recomputed composite (median of the
 * per-engineer method scores) and the stored composite score. The composite
 * is exact arithmetic on the methods, so we keep this extremely tight —
 * anything above 0.05 percentile points indicates the per-engineer method
 * breakdown disagrees with the composite, which is a methodology defect, not
 * rounding noise.
 */
export const RANKING_ATTRIBUTION_TOLERANCE = 0.05 as const;

/** Whether a contribution is actually scored or surfaced as an absent signal. */
export type AttributionContributionKind = "present" | "absent";

/**
 * One component's view on an engineer's score — the building block of the
 * per-method breakdown. `percentile` is the engineer's rank-percentile on
 * [0, 100] for this component, with lower-is-better signals already inverted
 * so a higher percentile always reads as "better" on the drilldown. The
 * `approxCompositeLift` is a linear approximation of how far this one signal
 * pushed the composite above (or below) the neutral 50 — it is a useful
 * directional label, not the actual composite formula (which is median).
 */
export interface AttributionContribution {
  signal: string;
  method: CompositeMethod;
  methodLabel: string;
  kind: AttributionContributionKind;
  rawValue: number | null;
  percentile: number | null;
  /**
   * Weight of this component inside its method. Method components sum to 1
   * (weighted-mean contract) so this is directly comparable across
   * components within the same method.
   */
  weightInMethod: number;
  /**
   * Linear approximation of the signal's lift on the composite percentile
   * above the neutral point of 50. Defined as
   *   (1 / totalMethods) × weightInMethod × (percentile − 50)
   * when the method is present, null otherwise. Used only to tag positive vs
   * negative drivers — the composite itself is the median of the four method
   * scores, not a weighted sum, so this number is illustrative.
   */
  approxCompositeLift: number | null;
  /** Reason a signal is absent. Empty string when `kind === "present"`. */
  absenceReason: string;
}

/** Evidence references and availability badges surfaced per engineer. */
export interface EngineerAttributionEvidence {
  githubLogin: string | null;
  /**
   * Stable GitHub search URL scoped to this engineer's merged PRs within the
   * signal window. Null when no GitHub login is mapped or no org was supplied.
   * Per-PR rubric / review turnaround / cycle-time are not persisted today
   * (see the unavailable-signals audit), so this URL is the only per-PR
   * evidence link we can emit without fabricating a signal.
   */
  githubPrSearchUrl: string | null;
  impactModelPresent: boolean;
  squadContextPresent: boolean;
  /** Plain-language evidence-availability notes, including absent evidence. */
  notes: string[];
}

/** Manager-chain / squad / pillar context pulled from the eligibility row. */
export interface EngineerAttributionContext {
  manager: string | null;
  rawSquad: string | null;
  pillar: string | null;
  canonicalSquad: CanonicalSquadMetadata | null;
  /**
   * Direct-report context derived by scanning the eligibility roster for
   * engineers whose `manager` field matches this engineer. M21 surfaces this
   * so a manager can see, on their own drilldown, how many directs they have
   * in the ranking cohort — this is the basis for a later calibration
   * feedback loop (managers validating their directs' positions).
   *
   * `directReportHashes` contains email hashes only; display names are
   * resolved at request time from the current eligibility roster and never
   * persisted (matches the snapshot privacy invariant).
   */
  directReportCount: number;
  directReportHashes: readonly string[];
}

/**
 * Placeholder manager calibration status attached to every engineer
 * attribution entry. M21 ships the shape only — the feedback loop is not
 * wired yet. A later cycle can add a `confirmed` / `disputed` / `pending`
 * state without changing the ranking core because every entry already
 * carries this field.
 */
export interface EngineerAttributionCalibration {
  /**
   * Current calibration state. Always `"not_requested"` today — no manager
   * has been asked to confirm their directs yet. The string literal type
   * keeps every call site honest: adding a new state is an observable type
   * change, not a silent copy tweak.
   */
  status: "not_requested";
  /**
   * Plain-language explainer for the page ("Ranking is read-only evidence;
   * manager calibration feedback loop is structural only until the next
   * methodology milestone"). Kept as a field so the copy is one edit away
   * from being updated when the loop is wired.
   */
  note: string;
  /**
   * Email hash of the manager (resolved via the eligibility roster) so the
   * later feedback loop can target requests at the right user without
   * rejoining headcount. `null` when the engineer has no manager on record
   * or the manager is not in the competitive roster (e.g. CEO / ex-manager).
   */
  managerEmailHash: string | null;
}

/** Discipline peer comparison — inherited from the M10 normalisation layer. */
export interface EngineerAttributionPeerComparison {
  discipline: Discipline;
  disciplineCohort: DisciplineCohortInfo | null;
  rawPercentile: number | null;
  adjustedPercentile: number | null;
  /** `adjustedPercentile − rawPercentile` — lift from tenure/role adjustment. */
  adjustmentLift: number | null;
}

/** Reconciliation check — per-method scores must form the composite via median. */
export interface EngineerAttributionReconciliation {
  methodScores: Array<{ method: CompositeMethod; score: number }>;
  /** Median of present method scores. Null when compositeScore is null. */
  recomputedComposite: number | null;
  /** `recomputedComposite − compositeScore`. Null when compositeScore is null. */
  delta: number | null;
  /** `|delta| ≤ tolerance`. Always true for a well-formed composite. */
  matches: boolean;
}

/** Per-method entry in the attribution drilldown. */
export interface EngineerAttributionMethod {
  method: CompositeMethod;
  label: string;
  score: number | null;
  present: boolean;
  presentReason: string;
  components: AttributionContribution[];
}

/** Full attribution entry for one engineer. Attached to the snapshot bundle. */
export interface EngineerAttribution {
  emailHash: string;
  displayName: string;
  discipline: Discipline;
  levelLabel: string;
  eligibility: EligibilityStatus;
  rank: number | null;
  compositeScore: number | null;
  compositePercentile: number | null;
  presentMethodCount: number;
  methods: EngineerAttributionMethod[];
  topPositiveDrivers: AttributionContribution[];
  topNegativeDrivers: AttributionContribution[];
  /** Signals labelled absent so the reader never infers availability from silence. */
  absentSignals: string[];
  reconciliation: EngineerAttributionReconciliation;
  peerComparison: EngineerAttributionPeerComparison;
  evidence: EngineerAttributionEvidence;
  context: EngineerAttributionContext;
  /**
   * M21 placeholder manager-calibration state. Ships the shape only so a
   * later milestone can wire a feedback loop without changing the ranking
   * core contract.
   */
  calibration: EngineerAttributionCalibration;
}

export interface AttributionBundle {
  /** Plain-language description of the attribution methodology. */
  contract: string;
  /** Tolerance used for the reconciliation check. */
  tolerance: number;
  /** Total methods combined into the composite (today: 4). */
  totalMethods: number;
  /** All competitive engineers, scored or unscored. Sorted by rank asc with unscored last. */
  entries: EngineerAttribution[];
  /** Plain-language attribution-stage limitations shown on the page. */
  limitations: string[];
}

/**
 * Build the GitHub PR-search URL for an engineer scoped to merged PRs in the
 * signal window. Returns null if the login or org is missing. The URL is
 * constructed locally; no API call is made.
 */
function buildGithubPrSearchUrl(
  githubLogin: string | null,
  githubOrg: string | null,
  windowStartIso: string,
  windowEndIso: string,
): string | null {
  if (!githubLogin || !githubOrg) return null;
  const trimmedOrg = githubOrg.trim();
  if (!trimmedOrg) return null;
  const start = windowStartIso.slice(0, 10);
  const end = windowEndIso.slice(0, 10);
  const query = [
    `org:${trimmedOrg}`,
    `author:${githubLogin}`,
    "is:pr",
    "is:merged",
    `merged:${start}..${end}`,
  ].join(" ");
  return `https://github.com/search?type=pullrequests&q=${encodeURIComponent(query)}`;
}

function describeMethodPresence(
  method: CompositeMethod,
  score: number | null,
  entry: EligibilityEntry,
): string {
  if (score !== null) return "Scored — contributes to the median.";
  switch (method) {
    case "output":
      return "No scored components — no persisted PR/commit activity in the window.";
    case "impact":
      return entry.hasImpactModelRow
        ? "Impact model present but SHAP fields missing — treated as absent."
        : "Not in the impact-model training set — absent for this engineer.";
    case "delivery":
      return "No squad-delivery context joined — Swarmia squad fields are squad-level and may be missing for this engineer's squad.";
    case "adjusted":
      return "No normalisation lift — the adjusted percentile could not be computed (e.g. no rawScore from persisted PR data).";
  }
}

function buildMethodComponents(
  method: CompositeMethod,
  lenses: LensesBundle,
  normalisation: EngineerNormalisation | undefined,
  emailHash: string,
  totalMethods: number,
  methodPresent: boolean,
): AttributionContribution[] {
  const methodLabel = RANKING_COMPOSITE_METHOD_LABELS[method];
  const lensSummary =
    method === "output"
      ? lenses.lenses.output
      : method === "impact"
        ? lenses.lenses.impact
        : method === "delivery"
          ? lenses.lenses.delivery
          : null;

  if (lensSummary) {
    const lensEntry = lensSummary.entries.find((e) => e.emailHash === emailHash);
    if (!lensEntry) return [];
    return lensEntry.components.map((component): AttributionContribution => {
      const percentile = component.percentile;
      const kind: AttributionContributionKind =
        percentile === null ? "absent" : "present";
      const approxCompositeLift =
        kind === "present" && methodPresent
          ? (1 / totalMethods) * component.weight * (percentile! - 50)
          : null;
      return {
        signal: component.name,
        method,
        methodLabel,
        kind,
        rawValue: component.rawValue,
        percentile,
        weightInMethod: component.weight,
        approxCompositeLift,
        absenceReason:
          kind === "absent"
            ? `${component.name} is missing for this engineer — the component does not contribute to ${methodLabel}.`
            : "",
      };
    });
  }

  // Adjusted method — surface the three normalisation sub-adjustments. Each
  // sub-adjustment contributes 1/3 of the adjusted method because
  // `adjustedPercentile = mean(discipline, level, tenure)` with equal weights.
  if (!normalisation) return [];
  const subWeight = 1 / 3;
  const subComponents: Array<{
    signal: string;
    rawValue: number | null;
    percentile: number | null;
    absenceReason: string;
  }> = [
    {
      signal: "Discipline percentile",
      rawValue: normalisation.rawScore,
      percentile: normalisation.disciplinePercentile,
      absenceReason:
        "Discipline cohort percentile unavailable — either no rawScore for this engineer or no eligible discipline cohort.",
    },
    {
      signal: "Level-adjusted residual percentile",
      rawValue: normalisation.levelAdjustedResidual,
      percentile: normalisation.levelAdjustedPercentile,
      absenceReason:
        "Level residual unavailable — no OLS fit (e.g. fewer than two engineers with both a parsable level and a rawScore).",
    },
    {
      signal: "Tenure-adjusted rate percentile",
      rawValue: normalisation.tenureAdjustedRate,
      percentile: normalisation.tenureAdjustedPercentile,
      absenceReason:
        "Tenure-adjusted rate unavailable — engineer has no rawScore or zero window exposure.",
    },
  ];

  return subComponents.map((sub): AttributionContribution => {
    const kind: AttributionContributionKind =
      sub.percentile === null ? "absent" : "present";
    const approxCompositeLift =
      kind === "present" && methodPresent
        ? (1 / totalMethods) * subWeight * (sub.percentile! - 50)
        : null;
    return {
      signal: sub.signal,
      method,
      methodLabel,
      kind,
      rawValue: sub.rawValue,
      percentile: sub.percentile,
      weightInMethod: subWeight,
      approxCompositeLift,
      absenceReason: kind === "absent" ? sub.absenceReason : "",
    };
  });
}

/**
 * Build the per-engineer attribution bundle.
 *
 * Contract:
 *   For every competitive engineer, emit a drilldown carrying
 *   - each composite method's score and per-component breakdown (signal,
 *     weight within the method, raw value, percentile, and an approximate
 *     contribution to the composite percentile above neutral),
 *   - the top positive and top negative drivers (sorted by
 *     `|approxCompositeLift|` desc),
 *   - a reconciliation check proving the stored composite equals the median
 *     of the per-method scores within `RANKING_ATTRIBUTION_TOLERANCE`,
 *   - a discipline-cohort peer comparison inherited from the M10
 *     normalisation layer (raw percentile, adjusted percentile, adjustment
 *     lift, and the pooling note),
 *   - an evidence block with the engineer's GitHub login, a stable
 *     PR-search URL scoped to merged PRs in the window, impact-model
 *     presence, and whether squad-delivery context is joined,
 *   - manager/squad/pillar context from the eligibility row so a reader can
 *     defend a rank without leaving the drilldown.
 *
 * Absent signals are labelled verbatim — we never imply availability by
 * silent omission. AI tokens/spend are never contributions; they stay in the
 * audit and never enter a ranked path.
 */
export function buildAttribution({
  entries,
  lenses,
  normalisation,
  composite,
  windowStartIso,
  windowEndIso,
  githubOrg = null,
}: {
  entries: EligibilityEntry[];
  lenses: LensesBundle;
  normalisation: NormalisationBundle;
  composite: CompositeBundle;
  windowStartIso: string;
  windowEndIso: string;
  githubOrg?: string | null;
}): AttributionBundle {
  const competitiveByHash = new Map(
    entries
      .filter((e) => e.eligibility === "competitive")
      .map((e) => [e.emailHash, e]),
  );
  const compositeByHash = new Map(
    composite.entries.map((c) => [c.emailHash, c]),
  );
  const normalisationByHash = new Map(
    normalisation.entries.map((n) => [n.emailHash, n]),
  );
  const totalMethods = composite.methods.length;

  // Build direct-report / manager-email-hash indexes from the full roster so
  // every engineer's attribution can expose their direct-report count and
  // their manager's email hash without re-joining headcount. The lookup keys
  // are lower-cased name/email strings — headcount sometimes stores the
  // manager's name and sometimes their email, so we match against both.
  const rosterByNormalisedIdentifier = new Map<string, EligibilityEntry>();
  for (const entry of entries) {
    const nameKey = entry.displayName.trim().toLowerCase();
    if (nameKey) rosterByNormalisedIdentifier.set(nameKey, entry);
    const emailKey = entry.email.trim().toLowerCase();
    if (emailKey) rosterByNormalisedIdentifier.set(emailKey, entry);
  }
  const directReportsByManagerHash = new Map<string, string[]>();
  for (const entry of entries) {
    const managerKey = (entry.manager ?? "").trim().toLowerCase();
    if (!managerKey) continue;
    const managerEntry = rosterByNormalisedIdentifier.get(managerKey);
    if (!managerEntry) continue;
    const list =
      directReportsByManagerHash.get(managerEntry.emailHash) ?? [];
    list.push(entry.emailHash);
    directReportsByManagerHash.set(managerEntry.emailHash, list);
  }

  const attributionEntries: EngineerAttribution[] = [];
  for (const [, entry] of competitiveByHash) {
    const comp = compositeByHash.get(entry.emailHash);
    if (!comp) continue;
    const norm = normalisationByHash.get(entry.emailHash);

    const methods: EngineerAttributionMethod[] = composite.methods.map(
      (method) => {
        const score =
          method === "output"
            ? comp.output
            : method === "impact"
              ? comp.impact
              : method === "delivery"
                ? comp.delivery
                : comp.adjusted;
        const present = score !== null;
        const components = buildMethodComponents(
          method,
          lenses,
          norm,
          entry.emailHash,
          totalMethods,
          present,
        );
        return {
          method,
          label: RANKING_COMPOSITE_METHOD_LABELS[method],
          score,
          present,
          presentReason: describeMethodPresence(method, score, entry),
          components,
        };
      },
    );

    const allContributions: AttributionContribution[] = methods.flatMap(
      (m) => m.components,
    );
    const present = allContributions.filter(
      (c): c is AttributionContribution & { approxCompositeLift: number } =>
        c.approxCompositeLift !== null && Number.isFinite(c.approxCompositeLift),
    );
    const topPositiveDrivers = [...present]
      .filter((c) => c.approxCompositeLift > 0)
      .sort((a, b) => b.approxCompositeLift - a.approxCompositeLift)
      .slice(0, RANKING_ATTRIBUTION_TOP_DRIVERS);
    const topNegativeDrivers = [...present]
      .filter((c) => c.approxCompositeLift < 0)
      .sort((a, b) => a.approxCompositeLift - b.approxCompositeLift)
      .slice(0, RANKING_ATTRIBUTION_TOP_DRIVERS);

    const absentSignals = Array.from(
      new Set(
        allContributions
          .filter((c) => c.kind === "absent")
          .map((c) => c.signal),
      ),
    );

    const presentMethodScores = methods
      .filter((m): m is EngineerAttributionMethod & { score: number } =>
        m.score !== null && Number.isFinite(m.score),
      )
      .map((m) => ({ method: m.method, score: m.score }));
    const recomputedComposite =
      presentMethodScores.length >= composite.minPresentMethods
        ? median(presentMethodScores.map((m) => m.score))
        : null;
    const delta =
      recomputedComposite !== null && comp.composite !== null
        ? recomputedComposite - comp.composite
        : null;
    const matches =
      delta === null
        ? comp.composite === null && recomputedComposite === null
        : Math.abs(delta) <= RANKING_ATTRIBUTION_TOLERANCE;

    const evidenceNotes: string[] = [];
    if (!entry.githubLogin) {
      evidenceNotes.push(
        "No GitHub login mapped — PR evidence links are unavailable until `githubEmployeeMap` is updated in admin.",
      );
    }
    if (!entry.hasImpactModelRow) {
      evidenceNotes.push(
        "Not in the impact-model training set — SHAP contributions unavailable.",
      );
    }
    evidenceNotes.push(
      "Per-PR LLM rubric, individual review turnaround, and PR-level cycle time are not persisted in the current schema and are labelled absent rather than fabricated.",
    );

    const adjustmentLift =
      norm?.adjustmentDelta ?? null;

    attributionEntries.push({
      emailHash: entry.emailHash,
      displayName: entry.displayName,
      discipline: entry.discipline,
      levelLabel: entry.levelLabel,
      eligibility: entry.eligibility,
      rank: comp.rank,
      compositeScore: comp.composite,
      compositePercentile: comp.compositePercentile,
      presentMethodCount: comp.presentMethodCount,
      methods,
      topPositiveDrivers,
      topNegativeDrivers,
      absentSignals,
      reconciliation: {
        methodScores: presentMethodScores,
        recomputedComposite,
        delta,
        matches,
      },
      peerComparison: {
        discipline: entry.discipline,
        disciplineCohort: norm?.disciplineCohort ?? null,
        rawPercentile: norm?.rawPercentile ?? null,
        adjustedPercentile: norm?.adjustedPercentile ?? null,
        adjustmentLift,
      },
      evidence: {
        githubLogin: entry.githubLogin,
        githubPrSearchUrl: buildGithubPrSearchUrl(
          entry.githubLogin,
          githubOrg,
          windowStartIso,
          windowEndIso,
        ),
        impactModelPresent: entry.hasImpactModelRow,
        squadContextPresent: Boolean(comp.delivery !== null),
        notes: evidenceNotes,
      },
      context: {
        manager: entry.manager,
        rawSquad: entry.squad,
        pillar: entry.pillar,
        canonicalSquad: entry.canonicalSquad,
        directReportCount: (
          directReportsByManagerHash.get(entry.emailHash) ?? []
        ).length,
        directReportHashes:
          directReportsByManagerHash.get(entry.emailHash) ?? [],
      },
      calibration: {
        status: "not_requested",
        note: "Calibration structure is present — manager email hash and direct-report list are resolved at request time. The feedback loop that lets a manager confirm or dispute a direct's position is outstanding work bundled into the stability-check milestone.",
        managerEmailHash: (() => {
          const managerKey = (entry.manager ?? "").trim().toLowerCase();
          if (!managerKey) return null;
          const managerEntry =
            rosterByNormalisedIdentifier.get(managerKey);
          return managerEntry ? managerEntry.emailHash : null;
        })(),
      },
    });
  }

  attributionEntries.sort((a, b) => {
    const ra = a.rank ?? Number.POSITIVE_INFINITY;
    const rb = b.rank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName);
  });

  const contract = `Attribution reveals, for every competitive engineer, which signals pushed their composite above or below the neutral 50 and by how much. Each composite method (A output, B impact, C delivery, tenure/role-adjusted) surfaces its component weights and per-engineer percentiles; the top ${RANKING_ATTRIBUTION_TOP_DRIVERS} positive and negative drivers are listed with their approximate lift. The per-method scores are reconciled against the stored composite via the median contract within ${RANKING_ATTRIBUTION_TOLERANCE} percentile points of tolerance. Absent signals are labelled with a reason; the page never implies a signal by silent omission.`;

  return {
    contract,
    tolerance: RANKING_ATTRIBUTION_TOLERANCE,
    totalMethods,
    entries: attributionEntries,
    limitations: [
      `Attribution's positive/negative driver tag uses a linear approximation of each component's lift on the composite percentile: (1 / ${totalMethods}) × componentWeight × (percentile − 50). The composite itself is the median of the four method scores, not a weighted sum, so the driver magnitudes are directional labels rather than exact rank contributions.`,
      `Evidence links are limited to a GitHub PR-search URL filtered to merged PRs in the window. Per-PR LLM rubric, individual review turnaround, and PR-level cycle time are not persisted in the current schema and appear in the absent-signals list rather than the evidence block.`,
      `Manager-chain and squad context come from the eligibility row (Mode Headcount SSoT and the squads registry when joined). Every drilldown now carries a manager-calibration stub (direct-report count, manager email hash, \`not_requested\` status) so a later feedback loop can validate the ranking without touching the attribution contract.`,
      `Privacy-preserving ranking snapshot persistence (M16) is live; the schema keys on (snapshotDate, methodologyVersion, emailHash) so cross-methodology snapshots cannot be merged by accident, and rows carry no display name / email / manager / resolved GitHub login. Movers view (M18) is live and renders against the most recent comparable prior snapshot. The methodology panel, anti-gaming audit, freshness badges, and manager-calibration stub (M21) are live. The stability check remains the only outstanding methodology milestone — the composite is an evidence rank, not a final adjudication until that lands.`,
    ],
  };
}

/**
 * Minimum gap in days between the current snapshot and the prior snapshot
 * used for the movers view. A too-short gap is not interesting: same-day
 * refreshes of the same methodology should not be reported as movement.
 * Six days keeps the diff weekly-ish while still allowing two cycles per
 * week when the ranking is refreshed daily.
 */
export const RANKING_MOVERS_MIN_GAP_DAYS = 6 as const;

/**
 * How many engineers to surface in each of the risers / fallers /
 * newEntrants / cohortExits tables. Kept small so the movers section reads
 * as a narrative highlight list, not the full rank diff — the underlying
 * persisted snapshot still contains every engineer for audit.
 */
export const RANKING_MOVERS_TOP_N = 10 as const;

/** Category a mover row belongs to. */
export type MoverCategory =
  | "riser"
  | "faller"
  | "new_entrant"
  | "cohort_exit";

/**
 * Best-guess cause of a mover's movement, given only what the persisted
 * snapshot carries. Deliberately conservative: when the scoring `inputHash`
 * is unchanged, the movement is `ambiguous_context` rather than
 * "methodology noise" because tenure, discipline/level, manager/squad, and
 * normalisation-cohort transitions are not encoded in the hash.
 */
export type MoverCauseKind =
  | "input_drift"
  | "ambiguous_context"
  | "methodology_change"
  | "cohort_transition"
  | "unknown";

/**
 * High-level state of the movers bundle. The page renders a useful empty
 * state for every non-`ok` status rather than silently rendering a blank
 * table.
 */
export type MoversStatus =
  | "no_prior_snapshot"
  | "insufficient_gap"
  | "methodology_changed"
  | "ok";

export interface MoverEntry {
  emailHash: string;
  /** Resolved at request time from the current eligibility roster. */
  displayName: string;
  priorRank: number | null;
  currentRank: number | null;
  /** `currentRank - priorRank`. Negative = improved, positive = regressed. */
  rankDelta: number | null;
  priorCompositePercentile: number | null;
  currentCompositePercentile: number | null;
  /** `currentCompositePercentile - priorCompositePercentile` (both non-null). */
  percentileDelta: number | null;
  priorConfidenceWidth: number | null;
  currentConfidenceWidth: number | null;
  /** `currentConfidenceWidth - priorConfidenceWidth` (both non-null). */
  confidenceWidthDelta: number | null;
  category: MoverCategory;
  causeKind: MoverCauseKind;
  /** Plain-language narrative of the likely cause (safe to display). */
  likelyCause: string;
  /**
   * True when both snapshots persisted an `inputHash` and the two differ.
   * Null when either hash is missing — in which case we cannot distinguish
   * input drift from methodology drift from persisted state alone.
   */
  inputHashChanged: boolean | null;
  /** True when the prior snapshot was taken under a different methodology. */
  methodologyChanged: boolean;
}

export interface MoversBundle {
  status: MoversStatus;
  /** Plain-language description of the movers methodology. */
  contract: string;
  currentSnapshot: { snapshotDate: string; methodologyVersion: string };
  priorSnapshot: {
    snapshotDate: string;
    methodologyVersion: string;
  } | null;
  /** Calendar-day gap between prior and current; null when no prior exists. */
  priorSnapshotGapDays: number | null;
  minGapDays: number;
  topN: number;
  /** True when prior and current methodology versions differ. */
  methodologyChanged: boolean;
  /** Top-N engineers with the biggest rank improvement (most negative delta). */
  risers: MoverEntry[];
  /** Top-N engineers with the biggest rank regression (most positive delta). */
  fallers: MoverEntry[];
  /** Engineers ranked this snapshot but not the prior one (newly competitive). */
  newEntrants: MoverEntry[];
  /** Engineers ranked in the prior snapshot but not this one (leavers, lost methods, etc.). */
  cohortExits: MoverEntry[];
  /** Informational notes surfaced on the page above the tables. */
  notes: string[];
  /** Plain-language movers-stage limitations shown on the page. */
  limitations: string[];
}

function compareSnapshotDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function diffSnapshotDates(priorDate: string, currentDate: string): number | null {
  const prior = new Date(`${priorDate}T00:00:00Z`);
  const current = new Date(`${currentDate}T00:00:00Z`);
  if (Number.isNaN(prior.getTime()) || Number.isNaN(current.getTime())) {
    return null;
  }
  const ms = current.getTime() - prior.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function sanitiseTopN(topN: number | undefined): number {
  if (topN === undefined) return RANKING_MOVERS_TOP_N;
  if (!Number.isFinite(topN) || topN <= 0) return 0;
  return Math.floor(topN);
}

function sanitiseMinGapDays(minGapDays: number | undefined): number {
  if (minGapDays === undefined) return RANKING_MOVERS_MIN_GAP_DAYS;
  if (!Number.isFinite(minGapDays) || minGapDays < 0) {
    return RANKING_MOVERS_MIN_GAP_DAYS;
  }
  return Math.floor(minGapDays);
}

const MOVERS_BASE_LIMITATIONS: readonly string[] = [
  "`inputHash` covers scoring signal rows only (GitHub activity, SHAP impact, and squad delivery context). Tenure, discipline, manager/squad, cohort membership, and normalisation-cohort transitions are not encoded in the hash — an unchanged `inputHash` paired with a rank change is labelled `ambiguous_context`, not methodology noise.",
  "The movers view diffs the current snapshot against the most recent prior snapshot at least `RANKING_MOVERS_MIN_GAP_DAYS` calendar days old, preferring the same methodology version. If only a different-methodology prior exists, every row is labelled `methodology_change` and must not be read as behaviour change.",
  "Cohort entrants include engineers who completed ramp-up, gained a GitHub mapping, or produced enough present methods to score for the first time. Cohort exits include leavers, engineers whose composite lost enough methods to become unscored, and hashes not present in the current slice.",
  "Top-N risers/fallers are a narrative highlight surface. Every competitive engineer is still persisted in `engineeringRankingSnapshots` so a full rank diff can be reconstructed from storage for audit.",
];

/**
 * Build the movers bundle for M18. Pure helper — the caller (server loader
 * or test fixture) is responsible for deciding which prior snapshot slice to
 * pass in. When no prior slice is supplied, or the prior is closer than
 * `minGapDays`, the bundle emits a helpful empty state rather than
 * fabricating movement.
 *
 * Cause heuristics are deliberately conservative:
 *   - Methodology version differs → `methodology_change` for every entry.
 *   - Present on one side only → `cohort_transition`.
 *   - Both sides, hashes both present, differ → `input_drift`.
 *   - Both sides, hashes both present, equal → `ambiguous_context`.
 *   - Either hash missing → `unknown`.
 *
 * Rank deltas are signed as `current - prior` so a negative delta reads as
 * a rank improvement (moving from rank 8 to rank 3 → delta −5).
 */
export function buildMovers(inputs: {
  currentSnapshotDate: string;
  currentMethodologyVersion: string;
  composite: CompositeBundle;
  confidence: ConfidenceBundle;
  eligibilityEntries: readonly EligibilityEntry[];
  /**
   * Optional per-engineer signal rows — used to compute the current
   * `inputHash` values that are diffed against `priorRows[i].inputHash`.
   * When absent, every entry reports `inputHashChanged = null` and
   * `causeKind = "unknown"`.
   */
  signals?: readonly PerEngineerSignalRow[];
  /**
   * The prior snapshot slice to compare against. Every row MUST share the
   * same `(snapshotDate, methodologyVersion)`. Server loaders should call
   * `readRankingSnapshot({ snapshotDate, methodologyVersion })` to produce
   * this shape; tests pass fixtures.
   */
  priorRows?: readonly RankingSnapshotRow[];
  /** Defaults to `RANKING_MOVERS_MIN_GAP_DAYS`. */
  minGapDays?: number;
  /** Defaults to `RANKING_MOVERS_TOP_N`. */
  topN?: number;
}): MoversBundle {
  const minGapDays = sanitiseMinGapDays(inputs.minGapDays);
  const topN = sanitiseTopN(inputs.topN);
  const currentSnapshot = {
    snapshotDate: inputs.currentSnapshotDate,
    methodologyVersion: inputs.currentMethodologyVersion,
  };
  const contract = `Movers diffs the current ranking against the most recent prior snapshot at least ${minGapDays} calendar days old, preferring the same methodology version. Risers/fallers are the top ${topN} engineers by absolute rank delta with prior and current ranks both present; newEntrants/cohortExits cover engineers who appear on only one side. Likely cause is derived from persisted state alone — methodology version, scoring \`inputHash\`, and cohort presence — so the narrative never overclaims input drift when the hash is unchanged.`;

  const priorRows = inputs.priorRows ?? [];

  // No prior snapshot at all.
  if (priorRows.length === 0) {
    return {
      status: "no_prior_snapshot",
      contract,
      currentSnapshot,
      priorSnapshot: null,
      priorSnapshotGapDays: null,
      minGapDays,
      topN,
      methodologyChanged: false,
      risers: [],
      fallers: [],
      newEntrants: [],
      cohortExits: [],
      notes: [
        "No prior ranking snapshot has been persisted yet. Movers view will populate after the next scheduled refresh produces a second snapshot.",
      ],
      limitations: [...MOVERS_BASE_LIMITATIONS],
    };
  }

  // All prior rows are expected to share the same slice key. Guard anyway.
  const firstPrior = priorRows[0];
  const priorSnapshotDate = firstPrior.snapshotDate;
  const priorMethodologyVersion = firstPrior.methodologyVersion;
  const priorSnapshot = {
    snapshotDate: priorSnapshotDate,
    methodologyVersion: priorMethodologyVersion,
  };

  const gapDays = diffSnapshotDates(
    priorSnapshotDate,
    inputs.currentSnapshotDate,
  );

  if (gapDays === null || compareSnapshotDates(priorSnapshotDate, inputs.currentSnapshotDate) >= 0 || gapDays < minGapDays) {
    return {
      status: "insufficient_gap",
      contract,
      currentSnapshot,
      priorSnapshot,
      priorSnapshotGapDays: gapDays,
      minGapDays,
      topN,
      methodologyChanged:
        priorMethodologyVersion !== inputs.currentMethodologyVersion,
      risers: [],
      fallers: [],
      newEntrants: [],
      cohortExits: [],
      notes: [
        `Prior snapshot is ${gapDays ?? 0} days old (<${minGapDays}). Movers view waits for a prior snapshot at least ${minGapDays} days before the current one so day-to-day refresh jitter is not reported as movement.`,
      ],
      limitations: [...MOVERS_BASE_LIMITATIONS],
    };
  }

  const methodologyChanged =
    priorMethodologyVersion !== inputs.currentMethodologyVersion;

  // Current-snapshot lookups.
  const displayNameByHash = new Map(
    inputs.eligibilityEntries.map((e) => [e.emailHash, e.displayName]),
  );
  const currentByHash = new Map(
    inputs.composite.entries
      .filter((c) => c.rank !== null && c.composite !== null)
      .map((c) => [c.emailHash, c]),
  );
  const confidenceByHash = new Map(
    inputs.confidence.entries.map((c) => [c.emailHash, c]),
  );
  const currentInputHashByHash = new Map<string, string | null>();
  if (inputs.signals) {
    for (const signal of inputs.signals) {
      currentInputHashByHash.set(
        signal.emailHash,
        computeRankingInputHash(signal),
      );
    }
  }

  // Prior-snapshot lookups.
  const priorByHash = new Map<string, RankingSnapshotRow>();
  const priorRankedByHash = new Map<string, RankingSnapshotRow>();
  for (const row of priorRows) {
    priorByHash.set(row.emailHash, row);
    if (row.rank !== null && row.compositeScore !== null) {
      priorRankedByHash.set(row.emailHash, row);
    }
  }

  function resolveDisplayName(emailHash: string, prior?: RankingSnapshotRow): string {
    return (
      displayNameByHash.get(emailHash) ??
      (prior ? `Unmapped (${emailHash.slice(0, 8)})` : `Unknown (${emailHash.slice(0, 8)})`)
    );
  }

  function computeCauseKind(params: {
    priorPresent: boolean;
    currentPresent: boolean;
    inputHashChanged: boolean | null;
  }): { causeKind: MoverCauseKind; likelyCause: string } {
    if (methodologyChanged) {
      return {
        causeKind: "methodology_change",
        likelyCause: `Prior snapshot was methodology v${priorMethodologyVersion}; current is v${inputs.currentMethodologyVersion}. Any rank movement is methodology-affected and must not be read as behaviour change.`,
      };
    }
    if (!params.priorPresent || !params.currentPresent) {
      return {
        causeKind: "cohort_transition",
        likelyCause: params.currentPresent
          ? "Engineer was not ranked in the prior snapshot (new hire, newly mapped to GitHub, or finished ramp-up). Ranked for the first time this cycle."
          : "Engineer was ranked in the prior snapshot but is not in the current competitive cohort (leaver, lost GitHub mapping, or composite dropped below the minimum present-method count).",
      };
    }
    if (params.inputHashChanged === null) {
      return {
        causeKind: "unknown",
        likelyCause:
          "`inputHash` not persisted on one or both sides — cannot distinguish input drift from methodology/context change from stored state alone.",
      };
    }
    if (params.inputHashChanged) {
      return {
        causeKind: "input_drift",
        likelyCause:
          "Scoring signals moved between snapshots (persisted `inputHash` differs). Most likely driven by new GitHub PRs/commits, updated impact-model values, or refreshed squad delivery context.",
      };
    }
    return {
      causeKind: "ambiguous_context",
      likelyCause:
        "Scoring `inputHash` is unchanged, but rank moved. Likely caused by cohort re-ranking, a different normalisation cohort, or confidence re-estimation rather than this engineer's own scoring inputs. Not methodology noise — labelled ambiguous rather than overclaimed.",
    };
  }

  function makeEntry(
    emailHash: string,
    prior: RankingSnapshotRow | undefined,
    current: EngineerCompositeEntry | undefined,
    category: MoverCategory,
  ): MoverEntry {
    const priorRank = prior?.rank ?? null;
    const currentRank = current?.rank ?? null;
    const rankDelta =
      priorRank !== null && currentRank !== null
        ? currentRank - priorRank
        : null;
    const priorCompositePercentile = prior?.compositeScore ?? null;
    const currentCompositePercentile = current?.compositePercentile ?? null;
    const percentileDelta =
      priorCompositePercentile !== null && currentCompositePercentile !== null
        ? currentCompositePercentile - priorCompositePercentile
        : null;
    const currentConfidenceWidth =
      confidenceByHash.get(emailHash)?.ciWidth ?? null;
    const priorConfidenceWidth =
      prior?.metadata.confidenceWidth ??
      (prior?.confidenceLow !== null && prior?.confidenceLow !== undefined &&
      prior?.confidenceHigh !== null && prior?.confidenceHigh !== undefined
        ? prior.confidenceHigh - prior.confidenceLow
        : null);
    const confidenceWidthDelta =
      priorConfidenceWidth !== null && currentConfidenceWidth !== null
        ? currentConfidenceWidth - priorConfidenceWidth
        : null;

    const priorInputHash = prior?.inputHash ?? null;
    const currentInputHash = inputs.signals
      ? (currentInputHashByHash.get(emailHash) ?? null)
      : null;
    const inputHashChanged =
      priorInputHash !== null && currentInputHash !== null
        ? priorInputHash !== currentInputHash
        : null;

    const { causeKind, likelyCause } = computeCauseKind({
      priorPresent: Boolean(prior && prior.rank !== null),
      currentPresent: Boolean(current && current.rank !== null),
      inputHashChanged,
    });

    return {
      emailHash,
      displayName: resolveDisplayName(emailHash, prior),
      priorRank,
      currentRank,
      rankDelta,
      priorCompositePercentile,
      currentCompositePercentile,
      percentileDelta,
      priorConfidenceWidth,
      currentConfidenceWidth,
      confidenceWidthDelta,
      category,
      causeKind,
      likelyCause,
      inputHashChanged,
      methodologyChanged,
    };
  }

  const risers: MoverEntry[] = [];
  const fallers: MoverEntry[] = [];
  const newEntrants: MoverEntry[] = [];
  const cohortExits: MoverEntry[] = [];

  // Engineers ranked in the current snapshot.
  for (const [emailHash, current] of currentByHash) {
    const prior = priorRankedByHash.get(emailHash);
    if (prior) {
      const entry = makeEntry(emailHash, prior, current, "riser");
      if (entry.rankDelta !== null && entry.rankDelta < 0) {
        entry.category = "riser";
        risers.push(entry);
      } else if (entry.rankDelta !== null && entry.rankDelta > 0) {
        entry.category = "faller";
        fallers.push(entry);
      }
    } else {
      newEntrants.push(
        makeEntry(emailHash, undefined, current, "new_entrant"),
      );
    }
  }

  // Engineers ranked in the prior snapshot but not the current.
  for (const [emailHash, prior] of priorRankedByHash) {
    if (!currentByHash.has(emailHash)) {
      cohortExits.push(
        makeEntry(emailHash, prior, undefined, "cohort_exit"),
      );
    }
  }

  risers.sort((a, b) => {
    const da = a.rankDelta ?? 0;
    const db = b.rankDelta ?? 0;
    if (da !== db) return da - db; // most negative first
    return a.emailHash.localeCompare(b.emailHash);
  });
  fallers.sort((a, b) => {
    const da = a.rankDelta ?? 0;
    const db = b.rankDelta ?? 0;
    if (da !== db) return db - da; // most positive first
    return a.emailHash.localeCompare(b.emailHash);
  });
  newEntrants.sort((a, b) => {
    const ra = a.currentRank ?? Number.POSITIVE_INFINITY;
    const rb = b.currentRank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.emailHash.localeCompare(b.emailHash);
  });
  cohortExits.sort((a, b) => {
    const ra = a.priorRank ?? Number.POSITIVE_INFINITY;
    const rb = b.priorRank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.emailHash.localeCompare(b.emailHash);
  });

  const notes: string[] = [];
  if (methodologyChanged) {
    notes.push(
      `Methodology version changed since prior snapshot (v${priorMethodologyVersion} → v${inputs.currentMethodologyVersion}). Every mover row is labelled \`methodology_change\` and must not be read as behaviour change — compare against a prior snapshot that shares the current methodology version once one has been persisted.`,
    );
  } else {
    notes.push(
      `Prior snapshot: v${priorMethodologyVersion} on ${priorSnapshotDate}, ${gapDays} days before the current snapshot (${inputs.currentSnapshotDate}).`,
    );
  }
  if (newEntrants.length > 0 || cohortExits.length > 0) {
    notes.push(
      `${newEntrants.length} cohort entrant(s) and ${cohortExits.length} cohort exit(s) are categorised separately from risers/fallers so roster transitions are never narrated as ordinary rank movement.`,
    );
  }

  return {
    status: methodologyChanged ? "methodology_changed" : "ok",
    contract,
    currentSnapshot,
    priorSnapshot,
    priorSnapshotGapDays: gapDays,
    minGapDays,
    topN,
    methodologyChanged,
    risers: topN === 0 ? risers : risers.slice(0, topN),
    fallers: topN === 0 ? fallers : fallers.slice(0, topN),
    newEntrants: topN === 0 ? newEntrants : newEntrants.slice(0, topN),
    cohortExits: topN === 0 ? cohortExits : cohortExits.slice(0, topN),
    notes,
    limitations: [...MOVERS_BASE_LIMITATIONS],
  };
}

/**
 * Base provenance notes that are true for every preflight regardless of
 * which optional inputs were supplied. Exported for tests that want to
 * assert on the constant surface.
 */
export const RANKING_SOURCE_NOTES_BASE: readonly string[] = [
  "Roster spine: Mode Headcount SSoT (engineering rows). Manager chain comes from the `manager` / `line_manager_email` fields on the same row.",
  "GitHub identity: `githubEmployeeMap` (non-bot). Unmapped active engineers surface with `insufficient_mapping`, not silently dropped.",
  "Impact model presence: `src/data/impact-model.json` joined by `email_hash` (SHA-256 of lowercased email, first 16 hex chars).",
  "Display names and emails are resolved at request time and never written into persisted ranking snapshots.",
];

/**
 * Compute the provenance notes for a given preflight. The squads-registry
 * note is only added when the caller supplied a non-empty `squads` input —
 * otherwise the page would claim a live source that was never fetched. An
 * empty array is treated the same as absent so this gate stays in lock-step
 * with `coverage.squadsRegistryPresent`.
 */
export function buildSourceNotes(inputs: EligibilityInputs): string[] {
  const notes = [...RANKING_SOURCE_NOTES_BASE];
  const hasSquads = Boolean(inputs.squads && inputs.squads.length > 0);
  if (hasSquads) {
    notes.splice(
      3,
      0,
      "Squads registry (`squads` table): canonical squad name, pillar, PM, and Slack channel id joined at request time by lowercased `hb_squad`. Does not provide manager chain.",
    );
  } else {
    notes.push(
      "Squads registry was not fetched for this snapshot; canonical squad metadata is unavailable and any squad/PM fields on the page come from the raw headcount `hb_squad` label only.",
    );
  }
  return notes;
}

const KNOWN_LIMITATIONS: readonly string[] = [
  "Per-PR LLM rubric signal (prReviewAnalyses / RUBRIC_VERSION) is not yet wired. Documented as the highest-priority future signal.",
  "Individual review graph, review turnaround, and PR-level cycle time are not persisted in `githubPrs` / `githubPrMetrics` today. The page must not claim these signals until the schema/sync is extended.",
  "Eligibility, signal orthogonality audit, three independent scoring lenses, tenure/role normalisation, the composite score with effective-weight decomposition / leave-one-method-out sensitivity / PR/log-impact dominance check, 80% bootstrap confidence bands with statistical-tie groups, per-engineer attribution drilldowns, privacy-preserving ranking snapshot persistence, movers view, methodology panel + anti-gaming audit + freshness badges + manager-calibration stub are implemented. The stability check is the only pending methodology milestone — the composite is an evidence rank, not a final adjudication until it lands.",
  "Movers view compares against the most recent prior snapshot at least `RANKING_MOVERS_MIN_GAP_DAYS` days old, preferring the same methodology version. The scoring `inputHash` only covers GitHub activity, SHAP impact, and squad delivery context — tenure/discipline/manager/squad/cohort transitions are not encoded in the hash, so an unchanged hash paired with rank movement is labelled `ambiguous_context` rather than methodology noise.",
  "Swarmia DORA is squad/pillar context only — it describes teams, not individuals, and must not be used as individual review evidence.",
  "Squads registry does not contain manager chain. Manager and direct-report context comes from Mode Headcount SSoT / people loaders; the ranking methodology must not imply `squads` as the source of manager relationships.",
  "AI usage (tokens/spend) is contextual and audit-only. It must not directly reward individuals without independent validation.",
];

const PLANNED_SIGNALS: EngineeringRankingSnapshot["plannedSignals"] = [
  { name: "GitHub PRs + commits (author, merged_at, lines)", state: "available" },
  { name: "SHAP impact model", state: "available" },
  {
    name: "Mode Headcount SSoT (tenure, discipline, manager chain)",
    state: "available",
    note: "Manager and manager-email fields originate here (via `src/lib/data/people.ts`), not the squads registry.",
  },
  {
    name: "Squads registry (squad name, pillar, PM, Slack channel id)",
    state: "available",
    note: "`squads` table supplies squad name, pillar, PM name, and Slack `channel_id`. All four are threaded through the eligibility snapshot when the registry is fetched. Does not contain manager or manager-email fields.",
  },
  {
    name: "Swarmia DORA — squad/pillar context, not individual signal",
    state: "available",
    note: "Team-level cycle time, deploy frequency, CFR, MTTR. Context only; capped/contextual contribution to individual rank.",
  },
  {
    name: "AI usage (contextual, audit only)",
    state: "available",
    note: "Claude + Cursor spend/tokens per engineer. Contextual, not a direct ranking reward — easily gameable.",
  },
  {
    name: "Per-PR LLM rubric (prReviewAnalyses)",
    state: "unavailable",
    note: "Not present in schema today. Listed in plan risks as highest-priority future signal.",
  },
  {
    name: "Individual PR reviewer graph (who reviews whom)",
    state: "unavailable",
    note: "`githubPrs` persists author/stats only. Reviewer identities and review edges are not stored.",
  },
  {
    name: "Individual review turnaround (time-to-first-review, time-to-approve)",
    state: "unavailable",
    note: "No reviewer timestamps in `githubPrs` or `githubPrMetrics`. Cannot be derived from current persisted fields.",
  },
  {
    name: "Individual PR cycle time (open → merged at engineer level)",
    state: "unavailable",
    note: "`githubPrs` stores `merged_at` only. Opened-at / ready-for-review timestamps are not persisted, so per-engineer cycle time cannot be computed.",
  },
];

/* --------------------------------------------------------------------------
 * M21 methodology panel, anti-gaming audit, freshness badges, and manager
 * calibration stub
 * ------------------------------------------------------------------------ */

/**
 * Canonical rubric-version marker. The per-PR LLM rubric source
 * (`prReviewAnalyses` / `RUBRIC_VERSION` in `src/lib/integrations/code-review-analyser.ts`)
 * does not exist in this codebase today, so the methodology panel surfaces
 * the version as an explicit "not available" state rather than fabricating
 * one. When a future cycle adds the rubric, this constant can be replaced
 * with a live version string and the methodology panel flips to "available"
 * without touching the panel's render.
 */
export const RANKING_RUBRIC_VERSION: string | null = null;

/**
 * Down-weight posture for a signal in the ranking. `full_weight` means the
 * signal carries its declared lens weight; `down_weighted` means the signal
 * is intentionally suppressed (e.g. sqrt/log damping); `contextual_only`
 * means the signal is read but never scored — it lives in the audit only.
 */
export type AntiGamingDownweight =
  | "full_weight"
  | "down_weighted"
  | "contextual_only";

/**
 * One row in the anti-gaming audit. For every signal the ranking touches
 * (scoring OR contextual) the page must be able to name: how it could be
 * gamed, what the methodology does to resist it, and what the residual
 * weakness is even with that mitigation in place. If a signal has no
 * mitigation, the entry is still recorded — the "pure lens A PR count"
 * row in past methodology was exactly this case.
 */
export interface AntiGamingRow {
  signal: string;
  gamingPath: string;
  mitigation: string;
  residualWeakness: string;
  downweightStatus: AntiGamingDownweight;
}

/**
 * Per-source freshness badge rendered on the methodology panel. `timestamp`
 * is the ISO string that source was last updated (impact model trained,
 * snapshot persisted, latest AI usage month, etc.); `window` is the lookback
 * window the ranking reads from that source. Both are optional — a source
 * that does not expose either can still appear on the panel with a single
 * "not available" badge.
 */
export interface RankingFreshnessBadge {
  label: string;
  source: string;
  timestamp: string | null;
  window: string | null;
  /**
   * Whether the upstream signal is actually available to the ranking today.
   * `available` means the source is wired and the ranking uses it;
   * `unavailable` means no persisted source exists (rubric version today);
   * `pending_source` means the source is wired but a timestamp is not
   * currently threaded through to the page.
   */
  availability: "available" | "unavailable" | "pending_source";
  note: string | null;
}

/**
 * Aggregate manager-calibration status surfaced at the page level. Details
 * per engineer live on `EngineerAttribution.calibration`; this summary just
 * tells the reader "the structure is present, feedback loop is not wired
 * yet" so no one mistakes a blank state for confirmed calibration.
 */
export interface ManagerCalibrationSummary {
  status: "structure_only" | "pending" | "active";
  /** Count of engineers with at least one mapped direct report in the roster. */
  managersWithDirectReports: number;
  /** Sum of direct-report counts across the ranking cohort. */
  directReportLinks: number;
  /** Engineers whose manager is a recognised manager in the roster. */
  engineersWithMappedManager: number;
  /** Plain-language explainer rendered on the page. */
  note: string;
}

/**
 * Lens summary intended for the methodology panel — a flattened, printable
 * view of `RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS` plus human-readable
 * labels and caveats. Duplicates some lens-definition data because the
 * lenses bundle is scored-engineers centric; this type is page-copy centric.
 */
export interface MethodologyLensSpec {
  key: CompositeMethod;
  label: string;
  weights: readonly { signal: string; weight: number }[];
  description: string;
}

export interface MethodologyBundle {
  /** Concise narrative prose for the top of the methodology panel. */
  contract: string;
  methodologyVersion: string;
  rubricVersion: string | null;
  lenses: readonly MethodologyLensSpec[];
  compositeRule: string;
  normalisationSummary: string;
  effectiveWeights: readonly EffectiveSignalWeight[];
  antiGamingRows: readonly AntiGamingRow[];
  freshness: readonly RankingFreshnessBadge[];
  unavailableSignals: readonly UnavailableSignal[];
  knownLimitations: readonly string[];
  managerCalibration: ManagerCalibrationSummary;
}

/**
 * Anti-gaming audit rows. One row per signal the ranking touches (scoring
 * AND contextual). The table is intentionally long because the page's
 * reviewer-facing promise is that no signal is used without a visible
 * statement of its gaming posture.
 */
export const RANKING_ANTI_GAMING_ROWS: readonly AntiGamingRow[] = [
  {
    signal: "PR count (sqrt-damped)",
    gamingPath:
      "Open many tiny PRs to inflate output count without shipping meaningful work.",
    mitigation:
      "sqrt-damping in lens A, which caps the marginal return from each additional PR. PR count is only 20% of lens A, and lens A is 25% of the composite (median of four methods), so the effective ceiling is ~5%.",
    residualWeakness:
      "A persistent high-volume spammer can still rank ahead of a low-volume shipper of comparable impact until the per-PR LLM rubric signal lands to weight PR quality.",
    downweightStatus: "down_weighted",
  },
  {
    signal: "Commit count (sqrt-damped)",
    gamingPath:
      "Split work into many tiny commits to inflate commit count.",
    mitigation:
      "sqrt-damping and a lens-A weight of 15%, then median over four methods caps the effective share at ~3.75%.",
    residualWeakness:
      "Not every codebase uses atomic commits; repo convention affects this signal more than individual behaviour.",
    downweightStatus: "down_weighted",
  },
  {
    signal: "Net lines (log-signed)",
    gamingPath:
      "Include vendored code / large generated diffs / whitespace reflows to inflate net lines added.",
    mitigation:
      "log-signed transform dampens the marginal line contribution aggressively; lens-A weight is 15% and the composite is a median, capping effective share at ~3.75%.",
    residualWeakness:
      "Generated code and formatter-driven reflows can still move the signal; the ranking cannot detect semantic-vs-syntactic churn without a rubric.",
    downweightStatus: "down_weighted",
  },
  {
    signal: "Log-impact composite",
    gamingPath:
      "The SHAP impact model is trained on upstream behaviour; someone who games PR/commit counts upstream will see their impact score move too, so activity-gaming flows through to this composite.",
    mitigation:
      "Log-damping inside the composite, dominance check on final-rank correlation against PR count and log-impact at 0.75, and a methodology panel that marks the signal flagged above the 30% effective-weight ceiling.",
    residualWeakness:
      "Because log-impact appears in both lens A and the M10 normalisation layer, its effective share is 37.5% — above the 30% ceiling. Until the per-PR LLM rubric or individual review signals land to dilute its share, this is an explicit, visible trade-off on the dominance panel.",
    downweightStatus: "contextual_only",
  },
  {
    signal: "SHAP predicted impact",
    gamingPath:
      "Predicted impact is a function of tenure/discipline/level/pillar — not directly user-controllable.",
    mitigation:
      "Training pipeline lives upstream in `ml-impact/`; the ranking consumes the frozen JSON. Lens B weight is 40%, but lens B is 25% of the composite, capping the effective share at ~10%.",
    residualWeakness:
      "If the upstream training signals become gameable (e.g. self-reported tenure), this signal inherits that weakness.",
    downweightStatus: "full_weight",
  },
  {
    signal: "SHAP actual impact",
    gamingPath:
      "If the target impact metric (`impact_360d`) can be inflated via upstream behaviour, actual impact inherits that.",
    mitigation:
      "The target definition is fixed in `ml-impact/train.py`; the ranking does not override it. Lens B weight is 40%; effective share ~10%.",
    residualWeakness:
      "The target is a constructed metric; changes to its formula count as methodology changes and must bump `RANKING_METHODOLOGY_VERSION`.",
    downweightStatus: "full_weight",
  },
  {
    signal: "SHAP residual",
    gamingPath:
      "Residual is actual − predicted, so both upstream weaknesses apply.",
    mitigation:
      "Lens B weight is 20%, composite median caps effective share at ~5%.",
    residualWeakness:
      "A small residual differential can swing a single engineer's lens B score without reflecting any real behaviour change.",
    downweightStatus: "full_weight",
  },
  {
    signal: "Squad review rate %",
    gamingPath:
      "Team-level signal; cannot be gamed by a single engineer. An engineer could choose a high-review-rate squad to inflate their delivery lens.",
    mitigation:
      "Lens C is contextual: capped at 25% of the composite (one of four methods) and narrated as squad-delivery context on the page. Squad-delivery context is the only team-level input to the individual rank.",
    residualWeakness:
      "Ecological fallacy — the ranking cannot distinguish a strong engineer on a strong squad from a weak engineer coasting on the squad's delivery performance. Future per-engineer review data would replace this.",
    downweightStatus: "contextual_only",
  },
  {
    signal: "Squad cycle time (inverted)",
    gamingPath:
      "Team-level; inherits the squad review-rate gaming posture.",
    mitigation:
      "Inverted rank percentile (lower cycle time = higher score); weight 30% in lens C, ~7.5% effective share.",
    residualWeakness:
      "Squads with different PR-size norms will read differently here without reflecting individual behaviour.",
    downweightStatus: "contextual_only",
  },
  {
    signal: "Squad time-to-first-review (inverted)",
    gamingPath:
      "Team-level; inherits the squad review-rate gaming posture.",
    mitigation:
      "Inverted rank percentile; weight 30% in lens C, ~7.5% effective share. Narrated as contextual.",
    residualWeakness:
      "Team-wide review discipline; no individual accountability visible.",
    downweightStatus: "contextual_only",
  },
  {
    signal: "AI tokens / AI spend",
    gamingPath:
      "Easy to inflate — open a session, run prompts without using output, and tokens accumulate.",
    mitigation:
      "AI usage is audit-only: never enters any lens, composite, or normalisation. Listed in the signal inventory and planned-signals panel only for traceability.",
    residualWeakness:
      "A future cycle that wants to use AI usage as a signal must first validate it against independent evidence; otherwise the gaming path is trivial.",
    downweightStatus: "contextual_only",
  },
  {
    signal: "Self-review (individual review graph)",
    gamingPath:
      "Rubber-stamp a teammate's PR in return for a similar rubber-stamp review — inflates review counts without review quality.",
    mitigation:
      "Not applicable today — the individual review graph is not persisted. The page marks it as unavailable instead of silently treating it as neutral.",
    residualWeakness:
      "Until reviewer identities and timestamps are persisted, review gaming is invisible to the ranking; it can neither reward nor penalise a reviewer for their edits.",
    downweightStatus: "contextual_only",
  },
];

/**
 * Human-readable lens descriptions for the methodology panel. These are the
 * page-copy equivalents of `RANKING_LENS_DEFINITIONS`/`RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS`
 * — one sentence per lens explaining what the lens is trying to measure.
 */
const METHODOLOGY_LENS_DESCRIPTIONS: Record<CompositeMethod, string> = {
  output:
    "Individual GitHub output — merged PRs, commits, and signed-log net lines over the window, damped so volume alone cannot dominate.",
  impact:
    "ML-predicted and measured impact from the SHAP model in `src/data/impact-model.json`, plus the residual between them.",
  delivery:
    "Squad-level delivery health from Swarmia — context only, capped at 25% of the composite.",
  adjusted:
    "Tenure and role-adjusted percentile layer over the log-impact composite: discipline-partitioned percentiles with documented pooling, level residual percentiles (OLS), and tenure-exposure adjustment.",
};

function buildMethodologyLenses(): readonly MethodologyLensSpec[] {
  const methods: CompositeMethod[] = [
    "output",
    "impact",
    "delivery",
    "adjusted",
  ];
  return methods.map((method) => ({
    key: method,
    label: RANKING_COMPOSITE_METHOD_LABELS[method],
    weights: RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS[method].map((w) => ({
      signal: w.signal,
      weight: w.weight,
    })),
    description: METHODOLOGY_LENS_DESCRIPTIONS[method],
  }));
}

function buildFreshnessBadges(params: {
  signalWindowStart: string;
  signalWindowEnd: string;
  snapshotDate: string;
  impactModelGeneratedAt: string | null;
  rubricVersion: string | null;
  aiUsageLatestMonth: string | null;
  headcountGeneratedAt: string | null;
}): RankingFreshnessBadge[] {
  const startIso = params.signalWindowStart.slice(0, 10);
  const endIso = params.signalWindowEnd.slice(0, 10);
  const window = `${startIso} → ${endIso}`;
  return [
    {
      label: "Ranking snapshot",
      source: "engineeringRankingSnapshots",
      timestamp: params.snapshotDate,
      window,
      availability: "available",
      note: "Snapshot date stamps the persisted rows used by movers / stability.",
    },
    {
      label: "Signal window",
      source: "buildRankingSnapshot",
      timestamp: params.signalWindowEnd,
      window,
      availability: "available",
      note: `Default ${RANKING_SIGNAL_WINDOW_DAYS}-day lookback. GitHub PRs/commits and Swarmia DORA share this window.`,
    },
    {
      label: "Impact model",
      source: "src/data/impact-model.json",
      timestamp: params.impactModelGeneratedAt,
      window: "Model training cohort (see ml-impact/train.py)",
      availability: params.impactModelGeneratedAt
        ? "available"
        : "pending_source",
      note: params.impactModelGeneratedAt
        ? "SHAP model JSON `generated_at` is the training timestamp. Retrain in `ml-impact/` bumps the JSON in-place."
        : "Training timestamp not yet threaded through to the page.",
    },
    {
      label: "GitHub PR/commit window",
      source: "githubPrs, githubCommits",
      timestamp: params.signalWindowEnd,
      window,
      availability: "available",
      note: "Aggregated from the 180-day signal window at request time.",
    },
    {
      label: "Swarmia DORA",
      source: "src/lib/data/swarmia.ts",
      timestamp: params.signalWindowEnd,
      window,
      availability: "available",
      note: "Squad/pillar-level DORA over `last_180_days`. Contextual only.",
    },
    {
      label: "AI usage",
      source: "src/lib/data/ai-usage.ts",
      timestamp: params.aiUsageLatestMonth,
      window: params.aiUsageLatestMonth
        ? `Latest month: ${params.aiUsageLatestMonth}`
        : "Latest month only",
      availability: "available",
      note: "AI usage reads the latest-month summary, not the 180-day window. Audit-only — never scored.",
    },
    {
      label: "Mode headcount SSoT",
      source: "getReportData('people', 'headcount')",
      timestamp: params.headcountGeneratedAt,
      window: "Active-as-of now",
      availability: params.headcountGeneratedAt
        ? "available"
        : "pending_source",
      note: params.headcountGeneratedAt
        ? "Headcount sync timestamp threaded through from the Mode sync pipeline."
        : "Mode sync timestamp not currently joined through to the ranking page.",
    },
    {
      label: "Per-PR rubric (RUBRIC_VERSION)",
      source:
        "src/lib/integrations/code-review-analyser.ts (prReviewAnalyses)",
      timestamp: null,
      window: null,
      availability: params.rubricVersion ? "available" : "unavailable",
      note: params.rubricVersion
        ? `Rubric version ${params.rubricVersion}.`
        : "Rubric source is not present in this codebase. No per-PR quality signal enters the ranking today.",
    },
  ];
}

function buildManagerCalibrationSummary(
  attributionEntries: readonly EngineerAttribution[],
): ManagerCalibrationSummary {
  let managersWithDirectReports = 0;
  let directReportLinks = 0;
  let engineersWithMappedManager = 0;
  for (const entry of attributionEntries) {
    if (entry.context.directReportCount > 0) {
      managersWithDirectReports += 1;
      directReportLinks += entry.context.directReportCount;
    }
    if (entry.calibration.managerEmailHash) {
      engineersWithMappedManager += 1;
    }
  }
  return {
    status: "structure_only",
    managersWithDirectReports,
    directReportLinks,
    engineersWithMappedManager,
    note: "Manager-calibration structure is present on every engineer's attribution drilldown (status: not_requested, manager email hash, direct-report list). The feedback loop — managers confirming/disputing their directs' positions — is outstanding work bundled into the stability-check milestone.",
  };
}

/**
 * Build the methodology panel bundle. Composes already-computed inputs:
 *  - `composite.effectiveSignalWeights` for the weight decomposition
 *  - `attribution.entries` for manager-calibration aggregates and
 *    direct-report wiring
 *  - `audit.unavailableSignals` for the rubric/review unavailable list
 *
 * Adds the anti-gaming table (static per signal inventory), freshness
 * badges (impact-model training date, signal window, rubric version, AI
 * latest-month, Mode headcount freshness), and a plain-language composite
 * rule + normalisation summary that matches the live math.
 */
export function buildMethodology(params: {
  composite: CompositeBundle;
  normalisation: NormalisationBundle;
  attribution: AttributionBundle;
  audit: SignalAudit;
  knownLimitations: readonly string[];
  signalWindowStart: string;
  signalWindowEnd: string;
  snapshotDate: string;
  impactModelGeneratedAt: string | null;
  aiUsageLatestMonth: string | null;
  headcountGeneratedAt: string | null;
  rubricVersion?: string | null;
}): MethodologyBundle {
  const {
    composite,
    normalisation,
    attribution,
    audit,
    knownLimitations,
    signalWindowStart,
    signalWindowEnd,
    snapshotDate,
    impactModelGeneratedAt,
    aiUsageLatestMonth,
    headcountGeneratedAt,
  } = params;
  const rubricVersion = params.rubricVersion ?? RANKING_RUBRIC_VERSION;

  const lenses = buildMethodologyLenses();
  const compositeRule = composite.contract;
  const normalisationSummary = `Normalisation pipeline: rank-percentile of ${normalisation.sourceSignal}, then discipline-partitioned percentiles (min cohort ${normalisation.minCohortSize}, documented pooling in \`DISCIPLINE_POOL_FALLBACK\`), level residual percentile from an OLS fit on level number, and tenure exposure adjustment capped at the ${normalisation.windowDays}-day signal window. Final \`adjustedPercentile\` is the equal-weighted mean of the three components and feeds the composite as one of four methods.`;
  const freshness = buildFreshnessBadges({
    signalWindowStart,
    signalWindowEnd,
    snapshotDate,
    impactModelGeneratedAt,
    rubricVersion,
    aiUsageLatestMonth,
    headcountGeneratedAt,
  });
  const managerCalibration = buildManagerCalibrationSummary(attribution.entries);

  const contract = `The ranking is the median of four methods (A individual output, B SHAP impact, C squad delivery, tenure/role-adjusted percentile). Engineers must have at least ${composite.minPresentMethods} present methods to be scored; otherwise their row is unscored rather than assigned a neutral rank. Every signal below is listed with its anti-gaming posture; every source below is listed with its current freshness. Per-PR LLM rubric, individual review turnaround, and PR-level cycle time are not persisted today and appear in the unavailable-signals list rather than the score. Manager calibration is structural — an engineer's attribution drilldown carries direct-report context and a \`not_requested\` calibration placeholder so a later feedback loop can validate the ranking without changing the ranking core.`;

  return {
    contract,
    methodologyVersion: RANKING_METHODOLOGY_VERSION,
    rubricVersion,
    lenses,
    compositeRule,
    normalisationSummary,
    effectiveWeights: composite.effectiveSignalWeights,
    antiGamingRows: RANKING_ANTI_GAMING_ROWS,
    freshness,
    unavailableSignals: audit.unavailableSignals,
    knownLimitations,
    managerCalibration,
  };
}

/**
 * Persistence row shape for `engineeringRankingSnapshots`. Mirrors the
 * Drizzle column contract but kept as a plain POJO so the pure helper that
 * produces it can be exercised without a database connection.
 *
 * Privacy invariant (tested): this shape is restricted to the email hash
 * plus methodology metadata — display name, resolved GitHub login, email,
 * manager, or raw squad name must NEVER appear here. The Drizzle `metadata`
 * jsonb column is similarly restricted by construction in
 * `buildRankingSnapshotRows`.
 */
export interface RankingSnapshotRow {
  snapshotDate: string;
  methodologyVersion: string;
  signalWindowStart: Date;
  signalWindowEnd: Date;
  emailHash: string;
  eligibilityStatus: EligibilityStatus;
  rank: number | null;
  compositeScore: number | null;
  adjustedPercentile: number | null;
  rawPercentile: number | null;
  methodA: number | null;
  methodB: number | null;
  methodC: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  inputHash: string | null;
  metadata: RankingSnapshotRowMetadata;
}

/**
 * Non-identifying metadata safe to persist alongside a ranking row. Values
 * are deliberately coarse — anything that could deanonymise an engineer in
 * a small cohort is excluded. Updates to this shape must not introduce
 * fields that can be correlated with the email hash to recover identity.
 */
export interface RankingSnapshotRowMetadata {
  /** Number of composite methods present for this engineer (0..4). */
  presentMethodCount: number;
  /** True when the composite was globally dominance-blocked this run. */
  dominanceBlocked: boolean;
  /** True when the cohort's composite dominance check skipped this signal. */
  dominanceRiskApplied: boolean;
  /** Confidence-band width in composite-percentile points; null when unknown. */
  confidenceWidth: number | null;
  /** True when the engineer sat in a statistical-tie group. */
  inTieGroup: boolean;
}

/**
 * Canonical ISO date formatter for `snapshot_date` (UTC calendar day).
 * The natural key uses this string verbatim so `persistRankingSnapshot`
 * being called twice on the same UTC day is idempotent under the same
 * methodology version.
 */
export function toSnapshotDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const INPUT_HASH_SIGNAL_FIELDS: readonly (keyof PerEngineerSignalRow)[] = [
  "prCount",
  "commitCount",
  "additions",
  "deletions",
  "shapPredicted",
  "shapActual",
  "shapResidual",
  "squadCycleTimeHours",
  "squadReviewRatePercent",
  "squadTimeToFirstReviewHours",
  "squadPrsInProgress",
];

/**
 * Deterministic hash of the subset of per-engineer input signals used by
 * the ranking methodology. Stable across runs when the inputs are
 * byte-identical — M17 movers can compare it across snapshots to tell
 * "the inputs moved" from "the methodology moved" without persisting the
 * raw values.
 *
 * AI tokens/spend are excluded because they do not enter scoring and so
 * must not be mistakenly attributed as a ranking input. The hash is
 * truncated to 16 hex chars, matching `hashEmailForRanking`.
 */
export function computeRankingInputHash(row: PerEngineerSignalRow): string {
  const payload = INPUT_HASH_SIGNAL_FIELDS.map((field) => {
    const value = row[field];
    if (value === null || value === undefined) return `${String(field)}:null`;
    if (typeof value === "number" && !Number.isFinite(value)) {
      return `${String(field)}:nan`;
    }
    if (typeof value === "number") {
      // Round to 6 decimal places so tiny floating-point jitter does not
      // flip the hash on re-ingest of the same upstream row.
      return `${String(field)}:${Number(value.toFixed(6))}`;
    }
    return `${String(field)}:${String(value)}`;
  }).join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Build the persistence rows for a ranking snapshot. One row is emitted per
 * competitive engineer in `snapshot.composite.entries`, scored or unscored —
 * ramp-up and leaver engineers are already filtered out upstream by the
 * composite builder. Rows NEVER include display name, email, manager,
 * canonical squad name, or resolved GitHub login; the privacy guarantee is
 * enforced at the construction site, not only in the schema.
 *
 * `snapshotDate` defaults to the UTC calendar day of `snapshot.generatedAt`,
 * so under normal usage the natural key `(snapshotDate, methodologyVersion,
 * emailHash)` is idempotent for same-day persist calls.
 *
 * `signalsByHash` is optional — when supplied, the per-engineer
 * `inputHash` is populated. Pass the same signal rows the snapshot was
 * built from to align the hash with the inputs that produced the rank.
 */
export function buildRankingSnapshotRows(
  snapshot: EngineeringRankingSnapshot,
  options?: {
    snapshotDate?: string;
    signalsByHash?: ReadonlyMap<string, PerEngineerSignalRow>;
  },
): RankingSnapshotRow[] {
  const snapshotDate =
    options?.snapshotDate ?? toSnapshotDate(new Date(snapshot.generatedAt));
  const signalWindowStart = new Date(snapshot.signalWindow.start);
  const signalWindowEnd = new Date(snapshot.signalWindow.end);
  const normalisedByHash = new Map(
    snapshot.normalisation.entries.map((n) => [n.emailHash, n]),
  );
  const confidenceByHash = new Map(
    snapshot.confidence.entries.map((c) => [c.emailHash, c]),
  );
  const eligibilityByHash = new Map(
    snapshot.eligibility.entries.map((e) => [e.emailHash, e.eligibility]),
  );
  const dominanceBlocked = snapshot.composite.dominanceBlocked;

  return snapshot.composite.entries.map((entry) => {
    const normalised = normalisedByHash.get(entry.emailHash);
    const confidence = confidenceByHash.get(entry.emailHash);
    const eligibility =
      eligibilityByHash.get(entry.emailHash) ?? "competitive";
    const signals = options?.signalsByHash?.get(entry.emailHash);
    const dominanceRiskApplied = snapshot.composite.finalRankCorrelations.some(
      (corr) => corr.dominanceRisk,
    );

    return {
      snapshotDate,
      methodologyVersion: snapshot.methodologyVersion,
      signalWindowStart,
      signalWindowEnd,
      emailHash: entry.emailHash,
      eligibilityStatus: eligibility,
      rank: entry.rank,
      compositeScore: entry.composite,
      adjustedPercentile: normalised?.adjustedPercentile ?? null,
      rawPercentile: normalised?.rawPercentile ?? null,
      methodA: entry.output,
      methodB: entry.impact,
      methodC: entry.delivery,
      confidenceLow: confidence?.ciLow ?? null,
      confidenceHigh: confidence?.ciHigh ?? null,
      inputHash: signals ? computeRankingInputHash(signals) : null,
      metadata: {
        presentMethodCount: entry.presentMethodCount,
        dominanceBlocked,
        dominanceRiskApplied,
        confidenceWidth: confidence?.ciWidth ?? null,
        inTieGroup: confidence?.inTieGroup ?? false,
      },
    };
  });
}

/**
 * Build a snapshot from already-fetched inputs. The server-side loader does
 * the fetching and calls this; tests call it with fixtures.
 *
 * Status stays `methodology_pending` even though the composite, confidence
 * bands, per-engineer attribution, ranking snapshot persistence, movers,
 * and the methodology panel / anti-gaming audit / freshness badges /
 * manager-calibration stub are all live — the stability check is the
 * remaining milestone that must land before the methodology is defensible
 * enough to advertise as `ready`.
 */
export function buildRankingSnapshot(
  inputs: EligibilityInputs,
): EngineeringRankingSnapshot {
  const now = inputs.now ?? new Date();
  const windowDays = inputs.windowDays ?? RANKING_SIGNAL_WINDOW_DAYS;
  const windowEnd = now.toISOString();
  const windowStart = new Date(
    now.getTime() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { entries, coverage } = buildEligibleRoster(inputs);
  const audit = buildSignalAudit({
    entries,
    signals: inputs.signals,
    windowDays,
    reviewSignalsPersisted: inputs.reviewSignalsPersisted,
  });
  const lenses = buildLenses({ entries, signals: inputs.signals });
  const normalisation = buildNormalisation({
    entries,
    signals: inputs.signals,
    windowDays,
    rampUpDays: inputs.rampUpDays,
  });
  const composite = buildComposite({
    entries,
    lenses,
    normalisation,
    signals: inputs.signals,
  });
  const confidence = buildConfidence({
    entries,
    composite,
    signals: inputs.signals,
  });
  const attribution = buildAttribution({
    entries,
    lenses,
    normalisation,
    composite,
    windowStartIso: windowStart,
    windowEndIso: windowEnd,
    githubOrg: inputs.githubOrg ?? null,
  });
  const movers = buildMovers({
    currentSnapshotDate: toSnapshotDate(now),
    currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
    composite,
    confidence,
    eligibilityEntries: entries,
    signals: inputs.signals,
    priorRows: inputs.priorSnapshotRows,
    minGapDays: inputs.moversMinGapDays,
    topN: inputs.moversTopN,
  });
  const methodology = buildMethodology({
    composite,
    normalisation,
    attribution,
    audit,
    knownLimitations: KNOWN_LIMITATIONS,
    signalWindowStart: windowStart,
    signalWindowEnd: windowEnd,
    snapshotDate: toSnapshotDate(now),
    impactModelGeneratedAt: inputs.impactModel.generated_at ?? null,
    aiUsageLatestMonth: inputs.aiUsageLatestMonth ?? null,
    headcountGeneratedAt: inputs.headcountGeneratedAt ?? null,
  });

  // Only engineers with a non-null composite rank are materialised into the
  // top-level `engineers` array — unscored competitive engineers remain
  // visible in `eligibility.entries` and `composite.entries`, but `engineers`
  // is reserved for rows the methodology has actually scored so a reader
  // never confuses "in the roster" with "ranked".
  const normalisedByHash = new Map(
    normalisation.entries.map((n) => [n.emailHash, n]),
  );
  const confidenceByHash = new Map(
    confidence.entries.map((c) => [c.emailHash, c]),
  );
  const engineers: EngineerRankingEntry[] = composite.entries
    .filter((c) => c.composite !== null && c.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((c) => {
      const normalised = normalisedByHash.get(c.emailHash);
      const ci = confidenceByHash.get(c.emailHash);
      return {
        emailHash: c.emailHash,
        displayName: c.displayName,
        rank: c.rank,
        compositeScore: c.composite,
        adjustedPercentile: normalised?.adjustedPercentile ?? null,
        rawPercentile: normalised?.rawPercentile ?? null,
        eligibility: "competitive",
        confidence:
          ci && ci.ciLow !== null && ci.ciHigh !== null
            ? { low: ci.ciLow, high: ci.ciHigh }
            : null,
      };
    });

  return {
    status: "methodology_pending",
    methodologyVersion: RANKING_METHODOLOGY_VERSION,
    generatedAt: windowEnd,
    signalWindow: { start: windowStart, end: windowEnd },
    engineers,
    eligibility: {
      entries,
      coverage,
      sourceNotes: buildSourceNotes(inputs),
    },
    audit,
    lenses,
    normalisation,
    composite,
    confidence,
    attribution,
    movers,
    methodology,
    knownLimitations: [...KNOWN_LIMITATIONS],
    plannedSignals: PLANNED_SIGNALS.map((s) => ({ ...s })),
  };
}

function emptyCoverage(): EligibilityCoverage {
  return {
    totalEngineers: 0,
    competitive: 0,
    rampUp: 0,
    insufficientMapping: 0,
    inactiveOrLeaver: 0,
    missingRequiredData: 0,
    mappedToGitHub: 0,
    presentInImpactModel: 0,
    excludedFutureStart: 0,
    squadRegistryUnmatched: 0,
    rampUpThresholdDays: RANKING_RAMP_UP_DAYS,
    squadsRegistryPresent: false,
  };
}

/**
 * Stub loader used by tests and callers that do not want to touch the
 * database/Mode. Returns the `methodology_pending` snapshot with an empty
 * eligibility roster. The real, data-fetching loader lives in
 * `engineering-ranking.server.ts` and delegates to `buildRankingSnapshot`.
 */
export async function getEngineeringRanking(): Promise<EngineeringRankingSnapshot> {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(
    now.getTime() - RANKING_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const entries: EligibilityEntry[] = [];
  const lenses = buildLenses({ entries });
  const normalisation = buildNormalisation({ entries });
  const composite = buildComposite({ entries, lenses, normalisation });
  const confidence = buildConfidence({ entries, composite });
  const attribution = buildAttribution({
    entries,
    lenses,
    normalisation,
    composite,
    windowStartIso: windowStart,
    windowEndIso: windowEnd,
  });
  const movers = buildMovers({
    currentSnapshotDate: toSnapshotDate(now),
    currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
    composite,
    confidence,
    eligibilityEntries: entries,
  });
  const audit = buildSignalAudit({
    entries,
    windowDays: RANKING_SIGNAL_WINDOW_DAYS,
    reviewSignalsPersisted: false,
  });
  const methodology = buildMethodology({
    composite,
    normalisation,
    attribution,
    audit,
    knownLimitations: KNOWN_LIMITATIONS,
    signalWindowStart: windowStart,
    signalWindowEnd: windowEnd,
    snapshotDate: toSnapshotDate(now),
    impactModelGeneratedAt: null,
    aiUsageLatestMonth: null,
    headcountGeneratedAt: null,
  });

  return {
    status: "methodology_pending",
    methodologyVersion: RANKING_METHODOLOGY_VERSION,
    generatedAt: windowEnd,
    signalWindow: { start: windowStart, end: windowEnd },
    engineers: [],
    eligibility: {
      entries: [],
      coverage: emptyCoverage(),
      sourceNotes: buildSourceNotes({
        headcountRows: [],
        githubMap: [],
        impactModel: { engineers: [] },
      }),
    },
    audit,
    lenses,
    normalisation,
    composite,
    confidence,
    attribution,
    movers,
    methodology,
    knownLimitations: [...KNOWN_LIMITATIONS],
    plannedSignals: PLANNED_SIGNALS.map((s) => ({ ...s })),
  };
}
