import modelData from "@/data/impact-model.json";

export interface ImpactFeatureImportance {
  name: string;
  impurity: number;
  permutation_mean: number;
  permutation_std: number;
}

export interface ImpactShapContribution {
  feature: string;
  group: string;
  shap: number;
  pct_multiplier: number;
  value: number | null;
}

export interface ImpactEngineerPrediction {
  name: string;
  email: string;
  email_hash: string;
  discipline: string;
  pillar: string;
  level_label: string;
  tenure_months: number;
  actual: number;
  predicted: number;
  predicted_insample: number;
  residual: number;
  slack_msgs_per_day: number;
  ai_tokens: number;
  latest_rating: number | null;
  shap_contributions: ImpactShapContribution[];
}

export interface ImpactGroupedImportance {
  group: string;
  mean_abs_shap: number;
}

export interface ImpactPartialDependence {
  feature: string;
  label: string;
  group: string;
  grid: number[];
  pdp_mean: number[];
  ice_sample: number[][];
  actual_min: number;
  actual_max: number;
  actual_median: number;
}

export interface ImpactCategoricalEntry {
  category: string;
  n: number;
  mean_predicted: number;
  mean_actual: number;
  vs_baseline_pct: number;
}

export interface ImpactCategoricalEffect {
  label: string;
  baseline: number;
  categories: ImpactCategoricalEntry[];
}

export interface ImpactGroupStat {
  group: string;
  mean: number;
  median: number;
  n: number;
}

export interface ImpactModel {
  generated_at: string;
  n_engineers: number;
  n_features: number;
  chosen_model: string;
  metrics: {
    r2: number;
    mae: number;
    rmse: number;
    spearman: number;
    baseline_r2: number;
    baseline_mae: number;
    baseline_rmse: number;
  };
  model_comparison: Record<string, { r2: number; spearman: number }>;
  target: {
    name: string;
    formula: string;
    mean: number;
    median: number;
    p95: number;
    max: number;
  };
  shap: {
    expected_log: number;
    expected_impact: number;
  };
  grouped_importance: ImpactGroupedImportance[];
  partial_dependence: ImpactPartialDependence[];
  categorical_effects: Record<string, ImpactCategoricalEffect | null>;
  features: ImpactFeatureImportance[];
  engineers: ImpactEngineerPrediction[];
  by_discipline: ImpactGroupStat[];
  by_level_track: ImpactGroupStat[];
  by_pillar: ImpactGroupStat[];
}

export function getImpactModel(): ImpactModel {
  return modelData as ImpactModel;
}
