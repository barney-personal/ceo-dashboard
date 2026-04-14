import { db } from "@/lib/db";
import { githubPrs } from "@/lib/db/schema";
import {
  checkGitHubHealth,
  fetchMergedPRRecords,
} from "@/lib/integrations/github";
import { createPhaseTracker } from "./phase-tracker";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  type SyncControl,
} from "./errors";
import { determineSyncStatus, formatSyncError } from "./coordinator";
import { runGitHubEmployeeMapping } from "./github-employee-match";
import * as Sentry from "@sentry/nextjs";

const SYNC_WINDOW_DAYS = 360;

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

  // Fetch and store individual PRs for the full window
  const fetchPhaseId = await tracker.startPhase("github-fetch-prs");
  try {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - SYNC_WINDOW_DAYS);
    since.setUTCHours(0, 0, 0, 0);

    const repoFilter = process.env.GITHUB_REPOS?.split(",")
      .map((r) => r.trim())
      .filter(Boolean);

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
      detail: `Stored ${recordsSynced} PRs from ${SYNC_WINDOW_DAYS} day window`,
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
