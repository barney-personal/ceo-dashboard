import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  },
}));

const { mockAnalysePR, mockFetchPayload } = vi.hoisted(() => ({
  mockAnalysePR: vi.fn(),
  mockFetchPayload: vi.fn(),
}));

vi.mock("@/lib/integrations/code-review-analyser", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/integrations/code-review-analyser")
  >("@/lib/integrations/code-review-analyser");
  return {
    ...actual,
    analysePR: mockAnalysePR,
  };
});

vi.mock("@/lib/integrations/github", () => ({
  fetchPRAnalysisPayload: mockFetchPayload,
}));

import {
  detectRevertWithin14d,
  getCodeReviewBackfillStatus,
  runCodeReviewAnalysis,
} from "../code-review";

interface FakePr {
  repo: string;
  prNumber: number;
  authorLogin: string;
  mergedAt: Date;
}

function stubSelectSequence(sequence: unknown[][]) {
  let call = 0;
  mockSelect.mockReset();
  mockSelect.mockImplementation(() => {
    const payload = sequence[call++] ?? [];
    const chain: Record<string, unknown> = {};
    ["from", "where", "orderBy", "limit"].forEach((method) => {
      chain[method] = () => chain;
    });
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(payload).then(resolve);
    return chain;
  });
}

function stubPrsQuery(
  prs: FakePr[],
  opts: {
    botLogins?: string[];
    existing?: Array<{ repo: string; prNumber: number }>;
    revertLookups?: unknown[][];
    includeExistingCall?: boolean;
  } = {},
) {
  const botRows = (opts.botLogins ?? []).map((login) => ({ githubLogin: login }));
  stubSelectSequence([
    prs,
    botRows,
    ...(opts.includeExistingCall === false ? [] : [opts.existing ?? []]),
    ...(opts.revertLookups ?? prs.map(() => [])),
  ]);
}

function stubInsert() {
  mockInsert.mockReset();
  mockInsert.mockImplementation(() => ({
    values: () => ({
      onConflictDoUpdate: () => Promise.resolve(),
    }),
  }));
}

function mockPayload(overrides: Record<string, unknown> = {}) {
  return {
    repo: "acme/api",
    prNumber: 1,
    title: "t",
    body: "",
    createdAt: "2026-04-20T10:00:00.000Z",
    mergedAt: "2026-04-21T10:00:00.000Z",
    mergeSha: "abc123",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    primarySurface: "backend",
    review: {
      approvalCount: 1,
      changeRequestCount: 0,
      reviewCommentCount: 0,
      conversationCommentCount: 0,
      reviewRounds: 1,
      timeToFirstReviewHours: 1,
      timeToMergeHours: 4,
      commitCount: 1,
      commitsAfterFirstReview: 0,
      revertWithin14d: false,
    },
    files: [],
    prNotes: [],
    ...overrides,
  };
}

function mockAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    provider: "anthropic",
    model: "claude-opus-4-7",
    technicalDifficulty: 3,
    executionQuality: 3,
    testAdequacy: 3,
    riskHandling: 3,
    reviewability: 3,
    analysisConfidencePct: 80,
    category: "feature",
    summary: "x",
    caveats: [],
    standout: null,
    complexity: 3,
    quality: 3,
    primarySurface: "backend",
    secondOpinionUsed: false,
    secondOpinionReasons: [],
    agreementLevel: "single_model",
    outcomeScore: 80,
    rawModelReviews: [],
    ...overrides,
  };
}

