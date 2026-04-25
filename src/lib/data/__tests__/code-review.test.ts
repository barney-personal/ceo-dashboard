import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

import {
  getCodeReviewView,
  rollupSquadsFromEngineers,
  type SquadLookup,
} from "../code-review";
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
  rawJson?: unknown;
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

  it("fires has_concerning_pr on rule-based signals even without the LLM standout", async () => {
    mockChain(
      [
        row({ authorLogin: "gary", prNumber: 701 }),
        row({
          authorLogin: "gary",
          prNumber: 702,
          standout: null,
          revertWithin14d: false,
          changeRequestCount: 4,
          commitsAfterFirstReview: 1,
        }),
        row({ authorLogin: "gary", prNumber: 703 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    const gary = view.engineers[0];
    expect(gary.flags).toContain("has_concerning_pr");
    const flagged = gary.prs.find((pr) => pr.prNumber === 702);
    expect(flagged?.secondLookReasons).toContain("heavy_change_requests");
  });

  it("flags material model disagreement and carries raw model reads", async () => {
    mockChain(
      [
        row({
          authorLogin: "maria",
          prNumber: 710,
          agreementLevel: "material_adjustment",
          rawJson: {
            rawModelReviews: [
              {
                provider: "anthropic",
                model: "claude-opus-4-7",
                technicalDifficulty: 4,
                executionQuality: 2,
                testAdequacy: 2,
                riskHandling: 2,
                reviewability: 2,
                analysisConfidencePct: 70,
                category: "feature",
                summary: "Claude was concerned.",
                caveats: [],
                standout: "concerning",
              },
              {
                provider: "openai",
                model: "gpt-5.4",
                technicalDifficulty: 4,
                executionQuality: 4,
                testAdequacy: 4,
                riskHandling: 4,
                reviewability: 4,
                analysisConfidencePct: 80,
                category: "feature",
                summary: "GPT saw a solid change.",
                caveats: [],
                standout: null,
              },
            ],
          },
        }),
        row({ authorLogin: "maria", prNumber: 711 }),
        row({ authorLogin: "maria", prNumber: 712 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    expect(view.engineers[0].flags).toContain("model_disagreement");
    expect(view.engineers[0].prs[0].rawModelReviews).toHaveLength(2);
  });

  it("does not flag review_churn_high when churn matches similar-work peers", async () => {
    // All engineers doing difficulty-5 refactors with the same churn pattern.
    // Nobody stands out against the bucket baseline.
    mockChain(
      [
        ...["p1", "p2", "p3", "p4", "p5"].flatMap((login, i) =>
          [801, 802].map((n) =>
            row({
              authorLogin: login,
              prNumber: n + i * 10,
              category: "refactor",
              technicalDifficulty: 5,
              reviewRounds: 4,
              commitsAfterFirstReview: 2,
            }),
          ),
        ),
      ],
      [],
    );

    const view = await getCodeReviewView();
    for (const engineer of view.engineers) {
      expect(engineer.flags).not.toContain("review_churn_high");
      expect(Math.abs(engineer.reviewChurnResidual)).toBeLessThan(1);
    }
  });

  it("flags review_churn_high when churn exceeds peers on similar work", async () => {
    // 6 smooth chore PRs set the chore:1 baseline near 0 churn.
    // Alice has 3 chore:1 PRs with very high churn — she stands out.
    // Bob does 3 refactor:5 PRs matching the refactor:5 baseline — no flag.
    const calm = ["c1", "c2", "c3", "c4", "c5", "c6"].map((login, i) =>
      row({
        authorLogin: login,
        prNumber: 900 + i,
        category: "chore",
        technicalDifficulty: 1,
        reviewRounds: 1,
        commitsAfterFirstReview: 0,
        changeRequestCount: 0,
      }),
    );
    const refactorPeers = ["r1", "r2", "r3", "r4", "r5", "r6"].map((login, i) =>
      row({
        authorLogin: login,
        prNumber: 920 + i,
        category: "refactor",
        technicalDifficulty: 5,
        reviewRounds: 4,
        commitsAfterFirstReview: 2,
        changeRequestCount: 1,
      }),
    );
    const alicePrs = [0, 1, 2, 3].map((n) =>
      row({
        authorLogin: "alice_churny",
        prNumber: 940 + n,
        category: "chore",
        technicalDifficulty: 1,
        reviewRounds: 4,
        commitsAfterFirstReview: 3,
        changeRequestCount: 2,
      }),
    );
    const bobPrs = [0, 1, 2, 3].map((n) =>
      row({
        authorLogin: "bob_refactor",
        prNumber: 960 + n,
        category: "refactor",
        technicalDifficulty: 5,
        reviewRounds: 4,
        commitsAfterFirstReview: 2,
        changeRequestCount: 1,
      }),
    );
    mockChain([...calm, ...refactorPeers, ...alicePrs, ...bobPrs], []);

    const view = await getCodeReviewView();
    const alice = view.engineers.find(
      (engineer) => engineer.authorLogin === "alice_churny",
    );
    const bob = view.engineers.find(
      (engineer) => engineer.authorLogin === "bob_refactor",
    );
    expect(alice?.flags).toContain("review_churn_high");
    expect(alice?.reviewChurnResidual).toBeGreaterThan(1);
    expect(bob?.flags).not.toContain("review_churn_high");
    expect(Math.abs(bob?.reviewChurnResidual ?? 0)).toBeLessThan(1);
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

describe("rollupSquadsFromEngineers", () => {
  function squadMap(
    entries: Array<[string, SquadLookup]>,
  ): Map<string, SquadLookup> {
    return new Map(entries.map(([login, lookup]) => [login.toLowerCase(), lookup]));
  }

  it("groups engineers by squad and ranks a stronger squad above a weaker one", async () => {
    mockChain(
      [
        row({ authorLogin: "alice", prNumber: 1, executionQuality: 5, testAdequacy: 5, outcomeScore: 95 }),
        row({ authorLogin: "alice", prNumber: 2, executionQuality: 5, testAdequacy: 4, outcomeScore: 92 }),
        row({ authorLogin: "bob", prNumber: 3, executionQuality: 5, testAdequacy: 5, outcomeScore: 94 }),
        row({ authorLogin: "bob", prNumber: 4, executionQuality: 4, testAdequacy: 5, outcomeScore: 90 }),
        row({ authorLogin: "carol", prNumber: 5, executionQuality: 2, testAdequacy: 2, outcomeScore: 55 }),
        row({ authorLogin: "carol", prNumber: 6, executionQuality: 2, testAdequacy: 2, outcomeScore: 58 }),
        row({ authorLogin: "dave", prNumber: 7, executionQuality: 2, testAdequacy: 3, outcomeScore: 60 }),
        row({ authorLogin: "dave", prNumber: 8, executionQuality: 3, testAdequacy: 2, outcomeScore: 62 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    const map = squadMap([
      ["alice", { squadName: "Payments", pillar: "Core" }],
      ["bob", { squadName: "Payments", pillar: "Core" }],
      ["carol", { squadName: "Growth", pillar: "GTM" }],
      ["dave", { squadName: "Growth", pillar: "GTM" }],
    ]);

    const { squads, unassignedEngineerCount } = rollupSquadsFromEngineers(
      view.engineers,
      map,
    );
    expect(unassignedEngineerCount).toBe(0);
    expect(squads).toHaveLength(2);
    expect(squads[0].squadName).toBe("Payments");
    expect(squads[0].engineerCount).toBe(2);
    expect(squads[0].prCount).toBe(4);
    expect(squads[0].pillar).toBe("Core");
    expect(squads[0].finalScore).toBeGreaterThan(squads[1].finalScore);
    expect(squads[0].qualityPercentile).toBe(100);
    expect(squads[1].qualityPercentile).toBe(0);
  });

  it("counts engineers with no squad mapping as unassigned", async () => {
    mockChain(
      [
        row({ authorLogin: "alice", prNumber: 10 }),
        row({ authorLogin: "alice", prNumber: 11 }),
        row({ authorLogin: "nobody", prNumber: 12 }),
        row({ authorLogin: "nobody", prNumber: 13 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    const map = squadMap([
      ["alice", { squadName: "Payments", pillar: "Core" }],
    ]);

    const { squads, unassignedEngineerCount, unassignedPrCount } =
      rollupSquadsFromEngineers(view.engineers, map);
    expect(squads).toHaveLength(1);
    expect(squads[0].squadName).toBe("Payments");
    expect(unassignedEngineerCount).toBe(1);
    expect(unassignedPrCount).toBe(2);
  });

  it("shrinks thin-evidence squads toward neutral 50", async () => {
    // Payments: one engineer with one very strong PR — thin evidence.
    // Growth: three engineers each with four mid PRs — much more evidence.
    mockChain(
      [
        row({ authorLogin: "alice", prNumber: 20, executionQuality: 5, testAdequacy: 5, outcomeScore: 98 }),
        ...["g1", "g2", "g3"].flatMap((login, i) =>
          [0, 1, 2, 3].map((n) =>
            row({
              authorLogin: login,
              prNumber: 30 + i * 10 + n,
              executionQuality: 3,
              testAdequacy: 3,
              outcomeScore: 78,
            }),
          ),
        ),
      ],
      [],
    );

    const view = await getCodeReviewView();
    const map = squadMap([
      ["alice", { squadName: "Payments", pillar: "Core" }],
      ["g1", { squadName: "Growth", pillar: "GTM" }],
      ["g2", { squadName: "Growth", pillar: "GTM" }],
      ["g3", { squadName: "Growth", pillar: "GTM" }],
    ]);

    const { squads } = rollupSquadsFromEngineers(view.engineers, map);
    const payments = squads.find((s) => s.squadName === "Payments")!;
    const growth = squads.find((s) => s.squadName === "Growth")!;
    // Payments has the higher rawScore (stronger single PR) but the shrinkage
    // toward 50 at 20 effective PRs should pull it closer to neutral than
    // Growth's well-evidenced raw score.
    expect(payments.rawScore).toBeGreaterThan(growth.rawScore);
    expect(Math.abs(payments.finalScore - 50)).toBeLessThan(
      Math.abs(payments.rawScore - 50),
    );
    expect(growth.effectivePrCount).toBeGreaterThan(payments.effectivePrCount);
  });
});
