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
import shap
import lightgbm as lgb
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

HERE = Path(__file__).parent
CSV_PATH = HERE / "features.csv"
OUT_PATH = HERE / "model.json"
# Anonymised copy intended for the committed bundle consumed by the
# dashboard page. Strips names + emails — the page still shows everything
# via an opaque "Engineer NNN" label.
PUBLIC_OUT_PATH = HERE.parent / "src" / "data" / "impact-model.json"

RANDOM_STATE = 42

FEATURE_DISPLAY = {
    "tenure_months": "Tenure (months)",
    "slack_msgs_per_day": "Slack messages per day",
    "slack_reactions_per_day": "Slack reactions per day",
    "slack_active_day_rate": "Slack active-day rate",
    "slack_desktop_share": "Slack desktop share",
    "slack_channel_share": "Channel vs DM share",
    "slack_days_since_active": "Days since last active",
    "ai_tokens_log": "AI tokens (log)",
    "ai_cost_log": "AI cost (log)",
    "ai_n_days": "AI usage days",
    "ai_max_models": "Distinct AI models",
    "avg_rating": "Avg perf rating",
    "latest_rating": "Latest perf rating",
    "rating_count": "Perf review count",
    "level_num": "Level number",
    "pr_size_median": "PR size (median)",
    "pr_size_p90_log": "PR size (p90, log)",
    "distinct_repos_180d": "Distinct repos (180d)",
    "weekend_pr_share": "Weekend PR share",
    "offhours_pr_share": "Off-hours PR share",
    "pr_slope_per_week": "PR rate slope (weekly)",
    "commits_180d_log": "Commits (log, 180d)",
    "commits_per_pr": "Commits per PR",
    "pr_gap_days": "PR gap (days without PR)",
    "weekly_pr_cv": "PR rate burstiness",
    "ramp_slope_first90": "PR-rate ramp (per tenure-month)",
}


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

    # PR style features (from extended extract.sql)
    df["pr_size_median"] = df["pr_size_median"].fillna(0)
    df["pr_size_p90_log"] = np.log1p(df["pr_size_p90"].fillna(0))
    df["distinct_repos_180d"] = df["distinct_repos_180d"].fillna(0)
    df["weekend_pr_share"] = df["weekend_pr_share"].fillna(0)
    df["offhours_pr_share"] = df["offhours_pr_share"].fillna(0)
    df["pr_slope_per_week"] = df["pr_slope_per_week"].fillna(0)
    df["commits_180d_log"] = np.log1p(df["commits_180d"].fillna(0))
    df["commits_per_pr"] = df["commits_per_pr"].fillna(0).clip(upper=50)

    # Round-4 time-shape features (ratios of PR counts — describe the SHAPE of
    # activity without leaking volume). Validated non-leaky in iterate2.py:
    # ramp_slope_first90 alone correlates only +0.12 with target, but combined
    # with pr_gap_days + weekly_pr_cv captures strong orthogonal signal.
    df["pr_gap_days"] = np.where(
        df["prs_360d"] > 0,
        365 * (1 - df["prs_90d"] / df["prs_360d"]),
        365,
    ).clip(0, 365)
    def _rate_cv(r30, r90, r360):
        rates = np.array([r30 / 30, r90 / 90, r360 / 360])
        mu = rates.mean()
        return 0 if mu == 0 else float(rates.std() / mu)
    df["weekly_pr_cv"] = df.apply(
        lambda r: _rate_cv(r["prs_30d"], r["prs_90d"], r["prs_360d"]), axis=1
    )
    df["ramp_slope_first90"] = np.where(
        df["tenure_months"] > 3,
        df["prs_90d"] / df["tenure_months"].clip(lower=1),
        0,
    )

    # Perf
    df["has_perf_rating"] = df["rating_count"].fillna(0) > 0
    df["avg_rating"] = df["avg_rating"].fillna(df["avg_rating"].median())
    df["latest_rating"] = df["latest_rating"].fillna(df["latest_rating"].median())

    # Numeric
    df["gender"] = df["gender"].fillna("Unknown")
    df["location"] = df["location"].fillna("Unknown")

    # Feature set.
    # IMPORTANT: impact = prs × log2(1 + (add+del)/prs). PR count and PR size
    # would be near-perfect proxies for the target → target leakage. We
    # therefore EXCLUDE pr_size_median, pr_size_p90_log, commits_180d_log.
    # Kept code-style features are *orthogonal* to PR volume: work-pattern
    # (weekend/offhours), breadth (distinct repos), trajectory (slope),
    # rework (commits per PR).
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
        # Code-style (orthogonal to target)
        "distinct_repos_180d",
        "weekend_pr_share",
        "offhours_pr_share",
        "pr_slope_per_week",
        "commits_per_pr",
        # Round-4 time-shape (ratios — describe activity shape, not volume)
        "pr_gap_days",
        "weekly_pr_cv",
        "ramp_slope_first90",
    ]
    categorical_features = ["level_track", "discipline", "pillar", "gender", "location"]

    # One-hot encode categoricals
    X_cat = pd.get_dummies(df[categorical_features], prefix=categorical_features)
    X_num = df[numeric_features].fillna(0)
    X = pd.concat([X_num, X_cat], axis=1)
    # Sanitize feature names — LightGBM rejects special JSON chars like spaces,
    # commas, quotes, colons, etc. Keep the mapping so we can pretty-print in UI.
    import re as _re
    def _safe_name(s: str) -> str:
        return _re.sub(r"[^A-Za-z0-9_]+", "_", s).strip("_")
    raw_to_safe = {c: _safe_name(c) for c in X.columns}
    X = X.rename(columns=raw_to_safe)
    feature_names = list(X.columns)

    y = df["impact_360d"].astype(float).values
    # Log-transform target to reduce skew (impact has a long tail).
    y_log = np.log1p(y)

    print(f"Training on n={len(X)}, features={X.shape[1]}")
    print(f"Target: impact_360d  mean={y.mean():.0f}  median={np.median(y):.0f}  max={y.max():.0f}")

    # Cross-validated predictions for honest performance estimate
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    # subsample=0.7 adds row-bagging which is the single biggest overfit reducer
    # for gradient boosting on this n. Tuned via ml-impact/tune2.py.
    model_cv = GradientBoostingRegressor(
        n_estimators=300, max_depth=3, learning_rate=0.05,
        subsample=0.7, random_state=RANDOM_STATE,
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

    # LightGBM with monotonic constraints on "more-is-better" features.
    # Monotone enforces the learned shape: tenure can only push predictions up,
    # AI usage only up, latest_rating only up, slack_days_since_active only down.
    # This kills spurious zigzags in PDPs and makes the model more defensible.
    monotone_map = {
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
        "distinct_repos_180d": 1,     # touching more repos ⇒ higher impact
        "commits_180d_log": 1,        # more commits ⇒ higher impact
        "pr_slope_per_week": 1,       # accelerating ⇒ higher impact
        "pr_gap_days": -1,            # bigger gaps ⇒ lower impact
        "ramp_slope_first90": 1,      # faster ramp-up ⇒ higher impact
        # NOT constrained: weekly_pr_cv (shape, direction unclear)
        # NOT constrained: pr_size_median (bigger isn't always better),
        # weekend_pr_share / offhours_pr_share (ambiguous), commits_per_pr
    }
    monotone_constraints = [
        monotone_map.get(f, 0) for f in feature_names
    ]
    n_monotone = sum(1 for m in monotone_constraints if m != 0)
    print(f"LightGBM: enforcing {n_monotone} monotone constraints")
    lgbm = lgb.LGBMRegressor(
        n_estimators=500,
        learning_rate=0.03,
        num_leaves=15,
        min_child_samples=5,
        reg_lambda=1.0,
        monotone_constraints=monotone_constraints,
        monotone_constraints_method="advanced",
        random_state=RANDOM_STATE,
        verbose=-1,
        n_jobs=-1,
    )
    y_pred_lgbm_log = cross_val_predict(lgbm, X, y_log, cv=kf)
    y_pred_lgbm = np.expm1(y_pred_lgbm_log)
    r2_lgbm = r2_score(y, y_pred_lgbm)
    rho_lgbm = spearmanr(y, y_pred_lgbm).statistic
    mae_lgbm = mean_absolute_error(y, y_pred_lgbm)
    rmse_lgbm = math.sqrt(mean_squared_error(y, y_pred_lgbm))
    print(f"LightGBM:      R²={r2_lgbm:.3f}  Spearman={rho_lgbm:.3f}  MAE={mae_lgbm:.0f}")

    # Pick the best model by Spearman (robust to outliers)
    candidates = [
        ("gradient_boosting", model_cv, y_pred_cv, r2_cv, rho_cv, mae_cv, rmse_cv),
        ("random_forest", rf, y_pred_rf, r2_rf, rho_rf,
         mean_absolute_error(y, y_pred_rf),
         math.sqrt(mean_squared_error(y, y_pred_rf))),
        ("lightgbm_monotonic", lgbm, y_pred_lgbm, r2_lgbm, rho_lgbm, mae_lgbm, rmse_lgbm),
    ]
    chosen, chosen_model, y_pred_final, r2_final, rho_final, mae_final, rmse_final = max(
        candidates, key=lambda c: c[4]  # spearman
    )
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

    # SHAP values — per-engineer feature contributions in log(1+impact) space.
    # TreeExplainer gives exact Shapley values for tree ensembles.
    print("Computing SHAP values...")
    explainer = shap.TreeExplainer(chosen_model)
    shap_values = explainer.shap_values(X)
    # expected_value can be scalar or 1-element array depending on model — normalise
    ev = explainer.expected_value
    if hasattr(ev, "__len__"):
        ev = np.asarray(ev).flatten()[0]
    expected_log = float(ev)
    expected_impact = float(np.expm1(expected_log))

    # Feature-group buckets for aggregated importance.
    def feature_group(name: str) -> str:
        lower = name.lower()
        if lower.startswith("slack_"):
            return "Slack engagement"
        if lower.startswith("ai_"):
            return "AI usage"
        if lower.startswith(("pr_", "commits_", "distinct_repos", "weekend_", "offhours_")):
            return "Code style"
        if lower.startswith("latest_rating") or lower.startswith("avg_rating") or lower == "rating_count":
            return "Performance review"
        if lower == "tenure_months":
            return "Tenure"
        if (
            lower == "level_num"
            or lower.startswith("level_track_")
            or lower.startswith("level_label_")
        ):
            return "Level"
        if lower.startswith("discipline_"):
            return "Discipline"
        if lower.startswith("pillar_"):
            return "Pillar"
        if lower.startswith("gender_"):
            return "Gender"
        if lower.startswith("location_"):
            return "Location"
        return "Other"

    group_importance = {}
    # Magnitude of mean-abs SHAP aggregated per group (log-space units)
    mean_abs_shap = np.mean(np.abs(shap_values), axis=0)
    for i, fname in enumerate(feature_names):
        g = feature_group(fname)
        group_importance[g] = group_importance.get(g, 0.0) + float(mean_abs_shap[i])
    grouped_importance = sorted(
        [{"group": g, "mean_abs_shap": v} for g, v in group_importance.items()],
        key=lambda d: d["mean_abs_shap"],
        reverse=True,
    )

    # In-sample predictions (from the full-data fit — what SHAP decomposes).
    # These will differ from the 5-fold-CV predictions used for honest metrics
    # but sum correctly with the SHAP values so the waterfall adds up.
    y_pred_insample_log = chosen_model.predict(X)
    y_pred_insample = np.expm1(y_pred_insample_log)

    # Partial dependence for top continuous features: sweep the feature across
    # a grid, predict the whole dataset with that feature replaced, average.
    # Answers "as X goes from low to high, what does the model predict?"
    def partial_dependence(fname: str, n_points: int = 30):
        if fname not in X.columns:
            return None
        col = X[fname].values
        is_onehot = fname.startswith(
            ("pillar_", "discipline_", "gender_", "location_", "level_track_", "level_label_")
        )
        if is_onehot:
            return None
        lo, hi = np.percentile(col, [5, 95])
        if lo == hi:
            return None
        grid = np.linspace(lo, hi, n_points)
        X_mod = X.copy()
        sample_size = min(40, len(X))
        sample_idx = np.random.default_rng(RANDOM_STATE).choice(
            len(X), sample_size, replace=False
        )
        pdp_mean = []
        ice_lines = [[] for _ in range(sample_size)]
        for v in grid:
            X_mod[fname] = v
            preds_log = chosen_model.predict(X_mod)
            preds = np.expm1(preds_log)
            pdp_mean.append(float(preds.mean()))
            for k, si in enumerate(sample_idx):
                ice_lines[k].append(float(preds[si]))
        return {
            "feature": fname,
            "label": FEATURE_DISPLAY.get(fname, fname),
            "group": feature_group(fname),
            "grid": [float(g) for g in grid],
            "pdp_mean": pdp_mean,
            "ice_sample": ice_lines,
            "actual_min": float(col.min()),
            "actual_max": float(col.max()),
            "actual_median": float(np.median(col)),
        }

    ranked_numeric = [
        f
        for f in sorted(
            feature_names,
            key=lambda n: -np.abs(shap_values[:, feature_names.index(n)]).mean(),
        )
        if not any(
            f.startswith(p)
            for p in ("pillar_", "discipline_", "gender_", "location_", "level_track_", "level_label_")
        )
    ][:10]
    print(f"\nComputing partial dependence for {len(ranked_numeric)} features...")
    pdp_plots = []
    for fname in ranked_numeric:
        pdp = partial_dependence(fname)
        if pdp is not None:
            pdp_plots.append(pdp)

    def categorical_effect(prefix: str, label: str):
        cats = [f for f in feature_names if f.startswith(prefix)]
        if not cats:
            return None
        results = []
        base = float(y_pred_insample.mean())
        for c in cats:
            mask = X[c] == 1
            if mask.sum() < 2:
                continue
            mean_pred = float(y_pred_insample[mask].mean())
            mean_actual = float(y[mask].mean())
            results.append({
                "category": c.replace(prefix, ""),
                "n": int(mask.sum()),
                "mean_predicted": mean_pred,
                "mean_actual": mean_actual,
                "vs_baseline_pct": round(((mean_pred - base) / base) * 100, 1),
            })
        results.sort(key=lambda r: r["mean_predicted"], reverse=True)
        return {"label": label, "baseline": base, "categories": results}

    categorical_effects = {
        "pillar": categorical_effect("pillar_", "Pillar"),
        "discipline": categorical_effect("discipline_", "Discipline"),
        "level": categorical_effect("level_track_", "Level track"),
    }

    engineers = []
    df_reset = df.reset_index(drop=True)
    for i, (_, r) in enumerate(df_reset.iterrows()):
        # Per-engineer SHAP: feature, raw contribution (log units), % multiplier (exp(shap)-1)
        # Filter noise / inapplicable one-hot zeros, but collect their SHAP sum into a
        # synthetic "other_minor" entry so the waterfall still adds up to the prediction.
        eng_shap = shap_values[i]
        contributions = []
        hidden_sum = 0.0
        hidden_count = 0
        for j, fname in enumerate(feature_names):
            shap_val = float(eng_shap[j])
            try:
                feat_val = float(X.iloc[i, j])
            except (ValueError, TypeError):
                feat_val = None
            is_onehot = fname.startswith(
                ("pillar_", "discipline_", "gender_", "location_", "level_track_", "level_label_")
            )
            is_inapplicable_onehot = is_onehot and feat_val == 0
            is_trivial = abs(shap_val) < 5e-3
            if is_inapplicable_onehot or is_trivial:
                hidden_sum += shap_val
                hidden_count += 1
                continue
            contributions.append({
                "feature": fname,
                "group": feature_group(fname),
                "shap": round(shap_val, 4),
                "pct_multiplier": round((float(np.exp(shap_val)) - 1) * 100, 1),
                "value": round(feat_val, 3) if feat_val is not None else None,
            })
        if hidden_count > 0 and abs(hidden_sum) > 1e-3:
            contributions.append({
                "feature": f"{hidden_count}_minor_features",
                "group": "Other",
                "shap": round(hidden_sum, 4),
                "pct_multiplier": round((float(np.exp(hidden_sum)) - 1) * 100, 1),
                "value": None,
            })
        contributions.sort(key=lambda c: abs(c["shap"]), reverse=True)

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
                "predicted_insample": int(round(float(y_pred_insample[i]))),
                "residual": int(round(float(r["impact_360d"] - y_pred_final[i]))),
                "slack_msgs_per_day": round(float(r["slack_msgs_per_day"]), 2),
                "ai_tokens": int(r["ai_tokens"]),
                "latest_rating": float(r["latest_rating"]) if pd.notna(r["latest_rating"]) else None,
                "shap_contributions": contributions,
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
            "lightgbm_monotonic": {"r2": round(r2_lgbm, 4), "spearman": round(rho_lgbm, 4)},
        },
        "target": {
            "name": "impact_360d",
            "formula": "round(prs * log2(1 + (additions + deletions) / prs))",
            "mean": float(y.mean()),
            "median": float(np.median(y)),
            "p95": float(np.percentile(y, 95)),
            "max": float(y.max()),
        },
        "shap": {
            "expected_log": expected_log,
            "expected_impact": expected_impact,
        },
        "grouped_importance": grouped_importance,
        "partial_dependence": pdp_plots,
        "categorical_effects": categorical_effects,
        "features": feats,
        "engineers": engineers,
        "by_discipline": grouped_stats("discipline"),
        "by_level_track": grouped_stats("level_track"),
        "by_pillar": grouped_stats("pillar"),
    }

    OUT_PATH.write_text(json.dumps(output, indent=2))
    print(f"\nWrote {OUT_PATH} (full, gitignored)")

    # Anonymised version for commit: strip names + emails, replace with stable
    # pseudonyms derived from a sort-by-email-hash index. The UI stays fully
    # functional — the waterfall picker + outlier table just show "Engineer NNN".
    import copy, hashlib
    public = copy.deepcopy(output)
    sorted_indices = sorted(
        range(len(public["engineers"])),
        key=lambda i: hashlib.sha256(public["engineers"][i]["email"].encode()).hexdigest(),
    )
    rank_by_pos = {orig_i: rank + 1 for rank, orig_i in enumerate(sorted_indices)}
    for i, e in enumerate(public["engineers"]):
        rank = rank_by_pos[i]
        e["name"] = f"Engineer {rank:03d}"
        e["email"] = f"anon-{rank:03d}"
    PUBLIC_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT_PATH.write_text(json.dumps(public, indent=2))
    print(f"Wrote {PUBLIC_OUT_PATH} (anonymised, committed)")

    print("\nTop 15 features by permutation importance:")
    for f in feats[:15]:
        bar = "█" * max(1, int(f["permutation_mean"] * 200))
        print(f"  {f['name']:40s} {f['permutation_mean']:+.4f}  {bar}")


if __name__ == "__main__":
    main()
