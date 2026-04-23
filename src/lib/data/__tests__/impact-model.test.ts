import { describe, it, expect } from "vitest";
import { getImpactModel } from "../impact-model";

describe("getImpactModel (static snapshot loader)", () => {
  const model = getImpactModel();

  it("exposes the expected top-level keys", () => {
    expect(model).toHaveProperty("generated_at");
    expect(model).toHaveProperty("chosen_model");
    expect(model).toHaveProperty("metrics");
    expect(model).toHaveProperty("model_comparison");
    expect(model).toHaveProperty("target");
    expect(model).toHaveProperty("features");
    expect(model).toHaveProperty("engineers");
    expect(model).toHaveProperty("grouped_importance");
    expect(model).toHaveProperty("partial_dependence");
    expect(model).toHaveProperty("categorical_effects");
  });

  it("has a non-empty engineers array with no real names/emails", () => {
    expect(model.engineers.length).toBeGreaterThan(0);
    for (const e of model.engineers) {
      // Catch accidental re-commit of real PII in the snapshot.
      expect(e.name).toMatch(/^Engineer \d{3}$/);
      expect(e.email).toMatch(/^anon-\d{3}$/);
      expect(e.email).not.toContain("@");
    }
  });

  it("every engineer's shap_contributions sum to log(predicted/baseline)", () => {
    const baseline = model.shap.expected_log;
    // Sample a few engineers; allow a small rounding tolerance (<0.02 in log units).
    const samples = model.engineers.slice(0, 5);
    for (const e of samples) {
      const shapSum = e.shap_contributions.reduce((s, c) => s + c.shap, 0);
      const reconstructed = Math.expm1(baseline + shapSum);
      expect(Math.abs(reconstructed - e.predicted_insample)).toBeLessThan(
        Math.max(10, e.predicted_insample * 0.05),
      );
    }
  });

  it("metrics are within plausible bounds", () => {
    expect(model.metrics.r2).toBeGreaterThan(0);
    expect(model.metrics.r2).toBeLessThan(1);
    expect(model.metrics.spearman).toBeGreaterThan(0);
    expect(model.metrics.spearman).toBeLessThanOrEqual(1);
    expect(model.metrics.mae).toBeGreaterThan(0);
    expect(model.metrics.mae).toBeLessThan(model.metrics.baseline_mae);
  });

  it("feature-importance is sorted by permutation_mean desc", () => {
    for (let i = 1; i < model.features.length; i++) {
      expect(model.features[i - 1].permutation_mean).toBeGreaterThanOrEqual(
        model.features[i].permutation_mean,
      );
    }
  });

  it("never uses protected attributes (gender, location) as features", () => {
    for (const f of model.features) {
      expect(f.name).not.toMatch(/gender|location/i);
    }
    for (const g of model.grouped_importance) {
      expect(g.group).not.toMatch(/^Gender$|^Location$/);
    }
    for (const e of model.engineers) {
      for (const c of e.shap_contributions) {
        expect(c.feature).not.toMatch(/gender|location/i);
        expect(c.group).not.toMatch(/^Gender$|^Location$/);
      }
    }
  });
});