describe("runCodeReviewAnalysis", () => {
  const originalExcluded = process.env.CODE_REVIEW_EXCLUDED_REPOS;

  beforeEach(() => {
    mockAnalysePR.mockReset();
    mockFetchPayload.mockReset();
    stubInsert();
    delete process.env.CODE_REVIEW_EXCLUDED_REPOS;
  });

  afterEach(() => {
    if (originalExcluded === undefined) {
      delete process.env.CODE_REVIEW_EXCLUDED_REPOS;
    } else {
      process.env.CODE_REVIEW_EXCLUDED_REPOS = originalExcluded;
    }
  });

  it("analyses each uncached PR and returns the counts", async () => {
    stubPrsQuery([
      { repo: "acme/api", prNumber: 1, authorLogin: "alice", mergedAt: new Date() },
      { repo: "acme/api", prNumber: 2, authorLogin: "bob", mergedAt: new Date() },
    ]);
    mockFetchPayload.mockResolvedValue(mockPayload());
    mockAnalysePR.mockResolvedValue(mockAnalysis());

    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(mockAnalysePR).toHaveBeenCalledTimes(2);
  });

  it("skips bot authors without hitting the LLM", async () => {
    stubPrsQuery([
      { repo: "acme/api", prNumber: 1, authorLogin: "dependabot[bot]", mergedAt: new Date() },
      { repo: "acme/api", prNumber: 2, authorLogin: "renovate-bot", mergedAt: new Date() },
    ]);
    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(0);
    expect(result.skipped).toHaveLength(2);
    expect(mockAnalysePR).not.toHaveBeenCalled();
  });

  it("skips bots flagged in githubEmployeeMap even when the login looks clean", async () => {
    stubPrsQuery(
      [{ repo: "acme/api", prNumber: 1, authorLogin: "acme-releaser", mergedAt: new Date() }],
      { botLogins: ["acme-releaser"] },
    );
    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(0);
    expect(result.skipped.some((entry) => entry.reason === "bot author")).toBe(true);
  });

  it("skips repos matching CODE_REVIEW_EXCLUDED_REPOS", async () => {
    process.env.CODE_REVIEW_EXCLUDED_REPOS = "acme/secret";
    stubPrsQuery([
      { repo: "acme/secret", prNumber: 1, authorLogin: "alice", mergedAt: new Date() },
      { repo: "acme/public", prNumber: 2, authorLogin: "alice", mergedAt: new Date() },
    ]);
    mockFetchPayload.mockResolvedValue(mockPayload({ repo: "acme/public", prNumber: 2 }));
    mockAnalysePR.mockResolvedValue(mockAnalysis());

    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(1);
    expect(result.skipped.some((entry) => entry.reason === "repo excluded")).toBe(true);
  });

  it("records failures but continues past them", async () => {
    stubPrsQuery([
      { repo: "acme/api", prNumber: 1, authorLogin: "alice", mergedAt: new Date() },
      { repo: "acme/api", prNumber: 2, authorLogin: "alice", mergedAt: new Date() },
    ]);
    mockFetchPayload.mockResolvedValue(mockPayload());
    mockAnalysePR
      .mockRejectedValueOnce(new Error("LLM down"))
      .mockResolvedValueOnce(mockAnalysis());

    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("LLM down");
  });

  it("re-analyses cached PRs when force=true", async () => {
    stubPrsQuery(
      [
        { repo: "acme/api", prNumber: 1, authorLogin: "alice", mergedAt: new Date() },
        { repo: "acme/api", prNumber: 2, authorLogin: "alice", mergedAt: new Date() },
      ],
      {
        existing: [
          { repo: "acme/api", prNumber: 1 },
          { repo: "acme/api", prNumber: 2 },
        ],
        includeExistingCall: false,
      },
    );
    mockFetchPayload.mockResolvedValue(mockPayload());
    mockAnalysePR.mockResolvedValue(mockAnalysis());

    const result = await runCodeReviewAnalysis({ force: true });
    expect(result.analysed).toBe(2);
    expect(result.cached).toBe(0);
  });

  it("honours the limit parameter", async () => {
    stubPrsQuery(
      Array.from({ length: 20 }).map((_, index) => ({
        repo: "acme/api",
        prNumber: index,
        authorLogin: "alice",
        mergedAt: new Date(),
      })),
    );
    mockFetchPayload.mockResolvedValue(mockPayload());
    mockAnalysePR.mockResolvedValue(mockAnalysis());

    const result = await runCodeReviewAnalysis({ limit: 5 });
    expect(result.analysed).toBe(5);
  });

  it("supports bounded parallel analysis workers when configured", async () => {
    stubPrsQuery(
      Array.from({ length: 4 }).map((_, index) => ({
        repo: "acme/api",
        prNumber: index + 1,
        authorLogin: `user-${index}`,
        mergedAt: new Date(),
      })),
      {
        revertLookups: Array.from({ length: 4 }, () => []),
      },
    );
    mockFetchPayload.mockImplementation(async (_repo, prNumber: number) => {
      await Promise.resolve();
      return mockPayload({ prNumber });
    });
    mockAnalysePR.mockImplementation(async () => {
      await Promise.resolve();
      return mockAnalysis();
    });

    const result = await runCodeReviewAnalysis({ limit: 4, concurrency: 3 });
    expect(result.analysed).toBe(4);
    expect(result.failed).toHaveLength(0);
    expect(mockFetchPayload).toHaveBeenCalledTimes(4);
    expect(mockAnalysePR).toHaveBeenCalledTimes(4);
  });

  it("detects a revert when the revert commit references the merge SHA", async () => {
    stubSelectSequence([
      [
        {
          message: 'Revert "Add thing" (abc123)',
          committedAt: new Date("2026-04-22T10:00:00Z"),
        },
      ],
    ]);

    await expect(
      detectRevertWithin14d(
        "acme/api",
        42,
        new Date("2026-04-21T10:00:00Z"),
        "abc123",
        "Add thing",
      ),
    ).resolves.toBe(true);
  });

  it("does not mark unrelated revert commits as matches on a loose title substring", async () => {
    stubSelectSequence([
      [
        {
          message: "Revert fix login bug regression in payments",
          committedAt: new Date("2026-04-22T10:00:00Z"),
        },
      ],
    ]);

    await expect(
      detectRevertWithin14d(
        "acme/api",
        42,
        new Date("2026-04-21T10:00:00Z"),
        "abc123",
        "Fix login bug",
      ),
    ).resolves.toBe(false);
  });
});

