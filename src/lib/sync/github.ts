import { db } from "@/lib/db";
import { githubPrMetrics } from "@/lib/db/schema";
import {
  checkGitHubHealth,
  getEngineeringStats,
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

  // Fetch and store metrics for 30-day rolling window
  const fetchPhaseId = await tracker.startPhase("github-fetch-pr-metrics");
  try {
    // Normalize period bounds to UTC day boundaries so the upsert
    // conflict key (login, periodStart, periodEnd) matches across syncs
    // regardless of the runtime timezone of the sync worker.
    const periodEnd = new Date();
    periodEnd.setUTCHours(23, 59, 59, 999);
    const periodStart = new Date();
    periodStart.setUTCDate(periodStart.getUTCDate() - 30);
    periodStart.setUTCHours(0, 0, 0, 0);

    // If GITHUB_REPOS is set (comma-separated), only sync those repos
    // instead of crawling the entire org.
    const repoFilter = process.env.GITHUB_REPOS?.split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const stats = await getEngineeringStats(periodStart, {
      signal: opts.signal,
      repos: repoFilter,
      onRepoProgress: (repo) => {
        Sentry.addBreadcrumb({
          category: "sync.github",
          level: "info",
          message: `Processing repo ${repo}`,
        });
      },
    });

    // Upsert metrics per engineer
    for (const engineer of stats) {
      await db
        .insert(githubPrMetrics)
        .values({
          login: engineer.login,
          avatarUrl: engineer.avatarUrl,
          prsCount: engineer.prsCount,
          additions: engineer.additions,
          deletions: engineer.deletions,
          changedFiles: engineer.changedFiles,
          repos: Array.from(engineer.repos),
          periodStart,
          periodEnd,
        })
        .onConflictDoUpdate({
          target: [
            githubPrMetrics.login,
            githubPrMetrics.periodStart,
            githubPrMetrics.periodEnd,
          ],
          set: {
            avatarUrl: engineer.avatarUrl,
            prsCount: engineer.prsCount,
            additions: engineer.additions,
            deletions: engineer.deletions,
            changedFiles: engineer.changedFiles,
            repos: Array.from(engineer.repos),
            syncedAt: new Date(),
          },
        });

      recordsSynced += 1;
    }

    await tracker.endPhase(fetchPhaseId, {
      status: "success",
      itemsProcessed: recordsSynced,
      detail: `Synced ${recordsSynced} engineers across ${stats.reduce((acc, s) => acc + s.repos.size, 0)} repo contributions`,
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

    const message = `Failed to sync GitHub PR metrics: ${formatSyncError(error)}`;
    errors.push(message);
    Sentry.captureException(error, {
      tags: { integration: "github" },
      extra: { phase: "fetch-pr-metrics" },
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
