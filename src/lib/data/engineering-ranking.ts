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
  /** Known methodology limitations, surfaced verbatim on the page. */
  knownLimitations: string[];
  /** Signals the loader plans to incorporate, and their current availability. */
  plannedSignals: Array<{
    name: string;
    state: "available" | "planned" | "unavailable";
    note?: string;
  }>;
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
  /** Defaults to new Date() — injectable so tests can pin "today". */
  now?: Date;
  /** Defaults to RANKING_RAMP_UP_DAYS. */
  rampUpDays?: number;
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
  const windowEnd = now.toISOString();
  const windowStart = new Date(
    now.getTime() - 180 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { entries, coverage } = buildEligibleRoster(inputs);

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
    now.getTime() - 180 * 24 * 60 * 60 * 1000,
  ).toISOString();

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
    knownLimitations: [...KNOWN_LIMITATIONS],
    plannedSignals: PLANNED_SIGNALS.map((s) => ({ ...s })),
  };
}
