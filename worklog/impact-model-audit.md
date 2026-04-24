# Impact-model target audit (M3)

**Date:** 2026-04-24
**Owner:** Implementer (Cycle 3)
**Purpose:** Decide whether the existing `src/data/impact-model.json` + `ml-impact/` model may be used as a signal in the B-side composite engineer score.

This audit is deliberately written as a durable artifact (not an inline comment). The CEO no longer trusts the trained target; this file records the training target, the features, the bias/leakage risks, and the explicit usage call, so M6 and later cycles can reference a single source of truth.

---

## (a) Training target — exact formula

From `ml-impact/train.py:71-75` and `ml-impact/README.md:26-27`:

```
impact_360d = round(prs * log2(1 + (additions + deletions) / prs))
```

computed per engineer across the **last 360 days of merged PRs**, where `prs`, `additions`, `deletions` are raw totals from `githubPrs` (restricted to merged PRs authored by that engineer within the window).

The target is a multiplicative function of:
- **PR volume** — linear in count of merged PRs.
- **Churn per PR** — `log2(1 + mean_lines_per_pr)`. Log-compressed, but still strictly monotone-increasing in lines changed.

In plain words: *the more merged PRs an engineer ships, and the larger each one is on average, the higher the target.* The rounding and `log2` dampen the tail but do not change the ordering.

The script mirrors `src/lib/data/engineering-impact.ts#impactScore()` — the same formula powers the existing A-side Impact report. So the target is not specific to the model; it is the headline number shown on `/dashboard/engineering/impact`.

---

## (b) Feature list and leakage / bias risks

### Features actually passed to the regressor

Numeric features (`train.py:212-238`):

| Bucket | Features |
|---|---|
| Tenure | `tenure_months` |
| Level | `level_num` (numeric from level code) |
| Slack engagement | `slack_msgs_per_day`, `slack_reactions_per_day`, `slack_active_day_rate`, `slack_desktop_share`, `slack_channel_share`, `slack_days_since_active` |
| AI usage | `ai_tokens_log`, `ai_cost_log`, `ai_n_days`, `ai_max_models` |
| Perf review | `avg_rating`, `latest_rating`, `rating_count` |
| PR style — breadth/rework | `distinct_repos_180d`, `commits_per_pr` |
| PR style — when | `weekend_pr_share`, `offhours_pr_share` |
| PR cadence | `pr_slope_per_week`, `pr_gap_days`, `weekly_pr_cv`, `ramp_slope_first90` |

Categorical (one-hot) features: `level_track`, `discipline`, `pillar`.

Explicitly **excluded** to avoid obvious target leakage (commented at `train.py:206-211`): `pr_size_median`, `pr_size_p90_log`, `commits_180d_log` — because these are near-identical to the target's `additions+deletions` term.

Explicitly **excluded** as protected attributes / demographic proxies (`train.py:239-245`, `README.md:33-39`): `gender`, `location`.

### Leakage / bias risks

1. **Partial target leakage via PR-cadence features.** Although `pr_size_*` and `commits_180d_log` were removed, the remaining PR-cadence features (`pr_slope_per_week`, `pr_gap_days`, `weekly_pr_cv`, `ramp_slope_first90`, `distinct_repos_180d`, `commits_per_pr`) are still derived from the same PR stream that produces the target. They describe the *shape* rather than the *volume* of PR activity, but an engineer cannot have a non-trivial `pr_slope_per_week` without shipping PRs. The score is therefore downstream of the very behaviour the ranking is supposed to evaluate.

2. **Slack engagement dominates the learned importances.** The committed model's grouped mean-abs-SHAP values (`src/data/impact-model.json` → `grouped_importance`, recorded 2026-04-24 09:05 UTC):

   | Group | mean-abs-SHAP (log units) |
   |---|---|
   | Slack engagement | **0.833** |
   | PR cadence | 0.235 |
   | PR habits | 0.212 |
   | Tenure | 0.169 |
   | AI usage | 0.164 |
   | Level | 0.044 |
   | Pillar | 0.028 |
   | Performance review | 0.013 |
   | Discipline | 0.005 |

   Slack engagement is ~3.5× the next group and ~65× the performance-review signal. The model is predominantly predicting PR-churn from Slack activity. That correlation is plausibly real (engaged engineers talk more and ship more) but is **not** a defensible ranking axis — it rewards noise over output and is trivially gamed.

