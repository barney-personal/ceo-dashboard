import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
    prCount: 6,
    distinctRepos: 2,
    medianComplexity: 3,
    medianQuality: 4,
    maxComplexity: 5,
    compositeScore: 72,
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
        complexity: 4,
        quality: 4,
        category: "feature",
        summary: "Add the feature foo that does X",
        caveats: ["Primarily test file changes"],
        standout: "notably_high_quality",
        githubUrl: "https://github.com/acme/api/pull/42",
      },
    ],
    prevPrCount: 4,
    prevCompositeScore: 48,
    weeklyComposite: [10, 20, 42],
    ...overrides,
  };
}

function makeView(engineers: EngineerRollup[], low: EngineerRollup[] = []): CodeReviewView {
  return {
    windowDays: 30,
    rubricVersion: "v1.0",
    analysedAtLatest: new Date("2026-04-23T12:00:00Z"),
    engineers,
    lowEvidenceEngineers: low,
    totalPrs: engineers.reduce((s, e) => s + e.prCount, 0),
  };
}

describe("<CodeReviewReport />", () => {
  it("renders an engineer row with composite + delta + flags", () => {
    render(
      <CodeReviewReport
        view={makeView([
          makeRollup({ flags: ["has_concerning_pr", "low_volume_high_complexity"] }),
        ])}
      />,
    );
    expect(screen.getByText("Alice A")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    // Prev 48, now 72 → +24. Displayed with a + sign.
    expect(screen.getByText(/\+24/)).toBeInTheDocument();
    // Flag labels render.
    expect(screen.getByText("Has a concerning PR")).toBeInTheDocument();
  });

  it("opens the drawer with PR detail on row click", () => {
    render(<CodeReviewReport view={makeView([makeRollup()])} />);
    // Drawer isn't in the DOM until a row is clicked.
    expect(screen.queryByText(/Add the feature foo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Alice A"));
    expect(screen.getByText(/Add the feature foo/)).toBeInTheDocument();
    expect(screen.getByText(/Primarily test file changes/)).toBeInTheDocument();
    expect(screen.getByText(/Notably high quality/)).toBeInTheDocument();
  });

  it("renders the calibration banner above the table", () => {
    render(<CodeReviewReport view={makeView([makeRollup()])} />);
    expect(screen.getByText(/Calibration input, not a verdict/)).toBeInTheDocument();
  });

  it("filters to engineers that match the selected diagnostic flag", () => {
    render(
      <CodeReviewReport
        view={makeView([
          makeRollup({ authorLogin: "alice", employeeName: "Alice A", flags: ["high_volume_low_quality"] }),
          makeRollup({ authorLogin: "bob", employeeName: "Bob B", flags: [] }),
        ])}
      />,
    );
    expect(screen.getByText("Bob B")).toBeInTheDocument();
    // Click the filter pill.
    fireEvent.click(screen.getByRole("button", { name: /High volume, low quality/ }));
    expect(screen.queryByText("Bob B")).not.toBeInTheDocument();
    expect(screen.getByText("Alice A")).toBeInTheDocument();
  });

  it("shows the low-evidence expander when engineers have <3 PRs", () => {
    render(
      <CodeReviewReport
        view={makeView(
          [makeRollup()],
          [makeRollup({ authorLogin: "carol", employeeName: "Carol C", prCount: 1, flags: ["low_evidence"] })],
        )}
      />,
    );
    expect(screen.getByText(/1 engineer with under 3 PRs/)).toBeInTheDocument();
    expect(screen.getByText("Carol C")).toBeInTheDocument();
  });
});
