import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

import { getCodeReviewView } from "../code-review";
import { RUBRIC_VERSION } from "@/lib/integrations/code-review-analyser";

interface FakeAnalysisRow {
  repo: string;
  prNumber: number;
  authorLogin: string;
  mergedAt: Date;
  technicalDifficulty: number;
  executionQuality: number;
  testAdequacy: number;
  riskHandling: number;
  reviewability: number;
  analysisConfidencePct: number;
  category: string;
  summary: string;
  caveats: string[];
  standout: string | null;
  primarySurface: string;
  approvalCount: number;
  changeRequestCount: number;
  reviewCommentCount: number;
  conversationCommentCount: number;
  reviewRounds: number;
  timeToFirstReviewMinutes: number | null;
  timeToMergeMinutes: number;
  commitCount: number;
  commitsAfterFirstReview: number;
  revertWithin14d: boolean;
  outcomeScore: number;
  reviewProvider: string;
  reviewModel: string;
  secondOpinionUsed: boolean;
  agreementLevel: string;
  secondOpinionReasons: string[];
  rubricVersion: string;
  analysedAt: Date;
}

function row(overrides: Partial<FakeAnalysisRow> = {}): FakeAnalysisRow {
  return {
    repo: "acme/api",
    prNumber: 1,
    authorLogin: "alice",
    mergedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    technicalDifficulty: 3,
    executionQuality: 3,
    testAdequacy: 3,
    riskHandling: 3,
    reviewability: 3,
    analysisConfidencePct: 80,
    category: "feature",
    summary: "Does a thing",
    caveats: [],
    standout: null,
    primarySurface: "backend",
    approvalCount: 1,
    changeRequestCount: 0,
    reviewCommentCount: 1,
    conversationCommentCount: 0,
    reviewRounds: 1,
    timeToFirstReviewMinutes: 60,
    timeToMergeMinutes: 180,
    commitCount: 2,
    commitsAfterFirstReview: 0,
    revertWithin14d: false,
    outcomeScore: 82,
    reviewProvider: "anthropic",
    reviewModel: "claude-opus-4-7",
    secondOpinionUsed: false,
    agreementLevel: "single_model",
    secondOpinionReasons: [],
    rubricVersion: RUBRIC_VERSION,
    analysedAt: new Date(),
    ...overrides,
  };
}

function mockChain(...payloads: unknown[][]) {
  let callCount = 0;
  mockSelect.mockReset();
  mockSelect.mockImplementation(() => {
    const payload = payloads[callCount++] ?? [];
    const chain: Record<string, unknown> = {};
    ["from", "where", "orderBy"].forEach((method) => {
      chain[method] = () => chain;
    });
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(payload).then(resolve);
    return chain as Awaited<unknown>;
  });
}

