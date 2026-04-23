"""
Train a gradient-boosted regressor to predict engineering impact from demographic,
Slack, AI-usage, perf-review, and PR-volume features.

Outputs:
  - model.json: metrics, feature importances (impurity + permutation), predictions
  - per-engineer rows with {actual, predicted, residual, features} for the UI

Usage:
  .venv-ml/bin/python ml-impact/train.py
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

HERE = Path(__file__).parent
CSV_PATH = HERE / "features.csv"
OUT_PATH = HERE / "model.json"

RANDOM_STATE = 42


def impact_score(prs: float, additions: float, deletions: float) -> float:
    """Mirror src/lib/data/engineering-impact.ts impactScore()."""
    if prs <= 0:
        return 0.0
    return round(prs * math.log2(1 + (additions + deletions) / prs))


def classify_level(raw):
    if raw is None or (isinstance(raw, float) and math.isnan(raw)) or not str(raw).strip():
        return ("unknown", None)
    r = str(raw).upper().strip()
    import re
    m = re.match(r"^([A-Z]+)(\d+)$", r)
    if not m:
        return ("Other", None)
    prefix, num = m.group(1), int(m.group(2))
    if prefix == "EM":
        return ("EM", num)
    if prefix == "QE":
        return ("QA", num)
    if prefix in ("EG", "DS", "EXEC"):
        return ("Other", num)
    return ("IC", num)


def classify_discipline(spec, job_title):
    s = str(spec or "").lower()
    j = str(job_title or "").lower()
    if "backend" in s or "backend" in j:
        return "BE"
    if "frontend" in s or "frontend" in j:
        return "FE"
    if "engineering manager" in s or "engineering manager" in j:
        return "EM"
    if "qa" in s or "qa" in j:
        return "QA"
    if "machine learning" in s or "ml " in s or "ml " in j:
        return "ML"
    if "python" in s:
        return "BE"
    if "technical operations" in s:
        return "Ops"
    return "Other"


def clean_pillar(dept):
    if not dept or (isinstance(dept, float) and math.isnan(dept)):
        return "Unknown"
    return str(dept).replace(" Pillar", "").strip()


def main():
    df = pd.read_csv(CSV_PATH)
    print(f"Loaded {len(df)} rows")

    # Target: 360d impact score
    df["impact_360d"] = df.apply(
        lambda r: impact_score(r["prs_360d"], r["add_360d"], r["del_360d"]), axis=1
    )

    # Only engineers who have shipped at least some code (matched to GitHub)
    df = df[df["prs_360d"] > 0].copy()
    print(f"After filtering to engineers with ≥1 PR: {len(df)}")

    # Derive features
    levels = df["level_raw"].apply(classify_level)
    df["level_track"] = levels.apply(lambda x: x[0])
    df["level_num"] = levels.apply(lambda x: x[1])
    df["discipline"] = df.apply(
        lambda r: classify_discipline(r["specialisation"], r["job_title"]), axis=1
    )
    df["pillar"] = df["department"].apply(clean_pillar)
    df["tenure_months"] = df["tenure_days"] / 30.44

    # Slack rates (handle missing / zero window)
    wd = df["slack_window_days"].fillna(0).replace(0, np.nan)
    df["slack_msgs_per_day"] = (df["slack_messages"] / wd).fillna(0)
    df["slack_reactions_per_day"] = (df["slack_reactions"] / wd).fillna(0)
    df["slack_active_day_rate"] = (df["slack_days_active"] / wd).fillna(0)
    df["slack_desktop_share"] = (
        df["slack_days_desktop"] / df["slack_days_active"].replace(0, np.nan)
    ).fillna(0)
    df["slack_channel_share"] = (
        df["slack_msgs_channels"] / df["slack_messages"].replace(0, np.nan)
    ).fillna(0)
    df["slack_days_since_active"] = df["slack_days_since_active"].fillna(365)

    # AI usage — log-transform tokens to tame the long tail
    df["ai_tokens_log"] = np.log1p(df["ai_tokens"].fillna(0))
    df["ai_cost_log"] = np.log1p(df["ai_cost"].fillna(0))
    df["ai_n_days"] = df["ai_n_days"].fillna(0)
    df["ai_max_models"] = df["ai_max_models"].fillna(0)

    # Perf
    df["has_perf_rating"] = df["rating_count"].fillna(0) > 0
    df["avg_rating"] = df["avg_rating"].fillna(df["avg_rating"].median())
    df["latest_rating"] = df["latest_rating"].fillna(df["latest_rating"].median())

    # Numeric
    df["gender"] = df["gender"].fillna("Unknown")
    df["location"] = df["location"].fillna("Unknown")

    # Feature set
    numeric_features = [
        "tenure_months",
        "level_num",
        "slack_msgs_per_day",
        "slack_reactions_per_day",
        "slack_active_day_rate",
        "slack_desktop_share",
        "slack_channel_share",
        "slack_days_since_active",
        "ai_tokens_log",
        "ai_cost_log",
        "ai_n_days",
        "ai_max_models",
        "avg_rating",
        "latest_rating",
        "rating_count",
    ]
    categorical_features = ["level_track", "discipline", "pillar", "gender", "location"]

    # One-hot encode categoricals
    X_cat = pd.get_dummies(df[categorical_features], prefix=categorical_features)
    X_num = df[numeric_features].fillna(0)
    X = pd.concat([X_num, X_cat], axis=1)
    feature_names = list(X.columns)

    y = df["impact_360d"].astype(float).values
    # Log-transform target to reduce skew (impact has a long tail).
    y_log = np.log1p(y)

    print(f"Training on n={len(X)}, features={X.shape[1]}")
    print(f"Target: impact_360d  mean={y.mean():.0f}  median={np.median(y):.0f}  max={y.max():.0f}")

    # Cross-validated predictions for honest performance estimate
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    model_cv = GradientBoostingRegressor(
        n_estimators=300, max_depth=3, learning_rate=0.05, random_state=RANDOM_STATE
    )
    y_pred_log_cv = cross_val_predict(model_cv, X, y_log, cv=kf)
    y_pred_cv = np.expm1(y_pred_log_cv)

    r2_cv = r2_score(y, y_pred_cv)
    mae_cv = mean_absolute_error(y, y_pred_cv)
    rmse_cv = math.sqrt(mean_squared_error(y, y_pred_cv))

    # Spearman rank-correlation (robust to the long tail)
    from scipy.stats import spearmanr
    rho_cv = spearmanr(y, y_pred_cv).statistic

    print(f"\nCross-validated metrics (5-fold):")
    print(f"  R²       = {r2_cv:.3f}")
    print(f"  MAE      = {mae_cv:.0f}")
    print(f"  RMSE     = {rmse_cv:.0f}")
    print(f"  Spearman = {rho_cv:.3f}")

    # Also fit an RF for comparison
    rf = RandomForestRegressor(
        n_estimators=500, max_depth=None, min_samples_leaf=2, random_state=RANDOM_STATE, n_jobs=-1
    )
    y_pred_rf_log = cross_val_predict(rf, X, y_log, cv=kf)
    y_pred_rf = np.expm1(y_pred_rf_log)
    r2_rf = r2_score(y, y_pred_rf)
    rho_rf = spearmanr(y, y_pred_rf).statistic
    print(f"\nRandom Forest: R²={r2_rf:.3f}  Spearman={rho_rf:.3f}")

    # Pick the better model by Spearman (robust to outliers)
    if rho_rf > rho_cv:
        chosen = "random_forest"
        chosen_model = rf
        y_pred_final = y_pred_rf
        r2_final, rho_final = r2_rf, rho_rf
        mae_final = mean_absolute_error(y, y_pred_rf)
        rmse_final = math.sqrt(mean_squared_error(y, y_pred_rf))
    else:
        chosen = "gradient_boosting"
        chosen_model = model_cv
        y_pred_final = y_pred_cv
        r2_final, rho_final, mae_final, rmse_final = r2_cv, rho_cv, mae_cv, rmse_cv
    print(f"\nChosen model: {chosen}")

    # Fit on full data to extract feature importances
    chosen_model.fit(X, y_log)
    impurity_imp = chosen_model.feature_importances_

    print("Computing permutation importance...")
    perm = permutation_importance(
        chosen_model, X, y_log, n_repeats=20, random_state=RANDOM_STATE, n_jobs=-1
    )

    # Baseline: predicting the mean
    baseline_r2 = 0.0
    baseline_mae = mean_absolute_error(y, np.full_like(y, y.mean()))
    baseline_rmse = math.sqrt(mean_squared_error(y, np.full_like(y, y.mean())))

    # Build output JSON
    feats = [
        {
            "name": feature_names[i],
            "impurity": float(impurity_imp[i]),
            "permutation_mean": float(perm.importances_mean[i]),
            "permutation_std": float(perm.importances_std[i]),
        }
        for i in range(len(feature_names))
    ]
    feats.sort(key=lambda f: f["permutation_mean"], reverse=True)

    engineers = []
    for i, (_, r) in enumerate(df.reset_index(drop=True).iterrows()):
        engineers.append(
            {
                "name": r["name"],
                "email": r["email"],
                "discipline": r["discipline"],
                "pillar": r["pillar"],
                "level_label": r["level_raw"] if pd.notna(r["level_raw"]) else "—",
                "tenure_months": round(float(r["tenure_months"]), 1),
                "actual": int(r["impact_360d"]),
                "predicted": int(round(float(y_pred_final[i]))),
                "residual": int(round(float(r["impact_360d"] - y_pred_final[i]))),
                "slack_msgs_per_day": round(float(r["slack_msgs_per_day"]), 2),
                "ai_tokens": int(r["ai_tokens"]),
                "latest_rating": float(r["latest_rating"]) if pd.notna(r["latest_rating"]) else None,
            }
        )

    # Category-level summary: mean impact by discipline / level_track
    def grouped_stats(col):
        g = df.groupby(col)["impact_360d"].agg(["mean", "median", "count"]).reset_index()
        return [
            {"group": str(row[col]), "mean": float(row["mean"]), "median": float(row["median"]), "n": int(row["count"])}
            for _, row in g.iterrows()
            if row["count"] >= 2
        ]

    output = {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "n_engineers": len(df),
        "n_features": len(feature_names),
        "chosen_model": chosen,
        "metrics": {
            "r2": round(r2_final, 4),
            "mae": round(mae_final, 2),
            "rmse": round(rmse_final, 2),
            "spearman": round(rho_final, 4),
            "baseline_r2": round(baseline_r2, 4),
            "baseline_mae": round(baseline_mae, 2),
            "baseline_rmse": round(baseline_rmse, 2),
        },
        "model_comparison": {
            "gradient_boosting": {"r2": round(r2_cv, 4), "spearman": round(rho_cv, 4)},
            "random_forest": {"r2": round(r2_rf, 4), "spearman": round(rho_rf, 4)},
        },
        "target": {
            "name": "impact_360d",
            "formula": "round(prs * log2(1 + (additions + deletions) / prs))",
            "mean": float(y.mean()),
            "median": float(np.median(y)),
            "p95": float(np.percentile(y, 95)),
            "max": float(y.max()),
        },
        "features": feats,
        "engineers": engineers,
        "by_discipline": grouped_stats("discipline"),
        "by_level_track": grouped_stats("level_track"),
        "by_pillar": grouped_stats("pillar"),
    }

    OUT_PATH.write_text(json.dumps(output, indent=2))
    print(f"\nWrote {OUT_PATH}")

    print("\nTop 15 features by permutation importance:")
    for f in feats[:15]:
        bar = "█" * max(1, int(f["permutation_mean"] * 200))
        print(f"  {f['name']:40s} {f['permutation_mean']:+.4f}  {bar}")


if __name__ == "__main__":
    main()
