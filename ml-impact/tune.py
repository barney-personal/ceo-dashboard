"""Final tuning: lock in 'full' time-shape features, sweep regularisation
hyperparameters, report CV ρ vs overfit gap tradeoff. Choose best."""
from __future__ import annotations
import math, re
from pathlib import Path
import numpy as np, pandas as pd
import lightgbm as lgb
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.metrics import mean_absolute_error, r2_score
from scipy.stats import spearmanr
import sys
sys.path.insert(0, str(Path(__file__).parent))
from iterate import load_and_derive, make_X, BASE_NUMERIC, BASE_CATEGORICAL, MONOTONE_PRIORS, RANDOM_STATE


def add_all_extras(df):
    # Round 1
    df["slack_msgs_log"] = np.log1p(df["slack_messages"].fillna(0))
    df["slack_reactions_log"] = np.log1p(df["slack_reactions"].fillna(0))
    # Round 2 (interactions)
    df["tenure_x_level"] = df["tenure_months"] * df["level_num"].fillna(0)
    df["tenure_x_ai"] = df["tenure_months"] * df["ai_tokens_log"]
    df["tenure_x_slack"] = df["tenure_months"] * df["slack_msgs_per_day"]
    # Round 4 (time shape)
    df["pr_gap_days"] = np.where(df["prs_360d"]>0, 365*(1-df["prs_90d"]/df["prs_360d"]), 365).clip(0,365)
    def cv_(r30,r90,r360):
        rates = np.array([r30/30, r90/90, r360/360]); mu = rates.mean()
        return 0 if mu==0 else float(rates.std()/mu)
    df["weekly_pr_cv"] = df.apply(lambda r: cv_(r["prs_30d"],r["prs_90d"],r["prs_360d"]), axis=1)
    df["ramp_slope_first90"] = np.where(df["tenure_months"]>3, df["prs_90d"]/df["tenure_months"], 0)


def evaluate_model(X, y_log, y, model, name, label):
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    y_cv = np.expm1(cross_val_predict(model, X, y_log, cv=kf))
    cv_r2 = r2_score(y, y_cv); cv_rho = spearmanr(y, y_cv).statistic; cv_mae = mean_absolute_error(y, y_cv)
    model.fit(X, y_log); y_tr = np.expm1(model.predict(X)); tr_r2 = r2_score(y, y_tr)
    return {"label": label, "model": name, "n": X.shape[1], "cv_r2": cv_r2, "cv_rho": cv_rho, "cv_mae": cv_mae, "tr_r2": tr_r2, "gap": tr_r2 - cv_r2}


def main():
    df = load_and_derive()
    add_all_extras(df)
    print(f"n={len(df)}\n")

    extra = [
        "slack_msgs_log", "slack_reactions_log",
        "tenure_x_level", "tenure_x_ai", "tenure_x_slack",
        "pr_gap_days", "weekly_pr_cv", "ramp_slope_first90",
    ]
    X = make_X(df, BASE_NUMERIC + extra, BASE_CATEGORICAL)
    y = df["impact_360d"].astype(float).values
    y_log = np.log1p(y)
    mono = [MONOTONE_PRIORS.get(f, 0) for f in X.columns]

    print(f"{'config':<45}{'CV R²':<8}{'CV ρ':<8}{'CV MAE':<9}{'Tr R²':<8}{'Gap':<7}")
    print("-"*90)

    # LightGBM regularisation sweep
    configs = []
    for num_leaves in [4, 8, 15, 31]:
        for min_child in [5, 10, 20, 30]:
            for reg_lambda in [0.5, 2.0, 5.0, 10.0]:
                for lr in [0.02, 0.05]:
                    configs.append({
                        "num_leaves": num_leaves, "min_child_samples": min_child,
                        "reg_lambda": reg_lambda, "learning_rate": lr,
                    })

    rows = []
    for cfg in configs:
        m = lgb.LGBMRegressor(
            n_estimators=500, **cfg,
            monotone_constraints=mono, monotone_constraints_method="advanced",
            random_state=RANDOM_STATE, verbose=-1, n_jobs=-1,
        )
        label = f"lgbm_nl{cfg['num_leaves']}_mc{cfg['min_child_samples']}_rl{cfg['reg_lambda']}_lr{cfg['learning_rate']}"
        r = evaluate_model(X, y_log, y, m, label, "tuned")
        rows.append(r)

    # Also GBM with different max_depth
    for max_depth in [2, 3, 4, 5]:
        for n_est in [200, 300, 500]:
            m = GradientBoostingRegressor(n_estimators=n_est, max_depth=max_depth, learning_rate=0.05, random_state=RANDOM_STATE)
            label = f"gbm_d{max_depth}_n{n_est}"
            r = evaluate_model(X, y_log, y, m, label, "tuned")
            rows.append(r)

    # Sort by CV ρ desc, then by gap asc (smaller gap = less overfit)
    rows.sort(key=lambda r: (-r["cv_rho"], r["gap"]))
    print("\nTop 20 by CV ρ (ties broken by small gap):")
    for r in rows[:20]:
        print(f"{r['model']:<45}{r['cv_r2']:<8.3f}{r['cv_rho']:<8.3f}{r['cv_mae']:<9.0f}{r['tr_r2']:<8.3f}{r['gap']:<7.3f}")

    # Best under gap constraint
    acceptable = [r for r in rows if r["gap"] < 0.30]
    acceptable.sort(key=lambda r: -r["cv_rho"])
    print(f"\nTop 10 with gap < 0.30:")
    for r in acceptable[:10]:
        print(f"{r['model']:<45}{r['cv_r2']:<8.3f}{r['cv_rho']:<8.3f}{r['cv_mae']:<9.0f}{r['tr_r2']:<8.3f}{r['gap']:<7.3f}")

    acceptable_strict = [r for r in rows if r["gap"] < 0.20]
    acceptable_strict.sort(key=lambda r: -r["cv_rho"])
    print(f"\nTop 10 with gap < 0.20 (stricter):")
    for r in acceptable_strict[:10]:
        print(f"{r['model']:<45}{r['cv_r2']:<8.3f}{r['cv_rho']:<8.3f}{r['cv_mae']:<9.0f}{r['tr_r2']:<8.3f}{r['gap']:<7.3f}")


if __name__ == "__main__":
    main()
