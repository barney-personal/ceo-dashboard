import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  engineerMatchJudgments,
  engineerMatches,
  engineerRatings,
  engineerTournamentRuns,
} from "@/lib/db/schema";
import {
  ANTHROPIC_CONCURRENCY,
  OPENAI_CONCURRENCY,
  RUBRIC_VERSION,
  SINGLE_JUDGE_ANTHROPIC_RATIO,
  STARTING_RATING,
} from "./config";
import { buildEngineerDossier, listEligibleEngineers } from "./dossier";
import { applyEloUpdate } from "./elo";
import { judgeWithAnthropic, judgeWithOpenAi } from "./judges";
import { pairKey, selectNextPair } from "./pairing";
import { getCodeReviewView } from "@/lib/data/code-review";
import { Semaphore } from "./semaphore";
import type {
  EngineerDossier,
  JudgmentResult,
  RatingSnapshot,
  TournamentRunSummary,
  Verdict,
} from "./types";

export interface RunOptions {
  matchTarget: number;
  windowStart: Date;
  windowEnd: Date;
  triggeredBy: "manual" | "cron" | "cli";
  notes?: string;
  /** Restrict the engineer pool to this allowlist of emails. Useful for tests. */
  engineerAllowlist?: string[];
  /** Skip real LLM calls and produce mock verdicts. For pipeline smoke tests. */
  dryRun?: boolean;
  /** When true, each match runs ONE judge instead of two. Routes Anthropic vs
   *  OpenAI by SINGLE_JUDGE_ANTHROPIC_RATIO so the providers don't block each
   *  other — substantial wall-clock speedup at the cost of half the judgments
   *  per match. Each match is its own independent ELO update either way. */
  singleJudge?: boolean;
  /** Warm-start from a prior run: load that run's per-engineer ratings,
   *  per-engineer judgment counts, and per-pair counts into memory before
   *  scheduling new matches. The new run accrues additional matches on top
   *  of the prior state — useful for incremental "another N rounds"
   *  follow-ups without re-running all the matches we already paid for.
   *  Caps (max-judgments-per-engineer, max-rematches-per-pair) apply
   *  cumulatively across runs in this mode. */
  continueFromRunId?: number;
  signal?: AbortSignal;
  /** Progress callback fired after every judgment (success or failure). */
  onProgress?: (event: ProgressEvent) => void;
  /** Fired once the run row has been inserted so callers can return the id immediately. */
  onStart?: (runId: number) => void;
}

export interface ProgressEvent {
  matchesCompleted: number;
  matchesAttempted: number;
  judgmentsCompleted: number;
  judgmentsFailed: number;
  costUsdSoFar: number;
  lastVerdict?: { matchId: number; provider: string; verdict: Verdict };
  lastError?: { matchId: number; provider: string; message: string };
}

const ANTHROPIC_SEMAPHORE = new Semaphore(ANTHROPIC_CONCURRENCY);
const OPENAI_SEMAPHORE = new Semaphore(OPENAI_CONCURRENCY);