3. **Monotonic AI-usage boost = pay-to-win vector.** `train.py:306-327` enforces `monotone_constraints` of `+1` on `ai_tokens_log`, `ai_cost_log`, `ai_n_days`, `ai_max_models`. That forces the learned response surface to be non-decreasing in AI spend. Any engineer who cranks AI token usage will move monotonically up the score regardless of output quality. This is a direct gaming vector for a composite built on top.

4. **Performance-rating signal is near-dead.** `train.py:197-199` median-imputes missing ratings, which is the majority for the 117-engineer dataset. Grouped mean-abs-SHAP for Performance review is 0.013 — the model has effectively learned to ignore HR's own ratings. For a performance-ranking use-case, that is the wrong direction.

5. **Small-n, many-feature overfit risk.** n = 117 after the `prs_360d > 0` filter (`train.py:132-133`). Feature count (post one-hot) = 37. Best Spearman ρ = 0.856 against the **model's own synthetic target**, not against an external performance ground truth. The README explicitly cautions (line 47): *"Treat importances as correlates, not levers."*

6. **Tenure truncation punishes new joiners.** `impact_360d` rolls a 360-day window. An engineer who joined 120 days ago can have at most one-third the structural opportunity to ship. `tenure_months` is a feature, but the regressor's ability to back this out on a 117-row dataset with many co-linear PR-cadence features is empirically weak — new joiners will show up with low actuals, low predictions, and a roughly-zero residual, which means the model flags them as "on trend for being low impact" rather than "too new to score."

7. **Excluded-PR survivorship bias.** `prs_360d > 0` filter removes anyone who did not ship a merged PR in the window. The exclusion is sensible for training, but means the model is silent about engineers who have zero shipped PRs — which is precisely the cohort a manager view would care about.

8. **Design and review work is invisible.** The target counts only *merged PRs authored by* the engineer. PR reviews they performed, design docs, pairing, architectural contributions, incident response, and anything that doesn't become a merged PR are formally zero. The README line 49 concedes this.

---

## (c) Is the target defensible for performance ranking?

**No.** The target `prs * log2(1 + churn/prs)` is a proxy for *code volume ship-rate*, which is only loosely correlated with performance:

- It rewards big, noisy PRs and punishes small, high-quality ones.
- It rewards authors over reviewers.
- It rewards engineers working in churn-heavy repos (fresh features) over engineers working in mature, high-leverage areas (bug triage, perf, reliability).
- It has near-zero correlation with the formal HR rating signal (see (b) point 4).
- It is downstream of the same PR stream that the composite would already use directly, making the model a *second-order smoothing* of signals the composite has first-hand.
- The dominant predictor is Slack engagement, which is not a legitimate performance axis.
- Two features are monotonically positive in AI spend, which is a gaming vector.

The model is *internally consistent* (Spearman 0.86 CV against its own target) and has been well-engineered to avoid obvious pitfalls (protected attributes excluded, log-transforms, monotonic constraints, KFold CV, multi-model comparison). None of that makes the *target* defensible for performance ranking, which is the axis the CEO wants to grade engineers on.

---

## (d) Explicit call — exclude or down-weight

**Call: EXCLUDE.** B-side's composite engineer score will not consume the trained model or any value derived from `src/data/impact-model.json`.

### Reasoning

1. **Churn-as-a-proxy is the problem B-side exists to fix.** The whole point of the two-persona rewrite is to stop ranking engineers by the same volume heuristic that has lost the CEO's trust. Re-importing this model — even at ≤20% weight — re-enshrines the exact target the refactor is meant to abandon. A single weight < 30% would still meaningfully move ordering at tie-break granularity, which M7 will surface as real flags (promote-candidate / PM-candidate).

