"use client";

import type { ImpactAnalysis } from "@/lib/data/engineering-impact";
import { ImpactFindings } from "./findings";
import { DistCleveland, DistHistogram } from "./distribution";
import {
  RampUpMain,
  RampUpSpaghetti,
  RampUpByDiscipline,
  RampUpByLevel,
} from "./ramp-up";
import { PillarBoxes, PillarCurves, PillarLollipop } from "./pillar";
import {
  BottomPerformers,
  TrajectoryScatter,
  WatchlistCaveat,
  WatchlistTable,
} from "./watchlist";
import {
  AiAdoptionByTenure,
  AiSpendVsImpactScatter,
  RampUpByAiUsage,
} from "./ai-tooling";

// Long-form variant for prose ("April 2026"). The chart in
// ai-tooling.tsx has its own short-form variant ("Apr 26") that fits
// inside an axis label — keeping them as two single-line helpers reads
// better than one helper with a `variant` argument.
function aiMonthLabel(iso: string | null): string {
  if (!iso) return "latest month";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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

export function ImpactReport({
  analysis,
  canSeeIndividuals,
}: {
  analysis: ImpactAnalysis;
  // When false (non-leadership viewers), hide charts that name or plot
  // individual engineers — Cleveland dots, spaghetti trajectories, pillar
  // box jitter, the entire watchlist section, and the AI spend scatter.
  // Aggregate shapes (histograms, median ramp-up curves, pillar curves,
  // cohorted AI ramp-ups) stay visible.
  canSeeIndividuals: boolean;
}) {
  const { engineers, tenureBuckets, metadata } = analysis;

  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-10">
      {/* Metadata strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-border/60 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>
          <span className="text-primary">› </span>data{" "}
          {fmtDate(metadata.dataStart)} → {fmtDate(metadata.dataEnd)}
        </span>
        <span>
          <span className="text-primary">› </span>
          {metadata.matchedEngineers}/{metadata.totalActiveEngineers} matched
        </span>
        <span>
          <span className="text-primary">› </span>
          {metadata.totalPrsInWindow.toLocaleString()} PRs
        </span>
        {metadata.modeLastSync && (
          <span>
            <span className="text-primary">› </span>mode sync{" "}
            {fmtDate(metadata.modeLastSync)}
          </span>
        )}
        {metadata.aiMatchedEngineers > 0 && (
          <span>
            <span className="text-primary">› </span>
            {metadata.aiMatchedEngineers} engineers w/ AI data
          </span>
        )}
      </div>

      {/* Executive summary */}
      <section className="space-y-4">
        <h2 className="font-display text-2xl italic tracking-tight text-foreground">
          Executive summary
        </h2>
        <ImpactFindings analysis={analysis} />
      </section>

      {/* What is the metric */}
      <section className="rounded-xl border-l-4 border-l-warning/60 border border-border/60 bg-muted/30 p-6">
        <h2 className="mb-4 font-display text-xl italic tracking-tight text-foreground">
          What is the &ldquo;impact&rdquo; metric?
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-sm text-foreground/85">
            <p>
              The metric lives on the Engineering page of this dashboard
              and is defined per engineer over a chosen window:
            </p>
            <pre className="overflow-x-auto rounded-md border border-border/60 bg-card p-3 font-mono text-[12px]">
              {metadata.impactFormula}
            </pre>
            <p>
              It&rsquo;s a hybrid: the count of merged pull requests
              multiplied by a log₂-dampened term for code volume. The
              log prevents one very large PR from dominating; the
              multiplier rewards throughput. An engineer with 10 PRs
              averaging 50 lines scores 56; 2 PRs averaging 250 lines
              scores 16.
            </p>
          </div>
          <div className="space-y-3 text-sm text-foreground/85">
            <p className="font-semibold text-foreground">
              How to read the charts
            </p>
            <ul className="space-y-1.5 text-[13px]">
              <li>
                <strong>Distributions</strong> use histograms + strip
                plots — you see both the shape and every individual
                engineer.
              </li>
              <li>
                <strong>Ramp-up curves</strong> show the median with a
                25–75th percentile band. Faint lines are individual
                trajectories.
              </li>
              <li>
                <strong>Sample size (n)</strong> is shown on every chart
                that splits the cohort. Cells with n &lt; 5 are hatched
                to flag low confidence.
              </li>
              <li>
                <strong>BE is green, FE is warm red</strong> (Okabe-Ito,
                colour-blind safe).
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Section A */}
      <section className="space-y-6">
        <SectionHead
          letter="A"
          title="Distribution of impact"
          lede="Before we talk about ramp-up, we need to see the shape of the metric itself. Where do engineers sit, and how wide is the spread?"
        />
        {/* The Cleveland dot plot already shows every individual engineer
            and the histogram shows the binned shape — together they answer
            "where do people sit?" and "how skewed is the distribution?".
            Earlier iterations also rendered ridgelines, violins, and a
            heatmap of the same numbers; with ~150 ICs the extra views
            mostly restated the same shape, so we cut them per Tufte's
            data-density principle. The cohort-by-cohort view lives in
            Section B (ramp-up) and Section C (pillar). */}
        {canSeeIndividuals && <DistCleveland engineers={engineers} />}
        <DistHistogram engineers={engineers} />
      </section>

      {/* Section B */}
      <section className="space-y-6">
        <SectionHead
          letter="B"
          title="Ramp-up & time to steady state"
          lede="The central question: how long does a new engineer take to reach the typical impact of their tenured peers?"
        />
        <RampUpMain engineers={engineers} buckets={tenureBuckets} />
        {canSeeIndividuals && (
          <RampUpSpaghetti engineers={engineers} buckets={tenureBuckets} />
        )}
        <RampUpByDiscipline engineers={engineers} buckets={tenureBuckets} />
        <RampUpByLevel engineers={engineers} buckets={tenureBuckets} />
      </section>

      {/* Section C */}
      <section className="space-y-6">
        <SectionHead
          letter="C"
          title="Does ramp-up differ by pillar?"
          lede="Pillars differ in codebase maturity, tooling, onboarding, squad size, and manager. How much does ramp-up actually diverge?"
        />
        {canSeeIndividuals && <PillarBoxes engineers={engineers} />}
        <PillarCurves engineers={engineers} buckets={tenureBuckets} />
        <PillarLollipop engineers={engineers} buckets={tenureBuckets} />
      </section>

      {/* Section D — leadership only: names individuals as low performers. */}
      {canSeeIndividuals && (
        <section className="space-y-6">
          <SectionHead
            letter="D"
            title="Who to be concerned about"
            lede="Engineers whose PR output is meaningfully below peers at the same level and discipline — or whose recent trajectory is sharply down versus their own 90-day baseline."
          />
          <WatchlistCaveat />
          <BottomPerformers engineers={engineers} />
          <TrajectoryScatter engineers={engineers} />
          <WatchlistTable engineers={engineers} />
        </section>
      )}

      {/* Section E */}
      <section className="space-y-6">
        <SectionHead
          letter="E"
          title="AI tooling — does it move the needle?"
          lede={`Three lenses on whether AI usage shows up in shipping output. Cohort: ICs with AI usage rows in the ${aiMonthLabel(metadata.aiMonthStart)} (${metadata.aiMatchedEngineers} of ${metadata.matchedEngineers} matched engineers).`}
        />
        {canSeeIndividuals && (
          <AiSpendVsImpactScatter engineers={engineers} />
        )}
        <RampUpByAiUsage engineers={engineers} buckets={tenureBuckets} />
        <AiAdoptionByTenure engineers={engineers} />
      </section>

      {/* Methodology appendix */}
      <section className="rounded-xl border-t-4 border-t-foreground border border-border/60 bg-muted/20 p-6">
        <h2 className="mb-4 font-display text-xl italic tracking-tight text-foreground">
          Methodology & caveats
        </h2>
        <div className="grid gap-6 text-[13px] text-foreground/85 lg:grid-cols-2">
          <div className="space-y-3">
            <p>
              <strong>Metric.</strong>{" "}
              <code className="font-mono text-[11px]">
                impact = round(prs × log₂(1 + (add+del)/prs))
              </code>
              . Mirrors the Engineering page table. PRs only — reviews and
              commits are not in the formula.
            </p>
            <p>
              <strong>Tenure buckets.</strong> 30-day windows from{" "}
              <code className="font-mono text-[11px]">start_date</code>. A
              bucket contributes to ramp-up aggregations only if it&rsquo;s
              fully inside the reliable data window.
            </p>
            <p>
              <strong>90-day rolling.</strong> Each ramp-up data point sums
              3 consecutive tenure-month buckets per engineer, then
              medians across engineers. Smooths legitimate zero-PR months
              and matches the main dashboard&rsquo;s <code>impact_90d</code>.
            </p>
            <p>
              <strong>Steady state.</strong> Median{" "}
              <code>impact_90d</code> across ICs with tenure ≥ 18 months.
              Larger, more stable sample than any single tenure-month
              cohort.
            </p>
          </div>
          <div className="space-y-3">
            {canSeeIndividuals && (
              <>
                <p>
                  <strong>Peer group (D.1–D.3).</strong> Other ICs at the
                  same level and discipline. Minimum 5 peers; fewer marks an
                  engineer &ldquo;uncomparable&rdquo; (excluded from the
                  watchlist).
                </p>
                <p>
                  <strong>Declining trajectory.</strong>{" "}
                  <code>impact_30d × 3 &lt; 0.6 × impact_90d</code> and the
                  engineer has a meaningful baseline (≥ 50).
                </p>
              </>
            )}
            <p>
              <strong>Reliable window.</strong> GitHub sync has been
              backfilled unevenly — we auto-detect the first calendar
              month with ≥ 40% of the median month&rsquo;s PR volume and
              only count tenure buckets that fall entirely inside that
              window. Current window: <code>{metadata.dataStart}</code> →{" "}
              <code>{metadata.dataEnd}</code> (
              {metadata.dataWindowDays} days).
            </p>
            <p>
              <strong>Match rate.</strong> Of {metadata.totalActiveEngineers}{" "}
              active engineers, {metadata.matchedEngineers} (
              {Math.round(
                (metadata.matchedEngineers /
                  metadata.totalActiveEngineers) *
                  100,
              )}
              %) map to a GitHub login. The remaining{" "}
              {metadata.unmatchedEngineers} are bots, new starters, or
              low-confidence LLM matches.
            </p>
            <p>
              <strong>AI usage join.</strong> Section E joins{" "}
              <code>aggregateLatestMonthByUser()</code> from the AI Model
              Usage Mode dashboard by lowercase email — combining Claude
              and Cursor spend per engineer. Bedrock data is reliable
              from <code>{metadata.aiDataStart}</code>; engineers with
              no usage row in {aiMonthLabel(metadata.aiMonthStart)} are
              treated as <em>no AI</em> in E.2 / E.3 (rather than $0,
              which would conflate &ldquo;chose not to use&rdquo; with
              &ldquo;not yet matched in the dataset&rdquo;).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
