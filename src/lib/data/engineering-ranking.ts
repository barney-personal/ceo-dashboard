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
 * Downstream callers must treat a ranking list as evidence, not as a final
 * answer, until `EngineeringRankingSnapshot.status === "ready"`.
 */

import { createHash } from "node:crypto";

export const RANKING_METHODOLOGY_VERSION = "0.1.0-scaffold" as const;

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
 * Per-engineer ranking entry. Populated by later milestones; today the
 * loader emits an empty array. We define the shape here so downstream tests
 * and UI can compile against the contract while M5+ fills it in.
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
   * composite — M10 synthesises the composite once the lenses are trusted.
   */
  lenses: LensesBundle;
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
 * NOT the final composite — M10 synthesises the composite once the lenses
 * are trusted and their disagreements are understood.
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
      "These three lenses are exploratory; M10 synthesises the final composite once the disagreements are understood and the weights justified.",
    ],
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
  "Ranking math, tenure/role normalisation, and confidence bands are implemented in later milestones. Until then no engineer is ranked.",
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

/**
 * Build a snapshot from already-fetched inputs. The server-side loader does
 * the fetching and calls this; tests call it with fixtures.
 *
 * Status stays `methodology_pending` because scoring lenses land in M5+.
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

  return {
    status: "methodology_pending",
    methodologyVersion: RANKING_METHODOLOGY_VERSION,
    generatedAt: windowEnd,
    signalWindow: { start: windowStart, end: windowEnd },
    engineers: [],
    eligibility: {
      entries,
      coverage,
      sourceNotes: buildSourceNotes(inputs),
    },
    audit,
    lenses,
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
    audit: buildSignalAudit({
      entries,
      windowDays: RANKING_SIGNAL_WINDOW_DAYS,
      reviewSignalsPersisted: false,
    }),
    lenses: buildLenses({ entries }),
    knownLimitations: [...KNOWN_LIMITATIONS],
    plannedSignals: PLANNED_SIGNALS.map((s) => ({ ...s })),
  };
}
