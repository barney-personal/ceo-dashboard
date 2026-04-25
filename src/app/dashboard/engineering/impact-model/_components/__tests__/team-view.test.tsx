import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { TeamView } from "../team-view";
import type { TeamView as TeamViewData } from "@/lib/data/impact-model.server";
import type { ImpactEngineerPrediction } from "@/lib/data/impact-model";

function makeEngineer(
  overrides: Partial<ImpactEngineerPrediction> = {},
): ImpactEngineerPrediction {
  return {
    name: "Alice Ng",
    email: "a1@meetcleo.com",
    discipline: "Engineering",
    pillar: "Core",
    level_label: "L4",
    tenure_months: 18,
    actual: 1200,
    predicted: 1100,
    predicted_insample: 1100,
    residual: 100,
    slack_msgs_per_day: 5,
    ai_tokens: 10000,
    latest_rating: 4,
    shap_contributions: [
      { feature: "tenure_months", group: "Tenure", shap: 0.3, pct_multiplier: 35, value: 36 },
      { feature: "ai_n_days", group: "AI usage", shap: -0.2, pct_multiplier: -18, value: 2 },
      { feature: "pr_size_median", group: "Code style", shap: -0.12, pct_multiplier: -11, value: 300 },
    ],
    ...overrides,
  };
}

function makeTeam(): TeamViewData {
  return {
    managerEmail: "mgr@example.com",
    managerName: "Manager Manny",
    entries: [
      {
        report: {
          email: "alice@example.com",
          name: "Alice Ng",
          jobTitle: "Senior Engineer",
          function: "Engineering",
          pillar: "Core",
          squad: null,
          startDate: null,
          level: "L4",
        },
        engineer: makeEngineer(),
        coaching: {
          residualPct: 9.09,
          residualDirection: "above",
          strengths: [
            {
              feature: "tenure_months",
              label: "How long they've been here",
              group: "Tenure",
              shap: 0.3,
              pctMultiplier: 35,
              value: 36,
              headline: "How long they've been here",
              detail: "36 months of tenure — deep context and relationships.",
            },
          ],
          conversations: [
            {
              feature: "ai_n_days",
              label: "Days per month using AI",
              group: "AI usage",
              shap: -0.2,
              pctMultiplier: -18,
              value: 2,
              headline: "Days per month using AI",
              detail:
                "Uses AI only ~2 days/month. Daily-use engineers predict higher impact — worth exploring whether the tools fit their workflow.",
            },
          ],
        },
      },
    ],
    reportsNotInModel: [
      {
        email: "bob@example.com",
        name: "Bob Recent",
        jobTitle: "Engineer",
        function: "Engineering",
        pillar: "Core",
        squad: null,
        startDate: null,
        level: "L3",
      },
    ],
    expectedImpact: 900,
    teamMedianPredicted: 1100,
  };
}

describe("<TeamView />", () => {
  it("renders a row per engineer and reveals coaching detail on expand", () => {
    const team = makeTeam();
    render(
      <TeamView
        team={team}
        canPickAnyManager={false}
        allManagers={[]}
        isViewerOwnTeam={true}
      />,
    );
    expect(screen.getByText("Your team")).toBeInTheDocument();
    expect(screen.getByText("Alice Ng")).toBeInTheDocument();
    // Residual badge rendered in summary
    expect(screen.getByText(/9% above prediction/)).toBeInTheDocument();

    // Detail hidden until expand
    expect(screen.queryByText(/worth exploring whether/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Alice Ng/ }));
    expect(screen.getByText(/worth exploring whether/i)).toBeInTheDocument();
    expect(screen.getByText(/deep context and relationships/i)).toBeInTheDocument();
    expect(screen.getByText("Strengths")).toBeInTheDocument();
    expect(screen.getByText("Worth a conversation")).toBeInTheDocument();
  });

  it("lists reports not in the model separately", () => {
    render(
      <TeamView
        team={makeTeam()}
        canPickAnyManager={false}
        allManagers={[]}
        isViewerOwnTeam={true}
      />,
    );
    expect(screen.getByText(/Bob Recent/)).toBeInTheDocument();
    expect(screen.getByText(/Not in the model/i)).toBeInTheDocument();
  });

  it("shows the manager picker for leadership+ viewers", () => {
    render(
      <TeamView
        team={makeTeam()}
        canPickAnyManager={true}
        allManagers={[
          { email: "mgr@example.com", name: "Manager Manny", directReports: 4, jobTitle: "EM" },
          { email: "other@example.com", name: "Another Manager", directReports: 3, jobTitle: null },
        ]}
        isViewerOwnTeam={false}
      />,
    );
    expect(screen.getByText(/Manager Manny's team/)).toBeInTheDocument();
    expect(screen.getByText(/Viewing manager/)).toBeInTheDocument();
  });
});
