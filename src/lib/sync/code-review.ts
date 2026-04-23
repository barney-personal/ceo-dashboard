import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, gte, inArray, lte, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  githubCommits,
  githubEmployeeMap,
  githubPrs,
  prReviewAnalyses,
} from "@/lib/db/schema";
import {
  RUBRIC_VERSION,
  analysePR,
  type CodeReviewAnalysis,
} from "@/lib/integrations/code-review-analyser";
import { fetchPRAnalysisPayload } from "@/lib/integrations/github";

/**
 * How far back the page looks. 90 days gives enough evidence for a shrunk,
 * cohort-relative ranking while weekly buckets still surface recent changes.
 */
export const CODE_REVIEW_WINDOW_DAYS = 90;

/**
 * Repos we'll never run Claude against — sensitive, infra-only, or where LLM
 * judgement adds little. Empty by default; set CODE_REVIEW_EXCLUDED_REPOS
 * in Doppler to override (comma-separated `owner/repo` list).
 */
export function getExcludedRepos(): Set<string> {
  const raw = process.env.CODE_REVIEW_EXCLUDED_REPOS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isBotAuthor(login: string): boolean {
  const l = login.toLowerCase();
  return (
    l.endsWith("[bot]") ||
    l.endsWith("-bot") ||
    l === "dependabot" ||
    l === "renovate" ||
    l === "github-actions"
  );
}

export interface AnalyseRunResult {
  candidatesConsidered: number;
  cached: number;
  analysed: number;
  failed: Array<{ repo: string; prNumber: number; reason: string }>;
  skipped: Array<{ repo: string; prNumber: number; reason: string }>;
  durationMs: number;
}

export interface AnalyseRunOptions {
  /** Override the 90d default window (for cron / backfills / tests). */
  windowDays?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Max PRs to analyse per call (keeps a manual trigger bounded). */
  limit?: number;
  /** Re-analyse already-cached rows (use sparingly — blows cost). */
  force?: boolean;
}

/**
 * Analyse every merged PR in the window that doesn't yet have a cached
 * analysis for the current RUBRIC_VERSION. Idempotent — safe to re-run.
 *
 * Designed to be called from:
 *   - The CEO-only manual trigger (`POST /api/sync/code-review`)
 *   - The weekly cron (`GET /api/cron`)
 *   - Backfills (scripted; pass a larger windowDays)
 */
export async function runCodeReviewAnalysis(
  opts: AnalyseRunOptions = {},
): Promise<AnalyseRunResult> {
  const start = Date.now();
  const windowDays = opts.windowDays ?? CODE_REVIEW_WINDOW_DAYS;
  const limit = opts.limit ?? 500;
  const excluded = getExcludedRepos();

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({
      repo: githubPrs.repo,
      prNumber: githubPrs.prNumber,
      authorLogin: githubPrs.authorLogin,
      mergedAt: githubPrs.mergedAt,
    })
    .from(githubPrs)
    .where(gte(githubPrs.mergedAt, since))
    .orderBy(desc(githubPrs.mergedAt));

  // Load DB-flagged bots once so we can filter them at sync time rather than
  // at display time. Without this, a bot with a clean-looking login (e.g. a
  // release bot named `acme-releaser`) has its PRs fetched + sent to Claude
  // + stored, only to be silently dropped on page load — wasted LLM budget.
  const botLogins = new Set(
    (
      await db
        .select({ githubLogin: githubEmployeeMap.githubLogin })
        .from(githubEmployeeMap)
        .where(eq(githubEmployeeMap.isBot, true))
    ).map((r) => r.githubLogin.toLowerCase()),
  );

  const skipped: AnalyseRunResult["skipped"] = [];
  const failed: AnalyseRunResult["failed"] = [];
  let cached = 0;
  let analysed = 0;

  // Find which (repo, prNumber) pairs already have a current-rubric analysis —
  // batch lookup so we don't N+1 select.
  const eligible = candidates.filter((c) => {
    if (isBotAuthor(c.authorLogin) || botLogins.has(c.authorLogin.toLowerCase())) {
      skipped.push({ repo: c.repo, prNumber: c.prNumber, reason: "bot author" });
      return false;
    }
    if (excluded.has(c.repo.toLowerCase())) {
      skipped.push({ repo: c.repo, prNumber: c.prNumber, reason: "repo excluded" });
      return false;
    }
    return true;
  });

  if (!opts.force && eligible.length > 0) {
    const existing = await db
      .select({
        repo: prReviewAnalyses.repo,
        prNumber: prReviewAnalyses.prNumber,
      })
      .from(prReviewAnalyses)
      .where(
        and(
          eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
          or(
            ...eligible.map((c) =>
              and(
                eq(prReviewAnalyses.repo, c.repo),
                eq(prReviewAnalyses.prNumber, c.prNumber),
              ),
            ),
          ),
        ),
      );
    const key = (r: { repo: string; prNumber: number }) => `${r.repo}#${r.prNumber}`;
    const existingSet = new Set(existing.map(key));
    for (let i = eligible.length - 1; i >= 0; i--) {
      if (existingSet.has(key(eligible[i]))) {
        cached++;
        eligible.splice(i, 1);
      }
    }
  }

  const toRun = eligible.slice(0, limit);
  // githubPrs.repo is the bare repo name (e.g. "mobile-app") — the GitHub
  // sync drops the org to match its per-repo metric schema. We need the
  // full "owner/repo" for the API, so prefix with GITHUB_ORG here. Throw
  // loudly if the env var is missing rather than producing "/reponame"
  // URLs that yield silent GitHub 404s per-PR.
  const org = process.env.GITHUB_ORG;
  if (!org && toRun.some((c) => !c.repo.includes("/"))) {
    throw new Error(
      "GITHUB_ORG is not set but one or more PRs store a bare repo name. " +
        "Set GITHUB_ORG in Doppler (dev + prd) to resolve repo full names.",
    );
  }
  function fullName(repo: string): string {
    return repo.includes("/") ? repo : `${org}/${repo}`;
  }
  // Sequential — tool-use + Opus bandwidth is fine for ≤500 PRs/run and
  // keeps memory footprint predictable. Parallelism can be added later if
  // the cron window bites.
  for (const c of toRun) {
    if (opts.signal?.aborted) break;
    try {
      const payload = await fetchPRAnalysisPayload(fullName(c.repo), c.prNumber, {
        signal: opts.signal,
      });
      payload.review.revertWithin14d = await detectRevertWithin14d(
        c.repo,
        c.prNumber,
        c.mergedAt,
        payload.mergeSha,
        payload.title,
      );
      const analysis = await analysePR(payload, { signal: opts.signal });
      await upsertAnalysis(c, payload, analysis);
      analysed++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ repo: c.repo, prNumber: c.prNumber, reason });
      Sentry.captureException(err, {
        tags: { feature: "code-review", repo: c.repo, pr: String(c.prNumber) },
      });
    }
  }

  return {
    candidatesConsidered: candidates.length,
    cached,
    analysed,
    failed,
    skipped,
    durationMs: Date.now() - start,
  };
}

