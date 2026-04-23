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
  rampUpThresholdDays: number;
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

export interface EligibilityInputs {
  headcountRows: EligibilityHeadcountRow[];
  githubMap: EligibilityGithubMapRow[];
  impactModel: EligibilityImpactModelView;
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
 *
 * No active engineer is dropped silently: unmapped or missing-data engineers
 * still appear in `entries` with an explicit `eligibility` and `reason`.
 * Manager chain is sourced from the headcount row (`manager` with
 * `line_manager_email` fallback), never from the squads registry.
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

  const entries: EligibilityEntry[] = [];

  for (const row of inputs.headcountRows) {
    if (!isEngineerRow(row)) continue;

    const emailRaw = row.email ?? "";
    const email = emailRaw.toLowerCase();
    const displayName =
      row.preferred_name?.trim() ||
      row.rp_full_name?.trim() ||
      email ||
      "(unknown)";

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
    rampUpThresholdDays: rampUpDays,
  };

  return { entries, coverage };
}

/** Provenance notes surfaced above the ranking so readers see each source. */
export const RANKING_SOURCE_NOTES: readonly string[] = [
  "Roster spine: Mode Headcount SSoT (engineering rows). Manager chain comes from the `manager` / `line_manager_email` fields on the same row.",
  "GitHub identity: `githubEmployeeMap` (non-bot). Unmapped active engineers surface with `insufficient_mapping`, not silently dropped.",
  "Impact model presence: `src/data/impact-model.json` joined by `email_hash` (SHA-256 of lowercased email, first 16 hex chars).",
  "Squads registry supplies squad name, pillar, PM, and Slack channel only. It does not provide manager chain.",
  "Display names and emails are resolved at request time and never written into persisted ranking snapshots.",
];

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
    name: "Squads registry (squad name, pillar, PM, Slack channel)",
    state: "available",
    note: "`squads` table stores squad name, pillar, PM, channel, and active state only. It does not contain manager or manager-email fields.",
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
      sourceNotes: [...RANKING_SOURCE_NOTES],
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
    rampUpThresholdDays: RANKING_RAMP_UP_DAYS,
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
      sourceNotes: [...RANKING_SOURCE_NOTES],
    },
    knownLimitations: [...KNOWN_LIMITATIONS],
    plannedSignals: PLANNED_SIGNALS.map((s) => ({ ...s })),
  };
}
