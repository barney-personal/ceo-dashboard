import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CodeReviewReport } from "../code-review-report";
import type { CodeReviewView, EngineerRollup } from "@/lib/data/code-review";

function makeRollup(overrides: Partial<EngineerRollup> = {}): EngineerRollup {
  return {
    authorLogin: "alice",
    employeeName: "Alice A",
    employeeEmail: "alice@example.com",
    isBot: false,
    cohort: "backend",
    prCount: 6,
    effectivePrCount: 5.1,
    confidencePct: 64,
    distinctRepos: 2,
    avgTechnicalDifficulty: 3.5,
    avgExecutionQuality: 4.1,
    avgTestAdequacy: 3.8,
    avgRiskHandling: 3.9,
    avgReviewability: 4.0,
    avgOutcomeScore: 82,
    qualityPercentile: 88,
    difficultyPercentile: 72,
    reliabilityPercentile: 79,
    reviewHealthPercentile: 80,
    throughputPercentile: 67,
    rawScore: 81,
    finalScore: 72,
    categoryCounts: {
      bug_fix: 1,
      feature: 2,
      refactor: 1,
      infra: 0,
      test: 1,
      docs: 0,
      chore: 1,
    },
    flags: [],
    prs: [
      {
        repo: "acme/api",
        prNumber: 42,
        mergedAt: new Date("2026-04-20T10:00:00Z"),
        technicalDifficulty: 4,
        executionQuality: 4,
        testAdequacy: 4,
        riskHandling: 4,
        reviewability: 4,
        analysisConfidencePct: 82,
        category: "feature",
        summary: "Add the feature foo that does X",
        caveats: ["Primarily test file changes"],
        standout: "notably_high_quality",
        primarySurface: "backend",
        approvalCount: 1,
        changeRequestCount: 0,
        reviewCommentCount: 1,
        conversationCommentCount: 0,
        reviewRounds: 1,
        timeToFirstReviewMinutes: 60,
        timeToMergeMinutes: 240,
        commitCount: 2,
        commitsAfterFirstReview: 0,
        revertWithin14d: false,
        outcomeScore: 84,
        reviewProvider: "anthropic",
        reviewModel: "claude-opus-4-7",
        secondOpinionUsed: true,
        agreementLevel: "confirmed",
        secondOpinionReasons: ["low_confidence"],
        qualityScore: 80,
        reviewHealthScore: 82,
        prScore: 76,
        recencyWeight: 0.9,
        githubUrl: "https://github.com/acme/api/pull/42",
        secondLookReasons: [],
      },
    ],
    prevFinalScore: 48,
    weeklyScore: [10, 20, 42],
    reviewChurnResidual: 0,
    ...overrides,
  };
}

function makeView(engineers: EngineerRollup[]): CodeReviewView {
  return {
    windowDays: 90,
    rubricVersion: "v2.0-dual-review",
    analysedAtLatest: new Date("2026-04-23T12:00:00Z"),
    engineers,
    totalPrs: engineers.reduce((sum, engineer) => sum + engineer.prCount, 0),
  };
}

describe("<CodeReviewReport />", () => {
  it("renders an engineer row with final score, confidence, and flags", () => {
    render(
      <CodeReviewReport
        view={makeView([
          makeRollup({ flags: ["has_concerning_pr", "review_churn_high"] }),
        ])}
      />,
    );
    expect(screen.getByText("Alice A")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getAllByText("72").length).toBeGreaterThan(0);
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("PR worth a second look")).toBeInTheDocument();
  });

  it("opens the drawer with PR detail on row click", () => {
    render(<CodeReviewReport view={makeView([makeRollup()])} />);
    expect(screen.queryByText(/Add the feature foo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Alice A"));
    expect(screen.getAllByText(/Add the feature foo/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Primarily test file changes/)).toBeInTheDocument();
    expect(screen.getByText(/Second opinion agreed/)).toBeInTheDocument();
    expect(screen.getByText(/Worth celebrating/)).toBeInTheDocument();
  });

  it("renders the reassurance banner above the table", () => {
    render(<CodeReviewReport view={makeView([makeRollup()])} />);
    expect(screen.getByText(/How to read this fairly/)).toBeInTheDocument();
  });

  it("filters to engineers that match the selected conversation starter", () => {
    render(
      <CodeReviewReport
        view={makeView([
          makeRollup({
            authorLogin: "alice",
            employeeName: "Alice A",
            flags: ["review_churn_high"],
          }),
          makeRollup({
            authorLogin: "bob",
            employeeName: "Bob B",
            flags: [],
          }),
        ])}
      />,
    );

    expect(screen.getByText("Bob B")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Lots of review back-and-forth/ }),
    );
    expect(screen.queryByText("Bob B")).not.toBeInTheDocument();
    expect(screen.getByText("Alice A")).toBeInTheDocument();
  });
});
