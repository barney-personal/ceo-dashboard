import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock drizzle's db so we can inject fake rows. Pattern mirrors the other
// data-loader tests in this folder (people.test.ts, attrition.test.ts, etc.).
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
  complexity: number;
  quality: number;
  category: string;
  summary: string;
  caveats: string[];
  standout: string | null;
  rubricVersion: string;
  analysedAt: Date;
}

function row(overrides: Partial<FakeAnalysisRow> = {}): FakeAnalysisRow {
  return {
    repo: "acme/api",
    prNumber: 1,
    authorLogin: "alice",
    mergedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    complexity: 3,
    quality: 3,
    category: "feature",
    summary: "Does a thing",
    caveats: [],
    standout: null,
    rubricVersion: RUBRIC_VERSION,
    analysedAt: new Date(),
    ...overrides,
  };
}

/** The data loader calls `.select().from().where().orderBy()` for the rows
 * and `.select().from()` for the employee map. Build a chainable stub that
 * returns the right payload based on call count. */
function mockChain(...payloads: unknown[][]) {
  let callCount = 0;
  mockSelect.mockReset();
  mockSelect.mockImplementation(() => {
    const payload = payloads[callCount++] ?? [];
    // Builds return a thenable chain — each method returns the chain.
    const chain: Record<string, unknown> = {};
    ["from", "where", "orderBy"].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(payload).then(resolve);
    return chain as Awaited<unknown>;
  });
}

