"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  CodeReviewView,
  DiagnosticFlag,
  EngineerRollup,
  PrReviewEntry,
} from "@/lib/data/code-review";
import type {
  AnalysisCategory,
  AnalysisStandout,
  ModelAgreementLevel,
  SecondOpinionReason,
} from "@/lib/integrations/code-review-analyser";

const FLAG_LABEL: Record<DiagnosticFlag, string> = {
  low_evidence: "Low evidence",
  low_confidence: "Low confidence",
  quality_variance_high: "Quality varies a lot",
  review_churn_high: "Review churn is high",
  has_concerning_pr: "Has a concerning PR",
  reverted_pr: "Has a reverted PR",
};

const FLAG_TONE: Record<DiagnosticFlag, "warn" | "info" | "neutral"> = {
  low_evidence: "neutral",
  low_confidence: "info",
  quality_variance_high: "warn",
  review_churn_high: "warn",
  has_concerning_pr: "warn",
  reverted_pr: "warn",
};

const CATEGORY_LABEL: Record<AnalysisCategory, string> = {
  bug_fix: "Bug fix",
  feature: "Feature",
  refactor: "Refactor",
  infra: "Infra",
  test: "Tests",
  docs: "Docs",
  chore: "Chore",
};

const STANDOUT_LABEL: Record<AnalysisStandout, string> = {
  notably_complex: "Notably complex",
  notably_high_quality: "Notably high quality",
  notably_low_quality: "Notably low quality",
  concerning: "Concerning",
};

const STANDOUT_TONE: Record<AnalysisStandout, "good" | "warn"> = {
  notably_complex: "good",
  notably_high_quality: "good",
  notably_low_quality: "warn",
  concerning: "warn",
};

const AGREEMENT_LABEL: Record<ModelAgreementLevel, string> = {
  single_model: "Single-model review",
  confirmed: "Second opinion confirmed",
  minor_adjustment: "Second opinion adjusted slightly",
  material_adjustment: "Second opinion adjusted materially",
};

const SECOND_OPINION_LABEL: Record<SecondOpinionReason, string> = {
  truncated_diff: "Truncated diff",
  large_pr: "Large PR",
  low_confidence: "Low confidence",
  concerning_flag: "Concerning signal",
  review_churn: "Review churn",
  revert_signal: "Revert signal",
};

