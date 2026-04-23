/**
 * Engineering ranking data loader.
 *
 * This loader is methodology-first: the page exists to iterate toward the
 * ranking we can defend for every engineer. Until the independent scoring
 * lenses, tenure/role normalisation, and confidence bands are in place the
 * loader intentionally returns a "methodology pending" state so the page is
 * honest about what it can claim.
 *
 * Downstream callers must treat a ranking list as evidence, not as a final
 * answer, until `EngineeringRankingSnapshot.status === "ready"`.
 */

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

/**
 * Per-engineer entry. Populated by later milestones; today the loader emits an
 * empty array. We define the shape here so downstream tests and UI can compile
 * against the contract while M2+ fills it in.
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
 * Stub loader. Returns a "methodology_pending" snapshot that the page renders
 * as a scaffold. Replaced in M2+ by the real eligibility-aware loader that
 * assembles signals, lenses, and composites.
 */
export async function getEngineeringRanking(): Promise<EngineeringRankingSnapshot> {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(
    now.getTime() - 180 * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    status: "methodology_pending",
    methodologyVersion: RANKING_METHODOLOGY_VERSION,
    generatedAt: windowEnd,
    signalWindow: { start: windowStart, end: windowEnd },
    engineers: [],
    knownLimitations: [
      "Per-PR LLM rubric signal (prReviewAnalyses / RUBRIC_VERSION) is not yet wired. Documented as the highest-priority future signal.",
      "Individual review graph, review turnaround, and PR-level cycle time are not persisted in `githubPrs` / `githubPrMetrics` today. The page must not claim these signals until the schema/sync is extended.",
      "Ranking math, tenure/role normalisation, and confidence bands are implemented in later milestones. Until then no engineer is ranked.",
      "Swarmia DORA is squad/pillar context only — it describes teams, not individuals, and must not be used as individual review evidence.",
      "AI usage (tokens/spend) is contextual and audit-only. It must not directly reward individuals without independent validation.",
    ],
    plannedSignals: [
      { name: "GitHub PRs + commits (author, merged_at, lines)", state: "available" },
      { name: "SHAP impact model", state: "available" },
      { name: "Mode headcount / tenure / discipline", state: "available" },
      { name: "Squads registry (pillar, manager chain)", state: "available" },
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
    ],
  };
}
