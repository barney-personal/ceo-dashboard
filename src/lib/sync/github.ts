import { db } from "@/lib/db";
import { githubPrs, githubCommits } from "@/lib/db/schema";
import {
  checkGitHubHealth,
  fetchMergedPRRecords,
  fetchCommitRecords,
} from "@/lib/integrations/github";
import { createPhaseTracker } from "./phase-tracker";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  type SyncControl,
} from "./errors";
import { determineSyncStatus, formatSyncError } from "./coordinator";
import { runGitHubEmployeeMapping } from "./github-employee-match";
import { sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";

const SYNC_WINDOW_DAYS = 360;
/** Overlap buffer when doing incremental sync to catch late-merged PRs */
const INCREMENTAL_OVERLAP_DAYS = 3;
/**
 * If the oldest stored PR is more than this many days newer than the
 * full-window start, we assume a prior sync left a gap and do a full
 * backfill pass instead of an incremental one.
 */
const BACKFILL_DETECT_GAP_DAYS = 14;
/**
 * Sparsity detection: compare PR count in the most recent 90 days against
 * the oldest 90 days of the window. If the ratio is below this threshold
 * (and we have enough data to be confident), assume a prior walk dropped
 * historical PRs (e.g. the UPDATED_AT pagination bug) and do a full
 * backfill to repair it. 0.2 = the old bucket must have at least 20% of
 * the recent bucket's PR count — healthy data usually >50%, bug produced
 * <5%.
 */
const BACKFILL_DETECT_SPARSITY_RATIO = 0.2;
/** Min recent-bucket count before the sparsity check is meaningful */
const BACKFILL_DETECT_MIN_RECENT = 100;

interface SyncRun {
  id: number;
}

interface GitHubSyncResult {
  status: "success" | "partial" | "error";
  recordsSynced: number;
  errors: string[];
}

export async function runGitHubSync(
  run: SyncRun,
  opts: SyncControl = {}
): Promise<GitHubSyncResult> {
  const tracker = createPhaseTracker(run.id);
  const errors: string[] = [];
  let recordsSynced = 0;
  const repoFilter = process.env.GITHUB_REPOS?.split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  // Health check
  const healthPhaseId = await tracker.startPhase("github-health-check");
  try {
    await checkGitHubHealth({ signal: opts.signal });
    await tracker.endPhase(healthPhaseId, { status: "success" });
  } catch (error) {
    const message = `GitHub API unreachable, skipping sync: ${formatSyncError(error)}`;
    Sentry.captureMessage("GitHub API unreachable, skipping sync", {
      level: "warning",
      tags: { integration: "github" },
    });
    await tracker.endPhase(healthPhaseId, {
      status: "error",
      errorMessage: message,
    });
    return { status: "error", recordsSynced: 0, errors: [message] };
  }

  // Fetch and store individual PRs — incremental if we already have data
  const fetchPhaseId = await tracker.startPhase("github-fetch-prs");
  try {
    const fullWindowSince = new Date();
    fullWindowSince.setUTCDate(fullWindowSince.getUTCDate() - SYNC_WINDOW_DAYS);
    fullWindowSince.setUTCHours(0, 0, 0, 0);

    // Check existing data to decide between incremental and full sync.
    // Three signals drive the decision:
    //  - max(mergedAt)   → forward incremental watermark
    //  - min(mergedAt)   → is the window covered at all?
    //  - sparsity ratio  → are old weeks densely covered, or did a prior
    //                      walk drop historical PRs (e.g. UPDATED_AT bug)?
    const [prBounds] = await db
      .select({
        maxMergedAt: sql<Date | null>`MAX(${githubPrs.mergedAt})`,
        minMergedAt: sql<Date | null>`MIN(${githubPrs.mergedAt})`,
        recentCount: sql<number>`COUNT(*) FILTER (WHERE ${githubPrs.mergedAt} >= NOW() - INTERVAL '90 days')`,
        oldCount: sql<number>`COUNT(*) FILTER (WHERE ${githubPrs.mergedAt} >= NOW() - INTERVAL '360 days' AND ${githubPrs.mergedAt} < NOW() - INTERVAL '270 days')`,
      })
      .from(githubPrs);

    const gapThreshold = new Date(fullWindowSince);
    gapThreshold.setUTCDate(
      gapThreshold.getUTCDate() + BACKFILL_DETECT_GAP_DAYS
    );
    const hasMinGap =
      !!prBounds?.minMergedAt && prBounds.minMergedAt > gapThreshold;

    const recentCount = Number(prBounds?.recentCount ?? 0);
    const oldCount = Number(prBounds?.oldCount ?? 0);
    const hasSparsityGap =
      recentCount >= BACKFILL_DETECT_MIN_RECENT &&
      oldCount < recentCount * BACKFILL_DETECT_SPARSITY_RATIO;

    const hasBackfillGap = hasMinGap || hasSparsityGap;

    let since = fullWindowSince;
    let syncMode: "full" | "incremental" = "full";
    if (!hasBackfillGap && prBounds?.maxMergedAt) {
      const incrementalSince = new Date(prBounds.maxMergedAt);
      incrementalSince.setUTCDate(
        incrementalSince.getUTCDate() - INCREMENTAL_OVERLAP_DAYS
      );
      if (incrementalSince > fullWindowSince) {
        since = incrementalSince;
        syncMode = "incremental";
      }
    }

    const { total: prTotal } = await fetchMergedPRRecords(since, {
      signal: opts.signal,
      repos: repoFilter,
      onPage: async (page) => {
        // Batch upsert entire page (up to 100 rows per insert)
        for (const pr of page) {
          await db
            .insert(githubPrs)
            .values({
              repo: pr.repo,
              prNumber: pr.prNumber,
              title: pr.title,
              authorLogin: pr.authorLogin,
              authorAvatarUrl: pr.authorAvatarUrl,
              mergedAt: pr.mergedAt,
              additions: pr.additions,
              deletions: pr.deletions,
              changedFiles: pr.changedFiles,
            })
            .onConflictDoUpdate({
              target: [githubPrs.repo, githubPrs.prNumber],
              set: {
                title: pr.title,
                authorLogin: pr.authorLogin,
                authorAvatarUrl: pr.authorAvatarUrl,
                mergedAt: pr.mergedAt,
                additions: pr.additions,
                deletions: pr.deletions,
                changedFiles: pr.changedFiles,
                syncedAt: new Date(),
              },
            });
        }
        recordsSynced += page.length;
        await opts.touchHeartbeat?.();
      },
      onRepoProgress: (repo, count) => {
        Sentry.addBreadcrumb({
          category: "sync.github",
          level: "info",
          message: `Fetched ${count} merged PRs from ${repo}`,
        });
      },
    });

    await tracker.endPhase(fetchPhaseId, {
      status: "success",
      itemsProcessed: prTotal,
      detail: `Stored ${prTotal} PRs (${syncMode} since ${since.toISOString().slice(0, 10)}${hasBackfillGap ? ` — backfill: ${hasMinGap ? "min-date gap" : `sparsity ${oldCount}/${recentCount}`}` : ""})`,
    });
  } catch (error) {
    if (
      error instanceof SyncCancelledError ||
      error instanceof SyncDeadlineExceededError
    ) {
      await tracker.endPhase(fetchPhaseId, {
        status: "error",
        errorMessage: error.message,
      });
      throw error;
    }

    const message = `Failed to sync GitHub PRs: ${formatSyncError(error)}`;
    errors.push(message);
    Sentry.captureException(error, {
      tags: { integration: "github" },
      extra: { phase: "fetch-prs" },
    });
    await tracker.endPhase(fetchPhaseId, {
      status: "error",
      errorMessage: message,
    });
  }

  // Fetch and store commits — incremental if we already have data
  const commitPhaseId = await tracker.startPhase("github-fetch-commits");
  let commitsSynced = 0;
  try {
    const fullWindowSinceCommits = new Date();
    fullWindowSinceCommits.setUTCDate(
      fullWindowSinceCommits.getUTCDate() - SYNC_WINDOW_DAYS
    );
    fullWindowSinceCommits.setUTCHours(0, 0, 0, 0);

    // Check for existing commit data to enable incremental sync
    const [latestCommit] = await db
      .select({
        maxCommittedAt: sql<Date | null>`MAX(${githubCommits.committedAt})`,
      })
      .from(githubCommits);

    let commitSince = fullWindowSinceCommits;
    if (latestCommit?.maxCommittedAt) {
      const incrementalSince = new Date(latestCommit.maxCommittedAt);
      incrementalSince.setUTCDate(
        incrementalSince.getUTCDate() - INCREMENTAL_OVERLAP_DAYS
      );
      if (incrementalSince > fullWindowSinceCommits) {
        commitSince = incrementalSince;
      }
    }

    const { total: commitTotal } = await fetchCommitRecords(commitSince, {
      signal: opts.signal,
      repos: repoFilter,
      onPage: async (page) => {
        for (const commit of page) {
          await db
            .insert(githubCommits)
            .values({
              repo: commit.repo,
              sha: commit.sha,
              authorLogin: commit.authorLogin,
              authorAvatarUrl: commit.authorAvatarUrl,
              committedAt: commit.committedAt,
              additions: commit.additions,
              deletions: commit.deletions,
              message: commit.message,
            })
            .onConflictDoUpdate({
              target: [githubCommits.repo, githubCommits.sha],
              set: {
                authorLogin: commit.authorLogin,
                authorAvatarUrl: commit.authorAvatarUrl,
                additions: commit.additions,
                deletions: commit.deletions,
                message: commit.message,
                syncedAt: new Date(),
              },
            });
        }
        commitsSynced += page.length;
        await opts.touchHeartbeat?.();
      },
      onRepoProgress: (repo, count) => {
        Sentry.addBreadcrumb({
          category: "sync.github",
          level: "info",
          message: `Fetched ${count} commits from ${repo}`,
        });
      },
    });

    await tracker.endPhase(commitPhaseId, {
      status: "success",
      itemsProcessed: commitTotal,
      detail: `Stored ${commitTotal} commits (since ${commitSince.toISOString().slice(0, 10)})`,
    });
  } catch (error) {
    if (
      error instanceof SyncCancelledError ||
      error instanceof SyncDeadlineExceededError
    ) {
      await tracker.endPhase(commitPhaseId, {
        status: "error",
        errorMessage: error.message,
      });
      throw error;
    }

    const message = `Failed to sync GitHub commits: ${formatSyncError(error)}`;
    errors.push(message);
    Sentry.captureException(error, {
      tags: { integration: "github" },
      extra: { phase: "fetch-commits" },
    });
    await tracker.endPhase(commitPhaseId, {
      status: "error",
      errorMessage: message,
    });
  }

  // Match GitHub logins to employee records
  const matchPhaseId = await tracker.startPhase("github-employee-matching");
  try {
    const matchResult = await runGitHubEmployeeMapping(opts);
    await tracker.endPhase(matchPhaseId, {
      status: "success",
      itemsProcessed: matchResult.mapped + matchResult.bots,
      detail: `Matched ${matchResult.mapped} employees, ${matchResult.bots} bots, ${matchResult.unmatched} unmatched, ${matchResult.skipped} skipped`,
    });
  } catch (error) {
    if (
      error instanceof SyncCancelledError ||
      error instanceof SyncDeadlineExceededError
    ) {
      await tracker.endPhase(matchPhaseId, {
        status: "error",
        errorMessage: error.message,
      });
      throw error;
    }

    const message = `Employee matching failed: ${formatSyncError(error)}`;
    errors.push(message);
    Sentry.captureException(error, {
      tags: { integration: "github" },
      extra: { phase: "employee-matching" },
    });
    await tracker.endPhase(matchPhaseId, {
      status: "error",
      errorMessage: message,
    });
  }

  return {
    status: determineSyncStatus(errors, recordsSynced),
    recordsSynced,
    errors,
  };
}