export function CodeReviewReport({ view }: { view: CodeReviewView }) {
  const [activeFlag, setActiveFlag] = useState<DiagnosticFlag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (!activeFlag) return view.engineers;
    return view.engineers.filter((engineer) => engineer.flags.includes(activeFlag));
  }, [view.engineers, activeFlag]);

  const selectedEngineer = useMemo(
    () => view.engineers.find((engineer) => engineer.authorLogin === selected) ?? null,
    [view.engineers, selected],
  );

  return (
    <div className="space-y-6">
      <Header view={view} />
      <CalibrationBanner />
      <FlagPills view={view} active={activeFlag} onChange={setActiveFlag} />
      <EngineerTable
        rows={visible}
        windowDays={view.windowDays}
        onSelect={setSelected}
      />
      {selectedEngineer && (
        <Drawer engineer={selectedEngineer} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Header({ view }: { view: CodeReviewView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setStatus(null);
    setError(null);
    try {
      const res = await fetch("/api/sync/code-review", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const remaining =
        body.candidatesConsidered - body.cached - body.analysed;
      const suffix =
        remaining > 0
          ? ` · ${remaining} PR${remaining === 1 ? "" : "s"} still pending.`
          : "";
      setStatus(
        `Analysed ${body.analysed}, cached ${body.cached}, failed ${body.failed.length}.${suffix}`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const lastAnalysed = view.analysedAtLatest
    ? new Date(view.analysedAtLatest).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          Engineering · Code review
        </p>
        <h1 className="mt-1 font-display text-3xl italic tracking-tight text-foreground">
          Code review quality over the last {view.windowDays} days
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every merged PR is reviewed against a richer rubric, blended with
          GitHub review-process signals, and rolled up into cohort-relative,
          confidence-aware percentiles. The final score is shrunk toward the
          cohort mean when evidence is thin.
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-mono uppercase tracking-[0.08em]">
            rubric {view.rubricVersion}
          </span>
          <span className="font-mono uppercase tracking-[0.08em]">
            · {view.totalPrs} PRs
          </span>
          <span className="font-mono uppercase tracking-[0.08em]">
            · last run {lastAnalysed}
          </span>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {isPending ? "Refreshing…" : "Re-run analysis"}
        </button>
        {status && <span className="text-[11px] text-primary">{status}</span>}
        {error && <span className="text-[11px] text-rose-600">{error}</span>}
      </div>
    </div>
  );
}

function CalibrationBanner() {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">
        Calibration input, not a verdict.
      </span>{" "}
      This page is still an LLM-assisted view of merged code. It is stronger
      than the old complexity × quality rollup, but it should still inform a
      diagnostic conversation rather than substitute for manager judgement.
    </div>
  );
}

function FlagPills({
  view,
  active,
  onChange,
}: {
  view: CodeReviewView;
  active: DiagnosticFlag | null;
  onChange: (flag: DiagnosticFlag | null) => void;
}) {
  const counts = useMemo(() => {
    const output = {} as Record<DiagnosticFlag, number>;
    for (const engineer of view.engineers) {
      for (const flag of engineer.flags) {
        output[flag] = (output[flag] ?? 0) + 1;
      }
    }
    return output;
  }, [view.engineers]);

  const flags = (Object.keys(FLAG_LABEL) as DiagnosticFlag[]).filter(
    (flag) => (counts[flag] ?? 0) > 0,
  );

  if (flags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Diagnostic filters:
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={pillClass(active === null, "neutral")}
      >
        All ({view.engineers.length})
      </button>
      {flags.map((flag) => (
        <button
          key={flag}
          type="button"
          onClick={() => onChange(active === flag ? null : flag)}
          className={pillClass(active === flag, FLAG_TONE[flag])}
        >
          {FLAG_LABEL[flag]} ({counts[flag]})
        </button>
      ))}
    </div>
  );
}

function pillClass(
  active: boolean,
  tone: "warn" | "info" | "neutral" | "good",
): string {
  const base =
    "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors";
  const palette =
    tone === "warn"
      ? active
        ? "border-rose-500/60 bg-rose-500/15 text-rose-700"
        : "border-rose-500/30 bg-rose-500/5 text-rose-700 hover:bg-rose-500/10"
      : tone === "info"
      ? active
        ? "border-sky-500/60 bg-sky-500/15 text-sky-700"
        : "border-sky-500/30 bg-sky-500/5 text-sky-700 hover:bg-sky-500/10"
      : tone === "good"
      ? active
        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700"
        : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10"
      : active
      ? "border-primary/60 bg-primary/15 text-primary"
      : "border-border/60 bg-muted/10 text-muted-foreground hover:bg-muted/20";
  return `${base} ${palette}`;
}

function EngineerTable({
  rows,
  windowDays,
  onSelect,
}: {
  rows: EngineerRollup[];
  windowDays: number;
  onSelect: (login: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/10 p-5 text-sm text-muted-foreground">
        No engineers match the current filter. Change the filter or re-run the
        analysis if nothing has been scored yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card shadow-warm">
      <table className="min-w-full text-[12px]">
        <thead className="bg-muted/20 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Engineer</th>
            <th className="px-3 py-2 text-left">Cohort</th>
            <th className="px-3 py-2 text-right">PRs</th>
            <th className="px-3 py-2 text-right">Confidence</th>
            <th className="px-3 py-2 text-right">Quality pct</th>
            <th className="px-3 py-2 text-right">Difficulty pct</th>
            <th className="px-3 py-2 text-right">Outcome pct</th>
            <th className="px-3 py-2 text-right">Final</th>
            <th className="px-3 py-2 text-right">{`vs prev ${windowDays}d`}</th>
            <th className="px-3 py-2 text-left">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((engineer, index) => (
            <tr
              key={engineer.authorLogin}
              onClick={() => onSelect(engineer.authorLogin)}
              className={`cursor-pointer border-t border-border/40 hover:bg-primary/5 ${
                index % 2 === 0 ? "bg-transparent" : "bg-muted/10"
              }`}
            >
              <td className="px-3 py-2 font-mono text-muted-foreground">
                {index + 1}
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-foreground">
                  {engineer.employeeName ?? engineer.authorLogin}
                </div>
                {engineer.employeeName && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    @{engineer.authorLogin}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <span className="rounded-full border border-border/60 bg-muted/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  {engineer.cohort}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {engineer.prCount}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({engineer.effectivePrCount.toFixed(1)} eff.)
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {engineer.confidencePct}%
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {Math.round(engineer.qualityPercentile)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {Math.round(engineer.difficultyPercentile)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {Math.round(engineer.reliabilityPercentile)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">
                {Math.round(engineer.finalScore)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                <DeltaCell
                  current={engineer.finalScore}
                  prev={engineer.prevFinalScore}
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {engineer.flags.map((flag) => (
                    <span
                      key={flag}
                      className={pillClass(false, FLAG_TONE[flag])}
                    >
                      {FLAG_LABEL[flag]}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeltaCell({
  current,
  prev,
}: {
  current: number;
  prev: number | null;
}) {
  if (prev === null) return <span className="text-muted-foreground">—</span>;
  const delta = current - prev;
  if (delta === 0) return <span className="text-muted-foreground">—</span>;
  const pct = prev > 0 ? (delta / prev) * 100 : null;
  const color =
    delta > 0
      ? "text-emerald-600"
      : delta < 0
      ? "text-rose-600"
      : "text-muted-foreground";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={color}>
      {sign}
      {Math.round(delta)}
      {pct !== null && (
        <span className="ml-1 text-[10px]">
          ({sign}
          {Math.round(pct)}%)
        </span>
      )}
    </span>
  );
}

function Drawer({
  engineer,
  onClose,
}: {
  engineer: EngineerRollup;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-border/60 bg-card p-5 shadow-warm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div>
            <h2 className="font-display text-2xl italic tracking-tight text-foreground">
              {engineer.employeeName ?? engineer.authorLogin}
            </h2>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              @{engineer.authorLogin}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {engineer.flags.map((flag) => (
                <span key={flag} className={pillClass(false, FLAG_TONE[flag])}>
                  {FLAG_LABEL[flag]}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted/20"
          >
            Close
          </button>
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Final score" value={String(Math.round(engineer.finalScore))} />
          <Stat label="Confidence" value={`${engineer.confidencePct}%`} />
          <Stat label="PRs" value={`${engineer.prCount} (${engineer.effectivePrCount.toFixed(1)} eff.)`} />
          <Stat label="Cohort" value={engineer.cohort} />
          <Stat label="Avg exec quality" value={engineer.avgExecutionQuality.toFixed(1)} />
          <Stat label="Avg tests" value={engineer.avgTestAdequacy.toFixed(1)} />
          <Stat label="Avg risk" value={engineer.avgRiskHandling.toFixed(1)} />
          <Stat label="Avg outcome" value={engineer.avgOutcomeScore.toFixed(0)} />
        </dl>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Quality pct" value={Math.round(engineer.qualityPercentile).toString()} />
          <Stat label="Difficulty pct" value={Math.round(engineer.difficultyPercentile).toString()} />
          <Stat label="Outcome pct" value={Math.round(engineer.reliabilityPercentile).toString()} />
          <Stat label="Review pct" value={Math.round(engineer.reviewHealthPercentile).toString()} />
          <Stat label="Throughput pct" value={Math.round(engineer.throughputPercentile).toString()} />
        </div>

        {engineer.weeklyScore.length > 1 && (
          <div className="mb-4 rounded-lg border border-border/40 bg-muted/5 p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
              Weekly PR score trend (oldest → newest)
            </p>
            <Sparkline values={engineer.weeklyScore} />
          </div>
        )}

        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          PRs ({engineer.prs.length})
        </h3>
        <ul className="space-y-3">
          {engineer.prs.map((pr) => (
            <PrCard key={`${pr.repo}#${pr.prNumber}`} pr={pr} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mt-2 flex h-10 items-end gap-1">
      {values.map((value, index) => {
        const heightPct = (value / max) * 100;
        return (
          <div
            key={index}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <div
              className="w-full rounded-sm bg-primary/70"
              style={{ height: `${Math.max(8, heightPct)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function PrCard({ pr }: { pr: PrReviewEntry }) {
  const mergedAt = new Date(pr.mergedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  return (
    <li className="rounded-lg border border-border/50 bg-muted/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a
            href={pr.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {pr.repo} #{pr.prNumber}
          </a>
          <p className="mt-1 text-sm text-foreground">{pr.summary}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {CATEGORY_LABEL[pr.category]} · merged {mergedAt} · surface {pr.primarySurface}
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-semibold text-foreground">
            {Math.round(pr.prScore)}
          </div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            PR score
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5">
        <Stat label="Difficulty" value={String(pr.technicalDifficulty)} />
        <Stat label="Execution" value={String(pr.executionQuality)} />
        <Stat label="Tests" value={String(pr.testAdequacy)} />
        <Stat label="Risk" value={String(pr.riskHandling)} />
        <Stat label="Reviewability" value={String(pr.reviewability)} />
        <Stat label="Confidence" value={`${pr.analysisConfidencePct}%`} />
        <Stat label="Outcome" value={String(pr.outcomeScore)} />
        <Stat label="Review rounds" value={String(pr.reviewRounds)} />
        <Stat label="Commits post-review" value={String(pr.commitsAfterFirstReview)} />
        <Stat label="Comments" value={String(pr.reviewCommentCount + pr.conversationCommentCount)} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        {pr.standout && (
          <span className={pillClass(false, STANDOUT_TONE[pr.standout])}>
            {STANDOUT_LABEL[pr.standout]}
          </span>
        )}
        {pr.revertWithin14d && (
          <span className={pillClass(false, "warn")}>Reverted within 14d</span>
        )}
        {pr.secondOpinionUsed && (
          <span className={pillClass(false, "info")}>
            {AGREEMENT_LABEL[pr.agreementLevel]}
          </span>
        )}
      </div>

      {pr.secondOpinionUsed && pr.secondOpinionReasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {pr.secondOpinionReasons.map((reason) => (
            <span key={reason} className={pillClass(false, "neutral")}>
              {SECOND_OPINION_LABEL[reason]}
            </span>
          ))}
        </div>
      )}

      {pr.caveats.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground">
          {pr.caveats.map((caveat, index) => (
            <li key={`${caveat}-${index}`}>- {caveat}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {pr.reviewProvider} · {pr.reviewModel}
      </p>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[12px] text-foreground">{value}</dd>
    </div>
  );
}
