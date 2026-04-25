import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildComposite,
  rankWithConfidence,
  scopeComposite,
  type CompositeBundle,
  type EngineerCompositeInput,
  type RankedCompositeEntry,
} from "@/lib/data/engineering-composite";
import { hashEmailForRanking } from "@/lib/data/engineering-ranking";
import { StackRankTable } from "../stack-rank-table";

const NOW = new Date("2026-04-24T00:00:00Z");

function engineer(
  overrides: Partial<EngineerCompositeInput> = {},
): EngineerCompositeInput {
  const email = overrides.email ?? "alice@meetcleo.com";
  return {
    emailHash: hashEmailForRanking(email),
    displayName: "Alice",
    email,
    githubLogin: "alice",
    discipline: "BE",
    pillar: "Growth",
    squad: "Daily Plans",
    managerEmail: "ceo@meetcleo.com",
    tenureDays: 365,
    isLeaverOrInactive: false,
    prCount: 20,
    analysedPrCount: 15,
    executionQualityMean: 4,
    testAdequacyMean: 4,
    riskHandlingMean: 4,
    reviewabilityMean: 4,
    technicalDifficultyMean: 3,
    revertRate: 0,
    reviewParticipationRate: 1,
    medianTimeToMergeMinutes: 8 * 60,
    ...overrides,
  };
}

function rankedCohort(): {
  bundle: CompositeBundle;
  ranked: RankedCompositeEntry[];
} {
  const engineers: EngineerCompositeInput[] = [];
  // Build a spread cohort so quartiles are meaningful.
  for (let i = 0; i < 8; i++) {
    const email = `be${i}@meetcleo.com`;
    engineers.push(
      engineer({
        email,
        displayName: `BE ${i}`,
        githubLogin: `be${i}`,
        prCount: 6 + i * 6,
        analysedPrCount: 5 + i * 5,
        executionQualityMean: 2 + i * 0.35,
        testAdequacyMean: 2 + i * 0.35,
        riskHandlingMean: 2 + i * 0.35,
        reviewabilityMean: 2 + i * 0.35,
        revertRate: i < 2 ? 0.3 : 0,
      }),
    );
  }
  const bundle = buildComposite({ now: NOW, engineers });
  const ranked = rankWithConfidence(scopeComposite(bundle, {}));
  return { bundle, ranked };
}