export async function runTournament(
  options: RunOptions,
): Promise<TournamentRunSummary> {
  const start = Date.now();

  const eligible = await listEligibleEngineers(
    options.windowStart,
    options.windowEnd,
  );
  const allowlist = options.engineerAllowlist?.map((e) => e.toLowerCase());
  const pool = allowlist
    ? eligible.filter((e) => allowlist.includes(e.email))
    : eligible;

  if (pool.length < 2) {
    throw new Error(
      `Tournament needs at least 2 eligible engineers; found ${pool.length}.`,
    );
  }

  // Pre-fetch the cohort-relative review-churn residual for each engineer so
  // every dossier gets a "is this engineer's review back-and-forth abnormal
  // for the type of work they ship" signal that can't be inferred from raw
  // per-PR counts alone. One getCodeReviewView() call covers the full pool.
  const churnResidualByEmail = await loadChurnResidualMap(
    options.windowStart,
    options.windowEnd,
  );

  const [run] = await db
    .insert(engineerTournamentRuns)
    .values({
      status: "running",
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      rubricVersion: RUBRIC_VERSION,
      matchTarget: options.matchTarget,
      triggeredBy: options.triggeredBy,
      notes: options.notes ?? null,
    })
    .returning();
  options.onStart?.(run.id);

  const ratings = new Map<string, RatingSnapshot>();
  for (const engineer of pool) {
    ratings.set(engineer.email, {
      engineerEmail: engineer.email,
      rating: STARTING_RATING,
      judgmentsPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    });
  }

  const dossierCache = new Map<string, EngineerDossier>();
  const pairCounts = new Map<string, number>();

  // Warm-start from a prior run if requested — caps accumulate across runs.
  if (options.continueFromRunId) {
    const priorState = await loadPriorRunState(options.continueFromRunId);
    for (const prior of priorState.ratings) {
      const existing = ratings.get(prior.engineerEmail);
      if (!existing) continue; // engineer fell out of pool since prior run
      existing.rating = prior.rating;
      existing.judgmentsPlayed = prior.judgmentsPlayed;
      existing.wins = prior.wins;
      existing.losses = prior.losses;
      existing.draws = prior.draws;
    }
    for (const [key, count] of priorState.pairCounts) {
      pairCounts.set(key, count);
    }
  }

  await persistRatingsSnapshot(run.id, ratings);
  // Tracks judgments scheduled but not yet applied to in-memory ratings.
  // The runner can fan out tens of matches in flight before any rating update
  // completes, so a naive `ratings[email].judgmentsPlayed >= cap` check would
  // miss in-flight commitments. We add this to the cap check inside pairing.
  const inFlightByEmail = new Map<string, number>();
  const incInFlight = (email: string) =>
    inFlightByEmail.set(email, (inFlightByEmail.get(email) ?? 0) + 1);
  const decInFlight = (email: string) =>
    inFlightByEmail.set(
      email,
      Math.max(0, (inFlightByEmail.get(email) ?? 0) - 1),
    );

  const counters = {
    matchesAttempted: 0,
    matchesCompleted: 0,
    judgmentsCompleted: 0,
    judgmentsFailed: 0,
    costUsd: 0,
  };

  const ratingChain: { tail: Promise<void> } = { tail: Promise.resolve() };

  try {
    for (let matchIdx = 0; matchIdx < options.matchTarget; matchIdx++) {
      throwIfAborted(options.signal);

      // Cheap cancel check every 10 matches so a UI DELETE actually stops the worker.
      if (matchIdx > 0 && matchIdx % 10 === 0) {
        const [runRow] = await db
          .select({ status: engineerTournamentRuns.status })
          .from(engineerTournamentRuns)
          .where(eq(engineerTournamentRuns.id, run.id));
        if (runRow?.status === "cancelled") {
          throw createAbortError("Cancelled via DB status");
        }
      }

      const pair = selectNextPair(
        [...ratings.values()].map((r) => ({
          email: r.engineerEmail,
          rating: r.rating,
          // Add in-flight count so engineers with N matches dispatched but not
          // yet applied to ratings are correctly seen as "near cap".
          judgmentsPlayed:
            r.judgmentsPlayed + (inFlightByEmail.get(r.engineerEmail) ?? 0),
        })),
        pairCounts,
      );
      if (!pair) {
        // No eligible pair left — every remaining option exceeds the rating-gap
        // ceiling or the per-pair rematch cap. Stop scheduling matches.
        break;
      }
      pairCounts.set(
        pairKey(pair.aEmail, pair.bEmail),
        (pairCounts.get(pairKey(pair.aEmail, pair.bEmail)) ?? 0) + 1,
      );

      const [matchRow] = await db
        .insert(engineerMatches)
        .values({
          runId: run.id,
          engineerAEmail: pair.aEmail,
          engineerBEmail: pair.bEmail,
          rubricVersion: RUBRIC_VERSION,
          status: "judging",
        })
        .returning();
      counters.matchesAttempted++;

      const [dossierA, dossierB] = await Promise.all([
        getOrBuildDossier(
          dossierCache,
          pair.aEmail,
          options.windowStart,
          options.windowEnd,
          "A",
          churnResidualByEmail,
        ),
        getOrBuildDossier(
          dossierCache,
          pair.bEmail,
          options.windowStart,
          options.windowEnd,
          "B",
          churnResidualByEmail,
        ),
      ]);

      if (!dossierA || !dossierB) {
        await db
          .update(engineerMatches)
          .set({
            status: "failed",
            errorMessage: !dossierA
              ? `Missing dossier for ${pair.aEmail}`
              : `Missing dossier for ${pair.bEmail}`,
            completedAt: new Date(),
          })
          .where(eq(engineerMatches.id, matchRow.id));
        // matchesAttempted was incremented above; matchesCompleted is normally
        // incremented inside the dispatch.then() callback. Skipping that path
        // means the drain loop (matchesCompleted < matchesAttempted) waits
        // forever. Increment here so a missing-dossier match doesn't strand
        // the run.
        counters.matchesCompleted++;
        continue;
      }

      const judgeInput = {
        pairing: {
          matchId: matchRow.id,
          runId: run.id,
          engineerAEmail: pair.aEmail,
          engineerBEmail: pair.bEmail,
          rubricVersion: RUBRIC_VERSION,
        },
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        dossierA: dossierA.rendered,
        dossierB: dossierB.rendered,
      };

      const judgesPerMatch = options.singleJudge ? 1 : 2;
      // Account for in-flight commitments BEFORE the judgment fans out so the
      // next pair-selection sees an accurate view of how many matches each
      // engineer is already committed to.
      for (let n = 0; n < judgesPerMatch; n++) {
        incInFlight(pair.aEmail);
        incInFlight(pair.bEmail);
      }

      const dispatch = options.singleJudge
        ? Promise.allSettled([
            pickSingleJudge(judgeInput, options),
          ])
        : Promise.allSettled([
            ANTHROPIC_SEMAPHORE.run(() =>
              options.dryRun
                ? mockJudgment(judgeInput, "anthropic")
                : judgeWithAnthropic(judgeInput, { signal: options.signal }),
            ),
            OPENAI_SEMAPHORE.run(() =>
              options.dryRun
                ? mockJudgment(judgeInput, "openai")
                : judgeWithOpenAi(judgeInput, { signal: options.signal }),
            ),
          ]);

      // Don't await dispatch in the loop — let it run while we queue more.
      // But we DO need ratingChain to serialise rating updates.
      // Wrapped in try/finally so a transient DB failure inside the callback
      // (rating upsert, match-status write) can't strand the drain loop —
      // matchesCompleted always increments exactly once per dispatched match.
      void dispatch.then(async (results) => {
       try {
        for (const result of results) {
          // Each settled result (success or failure) clears one in-flight slot
          // for both engineers. Ratings update only on success below.
          decInFlight(pair.aEmail);
          decInFlight(pair.bEmail);
          if (result.status === "fulfilled") {
            counters.judgmentsCompleted++;
            counters.costUsd += result.value.costUsd ?? 0;
            ratingChain.tail = ratingChain.tail.then(() =>
              applyJudgmentToRatings(
                run.id,
                matchRow.id,
                pair.aEmail,
                pair.bEmail,
                result.value,
                ratings,
              ),
            );
            options.onProgress?.({
              matchesCompleted: counters.matchesCompleted,
              matchesAttempted: counters.matchesAttempted,
              judgmentsCompleted: counters.judgmentsCompleted,
              judgmentsFailed: counters.judgmentsFailed,
              costUsdSoFar: counters.costUsd,
              lastVerdict: {
                matchId: matchRow.id,
                provider: result.value.judge.provider,
                verdict: result.value.verdict,
              },
            });
          } else {
            counters.judgmentsFailed++;
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            options.onProgress?.({
              matchesCompleted: counters.matchesCompleted,
              matchesAttempted: counters.matchesAttempted,
              judgmentsCompleted: counters.judgmentsCompleted,
              judgmentsFailed: counters.judgmentsFailed,
              costUsdSoFar: counters.costUsd,
              lastError: {
                matchId: matchRow.id,
                provider: "unknown",
                message,
              },
            });
          }
        }

        const completedThisMatch = results.filter(
          (r) => r.status === "fulfilled",
        ).length;
        try {
          await db
            .update(engineerMatches)
            .set({
              status: completedThisMatch > 0 ? "complete" : "failed",
              completedAt: new Date(),
              errorMessage:
                completedThisMatch === 0
                  ? results
                      .map((r) =>
                        r.status === "rejected"
                          ? r.reason instanceof Error
                            ? r.reason.message
                            : String(r.reason)
                          : "",
                      )
                      .filter(Boolean)
                      .join(" | ")
                  : null,
            })
            .where(eq(engineerMatches.id, matchRow.id));
        } catch (err) {
          // Status update failure shouldn't strand the run; the run row itself
          // already records overall progress via judgmentsCompleted.
          console.warn("Match status update failed", err);
        }
       } finally {
        counters.matchesCompleted++;
       }
      });

      // Keep the in-flight pipe primed but don't let it run unbounded.
      // Each provider semaphore caps real concurrency; we just need to keep
      // the loop from getting too far ahead so progress callbacks make sense.
      if (counters.matchesAttempted - counters.matchesCompleted > 32) {
        await waitOneTick();
      }
    }

    // Drain remaining dispatched matches.
    while (counters.matchesCompleted < counters.matchesAttempted) {
      throwIfAborted(options.signal);
      await waitOneTick();
    }
    await ratingChain.tail;

    await db
      .update(engineerTournamentRuns)
      .set({
        status: "completed",
        matchesCompleted: counters.matchesCompleted,
        judgmentsCompleted: counters.judgmentsCompleted,
        completedAt: new Date(),
      })
      .where(eq(engineerTournamentRuns.id, run.id));
  } catch (error) {
    await db
      .update(engineerTournamentRuns)
      .set({
        status: error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed",
        matchesCompleted: counters.matchesCompleted,
        judgmentsCompleted: counters.judgmentsCompleted,
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(engineerTournamentRuns.id, run.id));
    throw error;
  }

  return {
    runId: run.id,
    matchTarget: options.matchTarget,
    matchesCompleted: counters.matchesCompleted,
    judgmentsCompleted: counters.judgmentsCompleted,
    judgmentsFailed: counters.judgmentsFailed,
    totalCostUsd: counters.costUsd,
    durationMs: Date.now() - start,
    finalRatings: [...ratings.values()].sort((a, b) => b.rating - a.rating),
  };
}

async function getOrBuildDossier(
  cache: Map<string, EngineerDossier>,
  email: string,
  windowStart: Date,
  windowEnd: Date,
  label: "A" | "B",
  churnResidualByEmail: Map<string, number>,
): Promise<EngineerDossier | null> {
  const cacheKey = `${email}|${label}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const dossier = await buildEngineerDossier(email, windowStart, windowEnd, label, {
    reviewChurnResidual: churnResidualByEmail.get(email.toLowerCase()),
  });
  if (dossier) cache.set(cacheKey, dossier);
  return dossier;
}

interface PriorRunState {
  ratings: Array<{
    engineerEmail: string;
    rating: number;
    judgmentsPlayed: number;
    wins: number;
    losses: number;
    draws: number;
  }>;
  pairCounts: Map<string, number>;
}

async function loadPriorRunState(runId: number): Promise<PriorRunState> {
  const ratingRows = await db
    .select({
      engineerEmail: engineerRatings.engineerEmail,
      rating: sql<number>`${engineerRatings.rating}::float`,
      judgmentsPlayed: engineerRatings.judgmentsPlayed,
      wins: engineerRatings.wins,
      losses: engineerRatings.losses,
      draws: engineerRatings.draws,
    })
    .from(engineerRatings)
    .where(eq(engineerRatings.runId, runId));

  const matchRows = await db
    .select({
      engineerAEmail: engineerMatches.engineerAEmail,
      engineerBEmail: engineerMatches.engineerBEmail,
    })
    .from(engineerMatches)
    .where(eq(engineerMatches.runId, runId));

  const pairCounts = new Map<string, number>();
  for (const row of matchRows) {
    const key = pairKey(row.engineerAEmail, row.engineerBEmail);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  return {
    ratings: ratingRows.map((r) => ({
      engineerEmail: r.engineerEmail,
      rating: r.rating,
      judgmentsPlayed: r.judgmentsPlayed,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
    })),
    pairCounts,
  };
}

async function loadChurnResidualMap(
  windowStart: Date,
  windowEnd: Date,
): Promise<Map<string, number>> {
  try {
    const windowDays = Math.max(
      1,
      Math.round((windowEnd.getTime() - windowStart.getTime()) / 86_400_000),
    );
    const view = await getCodeReviewView({ windowDays });
    const out = new Map<string, number>();
    for (const engineer of view.engineers) {
      if (!engineer.employeeEmail) continue;
      out.set(
        engineer.employeeEmail.toLowerCase(),
        engineer.reviewChurnResidual,
      );
    }
    return out;
  } catch {
    // Best-effort: if the code-review view fails for any reason, just don't
    // surface the residual. Dossiers fall back to the unannotated form.
    return new Map();
  }
}

async function applyJudgmentToRatings(
  runId: number,
  matchId: number,
  emailA: string,
  emailB: string,
  judgment: JudgmentResult,
  ratings: Map<string, RatingSnapshot>,
): Promise<void> {
  const a = ratings.get(emailA);
  const b = ratings.get(emailB);
  if (!a || !b) return;

  const update = applyEloUpdate(a.rating, b.rating, judgment.verdict);
  a.rating = update.ratingA;
  b.rating = update.ratingB;
  a.judgmentsPlayed++;
  b.judgmentsPlayed++;
  if (judgment.verdict === "A") {
    a.wins++;
    b.losses++;
  } else if (judgment.verdict === "B") {
    a.losses++;
    b.wins++;
  } else {
    a.draws++;
    b.draws++;
  }

  await db.insert(engineerMatchJudgments).values({
    matchId,
    judgeProvider: judgment.judge.provider,
    judgeModel: judgment.judge.model,
    verdict: judgment.verdict,
    confidencePct: judgment.confidencePct,
    reasoning: judgment.reasoning,
    inputTokens: judgment.inputTokens,
    outputTokens: judgment.outputTokens,
    thinkingTokens: judgment.thinkingTokens,
    costUsd: judgment.costUsd?.toString() ?? null,
    latencyMs: judgment.latencyMs,
  });

  await db
    .update(engineerTournamentRuns)
    .set({
      judgmentsCompleted: sql`${engineerTournamentRuns.judgmentsCompleted} + 1`,
    })
    .where(eq(engineerTournamentRuns.id, runId));

  await Promise.all([
    upsertRating(runId, a),
    upsertRating(runId, b),
  ]);
}

async function persistRatingsSnapshot(
  runId: number,
  ratings: Map<string, RatingSnapshot>,
): Promise<void> {
  if (ratings.size === 0) return;
  await db
    .insert(engineerRatings)
    .values(
      [...ratings.values()].map((r) => ({
        runId,
        engineerEmail: r.engineerEmail,
        rating: r.rating.toFixed(2),
        judgmentsPlayed: r.judgmentsPlayed,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
      })),
    )
    .onConflictDoNothing();
}

async function upsertRating(
  runId: number,
  rating: RatingSnapshot,
): Promise<void> {
  await db
    .update(engineerRatings)
    .set({
      rating: rating.rating.toFixed(2),
      judgmentsPlayed: rating.judgmentsPlayed,
      wins: rating.wins,
      losses: rating.losses,
      draws: rating.draws,
      updatedAt: new Date(),
    })
    .where(
      sql`${engineerRatings.runId} = ${runId} AND ${engineerRatings.engineerEmail} = ${rating.engineerEmail}`,
    );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(
      signal.reason instanceof Error ? signal.reason.message : "Aborted",
    );
  }
}

function createAbortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function waitOneTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

async function pickSingleJudge(
  judgeInput: Parameters<typeof judgeWithAnthropic>[0],
  options: RunOptions,
): Promise<JudgmentResult> {
  const useAnthropic = Math.random() < SINGLE_JUDGE_ANTHROPIC_RATIO;
  if (useAnthropic) {
    return ANTHROPIC_SEMAPHORE.run(() =>
      options.dryRun
        ? mockJudgment(judgeInput, "anthropic")
        : judgeWithAnthropic(judgeInput, { signal: options.signal }),
    );
  }
  return OPENAI_SEMAPHORE.run(() =>
    options.dryRun
      ? mockJudgment(judgeInput, "openai")
      : judgeWithOpenAi(judgeInput, { signal: options.signal }),
  );
}

async function mockJudgment(
  input: { pairing: { matchId: number } },
  provider: "anthropic" | "openai",
): Promise<JudgmentResult> {
  await new Promise((r) => setTimeout(r, 30 + Math.random() * 50));
  const roll = Math.random();
  const verdict: Verdict = roll < 0.45 ? "A" : roll < 0.9 ? "B" : "draw";
  return {
    matchId: input.pairing.matchId,
    judge: {
      provider,
      model: provider === "anthropic" ? "mock-anthropic" : "mock-openai",
    },
    verdict,
    confidencePct: 60 + Math.floor(Math.random() * 30),
    reasoning: `dry-run mock verdict from ${provider}`,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
    latencyMs: 50,
  };
}
