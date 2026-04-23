import { describe, it, expect } from "vitest";
import { buildCoachingCard, plainLabelFor } from "../impact-model-coaching";
import type { ImpactEngineerPrediction } from "../impact-model";

function makeEngineer(
  overrides: Partial<ImpactEngineerPrediction> = {},
): ImpactEngineerPrediction {
  return {
    name: "Engineer 001",
    email: "anon-001",
    email_hash: "aaaaaaaaaaaaaaaa",
    discipline: "Engineering",
    pillar: "Core",
    level_label: "L4",
    tenure_months: 18,
    actual: 1000,
    predicted: 900,
    predicted_insample: 950,
    residual: 100,
    slack_msgs_per_day: 5,
    ai_tokens: 10000,
    latest_rating: 4,
    shap_contributions: [],
    ...overrides,
  };
}

describe("plainLabelFor", () => {
  it("maps known features to plain English", () => {
    expect(plainLabelFor("tenure_months")).toBe("How long they've been here");
    expect(plainLabelFor("ai_cost_log")).toBe("Spend on AI tools");
  });

  it("falls back to a humanised name for unknown features", () => {
    expect(plainLabelFor("pillar_money")).toBe("Pillar: money");
    expect(plainLabelFor("something_unknown")).toBe("something unknown");
  });
});

describe("buildCoachingCard", () => {
  it("sorts positive SHAP into strengths and negative actionable SHAP into conversations", () => {
    const engineer = makeEngineer({
      actual: 1200,
      predicted_insample: 1000,
      shap_contributions: [
        { feature: "tenure_months", group: "Tenure", shap: 0.3, pct_multiplier: 35, value: 36 },
        { feature: "ai_n_days", group: "AI usage", shap: -0.2, pct_multiplier: -18, value: 2 },
        { feature: "slack_channel_share", group: "Slack engagement", shap: 0.15, pct_multiplier: 16, value: 0.6 },
        { feature: "pr_size_median", group: "Code style", shap: -0.12, pct_multiplier: -11, value: 250 },
      ],
    });

    const card = buildCoachingCard(engineer);
    expect(card.residualDirection).toBe("above");
    expect(Math.round(card.residualPct)).toBe(20);
    expect(card.strengths.map((s) => s.feature)).toEqual([
      "tenure_months",
      "slack_channel_share",
    ]);
    expect(card.conversations.map((s) => s.feature)).toEqual([
      "ai_n_days",
      "pr_size_median",
    ]);
  });

  it("excludes non-actionable negative features from conversations", () => {
    // Level/discipline/pillar/tenure are context, not things you coach on.
    const engineer = makeEngineer({
      shap_contributions: [
        { feature: "level_num", group: "Level", shap: -0.15, pct_multiplier: -14, value: 3 },
        { feature: "pillar_growth", group: "Pillar", shap: -0.08, pct_multiplier: -7.5, value: 1 },
      ],
    });

    const card = buildCoachingCard(engineer);
    expect(card.conversations).toHaveLength(0);
  });

  it("excludes the aggregate '+N other features' bucket from either list", () => {
    const engineer = makeEngineer({
      shap_contributions: [
        { feature: "ai_n_days", group: "AI usage", shap: -0.2, pct_multiplier: -18, value: 3 },
        { feature: "5_minor_features", group: "Other", shap: -0.5, pct_multiplier: -40, value: null },
        { feature: "tenure_months", group: "Tenure", shap: 0.1, pct_multiplier: 10, value: 24 },
      ],
    });

    const card = buildCoachingCard(engineer);
    expect(card.strengths.find((s) => s.feature === "5_minor_features")).toBeUndefined();
    expect(card.conversations.find((s) => s.feature === "5_minor_features")).toBeUndefined();
    expect(card.conversations.map((s) => s.feature)).toEqual(["ai_n_days"]);
  });

  it("caps strengths and conversations at maxEach", () => {
    const engineer = makeEngineer({
      shap_contributions: Array.from({ length: 10 }).map((_, i) => ({
        feature: `ai_n_days`,
        group: "AI usage",
        shap: -0.1 - i * 0.01,
        pct_multiplier: -10 - i,
        value: 1,
      })),
    });
    const card = buildCoachingCard(engineer, 2);
    expect(card.conversations.length).toBeLessThanOrEqual(2);
  });

  it("flags residual direction correctly for below-prediction engineers", () => {
    const engineer = makeEngineer({
      actual: 700,
      predicted_insample: 1000,
      shap_contributions: [],
    });
    const card = buildCoachingCard(engineer);
    expect(card.residualDirection).toBe("below");
    expect(Math.round(card.residualPct)).toBe(-30);
  });

  it("returns 'on' for residuals within ±5%", () => {
    const engineer = makeEngineer({
      actual: 1020,
      predicted_insample: 1000,
    });
    const card = buildCoachingCard(engineer);
    expect(card.residualDirection).toBe("on");
  });
});
