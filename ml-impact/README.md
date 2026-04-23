# Engineering Impact ML Pipeline

Offline pipeline that trains a model predicting 360-day engineering impact
and emits JSON consumed by `/dashboard/engineering/impact-model`.

## Run

```bash
# 1. Extract features from prod
psql "$PROD_DATABASE_URL" -f ml-impact/extract.sql > ml-impact/features.csv
# (strip the "Output format is csv." first line if psql emits it)

# 2. Train & export model.json
.venv-ml/bin/python ml-impact/train.py

# 3. Refresh the page data
cp ml-impact/model.json src/data/impact-model.json
```

Setting up the Python venv once:

```bash
python3 -m venv .venv-ml
.venv-ml/bin/pip install scikit-learn pandas numpy scipy
```

## What it trains

- **Target:** `round(prs * log2(1 + (additions + deletions) / prs))` over the
  last 360 days of merged PRs, per engineer (email keyed).
- **Features:** tenure, level, discipline, pillar, squad, gender, location,
  Slack msgs/day, Slack reactions/day, active-day rate, desktop share,
  channel share, days-since-active, AI tokens (log), AI cost (log),
  AI days-used, perf-review count, avg & latest perf rating.
- **Models compared:** `GradientBoostingRegressor` and `RandomForestRegressor`.
  The model with the higher 5-fold-CV Spearman ρ is chosen.
- **Target transform:** log1p / expm1 to tame the long tail.

## Caveats

- n ≈ 140 — small. Treat importances as correlates, not levers.
- Only engineers who shipped ≥1 PR in the window are included.
- Impact score under-credits design/review work.
- Performance ratings are median-imputed when missing, diluting their signal.
- `features.csv` and `model.json` are gitignored (contain per-engineer data).
  The bundled snapshot at `src/data/impact-model.json` is committed so the
  page can render without re-running the pipeline at request time.
