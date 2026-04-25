import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { githubMock, matchMock, sentryMock, phaseTrackerMock, dbMock } =
  vi.hoisted(() => ({
    githubMock: {
      checkGitHubHealth: vi.fn(),
      fetchMergedPRRecords: vi.fn(),
      fetchCommitRecords: vi.fn(),
    },
    matchMock: {
      runGitHubEmployeeMapping: vi.fn(),
    },
    sentryMock: {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      addBreadcrumb: vi.fn(),
    },
    phaseTrackerMock: {
      startPhase: vi.fn(),
      endPhase: vi.fn(),
    },
    dbMock: {
      selectQueue: [] as unknown[][],
      selectIndex: 0,
    },
  }));

vi.mock("@/lib/integrations/github", () => ({
  checkGitHubHealth: githubMock.checkGitHubHealth,
  fetchMergedPRRecords: githubMock.fetchMergedPRRecords,
  fetchCommitRecords: githubMock.fetchCommitRecords,
}));

vi.mock("@/lib/sync/github-employee-match", () => ({
  runGitHubEmployeeMapping: matchMock.runGitHubEmployeeMapping,
}));

vi.mock("@sentry/nextjs", () => sentryMock);

vi.mock("@/lib/db/schema", () => ({
  githubPrs: {
    repo: "repo",
    prNumber: "prNumber",
    mergedAt: "mergedAt",
    authorLogin: "authorLogin",
  },
  githubCommits: {
    repo: "repo",
    sha: "sha",
    committedAt: "committedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("@/lib/db", () => {
  const onConflictDoUpdate = vi.fn(() => Promise.resolve());
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));

  // Drizzle builder thenable: see cycle-8 worklog for protocol details.
  const select = vi.fn(() => ({
    from: vi.fn(() => {
      const thenable = (onResolve?: unknown) => {
        const v = dbMock.selectQueue[dbMock.selectIndex++] ?? [];
        if (typeof onResolve === "function") {
          (onResolve as (v: unknown) => void)(v);
          return;
        }
        return Promise.resolve(v);
      };
      return { then: thenable };
    }),
  }));

  return { db: { select, insert } };
});

vi.mock("../phase-tracker", () => ({
  createPhaseTracker: vi.fn(() => phaseTrackerMock),
}));

vi.mock("../coordinator", () => ({
  determineSyncStatus: vi.fn(
    (errors: unknown[], succeeded: number) =>
      errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "error"
  ),
  formatSyncError: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e)
  ),
}));

import { runGitHubSync } from "../github";
import { SyncCancelledError, SyncDeadlineExceededError } from "../errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default prBounds row — no existing data, forces full-window sync. */
const NO_PR_BOUNDS = [
  { maxMergedAt: null, minMergedAt: null, recentCount: 0, oldCount: 0 },
];
/** Default commitBounds row — no existing data. */
const NO_COMMIT_BOUNDS = [{ maxCommittedAt: null }];

function makePr(num: number) {
  return {
    repo: "org/repo",
    prNumber: num,
    title: `PR ${num}`,
    authorLogin: "alice",
    authorAvatarUrl: null,
    mergedAt: new Date("2026-01-01"),
    additions: 10,
    deletions: 5,
    changedFiles: 2,
  };
}

function makeCommit(num: number) {
  return {
    repo: "org/repo",
    sha: `sha${num}`,
    authorLogin: "alice",
    authorAvatarUrl: null,
    committedAt: new Date("2026-01-01"),
    additions: 5,
    deletions: 2,
    message: `Commit ${num}`,
  };
}

const RUN = { id: 99 };

