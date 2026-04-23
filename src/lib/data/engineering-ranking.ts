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
      "Ranking math, tenure/role normalisation, and confidence bands are implemented in later milestones. Until then no engineer is ranked.",
      "Squad-level DORA and AI usage signals remain contextual — they must not directly drive individual ranking without explicit evidence.",
    ],
    plannedSignals: [
      { name: "GitHub PRs + commits", state: "available" },
      { name: "SHAP impact model", state: "available" },
      { name: "PR review graph", state: "available" },
      { name: "Mode headcount / tenure / discipline", state: "available" },
      { name: "Swarmia DORA (squad context)", state: "available" },
      { name: "AI usage (contextual, audit only)", state: "available" },
      {
        name: "Per-PR LLM rubric (prReviewAnalyses)",
        state: "unavailable",
        note: "Not present in schema today. Listed in plan risks.",
      },
    ],
  };
}
