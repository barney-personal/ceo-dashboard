import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
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

import { runCodeReviewAnalysis } from "../code-review";

interface FakePr {
  repo: string;
  prNumber: number;
  authorLogin: string;
  mergedAt: Date;
}

function stubPrsQuery(prs: FakePr[]) {
  // First .select() call → merged PR candidates
  // Second .select() call → existing analyses for the cache lookup
  // We need to return different chains depending on call count.
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
      return Promise.resolve([]).then(resolve); // no cache hits
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
