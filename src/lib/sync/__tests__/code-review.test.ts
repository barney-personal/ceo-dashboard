import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockInsert, mockDelete } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    // pruneOldAnalyses (called from maybeRunCodeReviewFromCron) does
    // db.delete(...).where(...).returning(...). Stub to a chainable that
    // resolves to empty so no rows "pruned".
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  },
}));

// Keep the vi.fn() around so future tests can swap in a custom delete —
// currently unused but imported for hoisted-initialisation symmetry.
void mockDelete;

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

import { runCodeReviewAnalysis } from "../code-review";

interface FakePr {
  repo: string;
  prNumber: number;
  authorLogin: string;
  mergedAt: Date;
}

function stubPrsQuery(
  prs: FakePr[],
  opts: {
    /** Login → `{ isBot: true }` rows returned by the githubEmployeeMap lookup. */
    botLogins?: string[];
    /** Existing (repo, prNumber) rows returned by the cache-hit lookup. */
    existing?: Array<{ repo: string; prNumber: number }>;
  } = {},
) {
  // Call order in runCodeReviewAnalysis:
  //   1. merged-PR candidates
  //   2. githubEmployeeMap bot logins
  //   3. existing analyses for cache lookup (skipped when force=true)
  const botRows = (opts.botLogins ?? []).map((l) => ({ githubLogin: l }));
  const existing = opts.existing ?? [];
  let call = 0;
  mockSelect.mockReset();
  mockSelect.mockImplementation(() => {
    call++;
    const chain: Record<string, unknown> = {};
    ["from", "where", "orderBy"].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (call === 1) return Promise.resolve(prs).then(resolve);
      if (call === 2) return Promise.resolve(botRows).then(resolve);
      return Promise.resolve(existing).then(resolve);
    };
    return chain;
  });
}

function stubInsert() {
  mockInsert.mockReset();
  mockInsert.mockImplementation(() => ({
    values: () => ({
      onConflictDoUpdate: () => Promise.resolve(),
    }),
  }));
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
    mockFetchPayload.mockResolvedValue({
      repo: "acme/api",
      prNumber: 1,
      title: "t",
      body: "",
      mergeSha: "abc",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      files: [],
      prNotes: [],
    });
    mockAnalysePR.mockResolvedValue({
      complexity: 3,
      quality: 3,
      category: "feature",
      summary: "x",
      caveats: [],
      standout: null,
    });

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
    expect(result.skipped.length).toBe(2);
    expect(mockAnalysePR).not.toHaveBeenCalled();
  });

  it("skips bots flagged in githubEmployeeMap even when the login looks clean", async () => {
    // "acme-releaser" doesn't match any login-suffix bot pattern — only the
    // DB flag stops it from being analysed. This is the regression test for
    // the PR-review finding.
    stubPrsQuery(
      [
        { repo: "acme/api", prNumber: 1, authorLogin: "acme-releaser", mergedAt: new Date() },
      ],
      { botLogins: ["acme-releaser"] },
    );
    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(0);
    expect(result.skipped.some((s) => s.reason === "bot author")).toBe(true);
    expect(mockAnalysePR).not.toHaveBeenCalled();
  });

  it("skips repos matching CODE_REVIEW_EXCLUDED_REPOS", async () => {
    process.env.CODE_REVIEW_EXCLUDED_REPOS = "acme/secret, acme/infra";
    stubPrsQuery([
      { repo: "acme/secret", prNumber: 1, authorLogin: "alice", mergedAt: new Date() },
      { repo: "acme/public", prNumber: 2, authorLogin: "alice", mergedAt: new Date() },
    ]);
    mockFetchPayload.mockResolvedValue({
      repo: "acme/public",
      prNumber: 2,
      title: "t",
      body: "",
      mergeSha: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      files: [],
      prNotes: [],
    });
    mockAnalysePR.mockResolvedValue({
      complexity: 3,
      quality: 3,
      category: "feature",
      summary: "x",
      caveats: [],
      standout: null,
    });

    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(1);
    expect(result.skipped.some((s) => s.reason === "repo excluded")).toBe(true);
  });

  it("records failures but continues past them", async () => {
    stubPrsQuery([
      { repo: "acme/api", prNumber: 1, authorLogin: "alice", mergedAt: new Date() },
      { repo: "acme/api", prNumber: 2, authorLogin: "alice", mergedAt: new Date() },
    ]);
    mockFetchPayload.mockResolvedValue({
      repo: "acme/api",
      prNumber: 1,
      title: "t",
      body: "",
      mergeSha: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      files: [],
      prNotes: [],
    });
    mockAnalysePR
      .mockRejectedValueOnce(new Error("LLM down"))
      .mockResolvedValueOnce({
        complexity: 2,
        quality: 3,
        category: "chore",
        summary: "x",
        caveats: [],
        standout: null,
      });

    const result = await runCodeReviewAnalysis();
    expect(result.analysed).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("LLM down");
  });

  it("re-analyses cached PRs when force=true", async () => {
    // Without force, cached rows are skipped. With force, the cache-hit
    // query is bypassed entirely and every eligible PR goes through the LLM.
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
      },
    );
    mockFetchPayload.mockResolvedValue({
      repo: "acme/api",
      prNumber: 1,
      title: "t",
      body: "",
      mergeSha: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      files: [],
      prNotes: [],
    });
    mockAnalysePR.mockResolvedValue({
      complexity: 3,
      quality: 3,
      category: "feature",
      summary: "x",
      caveats: [],
      standout: null,
    });

    const result = await runCodeReviewAnalysis({ force: true });
    // Both PRs re-analysed despite already being cached.
    expect(result.analysed).toBe(2);
    expect(result.cached).toBe(0);
    expect(mockAnalysePR).toHaveBeenCalledTimes(2);
  });

  it("honours the limit parameter", async () => {
    stubPrsQuery(
      Array.from({ length: 20 }).map((_, i) => ({
        repo: "acme/api",
        prNumber: i,
        authorLogin: "alice",
        mergedAt: new Date(),
      })),
    );
    mockFetchPayload.mockResolvedValue({
      repo: "acme/api",
      prNumber: 1,
      title: "t",
      body: "",
      mergeSha: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      files: [],
      prNotes: [],
    });
    mockAnalysePR.mockResolvedValue({
      complexity: 3,
      quality: 3,
      category: "feature",
      summary: "x",
      caveats: [],
      standout: null,
    });

    const result = await runCodeReviewAnalysis({ limit: 5 });
    expect(result.analysed).toBe(5);
  });
});