describe("StackRankTable", () => {
  it("renders one row per ranked engineer with rank, name, pillar, and score", () => {
    const { ranked } = rankedCohort();
    render(<StackRankTable ranked={ranked} />);

    expect(screen.getByTestId("stack-rank-table")).toBeInTheDocument();
    for (const entry of ranked) {
      const row = screen.getByTestId(`stack-rank-row-${entry.emailHash}`);
      expect(row).toBeInTheDocument();
      expect(
        within(row).getByText(new RegExp(`^${entry.displayName}$`)),
      ).toBeInTheDocument();
      expect(
        within(row).getByText(new RegExp(`#${entry.displayRank}\\b`)),
      ).toBeInTheDocument();
      expect(row.getAttribute("data-quartile")).toBe(String(entry.quartile));
      expect(row.getAttribute("data-flag")).toBe(entry.quartileFlag ?? "none");
    }
  });

  it("renders an empty state when there are no ranked entries", () => {
    render(<StackRankTable ranked={[]} />);
    expect(
      screen.getByText(/No scored engineers in this cohort yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stack-rank-table")).not.toBeInTheDocument();
  });

  it("expands a row to show falsifiable evidence and signal-level attribution", () => {
    const { ranked } = rankedCohort();
    const target = ranked[0];
    render(<StackRankTable ranked={ranked} />);

    const row = screen.getByTestId(`stack-rank-row-${target.emailHash}`);
    const toggle = within(row).getByRole("button", {
      name: new RegExp(`Expand ${target.displayName}`, "i"),
    });
    fireEvent.click(toggle);

    const drilldown = screen.getByTestId(
      `stack-rank-drilldown-${target.emailHash}`,
    );
    expect(drilldown).toBeInTheDocument();
    expect(
      within(drilldown).getByText(/Why this row\? \(falsifiable evidence\)/i),
    ).toBeInTheDocument();
    expect(
      within(drilldown).getByText(/Signal-level attribution/i),
    ).toBeInTheDocument();
    // Each evidence line from the composite must appear.
    for (const line of target.evidence) {
      expect(within(drilldown).getByText(line)).toBeInTheDocument();
    }
  });

  it("marks members of a multi-entry tie group with a tie badge", () => {
    const identicalInputs: EngineerCompositeInput[] = [];
    for (let i = 0; i < 5; i++) {
      const email = `tie${i}@meetcleo.com`;
      identicalInputs.push(
        engineer({
          email,
          displayName: `TIE ${i}`,
          githubLogin: `tie${i}`,
          prCount: 12,
          analysedPrCount: 10,
          executionQualityMean: 3.5,
          testAdequacyMean: 3.5,
          riskHandlingMean: 3.5,
          reviewabilityMean: 3.5,
        }),
      );
    }
    const bundle = buildComposite({ now: NOW, engineers: identicalInputs });
    const ranked = rankWithConfidence(scopeComposite(bundle, {}));
    render(<StackRankTable ranked={ranked} />);

    const badges = screen.getAllByText(/tied · \d+/i);
    expect(badges.length).toBe(ranked.length);
    // All in the same tie group (identical inputs).
    const firstTieGroup = ranked[0].tieGroupId;
    for (const entry of ranked) {
      expect(entry.tieGroupId).toBe(firstTieGroup);
    }
  });

  it("renders raw within-tie positions (1/N..N/N) so a manager can scan inside a wide tie", () => {
    // Same 5-tie cohort. Each row should carry a raw-position marker that
    // matches its order in the ranked list (the composite already returns
    // raw-score-descending order).
    const identicalInputs: EngineerCompositeInput[] = [];
    for (let i = 0; i < 5; i++) {
      const email = `wt${i}@meetcleo.com`;
      identicalInputs.push(
        engineer({
          email,
          displayName: `WT ${i}`,
          githubLogin: `wt${i}`,
          prCount: 12,
          analysedPrCount: 10,
          executionQualityMean: 3.5,
          testAdequacyMean: 3.5,
          riskHandlingMean: 3.5,
          reviewabilityMean: 3.5,
        }),
      );
    }
    const bundle = buildComposite({ now: NOW, engineers: identicalInputs });
    const ranked = rankWithConfidence(scopeComposite(bundle, {}));
    render(<StackRankTable ranked={ranked} />);

    ranked.forEach((entry, index) => {
      const marker = screen.getByTestId(`within-tie-${entry.emailHash}`);
      expect(marker).toHaveTextContent(`raw ${index + 1}/${ranked.length}`);
    });
  });

  it("does not render a raw within-tie position for non-tied rows", () => {
    // Two clearly separated engineers — one strong, one weak. Confidence
    // bands won't overlap, so they each form their own tie group of one and
    // no raw N/M marker should render.
    const inputs: EngineerCompositeInput[] = [
      engineer({
        email: "strong@meetcleo.com",
        displayName: "Strong",
        githubLogin: "strong",
        prCount: 80,
        analysedPrCount: 70,
        executionQualityMean: 4.8,
        testAdequacyMean: 4.8,
        riskHandlingMean: 4.8,
        reviewabilityMean: 4.8,
      }),
    ];
    for (let i = 0; i < 4; i++) {
      inputs.push(
        engineer({
          email: `weak${i}@meetcleo.com`,
          displayName: `WEAK ${i}`,
          githubLogin: `weak${i}`,
          prCount: 5,
          analysedPrCount: 4,
          executionQualityMean: 1.5 + i * 0.1,
          testAdequacyMean: 1.5,
          riskHandlingMean: 1.5,
          reviewabilityMean: 1.5,
        }),
      );
    }
    const bundle = buildComposite({ now: NOW, engineers: inputs });
    const ranked = rankWithConfidence(scopeComposite(bundle, {}));
    render(<StackRankTable ranked={ranked} />);

    // The strongest engineer is alone in their tie group — no raw position.
    const top = ranked.find((e) => e.displayName === "Strong");
    expect(top).toBeDefined();
    expect(
      screen.queryByTestId(`within-tie-${top!.emailHash}`),
    ).not.toBeInTheDocument();
  });

  it("renders the same competition-style rank label for every member of a tie group", () => {
    // Five engineers with overlapping confidence bands collapse into one tie
    // group. The visible rank must be the same for all five, not `#1, #2, #3,
    // #4, #5` with a tie badge — the badge alone still implies an ordering.
    const identicalInputs: EngineerCompositeInput[] = [];
    for (let i = 0; i < 5; i++) {
      const email = `same${i}@meetcleo.com`;
      identicalInputs.push(
        engineer({
          email,
          displayName: `SAME ${i}`,
          githubLogin: `same${i}`,
          prCount: 12,
          analysedPrCount: 10,
          executionQualityMean: 3.5,
          testAdequacyMean: 3.5,
          riskHandlingMean: 3.5,
          reviewabilityMean: 3.5,
        }),
      );
    }
    const bundle = buildComposite({ now: NOW, engineers: identicalInputs });
    const ranked = rankWithConfidence(scopeComposite(bundle, {}));
    expect(ranked.length).toBe(5);

    render(<StackRankTable ranked={ranked} />);

    const sharedDisplayRank = ranked[0].displayRank;
    // All members of the only tie group share displayRank === 1.
    expect(sharedDisplayRank).toBe(1);
    for (const entry of ranked) {
      expect(entry.displayRank).toBe(sharedDisplayRank);
      const row = screen.getByTestId(`stack-rank-row-${entry.emailHash}`);
      expect(within(row).getByText(/#1\b/)).toBeInTheDocument();
      expect(within(row).queryByText(/#2\b/)).not.toBeInTheDocument();
      expect(within(row).queryByText(/#3\b/)).not.toBeInTheDocument();
    }
    // Visible "#1" labels should appear once per tied row, no other rank
    // numbers should leak out of the table.
    const rankOneLabels = screen.getAllByText(/^#1$/);
    expect(rankOneLabels.length).toBe(5);
    expect(screen.queryByText(/^#2$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^#5$/)).not.toBeInTheDocument();
  });

  it("competition-rank jumps past the tie group size for the next non-tied row", () => {
    // Two engineers tied at the top, then three with strictly higher-quality
    // and well-separated confidence bands so they are NOT in the tie group.
    // Expected displayRanks: [1, 1, 3, 4, 5] — the third row jumps to #3.
    const inputs: EngineerCompositeInput[] = [];
    // Two identical strong engineers (top tie).
    for (let i = 0; i < 2; i++) {
      inputs.push(
        engineer({
          email: `top${i}@meetcleo.com`,
          displayName: `TOP ${i}`,
          githubLogin: `top${i}`,
          prCount: 60,
          analysedPrCount: 50,
          executionQualityMean: 4.8,
          testAdequacyMean: 4.8,
          riskHandlingMean: 4.8,
          reviewabilityMean: 4.8,
          revertRate: 0,
          reviewParticipationRate: 1,
          medianTimeToMergeMinutes: 4 * 60,
        }),
      );
    }
    // Three well-separated lower-quality engineers.
    const tail: Array<Partial<EngineerCompositeInput>> = [
      {
        prCount: 18,
        analysedPrCount: 15,
        executionQualityMean: 3,
        testAdequacyMean: 3,
        riskHandlingMean: 3,
        reviewabilityMean: 3,
        revertRate: 0.1,
      },
      {
        prCount: 10,
        analysedPrCount: 8,
        executionQualityMean: 2.5,
        testAdequacyMean: 2.5,
        riskHandlingMean: 2.5,
        reviewabilityMean: 2.5,
        revertRate: 0.2,
      },
      {
        prCount: 6,
        analysedPrCount: 5,
        executionQualityMean: 2,
        testAdequacyMean: 2,
        riskHandlingMean: 2,
        reviewabilityMean: 2,
        revertRate: 0.3,
      },
    ];
    tail.forEach((spec, i) => {
      inputs.push(
        engineer({
          email: `tail${i}@meetcleo.com`,
          displayName: `TAIL ${i}`,
          githubLogin: `tail${i}`,
          ...spec,
        }),
      );
    });

    const bundle = buildComposite({ now: NOW, engineers: inputs });
    const ranked = rankWithConfidence(scopeComposite(bundle, {}));

    // Sanity: top two share a tie group; the third row is in a different one.
    expect(ranked[0].tieGroupId).toBe(ranked[1].tieGroupId);
    expect(ranked[2].tieGroupId).not.toBe(ranked[0].tieGroupId);

    expect(ranked[0].displayRank).toBe(1);
    expect(ranked[1].displayRank).toBe(1);
    expect(ranked[2].displayRank).toBe(3);

    render(<StackRankTable ranked={ranked} />);

    // No "#2" should be rendered — competition rank skips it after the tie.
    expect(screen.queryByText(/^#2$/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^#1$/).length).toBe(2);
    expect(screen.getByText(/^#3$/)).toBeInTheDocument();

    // Promote/PM flag eligibility must not regress: the top tie spans indices
    // 0,1 — the positional top quartile of a 5-row cohort is index [0,1] (no,
    // ceil(5/4)=2 → top 2 indices 0,1) — so the promote flag stays eligible.
    for (const entry of ranked.slice(0, 2)) {
      if (entry.quartile === 4 && entry.flagEligible) {
        expect(entry.quartileFlag).toBe("promote_candidate");
      }
    }
  });

  it("renders a promote / performance-manage label only when flagEligible is true", () => {
    const { ranked } = rankedCohort();
    for (const entry of ranked) {
      const row = screen.queryByTestId(`stack-rank-row-${entry.emailHash}`);
      if (!row) continue;
      if (
        entry.quartileFlag === "promote_candidate" &&
        entry.flagEligible
      ) {
        expect(within(row).getByText(/Promote candidate/i)).toBeInTheDocument();
      }
      if (
        entry.quartileFlag === "performance_manage" &&
        entry.flagEligible
      ) {
        expect(
          within(row).getByText(/Performance-manage candidate/i),
        ).toBeInTheDocument();
      }
    }
    render(<StackRankTable ranked={ranked} />);

    // Inconclusive-quartile rows: quartile is 1/4 but flag is null or
    // flagEligible is false. These must render the muted "(inconclusive)"
    // variant rather than the bold promote / PM label.
    const inconclusive = ranked.filter(
      (e) =>
        (e.quartile === 1 || e.quartile === 4) &&
        (!e.flagEligible || e.quartileFlag === null),
    );
    for (const entry of inconclusive) {
      const row = screen.getByTestId(`stack-rank-row-${entry.emailHash}`);
      expect(within(row).getByText(/inconclusive/i)).toBeInTheDocument();
      expect(
        within(row).queryByText(/^Promote candidate$/i),
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByText(/^Performance-manage candidate$/i),
      ).not.toBeInTheDocument();
    }
  });

  it("shows partial-window tag on partial_window_scored rows", () => {
    const engineers: EngineerCompositeInput[] = [];
    for (let i = 0; i < 4; i++) {
      const email = `be${i}@meetcleo.com`;
      engineers.push(
        engineer({
          email,
          displayName: `BE ${i}`,
          githubLogin: `be${i}`,
          tenureDays: i === 0 ? 60 : 365,
          prCount: 10,
          analysedPrCount: 8,
        }),
      );
    }
    const bundle = buildComposite({ now: NOW, engineers });
    const ranked = rankWithConfidence(scopeComposite(bundle, {}));
    render(<StackRankTable ranked={ranked} />);

    const partialWindow = ranked.find(
      (e) => e.status === "partial_window_scored",
    );
    expect(partialWindow).toBeDefined();
    const row = screen.getByTestId(
      `stack-rank-row-${partialWindow!.emailHash}`,
    );
    expect(
      within(row).getByText(/partial window — delivery pro-rated/i),
    ).toBeInTheDocument();
  });
});
