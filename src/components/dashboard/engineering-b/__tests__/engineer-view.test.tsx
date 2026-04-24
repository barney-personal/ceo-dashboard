import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/engineering-composite.server", () => ({
  getEngineeringComposite: vi.fn(),
}));

import {
  buildComposite,
  COMPOSITE_METHODOLOGY_ROWS,
  COMPOSITE_METHODOLOGY_SECTIONS,
  type CompositeBundle,
  type EngineerCompositeInput,
} from "@/lib/data/engineering-composite";
import { hashEmailForRanking } from "@/lib/data/engineering-ranking";
import { getEngineeringComposite } from "@/lib/data/engineering-composite.server";
import { EngineerView } from "../engineer-view";

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
    managerEmail: "mgr@meetcleo.com",
    tenureDays: 365,
    isLeaverOrInactive: false,
    prCount: 14,
    analysedPrCount: 10,
    executionQualityMean: 3.5,
    testAdequacyMean: 3.5,
    riskHandlingMean: 3.5,
    reviewabilityMean: 3.5,
    technicalDifficultyMean: 3,
    revertRate: 0.05,
    reviewParticipationRate: 0.75,
    medianTimeToMergeMinutes: 8 * 60,
    ...overrides,
  };
}

function buildEngineerBundle(): CompositeBundle {
  return buildComposite({
    now: NOW,
    engineers: [
      engineer({
        email: "alice@meetcleo.com",
        emailHash: hashEmailForRanking("alice@meetcleo.com"),
        displayName: "Alice",
        githubLogin: "alice",
        pillar: "Growth",
        squad: "Daily Plans",
        prCount: 8,
        analysedPrCount: 8,
        executionQualityMean: 3.2,
        testAdequacyMean: 3.1,
        riskHandlingMean: 3.2,
        reviewabilityMean: 3.1,
        revertRate: 0.12,
        reviewParticipationRate: 0.5,
        medianTimeToMergeMinutes: 26 * 60,
      }),
      engineer({
        email: "bob@meetcleo.com",
        emailHash: hashEmailForRanking("bob@meetcleo.com"),
        displayName: "Bob",
        githubLogin: "bob",
        pillar: "Growth",
        squad: "Daily Plans",
        prCount: 20,
        analysedPrCount: 16,
        executionQualityMean: 4.5,
        testAdequacyMean: 4.3,
        riskHandlingMean: 4.4,
        reviewabilityMean: 4.2,
        revertRate: 0,
        reviewParticipationRate: 1,
        medianTimeToMergeMinutes: 7 * 60,
      }),
      engineer({
        email: "cara@meetcleo.com",
        emailHash: hashEmailForRanking("cara@meetcleo.com"),
        displayName: "Cara",
        githubLogin: "cara",
        pillar: "Chat",
        squad: "Autopilot",
        prCount: 16,
        analysedPrCount: 12,
        executionQualityMean: 4,
        testAdequacyMean: 4,
        riskHandlingMean: 4,
        reviewabilityMean: 4,
        revertRate: 0.03,
        reviewParticipationRate: 0.92,
        medianTimeToMergeMinutes: 10 * 60,
      }),
      engineer({
        email: "dan@meetcleo.com",
        emailHash: hashEmailForRanking("dan@meetcleo.com"),
        displayName: "Dan",
        githubLogin: "dan",
        pillar: "Chat",
        squad: "Autopilot",
        prCount: 11,
        analysedPrCount: 9,
        executionQualityMean: 3.7,
        testAdequacyMean: 3.8,
        riskHandlingMean: 3.7,
        reviewabilityMean: 3.8,
        revertRate: 0.08,
        reviewParticipationRate: 0.8,
        medianTimeToMergeMinutes: 14 * 60,
      }),
      engineer({
        email: "eve@meetcleo.com",
        emailHash: hashEmailForRanking("eve@meetcleo.com"),
        displayName: "Eve",
        githubLogin: "eve",
        pillar: "Platform",
        squad: "Infrastructure",
        prCount: 10,
        analysedPrCount: 7,
        executionQualityMean: 4.2,
        testAdequacyMean: 4.1,
        riskHandlingMean: 4.1,
        reviewabilityMean: 4.2,
        revertRate: 0,
        reviewParticipationRate: 0.95,
        medianTimeToMergeMinutes: 20 * 60,
      }),
      engineer({
        email: "frank@meetcleo.com",
        emailHash: hashEmailForRanking("frank@meetcleo.com"),
        displayName: "Frank",
        githubLogin: "frank",
        pillar: "Platform",
        squad: "Infrastructure",
        prCount: 9,
        analysedPrCount: 6,
        executionQualityMean: 3.8,
        testAdequacyMean: 3.9,
        riskHandlingMean: 3.8,
        reviewabilityMean: 3.9,
        revertRate: 0.04,
        reviewParticipationRate: 0.85,
        medianTimeToMergeMinutes: 22 * 60,
      }),
    ],
  });
}

