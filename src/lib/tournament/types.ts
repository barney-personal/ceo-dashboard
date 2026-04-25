export type Verdict = "A" | "B" | "draw";

export type JudgeProvider = "anthropic" | "openai";

export interface JudgeIdentity {
  provider: JudgeProvider;
  model: string;
}

export interface EngineerDossier {
  email: string;
  displayLabel: "A" | "B";
  windowStart: Date;
  windowEnd: Date;
  rendered: string;
}

export interface MatchPairing {
  matchId: number;
  runId: number;
  engineerAEmail: string;
  engineerBEmail: string;
  rubricVersion: string;
}

export interface JudgmentResult {
  matchId: number;
  judge: JudgeIdentity;
  verdict: Verdict;
  confidencePct: number | null;
  reasoning: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
}

export interface RatingSnapshot {
  engineerEmail: string;
  rating: number;
  judgmentsPlayed: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface TournamentRunSummary {
  runId: number;
  matchTarget: number;
  matchesCompleted: number;
  judgmentsCompleted: number;
  judgmentsFailed: number;
  totalCostUsd: number;
  durationMs: number;
  finalRatings: RatingSnapshot[];
}