describe("getCodeReviewView", () => {
  beforeEach(() => {
    mockSelect.mockReset();
  });

  it("rolls up engineers into confidence-aware ranked rows", async () => {
    mockChain(
      [
        row({ authorLogin: "alice", prNumber: 1, executionQuality: 5, testAdequacy: 4, outcomeScore: 90 }),
        row({ authorLogin: "alice", prNumber: 2, executionQuality: 4, testAdequacy: 4, outcomeScore: 88 }),
        row({ authorLogin: "alice", prNumber: 3, executionQuality: 4, testAdequacy: 5, outcomeScore: 92 }),
        row({ authorLogin: "bob", prNumber: 10, technicalDifficulty: 5, executionQuality: 3, testAdequacy: 3, outcomeScore: 70 }),
        row({ authorLogin: "bob", prNumber: 11, technicalDifficulty: 5, executionQuality: 3, testAdequacy: 2, outcomeScore: 68 }),
        row({ authorLogin: "bob", prNumber: 12, technicalDifficulty: 4, executionQuality: 3, testAdequacy: 3, outcomeScore: 71 }),
      ],
      [{ githubLogin: "alice", employeeName: "Alice A", isBot: false }],
    );

    const view = await getCodeReviewView();
    expect(view.engineers).toHaveLength(2);
    expect(view.engineers[0].authorLogin).toBe("alice");
    expect(view.engineers[0].finalScore).toBeGreaterThan(
      view.engineers[1].finalScore,
    );
    expect(view.engineers[0].employeeName).toBe("Alice A");
    expect(view.engineers[0].qualityPercentile).toBeGreaterThanOrEqual(50);
  });

  it("flags low evidence instead of splitting sparse engineers into a separate table", async () => {
    mockChain(
      [
        row({ authorLogin: "carol", prNumber: 100, analysisConfidencePct: 45 }),
        row({ authorLogin: "dave", prNumber: 101 }),
        row({ authorLogin: "dave", prNumber: 102 }),
        row({ authorLogin: "dave", prNumber: 103 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    expect(view.engineers).toHaveLength(2);
    expect(
      view.engineers.find((engineer) => engineer.authorLogin === "carol")?.flags,
    ).toContain("low_evidence");
  });

  it("surfaces reverted and concerning PR signals as diagnostic flags", async () => {
    mockChain(
      [
        row({ authorLogin: "erin", prNumber: 200 }),
        row({
          authorLogin: "erin",
          prNumber: 201,
          standout: "concerning",
          revertWithin14d: true,
        }),
        row({ authorLogin: "erin", prNumber: 202 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    expect(view.engineers[0].flags).toContain("has_concerning_pr");
    expect(view.engineers[0].flags).toContain("reverted_pr");
  });

  it("populates weekly score buckets for the drawer sparkline", async () => {
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    mockChain(
      [
        row({ authorLogin: "frank", prNumber: 300, mergedAt: daysAgo(2) }),
        row({ authorLogin: "frank", prNumber: 301, mergedAt: daysAgo(20) }),
        row({ authorLogin: "frank", prNumber: 302, mergedAt: daysAgo(55) }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    expect(view.engineers[0].weeklyScore.length).toBeGreaterThan(1);
    expect(
      view.engineers[0].weeklyScore.reduce((sum, value) => sum + value, 0),
    ).toBeGreaterThan(0);
  });

  it("returns neutral percentiles for a single-engineer cohort", async () => {
    mockChain([row({ authorLogin: "solo", prNumber: 400 })], []);

    const view = await getCodeReviewView();
    expect(view.engineers).toHaveLength(1);
    expect(view.engineers[0].qualityPercentile).toBe(50);
    expect(view.engineers[0].difficultyPercentile).toBe(50);
    expect(view.engineers[0].reliabilityPercentile).toBe(50);
    expect(view.engineers[0].reviewHealthPercentile).toBe(50);
    expect(view.engineers[0].throughputPercentile).toBe(50);
    expect(view.engineers[0].finalScore).toBe(50);
  });

  it("returns neutral percentiles when cohort members have identical scores", async () => {
    const mergedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    mockChain(
      [
        row({ authorLogin: "alice", prNumber: 500, mergedAt }),
        row({ authorLogin: "bob", prNumber: 501, mergedAt }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    expect(view.engineers).toHaveLength(2);
    expect(view.engineers.map((engineer) => engineer.qualityPercentile)).toEqual([
      50, 50,
    ]);
    expect(view.engineers.map((engineer) => engineer.difficultyPercentile)).toEqual([
      50, 50,
    ]);
    expect(view.engineers.map((engineer) => engineer.reliabilityPercentile)).toEqual([
      50, 50,
    ]);
    expect(view.engineers.map((engineer) => engineer.reviewHealthPercentile)).toEqual([
      50, 50,
    ]);
    expect(view.engineers.map((engineer) => engineer.throughputPercentile)).toEqual([
      50, 50,
    ]);
  });

  it("uses the general percentile path for two-engineer cohorts", async () => {
    mockChain(
      [
        row({ authorLogin: "high", prNumber: 600, executionQuality: 5, testAdequacy: 5, outcomeScore: 95 }),
        row({ authorLogin: "low", prNumber: 601, executionQuality: 2, testAdequacy: 2, outcomeScore: 60 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    expect(view.engineers).toHaveLength(2);
    expect(view.engineers[0].qualityPercentile).toBe(100);
    expect(view.engineers[1].qualityPercentile).toBe(0);
  });
});
