# B-side composite — gaming analysis

**Owner:** Implementer (Cycle 13)
**Methodology version:** `b-1.0.0`
**Date:** 2026-04-24

## Purpose

The B-side composite ranks engineers on five capped, cohort-relative signals.
Whenever a single number drives a high-stakes outcome, the laziest paths to
move it deserve to be enumerated and the defences spelled out. This worklog
catalogues the most plausible gaming strategies and the existing controls
that bound them. It is the document the CEO can show any engineer who asks
"could I just X?"

The reference is `src/lib/data/engineering-composite.ts` — every defence
named below points at a constant or function exported from that module.

## Threat model

The only signals the composite reads are:

1. `prCount` — merged PRs in the 180-day window
2. `analysedPrCount` — subset of those that passed the rubric pipeline
3. Rubric axis means (execution / tests / risk / reviewability),
   confidence-weighted and difficulty-weighted (`COMPOSITE_MIN_ANALYSED_PRS = 3`)
4. `revertRate` — fraction of analysed PRs reverted within 14 days
5. `reviewParticipationRate` — fraction with ≥1 review round
6. `medianTimeToMergeMinutes` — median PR cycle time

There is **no AI-spend, LOC, commit-count, Slack, or impact-model input.**
The M3 audit excluded the impact-model entirely from B-side; the gaming
vectors that audit identified (monotonic AI-spend climb, PR-cadence
proxies for Slack engagement) are simply not addressable by anyone in
B-side — they cannot move a signal that does not exist.

## Lazy strategies and existing defences

### G1. PR volume spam (split a real PR into 5 trivial ones)

**Strategy.** Author splits work into many small PRs to inflate `prCount` and
`analysedPrCount`.

**What this moves.** Delivery raw value (`extractDeliveryRaw` —
`log(1 + prCount)`).

**Defences in code.**
- **Cohort winsor cap** — `COMPOSITE_DELIVERY_WINSOR_P = 0.9` clips raw
  delivery at the cohort 90th percentile (`winsorizeAtPercentile` in
  `engineering-composite.ts`). A 70-PR superspammer is read as if they
  shipped roughly the cohort top decile, not 5x the median.
- **Log compression** — `Math.log(1 + prs)` flattens the long tail
  before the cap. Going from 20 to 40 PRs adds ~0.5; going from 5 to 10
  PRs adds ~0.7. The marginal gain on volume above the median is small.
- **Quality gate** — splitting work doesn't move rubric axes. The 30%
  weight on quality means a flood of trivial PRs dilutes mean
  `executionQuality` rather than amplifying delivery.
- **Reliability gate** — sloppy small PRs that get reverted feed
  `revertRate`, dragging reliability (20% weight) down.

**Residual risk.** A disciplined splitter whose small PRs are all clean
and well-reviewed could move delivery from say P40 to P75 and gain a few
composite points. They cannot rocket from bottom to top.

### G2. Review-round fluffing (force a stamp on every self-merge)

**Strategy.** Always add a co-worker to review your PRs even when
unnecessary, to push `reviewParticipationRate` to 1.0.

**What this moves.** Review discipline (15% weight).

**Defences in code.**
- **Cap.** `extractReviewDisciplineRaw` clamps to `[0, 1]` already.
- **Rubric pairing.** Quality (30%) is rated independently of who
  reviewed. A stamped review without substantive feedback doesn't move
  the rubric axes; the LLM rates the diff as it stands.
- **Cycle-time tradeoff.** Forcing reviews adds latency; cycle-time
  signal (15% weight) reads slower as a result.
- **Single-signal cap.** `COMPOSITE_MAX_SINGLE_WEIGHT = 0.30`. Even a
  perfect 1.0 review-discipline signal contributes at most 15% of the
  composite.

**Residual risk.** An engineer at the median who pushes review
discipline to the cohort top 25% and absorbs the cycle-time loss might
gain 3-5 composite points.

### G3. Cycle-time micro-PR farming (merge tiny PRs in minutes)

**Strategy.** Open and merge dozens of one-line PRs on autopilot to
crash median time-to-merge.

**What this moves.** Cycle time inverse.

**Defences in code.**
- **Floor clamp.** `COMPOSITE_CYCLE_TIME_FLOOR_MIN = 30` — anything
  faster than 30 minutes is treated as 30 minutes
  (`extractCycleTimeRaw`).
- **Cap clamp.** `COMPOSITE_CYCLE_TIME_CAP_HOURS = 14 * 24` (14 days);
  mirror at the slow end so abandoned PRs don't dominate either tail.
- **Volume cap.** Each micro-PR also feeds `prCount`, which is winsorized
  (G1).
- **Quality and reliability.** Micro-PRs add no rubric mass and any
  bad-merge revert tanks reliability.

**Residual risk.** Cycle-time signal moves smoothly within
`[30 min, 14 day]`. The bounded inverse means the gain from gaming is
linear, not exponential.

### G4. Rubber-stamp reviewing (write reviews that don't push back)

**Strategy.** Get reviewed by a peer who never blocks anything, so
review discipline ticks up but rubric stays high.

**What this moves.** Review discipline directly. Quality and reliability
indirectly (because rubber-stamped low-quality code is more likely to
revert).

**Defences in code.**
- The composite **does not score reviewers**. Rubber-stamping costs the
  reviewer nothing in the composite, but it doesn't help the author
  either: the LLM rubric is independent of who clicked Approve.
- **Rubric difficulty weighting.** A trivial change rated by the rubric
  contributes less to `quality` than a difficult one — rubber-stamping a
  big, gnarly change still leaves rubric axes free to flag the issues.
- **Reliability.** A revert within 14 days is unforgiving regardless of
  who approved the PR.