describe("maybeRunCodeReviewFromCron (cooldown gate)", () => {
  beforeEach(() => {
    mockAnalysePR.mockReset();
    mockFetchPayload.mockReset();
    stubInsert();
  });

  /** Chain that returns `rows` for the first select, then empty arrays. Used
   * for mocking the single `select().from().orderBy().limit()` inside
   * `msSinceLastAnalysis` specifically. */
  function stubSelect(rows: unknown[]) {
    let first = true;
    mockSelect.mockReset();
    mockSelect.mockImplementation(() => {
      const payload = first ? rows : [];
      first = false;
      const chain: Record<string, unknown> = {};
      ["from", "where", "orderBy", "limit"].forEach((m) => {
        chain[m] = () => chain;
      });
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(payload).then(resolve);
      return chain;
    });
  }

  it("returns { skippedBy: 'cooldown' } when the last run is within the cooldown window", async () => {
    // Import lazily so the fresh vi.mock state above is picked up.
    const mod = await import("../code-review");
    // Simulate "analysed 1 hour ago" — well inside the 6.5-day cooldown.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    stubSelect([{ analysedAt: oneHourAgo }]);
    const result = await mod.maybeRunCodeReviewFromCron();
    expect(result).toEqual({ skippedBy: "cooldown" });
    // Critically: we must NOT have kicked off an analysis run.
    expect(mockAnalysePR).not.toHaveBeenCalled();
    expect(mockFetchPayload).not.toHaveBeenCalled();
  });

  it("runs the analysis when no prior run exists", async () => {
    const mod = await import("../code-review");
    // msSinceLastAnalysis returns null → no prior run → cooldown doesn't apply.
    // Subsequent selects (candidates, bots, cache lookup) return empty so the
    // runner exits cleanly with no PRs to process.
    stubSelect([]);
    const result = await mod.maybeRunCodeReviewFromCron();
    expect("skippedBy" in result).toBe(false);
    if ("skippedBy" in result) return; // narrowing for TS
    expect(result.analysed).toBe(0);
  });
});