async function detectRevertWithin14d(
  repo: string,
  prNumber: number,
  mergedAt: Date,
  mergeSha: string | null,
  title: string,
): Promise<boolean> {
  const cutoff = new Date(mergedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  const commits = await db
    .select({
      message: githubCommits.message,
      committedAt: githubCommits.committedAt,
    })
    .from(githubCommits)
    .where(
      and(
        eq(githubCommits.repo, repo),
        gte(githubCommits.committedAt, mergedAt),
        lte(githubCommits.committedAt, cutoff),
      ),
    );

  const normalizedTitle = title.trim().toLowerCase();
  return commits.some((commit) => {
    const message = commit.message.toLowerCase();
    if (!message.startsWith("revert")) return false;
    if (mergeSha && message.includes(mergeSha.toLowerCase())) return true;
    if (message.includes(`#${prNumber}`)) return true;
    if (normalizedTitle && message.includes(normalizedTitle)) return true;
    return false;
  });
}

async function upsertAnalysis(
  pr: {
    repo: string;
    prNumber: number;
    authorLogin: string;
    mergedAt: Date;
  },
  payload: {
    mergeSha: string | null;
    primarySurface: string;
    review: {
      approvalCount: number;
      changeRequestCount: number;
      reviewCommentCount: number;
      conversationCommentCount: number;
      reviewRounds: number;
      timeToFirstReviewHours: number | null;
      timeToMergeHours: number;
      commitCount: number;
      commitsAfterFirstReview: number;
      revertWithin14d: boolean;
    };
  },
  analysis: CodeReviewAnalysis,
): Promise<void> {
  await db
    .insert(prReviewAnalyses)
    .values({
      repo: pr.repo,
      prNumber: pr.prNumber,
      mergeSha: payload.mergeSha ?? null,
      authorLogin: pr.authorLogin,
      mergedAt: pr.mergedAt,
      complexity: analysis.complexity,
      quality: analysis.quality,
      technicalDifficulty: analysis.technicalDifficulty,
      executionQuality: analysis.executionQuality,
      testAdequacy: analysis.testAdequacy,
      riskHandling: analysis.riskHandling,
      reviewability: analysis.reviewability,
      analysisConfidencePct: analysis.analysisConfidencePct,
      primarySurface: analysis.primarySurface,
      category: analysis.category,
      summary: analysis.summary,
      caveats: analysis.caveats,
      standout: analysis.standout,
      approvalCount: payload.review.approvalCount,
      changeRequestCount: payload.review.changeRequestCount,
      reviewCommentCount: payload.review.reviewCommentCount,
      conversationCommentCount: payload.review.conversationCommentCount,
      reviewRounds: payload.review.reviewRounds,
      timeToFirstReviewMinutes:
        payload.review.timeToFirstReviewHours === null
          ? null
          : Math.round(payload.review.timeToFirstReviewHours * 60),
      timeToMergeMinutes: Math.round(payload.review.timeToMergeHours * 60),
      commitCount: payload.review.commitCount,
      commitsAfterFirstReview: payload.review.commitsAfterFirstReview,
      revertWithin14d: payload.review.revertWithin14d,
      outcomeScore: analysis.outcomeScore,
      reviewProvider: analysis.provider,
      reviewModel: analysis.model,
      secondOpinionUsed: analysis.secondOpinionUsed,
      agreementLevel: analysis.agreementLevel,
      secondOpinionReasons: analysis.secondOpinionReasons,
      rubricVersion: RUBRIC_VERSION,
      rawJson: analysis as unknown as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [
        prReviewAnalyses.repo,
        prReviewAnalyses.prNumber,
        prReviewAnalyses.rubricVersion,
      ],
      set: {
        mergeSha: payload.mergeSha ?? null,
        authorLogin: pr.authorLogin,
        mergedAt: pr.mergedAt,
        complexity: analysis.complexity,
        quality: analysis.quality,
        technicalDifficulty: analysis.technicalDifficulty,
        executionQuality: analysis.executionQuality,
        testAdequacy: analysis.testAdequacy,
        riskHandling: analysis.riskHandling,
        reviewability: analysis.reviewability,
        analysisConfidencePct: analysis.analysisConfidencePct,
        primarySurface: analysis.primarySurface,
        category: analysis.category,
        summary: analysis.summary,
        caveats: analysis.caveats,
        standout: analysis.standout,
        approvalCount: payload.review.approvalCount,
        changeRequestCount: payload.review.changeRequestCount,
        reviewCommentCount: payload.review.reviewCommentCount,
        conversationCommentCount: payload.review.conversationCommentCount,
        reviewRounds: payload.review.reviewRounds,
        timeToFirstReviewMinutes:
          payload.review.timeToFirstReviewHours === null
            ? null
            : Math.round(payload.review.timeToFirstReviewHours * 60),
        timeToMergeMinutes: Math.round(payload.review.timeToMergeHours * 60),
        commitCount: payload.review.commitCount,
        commitsAfterFirstReview: payload.review.commitsAfterFirstReview,
        revertWithin14d: payload.review.revertWithin14d,
        outcomeScore: analysis.outcomeScore,
        reviewProvider: analysis.provider,
        reviewModel: analysis.model,
        secondOpinionUsed: analysis.secondOpinionUsed,
        agreementLevel: analysis.agreementLevel,
        secondOpinionReasons: analysis.secondOpinionReasons,
        rawJson: analysis as unknown as Record<string, unknown>,
        analysedAt: sql`now()`,
      },
    });
}

/**
 * Prune analyses older than the window that the UI cares about. Keeps the
 * table bounded even if retention/cron are misconfigured. No-op when the
 * window hasn't moved.
 */
export async function pruneOldAnalyses(windowDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const res = await db
    .delete(prReviewAnalyses)
    .where(lt(prReviewAnalyses.mergedAt, cutoff))
    .returning({ id: prReviewAnalyses.id });
  return res.length;
}

/** Milliseconds since the most-recent analysis row was written. Used by the
 * cron gate to skip code-review on 2-hour ticks — we only want a weekly run. */
export async function msSinceLastAnalysis(): Promise<number | null> {
  const row = await db
    .select({ analysedAt: prReviewAnalyses.analysedAt })
    .from(prReviewAnalyses)
    .orderBy(desc(prReviewAnalyses.analysedAt))
    .limit(1);
  if (row.length === 0) return null;
  return Date.now() - row[0].analysedAt.getTime();
}

/** Minimum gap between cron-triggered runs. Manual triggers bypass this. */
export const CODE_REVIEW_CRON_COOLDOWN_MS = 6.5 * 24 * 60 * 60 * 1000;

/**
 * Cron-friendly wrapper. Skips when a run happened within the cooldown.
 * Returns `{ skippedBy: "cooldown" }` instead of a result object when
 * skipped so the caller can include it in the fan-out response without
 * blowing up on a non-result. On every non-skipped run it also prunes
 * old rows to keep the table bounded.
 */
export async function maybeRunCodeReviewFromCron(): Promise<
  | (AnalyseRunResult & { pruned?: number })
  | { skippedBy: "cooldown" }
> {
  const sinceLast = await msSinceLastAnalysis();
  if (sinceLast !== null && sinceLast < CODE_REVIEW_CRON_COOLDOWN_MS) {
    return { skippedBy: "cooldown" };
  }
  const result = await runCodeReviewAnalysis();
  // Prune before returning so the table doesn't grow indefinitely under
  // multi-rubric-version history. Errors here shouldn't fail the cron —
  // Sentry captures and we serve the run result anyway.
  let pruned: number | undefined;
  try {
    pruned = await pruneOldAnalyses();
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: "code-review", step: "prune" } });
  }
  return { ...result, pruned };
}

/** Surface reachable for tests without going through a cron handler. */
export async function getCachedAnalysisCount(
  repos: string[],
): Promise<number> {
  if (repos.length === 0) return 0;
  const res = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prReviewAnalyses)
    .where(
      and(
        eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
        inArray(prReviewAnalyses.repo, repos),
      ),
    );
  return res[0]?.count ?? 0;
}