**Residual risk.** The composite does not detect cliques where two
engineers exchange rubber-stamps. That is a leadership question, not a
math question; the manager view's drilldown shows authored PRs with
their evidence so a curious manager can spot a pattern.

### G5. Cherry-picking work to dodge difficult assignments

**Strategy.** Author only easy PRs, route hard refactors to teammates,
to keep `executionQuality` mean high.

**What this moves.** Quality (in the wrong direction — toward inflated
mean on trivial work).

**Defences in code.**
- **Difficulty weighting.** The rubric pipeline weights each PR by its
  `technicalDifficultyMean`. A book full of easy PRs is rated as a book
  full of easy PRs, not a book of perfect engineering.
- **Delivery balance.** If you ship 20 trivial PRs and 0 hard ones, you
  read top of the cohort on volume but middling on quality, because the
  difficulty-weighted mean stays modest.
- **Methodology disclosure.** The methodology panel says outright:
  "weighted by technical difficulty." A reviewer can ask "why is your
  cohort difficulty mean below median?" and have a defensible answer.

**Residual risk.** This is the most plausible gaming path because it
trades genuine signal for a composite delta. The defence is the
disclosure: a CEO can ask the question; an engineer who cannot answer
it has been spotted.

### G6. Avoiding revert-tracked merges (force-pushes or non-PR merges)

**Strategy.** Bypass GitHub PRs entirely so `revertRate` cannot be
computed.

**What this moves.** Reliability (and indirectly delivery, which counts
merged PRs).

**Defences in code.**
- **Insufficient-signal triage.** If fewer than 3 of 5 signals populate
  (`COMPOSITE_MIN_SIGNALS_FOR_SCORE = 3`), the engineer is unscored —
  status `unscored_insufficient_signals`. Bypassing the PR pipeline
  removes the engineer from the rank entirely; they cannot game their
  way to the top this way.
- **Operational guard.** Cleo's GitHub branch protection requires PRs
  on protected branches — direct push is not normally available.

**Residual risk.** A leaver-style total absence is detected as
`unscored_unmapped` or `unscored_leaver` and surfaces in coverage rather
than rank.

### G7. Tenure laundering (claim partial-window scoring forever)

**Strategy.** Argue you are still ramping up so the delivery pro-rate
keeps inflating your raw value.

**What this moves.** Delivery via `tenureFactorFor` pro-rate.

**Defences in code.**
- **Status visibility.** `partial_window_scored` is a status set by code
  — `tenureFactor > 1` strictly implies that status. The methodology
  panel and drilldown show the tenure factor explicitly.
- **Confidence penalty.** `CONFIDENCE_TENURE_PENALTY_PER_UNIT = 3`
  widens the band by 3 points for every unit of `tenureFactor - 1`.
  A 60-day engineer with `tenureFactor = 3` gains a `+6` half-width
  penalty, so even if they look "above median" the band swallows the
  difference and ties them with the median group.
- **Manager flag suppression.** A partial-window engineer wide enough to
  straddle a quartile boundary is flag-ineligible (M9). The promote /
  PM label cannot fire on a tenure-laundering rocket ship.

### G8. Cohort manipulation (move into a low-cohort discipline)

**Strategy.** Engineer reclassifies their discipline (e.g. BE -> FE) so
their percentile shifts in the easier cohort.

**What this moves.** All cohort percentiles.

**Defences in code.**
- **Cohort minimum.** `COMPOSITE_MIN_COHORT_SIZE = 3`. A discipline
  cohort below 3 is flagged `unscored_small_cohort`; the entire group
  exits the rank.
- **Ground-truth source.** Discipline comes from the Headcount SSoT,
  which is HR-managed and not author-self-declared. The github
  `username` mapping does not let an engineer relabel themselves.

### G9. Single-signal pump (max one signal, ignore others)

**Strategy.** Run all of the gaming above on one signal.

**What this moves.** That signal's contribution.

**Defences in code.**
- **Single-signal cap.** Nominal weights are bounded at
  `COMPOSITE_MAX_SINGLE_WEIGHT = 0.30`. After missing-signal
  re-normalisation, an engineer with only one populated signal still has
  their effective weight on that signal **clamped at 30%**. The other
  70% lands as zero, dragging the composite toward the floor.
- **Methodology cross-check.** The methodology metadata exposes weight
  caps verbatim; the cross-check test asserts the copy matches the code,
  so the disclosure cannot drift.

## Bottom-line summary

Across G1-G9 there is no single move that climbs an engineer from the
bottom quartile to the top. Each defensible move costs another signal.
The lazy paths cap at "a few composite points" — meaningful inside a
tie group but not enough to outrun the confidence band into a
promote-flag (which requires both score and band to be clear of the
non-quartile envelope, M8/M9).

The real residual risk is **G5 (cherry-picking easy work)** because the
information loss is genuine. The control there is methodology
disclosure plus the manager-view drilldown: every promote / PM
candidate's evidence pack is on the page; the questions a CEO would
need to ask are visible by default.

## What this analysis does not address

- **Collusion** between two or more engineers (G4 in scale). The
  composite is per-engineer; coordinated gaming across a clique cannot
  be detected mathematically. Expect leadership signals, not a code
  fix.
- **Long-term identity drift.** If an engineer changes role / squad /
  pillar mid-window, the cohort percentile is computed against the
  current pillar/squad as of the snapshot. Historical re-org churn is
  not modelled.
- **Latent bias in the LLM rubric.** The rubric scores rely on
  `prReviewAnalyses`. If the LLM systematically under-rates a style
  group, every author in that group reads slightly lower. The
  rubric-version bump (`RUBRIC_VERSION` in
  `src/lib/integrations/code-review-analyser.ts`) is the existing
  mitigation.

These are caveats for the CEO to know, not gaps the M13 controls were
expected to close.
