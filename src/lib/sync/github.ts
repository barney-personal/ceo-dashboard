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

    // Check for existing data to enable incremental sync
    const [latestPr] = await db
      .select({ maxMergedAt: sql<Date | null>`MAX(${githubPrs.mergedAt})` })
      .from(githubPrs);

    let since = fullWindowSince;
    if (latestPr?.maxMergedAt) {
      const incrementalSince = new Date(latestPr.maxMergedAt);
      incrementalSince.setUTCDate(
        incrementalSince.getUTCDate() - INCREMENTAL_OVERLAP_DAYS
      );
      // Use the more recent date (incremental) unless it's after now
      if (incrementalSince > fullWindowSince) {
        since = incrementalSince;
      }
    }

    const prs = await fetchMergedPRRecords(since, {
      signal: opts.signal,
      repos: repoFilter,
      onRepoProgress: (repo, count) => {
        Sentry.addBreadcrumb({
          category: "sync.github",
          level: "info",
          message: `Fetched ${count} merged PRs from ${repo}`,
        });
      },
    });

    // Upsert each PR
    for (const pr of prs) {
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

      recordsSynced += 1;
    }

    await tracker.endPhase(fetchPhaseId, {
      status: "success",
      itemsProcessed: recordsSynced,
      detail: `Stored ${recordsSynced} PRs (since ${since.toISOString().slice(0, 10)})`,
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

    const commits = await fetchCommitRecords(commitSince, {
      signal: opts.signal,
      repos: repoFilter,
      onRepoProgress: (repo, count) => {
        Sentry.addBreadcrumb({
          category: "sync.github",
          level: "info",
          message: `Fetched ${count} commits from ${repo}`,
        });
      },
    });

    for (const commit of commits) {
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

      commitsSynced += 1;
    }

    await tracker.endPhase(commitPhaseId, {
      status: "success",
      itemsProcessed: commitsSynced,
      detail: `Stored ${commitsSynced} commits (since ${commitSince.toISOString().slice(0, 10)})`,
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
