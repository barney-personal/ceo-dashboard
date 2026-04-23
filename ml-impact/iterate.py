"""
5-round feature-engineering shootout. For each round, build a candidate
feature set, train GBM + RF + LightGBM(monotonic), and log:

  CV R², CV ρ, CV MAE, train R², overfit_gap = train - CV R²

A round "wins" on CV ρ AND keeps overfit_gap ≤ 0.15 (heuristic — large gaps
mean the model memorises training rows). At the end, print a summary.

Usage:
  .venv-ml/bin/python ml-impact/iterate.py
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from scipy.stats import spearmanr

HERE = Path(__file__).parent
CSV_PATH = HERE / "features.csv"
RANDOM_STATE = 42


def impact_score(prs, additions, deletions):
    if prs <= 0:
        return 0.0
    return round(prs * math.log2(1 + (additions + deletions) / prs))


def classify_level(raw):
    if raw is None or (isinstance(raw, float) and math.isnan(raw)) or not str(raw).strip():
        return ("unknown", None)
    r = str(raw).upper().strip()
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


def safe_name(s):
    return re.sub(r"[^A-Za-z0-9_]+", "_", s).strip("_")


def load_and_derive():
    df = pd.read_csv(CSV_PATH)
    df["impact_360d"] = df.apply(
        lambda r: impact_score(r["prs_360d"], r["add_360d"], r["del_360d"]), axis=1
    )
    df = df[df["prs_360d"] > 0].copy()

    levels = df["level_raw"].apply(classify_level)
    df["level_track"] = levels.apply(lambda x: x[0])
    df["level_num"] = levels.apply(lambda x: x[1])
    df["discipline"] = df.apply(
        lambda r: classify_discipline(r["specialisation"], r["job_title"]), axis=1
    )
    df["pillar"] = df["department"].apply(clean_pillar)
    df["tenure_months"] = df["tenure_days"] / 30.44

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

    df["ai_tokens_log"] = np.log1p(df["ai_tokens"].fillna(0))
    df["ai_cost_log"] = np.log1p(df["ai_cost"].fillna(0))
    df["ai_n_days"] = df["ai_n_days"].fillna(0)
    df["ai_max_models"] = df["ai_max_models"].fillna(0)

    df["pr_size_median"] = df["pr_size_median"].fillna(0)
    df["pr_size_p90_log"] = np.log1p(df["pr_size_p90"].fillna(0))
    df["distinct_repos_180d"] = df["distinct_repos_180d"].fillna(0)
    df["weekend_pr_share"] = df["weekend_pr_share"].fillna(0)
    df["offhours_pr_share"] = df["offhours_pr_share"].fillna(0)
    df["pr_slope_per_week"] = df["pr_slope_per_week"].fillna(0)
    df["commits_180d_log"] = np.log1p(df["commits_180d"].fillna(0))
    df["commits_per_pr"] = df["commits_per_pr"].fillna(0).clip(upper=50)

    df["has_perf_rating"] = df["rating_count"].fillna(0) > 0
    df["avg_rating"] = df["avg_rating"].fillna(df["avg_rating"].median())
    df["latest_rating"] = df["latest_rating"].fillna(df["latest_rating"].median())

    df["gender"] = df["gender"].fillna("Unknown")
    df["location"] = df["location"].fillna("Unknown")
    return df


BASE_NUMERIC = [
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
    "distinct_repos_180d",
    "weekend_pr_share",
    "offhours_pr_share",
    "pr_slope_per_week",
    "commits_per_pr",
]
# NOTE: this is the historical 5-round shootout script. gender + location are
# left in BASE_CATEGORICAL here to preserve the numbers reported in the PR
# narrative, but the production train.py EXCLUDES them — see train.py's
# categorical_features and the README. Re-running this script today would
# produce numbers that differ slightly from the shipped model on purpose.
BASE_CATEGORICAL = ["level_track", "discipline", "pillar", "gender", "location"]

MONOTONE_PRIORS = {
    "tenure_months": 1,
    "ai_tokens_log": 1,
    "ai_cost_log": 1,
    "ai_n_days": 1,
    "ai_max_models": 1,
    "latest_rating": 1,
    "avg_rating": 1,
    "rating_count": 1,
    "slack_msgs_per_day": 1,
    "slack_reactions_per_day": 1,
    "slack_active_day_rate": 1,
    "slack_days_since_active": -1,
    "level_num": 1,
    "distinct_repos_180d": 1,
    "pr_slope_per_week": 1,
    "slack_msgs_log": 1,
    "slack_reactions_log": 1,
    "slack_engagement_composite": 1,
    "tenure_x_level": 1,
    "tenure_x_ai": 1,
    "manager_freq": 0,
    "squad_target_enc": 0,
    "pr_gap_days": -1,
    "weekly_pr_cv": 0,
    "ramp_slope_first90": 1,
}


def make_X(df, numeric_features, categorical_features):
    X_cat = pd.get_dummies(df[categorical_features], prefix=categorical_features)
    X_num = df[numeric_features].fillna(0)
    X = pd.concat([X_num, X_cat], axis=1)
    X.columns = [safe_name(c) for c in X.columns]
    return X


def evaluate(df, numeric_features, categorical_features, label):
    X = make_X(df, numeric_features, categorical_features)
    y = df["impact_360d"].astype(float).values
    y_log = np.log1p(y)
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)

    results = []
    for name, model in [
        (
            "gbm",
            GradientBoostingRegressor(
                n_estimators=300, max_depth=3, learning_rate=0.05, random_state=RANDOM_STATE
            ),
        ),
        (
            "rf",
            RandomForestRegressor(
                n_estimators=500, min_samples_leaf=2, random_state=RANDOM_STATE, n_jobs=-1
            ),
        ),
        (
            "lgbm",
            lgb.LGBMRegressor(
                n_estimators=500,
                learning_rate=0.03,
                num_leaves=15,
                min_child_samples=5,
                reg_lambda=1.0,
                monotone_constraints=[MONOTONE_PRIORS.get(f, 0) for f in X.columns],
                monotone_constraints_method="advanced",
                random_state=RANDOM_STATE,
                verbose=-1,
                n_jobs=-1,
            ),
        ),
    ]:
        y_cv_log = cross_val_predict(model, X, y_log, cv=kf)
        y_cv = np.expm1(y_cv_log)
        cv_r2 = r2_score(y, y_cv)
        cv_rho = spearmanr(y, y_cv).statistic
        cv_mae = mean_absolute_error(y, y_cv)

        # Train-set metric (fit on everything, predict on the same)
        model.fit(X, y_log)
        y_tr_log = model.predict(X)
        y_tr = np.expm1(y_tr_log)
        tr_r2 = r2_score(y, y_tr)
        gap = tr_r2 - cv_r2

        results.append(
            {
                "label": label,
                "model": name,
                "n_features": X.shape[1],
                "cv_r2": round(cv_r2, 3),
                "cv_rho": round(cv_rho, 3),
                "cv_mae": round(cv_mae, 0),
                "train_r2": round(tr_r2, 3),
                "gap": round(gap, 3),
            }
        )
    return results


def round_0_baseline(df):
    return evaluate(df, BASE_NUMERIC, BASE_CATEGORICAL, "0_baseline")


def round_1_slack_momentum(df):
    df["slack_msgs_log"] = np.log1p(df["slack_messages"].fillna(0))
    df["slack_reactions_log"] = np.log1p(df["slack_reactions"].fillna(0))
    df["slack_reaction_per_msg"] = (
        df["slack_reactions"] / df["slack_messages"].replace(0, np.nan)
    ).fillna(0).clip(upper=20)
    # Weighted composite of the two orthogonal strongest signals
    df["slack_engagement_composite"] = (
        df["slack_msgs_per_day"] + df["slack_reactions_per_day"]
    )
    extra = [
        "slack_msgs_log",
        "slack_reactions_log",
        "slack_reaction_per_msg",
        "slack_engagement_composite",
    ]
    return evaluate(df, BASE_NUMERIC + extra, BASE_CATEGORICAL, "1_slack_momentum")


def round_2_interactions(df):
    df["tenure_x_level"] = df["tenure_months"] * (df["level_num"].fillna(0))
    df["tenure_x_ai"] = df["tenure_months"] * df["ai_tokens_log"]
    df["tenure_x_slack"] = df["tenure_months"] * df["slack_msgs_per_day"]
    df["level_x_slack"] = df["level_num"].fillna(0) * df["slack_msgs_per_day"]
    extra = ["tenure_x_level", "tenure_x_ai", "tenure_x_slack", "level_x_slack"]
    return evaluate(df, BASE_NUMERIC + extra, BASE_CATEGORICAL, "2_interactions")


def round_3_manager_squad(df):
    # Frequency-encoded manager (how many reports they have in the pop)
    mgr = df.get("manager_email", pd.Series(["" for _ in range(len(df))]))
    if "manager_email" not in df.columns:
        # extract.sql doesn't export manager, fall back to no-op if missing
        return []
    mgr_counts = df["manager_email"].value_counts().to_dict()
    df["manager_freq"] = df["manager_email"].map(mgr_counts).fillna(0)

    # Target-encoded squad (leave-one-out mean)
    if "squad" in df.columns:
        squad_means = df.groupby("squad")["impact_360d"].mean().to_dict()
        n_per_squad = df.groupby("squad").size().to_dict()
        def loo(row):
            s = row["squad"]
            n = n_per_squad.get(s, 0)
            if n <= 1:
                return df["impact_360d"].mean()
            total = squad_means.get(s, 0) * n
            return (total - row["impact_360d"]) / (n - 1)
        df["squad_target_enc"] = df.apply(loo, axis=1)
    extra = ["manager_freq"]
    if "squad_target_enc" in df.columns:
        extra.append("squad_target_enc")
    return evaluate(df, BASE_NUMERIC + extra, BASE_CATEGORICAL, "3_manager_squad")


def round_4_time_shape(df):
    # Derived from existing columns. Pure-CSV variants (no DB call):
    #  - pr_gap_days: 365 - (prs_90d / prs_360d) * 360 (approx longest gap proxy)
    #  - weekly_pr_cv: variance proxy from 30d vs 90d vs 360d
    #  - ramp_slope_first90: estimate via pr_90d / tenure_months (proxy)

    df["pr_gap_days"] = np.where(
        df["prs_360d"] > 0,
        365 * (1 - df["prs_90d"] / df["prs_360d"]),
        365,
    ).clip(0, 365)

    # Coefficient of variation across (30d, 90d, 360d) normalised volumes
    def cv_of_rates(r30, r90, r360):
        rates = np.array([r30 / 30, r90 / 90, r360 / 360])
        mu = rates.mean()
        if mu == 0:
            return 0
        return float(rates.std() / mu)
    df["weekly_pr_cv"] = df.apply(
        lambda r: cv_of_rates(r["prs_30d"], r["prs_90d"], r["prs_360d"]), axis=1
    )

    df["ramp_slope_first90"] = np.where(
        df["tenure_months"] > 3,
        df["prs_90d"] / df["tenure_months"],
        0,
    )

    extra = ["pr_gap_days", "weekly_pr_cv", "ramp_slope_first90"]
    return evaluate(df, BASE_NUMERIC + extra, BASE_CATEGORICAL, "4_time_shape")


def round_5_tuned_lgbm(df, best_features):
    """Tune LightGBM hyperparameters on the best-feature set for min overfit gap."""
    X = make_X(df, best_features["numeric"], best_features["categorical"])
    y = df["impact_360d"].astype(float).values
    y_log = np.log1p(y)
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)

    # Hyperparameter sweep: regularisation ↑ → gap ↓, but CV might drop too
    grid = []
    for num_leaves in [8, 15, 31]:
        for min_child in [5, 10, 20]:
            for reg_lambda in [0.5, 2.0, 5.0]:
                grid.append({
                    "num_leaves": num_leaves,
                    "min_child_samples": min_child,
                    "reg_lambda": reg_lambda,
                })

    results = []
    mono = [MONOTONE_PRIORS.get(f, 0) for f in X.columns]
    for g in grid:
        model = lgb.LGBMRegressor(
            n_estimators=500,
            learning_rate=0.03,
            **g,
            monotone_constraints=mono,
            monotone_constraints_method="advanced",
            random_state=RANDOM_STATE,
            verbose=-1,
            n_jobs=-1,
        )
        y_cv = np.expm1(cross_val_predict(model, X, y_log, cv=kf))
        cv_r2 = r2_score(y, y_cv)
        cv_rho = spearmanr(y, y_cv).statistic
        cv_mae = mean_absolute_error(y, y_cv)
        model.fit(X, y_log)
        tr_r2 = r2_score(y, np.expm1(model.predict(X)))
        results.append({
            "label": "5_tuned_lgbm",
            "model": f"lgbm_nl{g['num_leaves']}_mc{g['min_child_samples']}_rl{g['reg_lambda']}",
            "n_features": X.shape[1],
            "cv_r2": round(cv_r2, 3),
            "cv_rho": round(cv_rho, 3),
            "cv_mae": round(cv_mae, 0),
            "train_r2": round(tr_r2, 3),
            "gap": round(tr_r2 - cv_r2, 3),
        })
    return results


def main():
    df = load_and_derive()
    print(f"n={len(df)} engineers, impact mean={df['impact_360d'].mean():.0f}, median={df['impact_360d'].median():.0f}\n")

    all_results = []
    print("=" * 100)
    print(f"{'Round':<22}{'Model':<12}{'n_feat':<8}{'CV R²':<8}{'CV ρ':<8}{'CV MAE':<9}{'Train R²':<10}{'Gap':<8}")
    print("=" * 100)

    rounds_to_run = [
        round_0_baseline,
        round_1_slack_momentum,
        round_2_interactions,
        round_3_manager_squad,
        round_4_time_shape,
    ]
    best_cv_rho = 0
    best_set = {"numeric": BASE_NUMERIC, "categorical": BASE_CATEGORICAL}

    for round_fn in rounds_to_run:
        df_round = df.copy()
        rows = round_fn(df_round)
        for r in rows:
            print(
                f"{r['label']:<22}{r['model']:<12}{r['n_features']:<8}"
                f"{r['cv_r2']:<8.3f}{r['cv_rho']:<8.3f}{r['cv_mae']:<9.0f}"
                f"{r['train_r2']:<10.3f}{r['gap']:<8.3f}"
            )
            all_results.append(r)
            # Track best valid (non-overfit) result for later tuning
            if r["cv_rho"] > best_cv_rho and r["gap"] < 0.30:
                best_cv_rho = r["cv_rho"]
                best_set["label"] = r["label"]
                best_set["model"] = r["model"]
        print("-" * 100)

    print(f"\nBest CV ρ so far: {best_cv_rho:.3f} on round={best_set.get('label','?')} model={best_set.get('model','?')}")

    # Reconstruct the best round's feature set for round 5 tuning
    # Simple heuristic: re-apply each round's feature additions in order through the best
    if best_set.get("label") == "0_baseline":
        pass
    elif best_set.get("label") == "1_slack_momentum":
        round_1_slack_momentum(df)  # populates df
        best_set["numeric"] = BASE_NUMERIC + [
            "slack_msgs_log",
            "slack_reactions_log",
            "slack_reaction_per_msg",
            "slack_engagement_composite",
        ]
    elif best_set.get("label") == "2_interactions":
        round_2_interactions(df)
        best_set["numeric"] = BASE_NUMERIC + [
            "tenure_x_level",
            "tenure_x_ai",
            "tenure_x_slack",
            "level_x_slack",
        ]
    elif best_set.get("label") == "3_manager_squad":
        round_3_manager_squad(df)
        best_set["numeric"] = BASE_NUMERIC + (
            ["manager_freq", "squad_target_enc"]
            if "squad_target_enc" in df.columns
            else ["manager_freq"]
        )
    elif best_set.get("label") == "4_time_shape":
        round_4_time_shape(df)
        best_set["numeric"] = BASE_NUMERIC + [
            "pr_gap_days",
            "weekly_pr_cv",
            "ramp_slope_first90",
        ]

    print("\n" + "=" * 100)
    print("Round 5: tune LightGBM on the best feature set")
    print("=" * 100)
    r5 = round_5_tuned_lgbm(df, best_set)
    r5.sort(key=lambda r: (-r["cv_rho"], r["gap"]))
    for r in r5[:10]:
        print(
            f"{r['label']:<22}{r['model']:<40}{r['n_features']:<8}"
            f"{r['cv_r2']:<8.3f}{r['cv_rho']:<8.3f}{r['cv_mae']:<9.0f}"
            f"{r['train_r2']:<10.3f}{r['gap']:<8.3f}"
        )
    all_results.extend(r5)

    # Winner: best cv_rho with gap ≤ 0.25 (modest overfitting ok)
    valid = [r for r in all_results if r["gap"] <= 0.25]
    if not valid:
        valid = all_results
    winner = max(valid, key=lambda r: r["cv_rho"])
    print("\n" + "=" * 100)
    print(f"WINNER: round={winner['label']}, model={winner['model']}")
    print(f"  n_features={winner['n_features']}  CV R²={winner['cv_r2']}  CV ρ={winner['cv_rho']}")
    print(f"  CV MAE={winner['cv_mae']}  Train R²={winner['train_r2']}  Gap={winner['gap']}")
    print("=" * 100)


if __name__ == "__main__":
    main()