describe("getCodeReviewView", () => {
  beforeEach(() => {
    mockSelect.mockReset();
  });

  it("rolls up multiple PRs per engineer, ranks by composite desc", async () => {
    mockChain(
      [
        // Alice: two PRs, composite = 3*3 + 5*4 = 29
        row({ authorLogin: "alice", prNumber: 1, complexity: 3, quality: 3 }),
        row({ authorLogin: "alice", prNumber: 2, complexity: 5, quality: 4 }),
        row({ authorLogin: "alice", prNumber: 3, complexity: 2, quality: 3 }), // total = 6
        // Bob: three PRs, composite = 4*4 + 4*4 + 4*4 = 48
        row({ authorLogin: "bob", prNumber: 10, complexity: 4, quality: 4 }),
        row({ authorLogin: "bob", prNumber: 11, complexity: 4, quality: 4 }),
        row({ authorLogin: "bob", prNumber: 12, complexity: 4, quality: 4 }),
      ],
      [{ githubLogin: "alice", employeeName: "Alice A", isBot: false }],
    );

    const view = await getCodeReviewView();
    expect(view.engineers).toHaveLength(2);
    // Bob outranks Alice because composite is higher.
    expect(view.engineers[0].authorLogin).toBe("bob");
    expect(view.engineers[0].compositeScore).toBe(48);
    expect(view.engineers[1].authorLogin).toBe("alice");
    expect(view.engineers[1].compositeScore).toBe(29 + 6);
    // Employee-map hydration applied where available.
    expect(view.engineers[1].employeeName).toBe("Alice A");
    expect(view.engineers[0].employeeName).toBeNull();
  });

  it("separates low-evidence engineers from the main ranking", async () => {
    mockChain(
      [
        row({ authorLogin: "carol", prNumber: 100 }), // only 1 PR — low evidence
        row({ authorLogin: "dave", prNumber: 101 }),
        row({ authorLogin: "dave", prNumber: 102 }),
        row({ authorLogin: "dave", prNumber: 103 }),
        row({ authorLogin: "dave", prNumber: 104 }),
      ],
      [],
    );

    const view = await getCodeReviewView();
    expect(view.engineers.map((e) => e.authorLogin)).toEqual(["dave"]);
    expect(view.lowEvidenceEngineers.map((e) => e.authorLogin)).toEqual(["carol"]);
    expect(view.lowEvidenceEngineers[0].flags).toContain("low_evidence");
  });

  it("excludes rows whose github login is mapped as a bot", async () => {
    mockChain(
      [
        row({ authorLogin: "dependabot", prNumber: 1 }),
        row({ authorLogin: "dependabot", prNumber: 2 }),
        row({ authorLogin: "dependabot", prNumber: 3 }),
        row({ authorLogin: "eve", prNumber: 4 }),
        row({ authorLogin: "eve", prNumber: 5 }),
        row({ authorLogin: "eve", prNumber: 6 }),
      ],
      [
        { githubLogin: "dependabot", employeeName: null, isBot: true },
      ],
    );

    const view = await getCodeReviewView();
    expect(view.engineers.map((e) => e.authorLogin)).toEqual(["eve"]);
  });

  it("flags high_volume_low_quality when an engineer has ≥8 PRs with median quality ≤2", async () => {
    const rows = Array.from({ length: 10 }).map((_, i) =>
      row({
        authorLogin: "frank",
        prNumber: 200 + i,
        complexity: 2,
        quality: 2,
      }),
    );
    mockChain(rows, []);
    const view = await getCodeReviewView();
    expect(view.engineers[0].flags).toContain("high_volume_low_quality");
  });

  it("flags low_volume_high_complexity when an engineer has ≤4 PRs with median complexity ≥4", async () => {
    mockChain(
      [
        row({ authorLogin: "grace", prNumber: 300, complexity: 5, quality: 4 }),
        row({ authorLogin: "grace", prNumber: 301, complexity: 4, quality: 3 }),
        row({ authorLogin: "grace", prNumber: 302, complexity: 4, quality: 4 }),
      ],
      [],
    );
    const view = await getCodeReviewView();
    expect(view.engineers[0].flags).toContain("low_volume_high_complexity");
  });

  it("flags has_concerning_pr when any PR has standout=concerning", async () => {
    mockChain(
      [
        row({ authorLogin: "heidi", prNumber: 400 }),
        row({ authorLogin: "heidi", prNumber: 401, standout: "concerning" }),
        row({ authorLogin: "heidi", prNumber: 402 }),
      ],
      [],
    );
    const view = await getCodeReviewView();
    expect(view.engineers[0].flags).toContain("has_concerning_pr");
  });

  it("flags quality_variance_high when ≥5 PRs have stdev(quality) ≥ 1.2", async () => {
    // Quality spread from 1 to 5 on a single author — classic "inconsistent"
    // pattern that the diagnostic exists to catch.
    const qualities = [1, 2, 3, 4, 5, 3];
    mockChain(
      qualities.map((q, i) =>
        row({ authorLogin: "mallory", prNumber: 700 + i, complexity: 3, quality: q }),
      ),
      [],
    );
    const view = await getCodeReviewView();
    expect(view.engineers[0].flags).toContain("quality_variance_high");
  });

  it("flags all_tiny_prs when ≥5 PRs all have complexity ≤2", async () => {
    const rows = Array.from({ length: 6 }).map((_, i) =>
      row({ authorLogin: "ivan", prNumber: 500 + i, complexity: 1, quality: 3 }),
    );
    mockChain(rows, []);
    const view = await getCodeReviewView();
    expect(view.engineers[0].flags).toContain("all_tiny_prs");
  });

  it("populates weekly composite buckets for the drawer sparkline", async () => {
    // Spread 3 PRs across the 30d window — each in a different week-ish bucket.
    const days = (n: number) =>
      new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    mockChain(
      [
        row({ authorLogin: "jack", prNumber: 600, mergedAt: days(2), complexity: 3, quality: 3 }),
        row({ authorLogin: "jack", prNumber: 601, mergedAt: days(10), complexity: 4, quality: 4 }),
        row({ authorLogin: "jack", prNumber: 602, mergedAt: days(25), complexity: 2, quality: 2 }),
      ],
      [],
    );
    const view = await getCodeReviewView();
    const buckets = view.engineers[0].weeklyComposite;
    expect(buckets.length).toBeGreaterThan(1);
    // Total across the buckets must equal the composite score.
    expect(buckets.reduce((s, v) => s + v, 0)).toBe(
      view.engineers[0].compositeScore,
    );
  });
});