2. **Signal double-counting.** The model's learned weights load overwhelmingly on Slack activity and PR cadence — B-side already plans to use raw PR signals directly (capped, winsorized, quality-gated per M6). Adding the model on top bakes the same evidence in twice, with a churn-dependency hidden inside the tree ensemble that is invisible to the methodology panel M10 has to defend line-by-line.

3. **Defensibility panel has to match the code.** M10 requires the self-defence copy to match every weight. Explaining *"20% of your score is a gradient-boosted prediction of last year's merged-PR churn built from your Slack engagement"* fails the CEO-defends-it-to-the-engineer test that the prompt sets.

4. **Gaming vector is unsealable.** The monotonic `+1` constraint on AI spend cannot be retuned without retraining, and the prompt forbids retraining inside this workflow (`"IMPACT_MODEL_HASH_KEY must not change — if training target is replaced, that is a documented forward plan, not a retrain inside this workflow"`). As long as the model is an input, paying Anthropic more = higher score. That is not a shape we can ship.

5. **Small n, weak ground truth.** n=117 with 37 features and no external performance label. Spearman ρ=0.856 is against the model's own synthetic target, not a human judgement. Using this number as a first-class input to a single-methodology score that the CEO defends to an engineer is not supportable.

### What about the existing A-side page?

The existing `/dashboard/engineering/impact-model` page and its SHAP waterfall remain live and unchanged — the A-side preservation constraint is honoured. The model continues to serve its current role as a diagnostic / explanatory artifact for leadership. Nothing in this audit removes or degrades A-side behaviour.

### Forward plan (out of scope for this workflow)

If the organisation wants an ML-based ranking signal in the future, it should be retrained against a target that is not the existing `impact_360d` formula — e.g. a calibrated HR rating, a peer-reviewed 360 score, or an explicit "would-promote" label. That is a separate project, flagged here so later cycles know the exclusion call is based on target choice, not on model quality or identity-resolution hygiene.

---

## (e) Identity-resolution confirmation

This section is maintained for completeness even though the exclusion call at (d) means the B-side composite will not load the model file.

- Per `CLAUDE.md` ("Known deliberate gaps"), `src/data/impact-model.json` currently stores **plain lowercased employee emails**, not HMAC hashes. The hash layer was removed in April 2026 because the A-side hashing scheme between `impact-model.server.ts` and `engineering-ranking.ts` never aligned. The repo is private and all consumer pages are leadership-or-CEO-gated.
- `train.py:679-685` deliberately writes plain lowercased emails to the committed public JSON.
- **B-side must not introduce any new persisted mapping** (hash→name, email→opaque-id, etc.) beyond what the A-side already ships. Because M3 excludes the model, B-side will not even read `src/data/impact-model.json` — so the "no new persisted identity mapping" requirement is trivially satisfied for the composite path.
- If a future cycle reverses the exclusion call and chooses to down-weight the model (not recommended per the reasoning at (d)), it must (i) read emails directly from the existing committed artifact and join at request time via the already-loaded Headcount SSoT, (ii) not write any derived identity mapping to disk or to a new Drizzle table, and (iii) update this audit in the same commit.

---

## Summary

| Item | Value |
|---|---|
| Target formula | `round(prs * log2(1 + (additions + deletions) / prs))` over 360 days |
| n engineers | 117 |
| Chosen model | `lightgbm_monotonic` |
| CV Spearman ρ | 0.856 (vs own target, not vs performance) |
| Top-loading signal | Slack engagement (mean-abs-SHAP ~3.5× next group) |
| Protected attributes excluded | gender, location |
| Gaming vector | monotonic +1 constraint on AI tokens/cost/days/models |
| **Defensible for performance ranking?** | **No** |
| **B-side usage call** | **Exclude entirely** |
| Identity mapping concerns | None — B-side composite will not read the file |

Cycles M6 onward must not import `src/data/impact-model.json`, `src/lib/data/impact-model.ts`, or `src/lib/data/impact-model.server.ts` into any new B-side composite-score module. If a future cycle needs to reverse this call, update this audit in the same commit.
