# Engineering Impact ML Pipeline

Offline pipeline that trains a model predicting 360-day engineering impact
and emits JSON consumed by `/dashboard/engineering/impact-model`.

## Run

```bash
# 1. Extract features from prod
psql "$PROD_DATABASE_URL" -f ml-impact/extract.sql > ml-impact/features.csv
# (strip the "Output format is csv." first line if psql emits it)

# 2. Train & export (writes both full model.json + anonymised src/data/impact-model.json)
.venv-ml/bin/python ml-impact/train.py
```

Setting up the Python venv once:

```bash
python3 -m venv .venv-ml
.venv-ml/bin/pip install scikit-learn pandas numpy scipy shap lightgbm
```

## What it trains

- **Target:** `round(prs * log2(1 + (additions + deletions) / prs))` over the
  last 360 days of merged PRs, per engineer (email keyed).
- **Features:** tenure, level, discipline, pillar, Slack engagement (msgs/day,
  reactions/day, active-day rate, desktop share, channel share, days-since-active),
  AI usage (tokens, cost, distinct days + models), perf-review signal (avg/latest
  rating + review count), and PR-style (weekend/off-hours share, distinct repos
  touched, PR-rate slope, PR gap, burstiness, ramp).
- **Deliberately excluded (protected attributes / demographic proxies):**
  `gender` and `location`. Both are pulled from the headcount SSoT for
  diagnostic purposes but are NOT passed as features — see the comment above
  `categorical_features` in `train.py`. Using a protected characteristic in an
  individual-scoring model would risk amplifying demographic gaps and creates
  indirect-discrimination exposure; surface any composition-driven findings
  separately, not through this model.
- **Models compared:** `GradientBoostingRegressor`, `RandomForestRegressor`,
  and `LGBMRegressor` (with monotonic constraints). The model with the higher
  5-fold-CV Spearman ρ is chosen.
- **Target transform:** log1p / expm1 to tame the long tail.

## Caveats

- n ≈ 140 — small. Treat importances as correlates, not levers.
- Only engineers who shipped ≥1 PR in the window are included.
- Impact score under-credits design/review work.
- Performance ratings are median-imputed when missing, diluting their signal.
- `features.csv` and `model.json` are gitignored (contain per-engineer data).
  The bundled snapshot at `src/data/impact-model.json` is committed so the
  page can render without re-running the pipeline at request time.
