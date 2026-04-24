import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/engineering-composite.server", () => ({
  getEngineeringComposite: vi.fn(),
}));

import {
  buildComposite,
  COMPOSITE_METHODOLOGY_ROWS,
  COMPOSITE_METHODOLOGY_SECTIONS,
  COMPOSITE_WEIGHTS,
  type CompositeBundle,
  type EngineerCompositeInput,
} from "@/lib/data/engineering-composite";
import { hashEmailForRanking } from "@/lib/data/engineering-ranking";
import { getEngineeringComposite } from "@/lib/data/engineering-composite.server";
import { ManagerView } from "../manager-view";

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

function buildCohortBundle(): CompositeBundle {
  const engineers: EngineerCompositeInput[] = [];
  for (let i = 0; i < 5; i++) {
    const email = `be${i}@meetcleo.com`;
    engineers.push(
      engineer({
        email,
        displayName: `BE ${i}`,
        githubLogin: `be${i}`,
        prCount: 10 + i * 4,
        analysedPrCount: 8 + i * 3,
        executionQualityMean: 2.5 + i * 0.4,
        testAdequacyMean: 2.5 + i * 0.4,
        riskHandlingMean: 2.5 + i * 0.4,
        reviewabilityMean: 2.5 + i * 0.4,
        managerEmail: i < 2 ? "mgr-alpha@meetcleo.com" : "mgr-beta@meetcleo.com",
      }),
    );
  }
  for (let i = 0; i < 3; i++) {
    const email = `fe${i}@meetcleo.com`;
    engineers.push(
      engineer({
        email,
        displayName: `FE ${i}`,
        githubLogin: `fe${i}`,
        discipline: "FE",
        pillar: "Chat",
        squad: "Autopilot",
        prCount: 12 + i * 2,
        analysedPrCount: 9 + i * 2,
        managerEmail: "mgr-alpha@meetcleo.com",
      }),
    );
  }
  return buildComposite({ now: NOW, engineers });
}

describe("ManagerView", () => {
  it("renders the methodology panel, stack rank table, and coverage line for org scope", async () => {
    const bundle = buildCohortBundle();
    const element = await ManagerView({ scope: "org", bundle });
    render(element);

    expect(screen.getByTestId("engineering-b-manager-view")).toBeInTheDocument();
    expect(screen.getByTestId("engineering-b-methodology")).toBeInTheDocument();
    expect(screen.getByTestId("stack-rank-table")).toBeInTheDocument();

    expect(
      screen.getByText(/Engineering stack rank/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Coverage:/i)).toBeInTheDocument();

    // Methodology panel renders the weight for every signal.
    for (const [, weight] of Object.entries(COMPOSITE_WEIGHTS)) {
      expect(
        screen.getAllByText(new RegExp(`${(weight * 100).toFixed(0)}%`)).length,
      ).toBeGreaterThan(0);
    }
  });

  it("restricts the stack rank to direct reports when scope is directs", async () => {
    const bundle = buildCohortBundle();
    const element = await ManagerView({
      scope: "directs",
      managerEmail: "mgr-alpha@meetcleo.com",
      bundle,
    });
    render(element);

    expect(
      screen.getByText(/Your direct reports — stack rank/i),
    ).toBeInTheDocument();

    // mgr-alpha has BE 0, BE 1, FE 0, FE 1, FE 2 (discipline cohort sizes:
    // BE=2 < min 3 → small_cohort, FE=3 ≥ 3 → scored).
    // We check FE names appear and mgr-beta BEs are absent.
    expect(screen.getByText("FE 0")).toBeInTheDocument();
    expect(screen.queryByText("BE 2")).not.toBeInTheDocument();
    expect(screen.queryByText("BE 3")).not.toBeInTheDocument();
    expect(screen.queryByText("BE 4")).not.toBeInTheDocument();
  });

  it("falls back to an empty stack rank state when there are no scored engineers", async () => {
    const emptyBundle: CompositeBundle = buildComposite({
      now: NOW,
      engineers: [],
    });
    const element = await ManagerView({ scope: "org", bundle: emptyBundle });
    render(element);

    expect(
      screen.getByText(/No scored engineers in this cohort yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stack-rank-table")).not.toBeInTheDocument();
  });

  it("warns when directs scope is requested without a manager email", async () => {
    const bundle = buildCohortBundle();
    const element = await ManagerView({
      scope: "directs",
      managerEmail: null,
      bundle,
    });
    render(element);

    expect(
      screen.getByText(/No direct-reports scope available/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stack-rank-table")).not.toBeInTheDocument();
  });

  it("calls the server loader when no bundle is injected", async () => {
    const bundle = buildCohortBundle();
    vi.mocked(getEngineeringComposite).mockResolvedValueOnce(bundle);

    const element = await ManagerView({ scope: "org" });
    render(element);

    expect(getEngineeringComposite).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("stack-rank-table")).toBeInTheDocument();
  });

  it("renders every canonical methodology row field on the manager panel", async () => {
    const bundle = buildCohortBundle();
    const element = await ManagerView({ scope: "org", bundle });
    render(element);

    const panel = screen.getByTestId("engineering-b-methodology-signals");
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

  it("renders every canonical methodology section on the manager panel", async () => {
    const bundle = buildCohortBundle();
    const element = await ManagerView({ scope: "org", bundle });
    render(element);

    const sections = screen.getByTestId("engineering-b-methodology-sections");
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
