"use client";

import type { ImpactModel } from "@/lib/data/impact-model";
import type { TeamView as TeamViewData } from "@/lib/data/impact-model.server";
import { FeatureImportanceChart } from "./feature-importance-chart";
import { ActualVsPredicted } from "./actual-vs-predicted";
import { GroupBars } from "./group-bars";
import { OutlierTable } from "./outlier-table";
import { ShapWaterfall } from "./shap-waterfall";
import { GroupedImportanceChart } from "./grouped-importance-chart";
import { FeatureDeepDive } from "./feature-deep-dive";
import { TeamView } from "./team-view";

interface ManagerOption {
  email: string;
  name: string;
  directReports: number;
  jobTitle: string | null;
}

function MetricTile({
  label,
  value,
  unit,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 shadow-warm ${
        highlight
          ? "border-primary/50 bg-primary/5"
          : "border-border/60 bg-card"
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-4xl italic tracking-tight text-foreground">
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function SectionHead({
  letter,
  title,
  lede,
}: {
  letter: string;
  title: string;
  lede: string;
}) {
  return (
    <div className="flex items-start gap-5 border-b border-border/60 pb-4">
      <span className="font-display text-6xl italic leading-none text-primary">
        {letter}
      </span>
      <div className="pt-1">
        <h2 className="font-display text-3xl italic tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm italic text-muted-foreground">
          {lede}
        </p>
      </div>
    </div>
  );
}

export function ImpactModelReport({
  model,
  teamView,
  allManagers,
  isViewerOwnTeam,
}: {
  model: ImpactModel;
  teamView?: TeamViewData | null;
  allManagers?: ManagerOption[];
  isViewerOwnTeam?: boolean;
}) {
  const { metrics, model_comparison, target, features, engineers } = model;

  const generatedAt = new Date(model.generated_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const topFeature = features[0];

  return (
    <div className="space-y-10">
      {/* Metadata strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-border/60 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>
          <span className="text-primary">› </span>trained {generatedAt}
        </span>
        <span>
          <span className="text-primary">› </span>
          {model.n_engineers} engineers
        </span>
        <span>
          <span className="text-primary">› </span>
          {model.n_features} features
        </span>
        <span>
          <span className="text-primary">› </span>model{" "}
          {model.chosen_model.replace("_", " ")}
        </span>
        <span>
          <span className="text-primary">› </span>5-fold CV
        </span>
      </div>

      {/* Manager-scoped team view — placed first because it's the most
          actionable content on the page. The model-wide sections below are
          reference material for understanding how the model works. */}
      {teamView && (
        <TeamView
          team={teamView}
          canPickAnyManager={true}
          allManagers={allManagers ?? []}
          isViewerOwnTeam={!!isViewerOwnTeam}
        />
      )}

      {/* Hero */}
      <section>
        <SectionHead
          letter="A"
          title="Can we predict engineering impact?"
          lede={`We regress each engineer's 360-day impact score against ${model.n_features} demographic, Slack-engagement, AI-usage, and performance features. The metrics below are held-out, cross-validated.`}
        />
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricTile
            label="R²"
            value={metrics.r2.toFixed(3)}
            hint={`Explains ${Math.round(metrics.r2 * 100)}% of impact variance vs baseline (mean).`}
            highlight
          />
          <MetricTile
            label="Spearman ρ"
            value={metrics.spearman.toFixed(3)}
            hint={`Rank correlation — the model ranks engineers in roughly ${
              metrics.spearman > 0.7 ? "strong" : "moderate"
            } agreement with their actual output.`}
            highlight
          />
          <MetricTile
            label="MAE"
            value={Math.round(metrics.mae).toLocaleString()}
            unit="impact pts"
            hint={`Typical absolute error. Baseline (predicting the mean) would miss by ${Math.round(metrics.baseline_mae).toLocaleString()}.`}
          />
          <MetricTile
            label="RMSE"
            value={Math.round(metrics.rmse).toLocaleString()}
            unit="impact pts"
            hint={`Root mean squared error. Penalises large misses. Baseline RMSE: ${Math.round(metrics.baseline_rmse).toLocaleString()}.`}
          />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm lg:col-span-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              What this means in plain English
            </div>
            <p className="mb-3 text-[13px] leading-relaxed text-foreground">
              Think of {model.n_engineers} runners in a marathon. Using only things like age,
              training hours, and gym visits — not running gait, injury
              history, or sleep — the model tries to guess each runner&rsquo;s
              finish time.
            </p>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-200/50 bg-emerald-50/40 p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-900/70">
                  Good at&hellip;
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-emerald-950/80">
                  <span className="font-semibold">Ranking.</span> Line up the
                  engineers from lowest to highest predicted impact and the
                  model gets the order ~{Math.round(metrics.spearman * 100)}%
                  right (Spearman ρ ={" "}
                  <span className="font-mono">
                    {metrics.spearman.toFixed(2)}
                  </span>
                  ). Top-quartile vs bottom-quartile comes through clearly.
                </p>
              </div>
              <div className="rounded-lg border border-amber-200/50 bg-amber-50/40 p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-amber-950/70">
                  Not good at&hellip;
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-amber-950/80">
                  <span className="font-semibold">Exact scores.</span> A typical
                  prediction is off by{" "}
                  <span className="font-mono">
                    {Math.round(metrics.mae).toLocaleString()}
                  </span>{" "}
                  impact points — big, given the median is{" "}
                  <span className="font-mono">
                    {Math.round(target.median).toLocaleString()}
                  </span>
                  . Don&rsquo;t read individual predictions as &ldquo;this
                  engineer should ship X.&rdquo;
                </p>
              </div>
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Bottom line:</span>{" "}
              useful for &ldquo;roughly where is Alice in the distribution?&rdquo;
              Not useful for &ldquo;what&rsquo;s Alice&rsquo;s exact number?&rdquo;
              Treat the important features as <em>correlates</em> of impact, not
              as levers you can pull.
            </p>
          </div>
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-5 lg:col-span-2">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Why the gap between ρ and R²?
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Impact has a long tail — a few engineers ship 3&ndash;5× the
              median (p95 ={" "}
              <span className="font-mono">
                {Math.round(target.p95).toLocaleString()}
              </span>
              , max ={" "}
              <span className="font-mono">
                {Math.round(target.max).toLocaleString()}
              </span>
              ). Features like tenure and Slack activity put these engineers in
              the right <em>neighbourhood</em>, but nothing in the current
              feature set explains the magnitude of their spike. Ranking
              survives; absolute prediction doesn&rsquo;t.
            </p>
            <div className="mt-4 border-t border-border/40 pt-3 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Target:</span>{" "}
              <code className="rounded bg-muted/50 px-1 font-mono text-[10px]">
                {target.formula}
              </code>{" "}
              over 360 days. Mean{" "}
              <span className="font-mono">
                {Math.round(target.mean).toLocaleString()}
              </span>
              , trained on log(1 + impact).
            </div>
          </div>
        </div>

        <div
          className="mt-4 grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${Math.min(
              Object.keys(model_comparison).length,
              3,
            )}, minmax(0, 1fr))`,
          }}
        >
          {Object.entries(model_comparison).map(([key, metrics]) => {
            const isChosen = model.chosen_model === key;
            const displayName = key
              .split("_")
              .map((s) => s[0].toUpperCase() + s.slice(1))
              .join(" ");
            return (
              <div
                key={key}
                className={`rounded-lg border p-4 ${
                  isChosen
                    ? "border-primary/50 bg-primary/5"
                    : "border-border/40 bg-muted/10"
                }`}
              >
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {displayName} {isChosen ? "(chosen)" : "(compared)"}
                </div>
                <div className="mt-1 flex items-baseline gap-4">
                  <span className="font-mono text-sm">
                    R²{" "}
                    <span className="font-medium">
                      {metrics.r2.toFixed(3)}
                    </span>
                  </span>
                  <span className="font-mono text-sm">
                    ρ{" "}
                    <span className="font-medium">
                      {metrics.spearman.toFixed(3)}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Feature importance */}
      <section>
        <SectionHead
          letter="B"
          title="Which features move the needle?"
          lede="Three views of the same question, from least to most intuitive: grouped categories (top), individual features (middle), and per-engineer reasoning (below)."
        />

        {/* Grouped importance */}
        <div className="mt-6 rounded-xl border border-border/60 bg-card p-5 shadow-warm">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Feature groups — share of model reasoning
              </div>
              <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
                Every feature bucketed by source. Percentages show what share
                of the model&rsquo;s reasoning comes from each category. If
                Tenure dominates, the model is mostly an experience-predictor;
                if Slack engagement is big, it&rsquo;s picking up work-style
                signals.
              </p>
            </div>
          </div>
          <GroupedImportanceChart data={model.grouped_importance} />
        </div>

        {/* Individual feature importance */}
        <div className="mt-4 rounded-xl border border-border/60 bg-card p-5 shadow-warm">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Individual features — permutation &amp; impurity
          </div>
          <FeatureImportanceChart features={features} topN={18} />
          {topFeature && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Top predictor:{" "}
              <span className="font-medium text-foreground">
                {topFeature.name.replace(/_/g, " ")}
              </span>
              . Removing it from the model drops performance by{" "}
              <span className="font-mono">
                {topFeature.permutation_mean.toFixed(3)}
              </span>{" "}
              (log-R² units). Permutation importance (darker) is the honest
              test — how much worse the model does when that feature is
              shuffled. Impurity (lighter) is the split-based importance most
              textbooks show.
            </p>
          )}
        </div>
      </section>

      {/* Per-feature deep dive */}
      <section>
        <SectionHead
          letter="C"
          title="Which things in an engineer's work move the model's prediction?"
          lede="One card per feature. Each answers: as this thing goes up, does the model expect more impact, less, or does it peak somewhere in the middle? Features with no clear story on their own are listed at the bottom rather than charted."
        />
        <div className="mt-6">
          <FeatureDeepDive
            partialDependence={model.partial_dependence}
            categoricalEffects={model.categorical_effects}
            baseline={model.shap.expected_impact}
          />
        </div>
      </section>

      {/* Per-engineer SHAP waterfall */}
      <section>
        <SectionHead
          letter="D"
          title="Why did the model predict this for a specific engineer?"
          lede="Pick an engineer below to see the exact path from the baseline prediction to their final score. Each step is one feature's contribution — green up, red down. This is how the model 'explains itself'."
        />
        <div className="mt-6">
          <ShapWaterfall
            engineers={engineers}
            expectedImpact={model.shap.expected_impact}
          />
        </div>
      </section>

      {/* Actual vs Predicted */}
      <section>
        <SectionHead
          letter="E"
          title="Does the model rank engineers well?"
          lede="Each dot is one engineer. Points on the dashed line are perfectly predicted. Above the line: the model over-predicted. Below: it under-predicted. Colour = discipline."
        />
        <div className="mt-6 rounded-xl border border-border/60 bg-card p-5 shadow-warm">
          <ActualVsPredicted engineers={engineers} />
        </div>
      </section>

      {/* Group stats */}
      <section>
        <SectionHead
          letter="F"
          title="Where does impact concentrate?"
          lede="Group median and mean impact. Bar = median (robust to outliers), line = mean (sensitive to top-end)."
        />
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <GroupBars data={model.by_discipline} title="By discipline" />
          <GroupBars data={model.by_level_track} title="By level track" />
          <GroupBars data={model.by_pillar} title="By pillar" />
        </div>
      </section>

      {/* Outliers */}
      <section>
        <SectionHead
          letter="G"
          title="Who surprises the model?"
          lede="The ten engineers whose actual output most diverged from the prediction. These are where the model's features don't tell the whole story — worth investigating."
        />
        <div className="mt-6">
          <OutlierTable engineers={engineers} />
        </div>
      </section>

      {/* Methodology */}
      <section>
        <SectionHead
          letter="H"
          title="Methodology"
          lede="Training pipeline, so you can re-run or replace it."
        />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Data sources
            </div>
            <ul className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
              <li>
                • <span className="text-foreground">Mode headcount SSoT</span> — active FTE
                engineers: tenure, level, specialisation, squad, pillar. Gender and location
                are extracted for diagnostic purposes but{" "}
                <span className="font-medium text-foreground">
                  deliberately excluded from the feature set
                </span>{" "}
                (see caveat below).
              </li>
              <li>
                • <span className="text-foreground">GitHub PR history</span> — 360-day PR count &
                lines changed per engineer, joined via github_employee_map.
              </li>
              <li>
                • <span className="text-foreground">Slack member snapshot</span> — messages,
                reactions, active-day rate, desktop share, channel share.
              </li>
              <li>
                • <span className="text-foreground">AI usage (Mode Query 3)</span> — total tokens,
                cost, distinct-days, models used per email.
              </li>
              <li>
                • <span className="text-foreground">Performance ratings</span> — avg & latest rating
                across review cycles.
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Training pipeline
            </div>
            <ol className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
              <li>
                <span className="font-mono text-[11px] text-foreground">1.</span> Extract features
                with <code className="rounded bg-muted/50 px-1 font-mono text-[11px]">
                  ml-impact/extract.sql
                </code>{" "}
                against prod Postgres.
              </li>
              <li>
                <span className="font-mono text-[11px] text-foreground">2.</span> Train & evaluate
                with{" "}
                <code className="rounded bg-muted/50 px-1 font-mono text-[11px]">
                  ml-impact/train.py
                </code>{" "}
                (RF + GBM, 5-fold CV, permutation importance).
              </li>
              <li>
                <span className="font-mono text-[11px] text-foreground">3.</span> Log-transform
                target (impact is long-tailed), pick the model with higher Spearman ρ.
              </li>
              <li>
                <span className="font-mono text-[11px] text-foreground">4.</span> Emit{" "}
                <code className="rounded bg-muted/50 px-1 font-mono text-[11px]">
                  src/data/impact-model.json
                </code>{" "}
                — this page reads it directly.
              </li>
            </ol>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-amber-200/50 bg-amber-50/40 p-4 text-xs leading-relaxed text-amber-950/70">
          <span className="font-medium">Caveats.</span> n = {model.n_engineers} is small. Only
          engineers who shipped at least one PR in the window are included. Impact rewards PR
          volume × log(lines changed), which under-credits review/design work. Perf-rating
          features are imputed with the median when missing, which dilutes their signal. Causal
          interpretations not warranted — treat high-permutation-importance features as{" "}
          <em>correlates</em> of impact, not levers.{" "}
          <span className="font-medium">Protected attributes</span> — gender and work-location are
          deliberately excluded from the feature set so the model cannot reflect or amplify
          protected-attribute gaps.{" "}
          <span className="font-medium">Re-identification</span> — although the committed JSON uses
          opaque &ldquo;Engineer NNN&rdquo; pseudonyms, the combination of pillar, discipline,
          level, and tenure-in-months is often unique in a ~141-person org, so a reader who knows
          the team could cross-reference entries back to individuals. Treat outputs accordingly.
        </div>
      </section>
    </div>
  );
}
