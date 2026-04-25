import type { JudgeIdentity } from "./types";

export const RUBRIC_VERSION = "tournament-v1";

export const DEFAULT_WINDOW_DAYS = 90;

// Bumping this requires re-running historical tournaments to keep ratings comparable.
export const STARTING_RATING = 1500;

// Each judgment is an independent ELO update (Option C). K=16 keeps a single
// pairing's two judgments equivalent in total weight to a single K=32 match.
export const ELO_K_FACTOR = 16;

// Provider concurrency caps. OpenAI's tier headroom is huge; Anthropic shares
// quota with OKR/code-review/Excel pipelines so we leave ~75% for them.
// See README "Active integrations" + the rate-limit probe in commit history.
export const ANTHROPIC_CONCURRENCY = parseIntEnv(
  process.env.TOURNAMENT_ANTHROPIC_CONCURRENCY,
  6,
);
export const OPENAI_CONCURRENCY = parseIntEnv(
  process.env.TOURNAMENT_OPENAI_CONCURRENCY,
  64,
);

export const ANTHROPIC_MODEL = "claude-opus-4-7";
export const OPENAI_MODEL = process.env.TOURNAMENT_OPENAI_MODEL?.trim() || "gpt-5.4";

// Opus 4.7 uses the adaptive-thinking API: pass `output_config.effort` instead
// of a token budget. Valid values: "low" | "medium" | "high".
export const ANTHROPIC_OUTPUT_EFFORT = (process.env
  .TOURNAMENT_ANTHROPIC_EFFORT?.trim() || "high") as "low" | "medium" | "high";

// Generous ceiling — adaptive thinking will use only what it needs.
export const ANTHROPIC_MAX_TOKENS = parseIntEnv(
  process.env.TOURNAMENT_ANTHROPIC_MAX_TOKENS,
  16_000,
);

// "Medium thinking" per the user's spec.
export const OPENAI_REASONING_EFFORT = (process.env
  .TOURNAMENT_OPENAI_REASONING_EFFORT?.trim() || "medium") as
  | "minimal"
  | "low"
  | "medium"
  | "high";

export const JUDGE_CALL_TIMEOUT_MS = 180_000;
export const JUDGE_MAX_ATTEMPTS = 3;

// Pricing in USD per 1M tokens. Used to record per-judgment cost; not load-bearing.
// Update when Anthropic/OpenAI pricing changes.
export const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 15, output: 75 },
  "gpt-5.4": { input: 1.25, output: 10 },
};

export const JUDGES: ReadonlyArray<JudgeIdentity> = [
  { provider: "anthropic", model: ANTHROPIC_MODEL },
  { provider: "openai", model: OPENAI_MODEL },
];

/**
 * In single-judge mode each match gets exactly one judgment routed to either
 * Anthropic or OpenAI. We default to ~10% Anthropic to match the natural
 * 6:64 concurrency ratio so neither provider becomes the long pole. Tune via
 * TOURNAMENT_SINGLE_JUDGE_ANTHROPIC_RATIO (0..1).
 */
export const SINGLE_JUDGE_ANTHROPIC_RATIO = parseFloatEnv(
  process.env.TOURNAMENT_SINGLE_JUDGE_ANTHROPIC_RATIO,
  0.1,
);

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseFloatEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = parseFloat(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