describe("maybeRunCodeReviewFromCron (cooldown gate)", () => {
  beforeEach(() => {
    mockAnalysePR.mockReset();
    mockFetchPayload.mockReset();
    stubInsert();
  });

  it("returns cooldown when the last run is recent", async () => {
    const mod = await import("../code-review");
    stubSelectSequence([[{ analysedAt: new Date(Date.now() - 60 * 60 * 1000) }]]);
    const result = await mod.maybeRunCodeReviewFromCron();
    expect(result).toEqual({ skippedBy: "cooldown" });
  });

  it("runs when no prior analysis exists", async () => {
    const mod = await import("../code-review");
    stubSelectSequence([[], [], [], []]);
    const result = await mod.maybeRunCodeReviewFromCron();
    expect("skippedBy" in result).toBe(false);
  });
});

describe("getCodeReviewBackfillStatus", () => {
  const originalExcluded = process.env.CODE_REVIEW_EXCLUDED_REPOS;

  afterEach(() => {
    if (originalExcluded === undefined) {
      delete process.env.CODE_REVIEW_EXCLUDED_REPOS;
    } else {
      process.env.CODE_REVIEW_EXCLUDED_REPOS = originalExcluded;
    }
  });

  it("reports analysed, remaining, and skipped counts using the live backlog rules", async () => {
    const latestAnalysedAt = new Date("2026-04-24T09:00:00Z");
    const oldestMissing = new Date("2026-04-18T10:00:00Z");
    const newestMissing = new Date("2026-04-22T10:00:00Z");
    process.env.CODE_REVIEW_EXCLUDED_REPOS = "acme/secret";
    stubSelectSequence([
      [
        {
          repo: "acme/api",
          prNumber: 1,
          authorLogin: "alice",
          mergedAt: new Date("2026-04-23T10:00:00Z"),
        },
        {
          repo: "acme/api",
          prNumber: 2,
          authorLogin: "dependabot[bot]",
          mergedAt: new Date("2026-04-23T11:00:00Z"),
        },
        {
          repo: "acme/secret",
          prNumber: 3,
          authorLogin: "alice",
          mergedAt: new Date("2026-04-23T12:00:00Z"),
        },
        {
          repo: "acme/api",
          prNumber: 4,
          authorLogin: "bob",
          mergedAt: newestMissing,
        },
        {
          repo: "acme/web",
          prNumber: 5,
          authorLogin: "charlie",
          mergedAt: oldestMissing,
        },
      ],
      [{ githubLogin: "release-bot" }],
      [
        {
          repo: "acme/api",
          prNumber: 1,
          analysedAt: latestAnalysedAt,
        },
        {
          repo: "acme/secret",
          prNumber: 3,
          analysedAt: new Date("2026-04-24T08:00:00Z"),
        },
      ],
    ]);

    const status = await getCodeReviewBackfillStatus();

    expect(status.candidatesConsidered).toBe(5);
    expect(status.eligibleTotal).toBe(3);
    expect(status.analysedCount).toBe(1);
    expect(status.remainingCount).toBe(2);
    expect(status.progressPct).toBeCloseTo((1 / 3) * 100, 5);
    expect(status.skippedBotCount).toBe(1);
    expect(status.skippedExcludedCount).toBe(1);
    expect(status.latestAnalysedAt).toEqual(latestAnalysedAt);
    expect(status.oldestRemainingMergedAt).toEqual(oldestMissing);
    expect(status.newestRemainingMergedAt).toEqual(newestMissing);
  });

  it("returns 100% progress when no PRs are eligible for review", async () => {
    stubSelectSequence([
      [
        {
          repo: "acme/api",
          prNumber: 1,
          authorLogin: "dependabot[bot]",
          mergedAt: new Date("2026-04-23T10:00:00Z"),
        },
      ],
      [],
      [],
    ]);

    const status = await getCodeReviewBackfillStatus();

    expect(status.eligibleTotal).toBe(0);
    expect(status.analysedCount).toBe(0);
    expect(status.remainingCount).toBe(0);
    expect(status.progressPct).toBe(100);
    expect(status.latestAnalysedAt).toBeNull();
    expect(status.oldestRemainingMergedAt).toBeNull();
    expect(status.newestRemainingMergedAt).toBeNull();
  });

  it("reports zero progress and null latest analysis when the backlog has not started", async () => {
    const oldestMissing = new Date("2026-04-18T10:00:00Z");
    const newestMissing = new Date("2026-04-22T10:00:00Z");
    stubSelectSequence([
      [
        {
          repo: "acme/api",
          prNumber: 1,
          authorLogin: "alice",
          mergedAt: oldestMissing,
        },
        {
          repo: "acme/web",
          prNumber: 2,
          authorLogin: "bob",
          mergedAt: newestMissing,
        },
      ],
      [],
      [],
    ]);

    const status = await getCodeReviewBackfillStatus();

    expect(status.eligibleTotal).toBe(2);
    expect(status.analysedCount).toBe(0);
    expect(status.remainingCount).toBe(2);
    expect(status.progressPct).toBe(0);
    expect(status.latestAnalysedAt).toBeNull();
    expect(status.oldestRemainingMergedAt).toEqual(oldestMissing);
    expect(status.newestRemainingMergedAt).toEqual(newestMissing);
  });
});