type FetchOpts = {
  onPage?: (page: unknown[]) => Promise<void>;
  onRepoProgress?: (repo: string, count: number) => void;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runGitHubSync — active heartbeat (M8)", () => {
  beforeEach(() => {
    phaseTrackerMock.startPhase.mockReset();
    phaseTrackerMock.endPhase.mockReset();
    githubMock.checkGitHubHealth.mockReset();
    githubMock.fetchMergedPRRecords.mockReset();
    githubMock.fetchCommitRecords.mockReset();
    matchMock.runGitHubEmployeeMapping.mockReset();
    sentryMock.captureException.mockReset();
    sentryMock.captureMessage.mockReset();
    dbMock.selectQueue = [];
    dbMock.selectIndex = 0;

    phaseTrackerMock.startPhase.mockResolvedValue(1);
    phaseTrackerMock.endPhase.mockResolvedValue(undefined);
    githubMock.checkGitHubHealth.mockResolvedValue(undefined);
    matchMock.runGitHubEmployeeMapping.mockResolvedValue({
      mapped: 0,
      bots: 0,
      unmatched: 0,
      skipped: 0,
    });
  });

  it("calls touchHeartbeat once per PR page and once per commit page (golden path)", async () => {
    dbMock.selectQueue = [NO_PR_BOUNDS, NO_COMMIT_BOUNDS];

    githubMock.fetchMergedPRRecords.mockImplementation(
      async (_since: unknown, opts: FetchOpts) => {
        await opts.onPage?.([makePr(1)]);
        await opts.onPage?.([makePr(2)]);
        return { total: 2 };
      }
    );
    githubMock.fetchCommitRecords.mockImplementation(
      async (_since: unknown, opts: FetchOpts) => {
        await opts.onPage?.([makeCommit(1)]);
        await opts.onPage?.([makeCommit(2)]);
        return { total: 2 };
      }
    );

    const touchHeartbeat = vi.fn().mockResolvedValue(undefined);
    const result = await runGitHubSync(RUN, { touchHeartbeat });

    expect(result.status).toBe("success");
    // 2 PR pages + 2 commit pages = 4 heartbeat touches
    expect(touchHeartbeat).toHaveBeenCalledTimes(4);
  });

  it("calls touchHeartbeat once when a single PR page is fetched, none for commits (commit fetch no pages)", async () => {
    dbMock.selectQueue = [NO_PR_BOUNDS, NO_COMMIT_BOUNDS];

    githubMock.fetchMergedPRRecords.mockImplementation(
      async (_since: unknown, opts: FetchOpts) => {
        await opts.onPage?.([makePr(1)]);
        return { total: 1 };
      }
    );
    githubMock.fetchCommitRecords.mockImplementation(
      async (_since: unknown, _opts: FetchOpts) => {
        // no pages
        return { total: 0 };
      }
    );

    const touchHeartbeat = vi.fn().mockResolvedValue(undefined);
    const result = await runGitHubSync(RUN, { touchHeartbeat });

    expect(result.status).toBe("success");
    // 1 PR page + 0 commit pages = 1 heartbeat touch
    expect(touchHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("stops calling touchHeartbeat after SyncCancelledError is thrown during PR fetch", async () => {
    dbMock.selectQueue = [NO_PR_BOUNDS, NO_COMMIT_BOUNDS];

    githubMock.fetchMergedPRRecords.mockImplementation(
      async (_since: unknown, opts: FetchOpts) => {
        await opts.onPage?.([makePr(1)]); // first page — heartbeat fired
        throw new SyncCancelledError("Cancelled mid-sync");
      }
    );
    // commit fetch should never be reached
    githubMock.fetchCommitRecords.mockResolvedValue({ total: 0 });

    const touchHeartbeat = vi.fn().mockResolvedValue(undefined);

    await expect(runGitHubSync(RUN, { touchHeartbeat })).rejects.toBeInstanceOf(
      SyncCancelledError
    );

    // Only the one page before the throw should have triggered a heartbeat touch
    expect(touchHeartbeat).toHaveBeenCalledTimes(1);
    // Commit fetch never ran
    expect(githubMock.fetchCommitRecords).not.toHaveBeenCalled();
  });

  it("stops calling touchHeartbeat after SyncDeadlineExceededError is thrown during PR fetch", async () => {
    dbMock.selectQueue = [NO_PR_BOUNDS, NO_COMMIT_BOUNDS];

    githubMock.fetchMergedPRRecords.mockImplementation(
      async (_since: unknown, opts: FetchOpts) => {
        await opts.onPage?.([makePr(1)]); // heartbeat fired
        await opts.onPage?.([makePr(2)]); // heartbeat fired
        throw new SyncDeadlineExceededError("Budget exceeded");
      }
    );
    githubMock.fetchCommitRecords.mockResolvedValue({ total: 0 });

    const touchHeartbeat = vi.fn().mockResolvedValue(undefined);

    await expect(runGitHubSync(RUN, { touchHeartbeat })).rejects.toBeInstanceOf(
      SyncDeadlineExceededError
    );

    // Two pages before the throw; commit fetch never ran
    expect(touchHeartbeat).toHaveBeenCalledTimes(2);
    expect(githubMock.fetchCommitRecords).not.toHaveBeenCalled();
  });

  it("does not call touchHeartbeat when no pages are processed", async () => {
    dbMock.selectQueue = [NO_PR_BOUNDS, NO_COMMIT_BOUNDS];

    githubMock.fetchMergedPRRecords.mockImplementation(
      async (_since: unknown, _opts: FetchOpts) => ({ total: 0 })
    );
    githubMock.fetchCommitRecords.mockImplementation(
      async (_since: unknown, _opts: FetchOpts) => ({ total: 0 })
    );

    const touchHeartbeat = vi.fn().mockResolvedValue(undefined);
    const result = await runGitHubSync(RUN, { touchHeartbeat });

    expect(result.status).toBe("success");
    expect(touchHeartbeat).not.toHaveBeenCalled();
  });

  it("works correctly when no touchHeartbeat is provided (opts.touchHeartbeat undefined)", async () => {
    dbMock.selectQueue = [NO_PR_BOUNDS, NO_COMMIT_BOUNDS];

    githubMock.fetchMergedPRRecords.mockImplementation(
      async (_since: unknown, opts: FetchOpts) => {
        await opts.onPage?.([makePr(1)]);
        return { total: 1 };
      }
    );
    githubMock.fetchCommitRecords.mockImplementation(
      async (_since: unknown, _opts: FetchOpts) => ({ total: 0 })
    );

    // No touchHeartbeat passed — should complete without error
    const result = await runGitHubSync(RUN, {});
    expect(result.status).toBe("success");
  });
});
