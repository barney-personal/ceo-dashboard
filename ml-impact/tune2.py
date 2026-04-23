"""Smaller focused tune: 24 configs only, flush after each row."""
from __future__ import annotations
import sys
import numpy as np
import lightgbm as lgb
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.metrics import mean_absolute_error, r2_score
from scipy.stats import spearmanr
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from iterate import load_and_derive, make_X, BASE_NUMERIC, BASE_CATEGORICAL, MONOTONE_PRIORS, RANDOM_STATE


def add_extras(df):
    df["pr_gap_days"] = np.where(df["prs_360d"]>0, 365*(1-df["prs_90d"]/df["prs_360d"]), 365).clip(0,365)
    def cv_(r30,r90,r360):
        rates = np.array([r30/30, r90/90, r360/360]); mu = rates.mean()
        return 0 if mu==0 else float(rates.std()/mu)
    df["weekly_pr_cv"] = df.apply(lambda r: cv_(r["prs_30d"],r["prs_90d"],r["prs_360d"]), axis=1)
    df["ramp_slope_first90"] = np.where(df["tenure_months"]>3, df["prs_90d"]/df["tenure_months"], 0)


def go():
    df = load_and_derive(); add_extras(df)
    extras = ["pr_gap_days", "weekly_pr_cv", "ramp_slope_first90"]
    X = make_X(df, BASE_NUMERIC + extras, BASE_CATEGORICAL)
    y = df["impact_360d"].astype(float).values
    y_log = np.log1p(y)
    mono = [MONOTONE_PRIORS.get(f, 0) for f in X.columns]
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)

    print(f"n={len(df)}, features={X.shape[1]}", flush=True)
    print(f"{'config':<40}{'CV R²':<8}{'CV ρ':<8}{'CV MAE':<9}{'Tr R²':<8}{'Gap':<7}", flush=True)
    print("-"*80, flush=True)

    # Smaller grid — 18 LightGBM + 4 GBM + 1 RF = 23 configs
    configs = []
    for num_leaves in [4, 8, 15]:
        for min_child in [10, 20]:
            for reg_lambda in [0.5, 2.0, 10.0]:
                configs.append(("lgbm", {"num_leaves": num_leaves, "min_child_samples": min_child, "reg_lambda": reg_lambda, "learning_rate": 0.03}))

    rows = []
    for typ, cfg in configs:
        m = lgb.LGBMRegressor(n_estimators=500, **cfg, monotone_constraints=mono, monotone_constraints_method="advanced", random_state=RANDOM_STATE, verbose=-1, n_jobs=-1)
        y_cv = np.expm1(cross_val_predict(m, X, y_log, cv=kf))
        cv_r2 = r2_score(y, y_cv); cv_rho = spearmanr(y, y_cv).statistic; cv_mae = mean_absolute_error(y, y_cv)
        m.fit(X, y_log); y_tr = np.expm1(m.predict(X))
        tr_r2 = r2_score(y, y_tr)
        label = f"lgbm_nl{cfg['num_leaves']}_mc{cfg['min_child_samples']}_rl{cfg['reg_lambda']}"
        r = {"m": label, "cv_r2": cv_r2, "cv_rho": cv_rho, "cv_mae": cv_mae, "tr_r2": tr_r2, "gap": tr_r2 - cv_r2}
        rows.append(r)
        print(f"{label:<40}{cv_r2:<8.3f}{cv_rho:<8.3f}{cv_mae:<9.0f}{tr_r2:<8.3f}{r['gap']:<7.3f}", flush=True)

    for n_est in [200, 300]:
        for max_depth in [2, 3]:
            m = GradientBoostingRegressor(n_estimators=n_est, max_depth=max_depth, learning_rate=0.05, subsample=0.7, random_state=RANDOM_STATE)
            y_cv = np.expm1(cross_val_predict(m, X, y_log, cv=kf))
            cv_r2 = r2_score(y, y_cv); cv_rho = spearmanr(y, y_cv).statistic; cv_mae = mean_absolute_error(y, y_cv)
            m.fit(X, y_log); y_tr = np.expm1(m.predict(X)); tr_r2 = r2_score(y, y_tr)
            label = f"gbm_d{max_depth}_n{n_est}_ss0.7"
            r = {"m": label, "cv_r2": cv_r2, "cv_rho": cv_rho, "cv_mae": cv_mae, "tr_r2": tr_r2, "gap": tr_r2 - cv_r2}
            rows.append(r)
            print(f"{label:<40}{cv_r2:<8.3f}{cv_rho:<8.3f}{cv_mae:<9.0f}{tr_r2:<8.3f}{r['gap']:<7.3f}", flush=True)

    rows.sort(key=lambda r: (-r["cv_rho"], r["gap"]))
    print("\nTop 5 by CV ρ:", flush=True)
    for r in rows[:5]:
        print(f"  {r['m']:<40}ρ={r['cv_rho']:.3f}  R²={r['cv_r2']:.3f}  gap={r['gap']:.3f}", flush=True)

    under_20 = [r for r in rows if r["gap"] < 0.20]
    if under_20:
        print("\nBest with gap < 0.20:", flush=True)
        under_20.sort(key=lambda r: -r["cv_rho"])
        for r in under_20[:3]:
            print(f"  {r['m']:<40}ρ={r['cv_rho']:.3f}  R²={r['cv_r2']:.3f}  gap={r['gap']:.3f}", flush=True)

    under_30 = [r for r in rows if r["gap"] < 0.30]
    if under_30:
        print("\nBest with gap < 0.30:", flush=True)
        under_30.sort(key=lambda r: -r["cv_rho"])
        for r in under_30[:3]:
            print(f"  {r['m']:<40}ρ={r['cv_rho']:.3f}  R²={r['cv_r2']:.3f}  gap={r['gap']:.3f}", flush=True)


if __name__ == "__main__":
    go()
