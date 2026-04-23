"""Round 4b+5b — isolate leakage and tune the winner carefully."""
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
from iterate import (
    load_and_derive,
    make_X,
    BASE_NUMERIC,
    BASE_CATEGORICAL,
    MONOTONE_PRIORS,
    RANDOM_STATE,
)


def evaluate(df, num, cat, label):
    X = make_X(df, num, cat)
    y = df["impact_360d"].astype(float).values
    y_log = np.log1p(y)
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    out = []
    for name, model in [
        ("gbm", GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05, random_state=RANDOM_STATE)),
        ("rf", RandomForestRegressor(n_estimators=500, min_samples_leaf=2, random_state=RANDOM_STATE, n_jobs=-1)),
        ("lgbm", lgb.LGBMRegressor(n_estimators=500, learning_rate=0.03, num_leaves=15, min_child_samples=5, reg_lambda=1.0, monotone_constraints=[MONOTONE_PRIORS.get(f,0) for f in X.columns], monotone_constraints_method="advanced", random_state=RANDOM_STATE, verbose=-1, n_jobs=-1)),
    ]:
        y_cv = np.expm1(cross_val_predict(model, X, y_log, cv=kf))
        cv_r2 = r2_score(y, y_cv); cv_rho = spearmanr(y, y_cv).statistic; cv_mae = mean_absolute_error(y, y_cv)
        model.fit(X, y_log); y_tr = np.expm1(model.predict(X))
        tr_r2 = r2_score(y, y_tr)
        out.append({"label": label, "model": name, "n": X.shape[1], "cv_r2": cv_r2, "cv_rho": cv_rho, "cv_mae": cv_mae, "tr_r2": tr_r2, "gap": tr_r2 - cv_r2})
    return out


def add_time_shape(df, variant):
    df["pr_gap_days"] = np.where(
        df["prs_360d"] > 0, 365 * (1 - df["prs_90d"] / df["prs_360d"]), 365,
    ).clip(0, 365)
    def cv_(r30, r90, r360):
        rates = np.array([r30/30, r90/90, r360/360]); mu = rates.mean()
        return 0 if mu==0 else float(rates.std()/mu)
    df["weekly_pr_cv"] = df.apply(lambda r: cv_(r["prs_30d"], r["prs_90d"], r["prs_360d"]), axis=1)
    df["ramp_slope_first90"] = np.where(df["tenure_months"] > 3, df["prs_90d"] / df["tenure_months"], 0)

    if variant == "full":
        return ["pr_gap_days", "weekly_pr_cv", "ramp_slope_first90"]
    if variant == "safe":  # drop volume-proxy
        return ["pr_gap_days", "weekly_pr_cv"]
    if variant == "gap_only":
        return ["pr_gap_days"]
    if variant == "cv_only":
        return ["weekly_pr_cv"]
    if variant == "ramp_only":
        return ["ramp_slope_first90"]
    return []


def main():
    df = load_and_derive()
    print(f"n={len(df)}\n")
    print(f"{'variant':<15}{'model':<6}{'n':<5}{'CV R²':<8}{'CV ρ':<8}{'CV MAE':<9}{'Tr R²':<8}{'Gap':<7}")
    print("-"*80)

    variants = ["none", "gap_only", "cv_only", "ramp_only", "safe", "full"]
    rows = []
    for v in variants:
        d = df.copy()
        extra = [] if v == "none" else add_time_shape(d, v)
        for r in evaluate(d, BASE_NUMERIC + extra, BASE_CATEGORICAL, v):
            rows.append(r)
            print(f"{v:<15}{r['model']:<6}{r['n']:<5}{r['cv_r2']:<8.3f}{r['cv_rho']:<8.3f}{r['cv_mae']:<9.0f}{r['tr_r2']:<8.3f}{r['gap']:<7.3f}")
        print()

    print("\n" + "="*80)
    print("LEAKAGE CHECK: is ramp_slope_first90 too correlated with the target?")
    print("="*80)
    d = df.copy(); add_time_shape(d, "full")
    corr_ramp = np.corrcoef(d["ramp_slope_first90"], d["impact_360d"])[0,1]
    corr_gap = np.corrcoef(d["pr_gap_days"], d["impact_360d"])[0,1]
    corr_cv = np.corrcoef(d["weekly_pr_cv"], d["impact_360d"])[0,1]
    print(f"  ramp_slope_first90   vs impact_360d: r = {corr_ramp:+.3f}")
    print(f"  pr_gap_days          vs impact_360d: r = {corr_gap:+.3f}")
    print(f"  weekly_pr_cv         vs impact_360d: r = {corr_cv:+.3f}")


if __name__ == "__main__":
    main()
