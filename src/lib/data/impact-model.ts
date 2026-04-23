import modelData from "@/data/impact-model.json";

export interface ImpactFeatureImportance {
  name: string;
  impurity: number;
  permutation_mean: number;
  permutation_std: number;
}

export interface ImpactEngineerPrediction {
  name: string;
  email: string;
  discipline: string;
  pillar: string;
  level_label: string;
  tenure_months: number;
  actual: number;
  predicted: number;
  residual: number;
  slack_msgs_per_day: number;
  ai_tokens: number;
  latest_rating: number | null;
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
  model_comparison: {
    gradient_boosting: { r2: number; spearman: number };
    random_forest: { r2: number; spearman: number };
  };
  target: {
    name: string;
    formula: string;
    mean: number;
    median: number;
    p95: number;
    max: number;
  };
  features: ImpactFeatureImportance[];
  engineers: ImpactEngineerPrediction[];
  by_discipline: ImpactGroupStat[];
  by_level_track: ImpactGroupStat[];
  by_pillar: ImpactGroupStat[];
}

export function getImpactModel(): ImpactModel {
  return modelData as ImpactModel;
}