describe("EngineerView", () => {
  it("renders the viewer's own org, pillar, and squad percentile bands", async () => {
    const bundle = buildEngineerBundle();
    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
      bundle,
    });
    render(element);

    expect(screen.getByTestId("engineering-b-engineer-view")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("All scored engineers")).toBeInTheDocument();
    expect(screen.getByText("Your pillar cohort")).toBeInTheDocument();
    expect(screen.getByText("Your squad cohort")).toBeInTheDocument();
    expect(screen.getByText(/Growth pillar/)).toBeInTheDocument();
    expect(screen.getByText(/Daily Plans squad/)).toBeInTheDocument();
    expect(screen.getAllByText(/percentile band/i).length).toBeGreaterThan(2);
  });

  it("renders 2-4 concrete takeaways grounded in the viewer's evidence", async () => {
    const bundle = buildEngineerBundle();
    const alice = bundle.entries.find((entry) => entry.displayName === "Alice");
    expect(alice).toBeDefined();

    const element = await EngineerView({
      viewerEmailHash: hashEmailForRanking("alice@meetcleo.com"),
      bundle,
    });
    render(element);

    const takeaways = screen.getAllByTestId("engineer-takeaway");
    expect(takeaways.length).toBeGreaterThanOrEqual(2);
    expect(takeaways.length).toBeLessThanOrEqual(4);
    expect(screen.getByText(/What would move your band most/i)).toBeInTheDocument();
    const renderedText = document.body.textContent ?? "";
    expect(alice!.evidence.some((line) => renderedText.includes(line))).toBe(
      true,
    );
    expect(screen.getAllByText(/effective weight/i).length).toBeGreaterThan(0);
  });

  it("shows squad and pillar aggregate competition without other engineer identities", async () => {
    const bundle = buildEngineerBundle();
    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
      bundle,
    });
    const { container } = render(element);

    expect(screen.getByText(/Squad aggregate position/i)).toBeInTheDocument();
    expect(screen.getByText(/Pillar aggregate position/i)).toBeInTheDocument();
    expect(screen.getAllByText("Daily Plans").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Growth").length).toBeGreaterThan(0);
    expect(screen.getByText("Autopilot")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();

    for (const otherName of ["Bob", "Cara", "Dan", "Eve", "Frank"]) {
      expect(screen.queryByText(otherName)).not.toBeInTheDocument();
    }

    // No stack-rank table rendered (the leakage shape we actually care about).
    expect(screen.queryByTestId("stack-rank-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("engineering-b-manager-view")).not.toBeInTheDocument();

    // No promote/PM candidate badge rendered against any individual row.
    // The methodology section may legitimately mention the rule names; those
    // are not data leakage. We assert the badge text shapes are absent.
    expect(
      screen.queryByText(/promote candidate/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/performance-manage candidate/i),
    ).not.toBeInTheDocument();

    const html = container.textContent ?? "";
    expect(html).not.toMatch(/stack rank table/i);
  });

  it("does not render individual composite scores for the viewer or peers", async () => {
    const bundle = buildEngineerBundle();
    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
      bundle,
    });
    const { container } = render(element);
    const html = container.textContent ?? "";

    for (const entry of bundle.scored) {
      expect(entry.score).not.toBeNull();
      expect(html).not.toContain(entry.score!.toFixed(1));
    }
  });

  it("falls back safely when the viewer has no matching composite row", async () => {
    const bundle = buildEngineerBundle();
    const element = await EngineerView({
      viewerEmailHash: "deadbeef",
      bundle,
    });
    render(element);

    expect(screen.getByText(/No engineer identity available/i)).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("renders the viewer's unscored reason without falling back to a cohort table", async () => {
    const bundle = buildComposite({
      now: NOW,
      engineers: [
        engineer({
          email: "alice@meetcleo.com",
          emailHash: hashEmailForRanking("alice@meetcleo.com"),
          displayName: "Alice",
          githubLogin: "alice",
          tenureDays: 12,
        }),
        engineer({
          email: "bob@meetcleo.com",
          emailHash: hashEmailForRanking("bob@meetcleo.com"),
          displayName: "Bob",
          githubLogin: "bob",
        }),
        engineer({
          email: "cara@meetcleo.com",
          emailHash: hashEmailForRanking("cara@meetcleo.com"),
          displayName: "Cara",
          githubLogin: "cara",
        }),
      ],
    });

    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
      bundle,
    });
    render(element);

    expect(screen.getByText(/Alice is not scored yet/i)).toBeInTheDocument();
    // Multiple panels mention "tenure < 30d" (unscored reason and methodology
    // coverage rules). The unscored reason text is the one we care about —
    // assert the count is positive rather than singular.
    expect(screen.getAllByText(/Tenure < 30d/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Cara")).not.toBeInTheDocument();
  });

  it("calls the server loader when no bundle is injected", async () => {
    const bundle = buildEngineerBundle();
    vi.mocked(getEngineeringComposite).mockResolvedValueOnce(bundle);

    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
    });
    render(element);

    expect(getEngineeringComposite).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("engineering-b-engineer-view")).toBeInTheDocument();
  });

  it("keeps group rows aggregate-only", async () => {
    const bundle = buildEngineerBundle();
    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
      bundle,
    });
    render(element);

    const squadGroup = screen.getByTestId(
      "engineer-group-squad-Daily Plans",
    );
    expect(within(squadGroup).getByText("your squad")).toBeInTheDocument();
    expect(within(squadGroup).queryByText("Alice")).not.toBeInTheDocument();
    expect(within(squadGroup).queryByText("Bob")).not.toBeInTheDocument();
  });

  it("renders every canonical methodology row field on the engineer panel", async () => {
    const bundle = buildEngineerBundle();
    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
      bundle,
    });
    render(element);

    const panel = screen.getByTestId("engineering-b-engineer-methodology-signals");
    for (const row of COMPOSITE_METHODOLOGY_ROWS) {
      const card = panel.querySelector(`[data-methodology-signal="${row.key}"]`);
      expect(card).not.toBeNull();
      const text = card!.textContent ?? "";
      expect(text).toContain(row.label);
      expect(text).toContain(row.description);
      expect(text).toContain(row.normalizationRule);
      expect(text).toContain(row.minimumSampleRule);
      expect(text).toContain(row.knownLimitations);
    }
  });

  it("renders every canonical methodology section on the engineer panel", async () => {
    const bundle = buildEngineerBundle();
    const element = await EngineerView({
      viewerEmail: "alice@meetcleo.com",
      bundle,
    });
    render(element);

    const sections = screen.getByTestId(
      "engineering-b-engineer-methodology-sections",
    );
    for (const section of COMPOSITE_METHODOLOGY_SECTIONS) {
      const card = sections.querySelector(
        `[data-methodology-section="${section.title}"]`,
      );
      expect(card).not.toBeNull();
      const text = card!.textContent ?? "";
      expect(text).toContain(section.title);
      expect(text).toContain(section.body);
    }
  });
});
