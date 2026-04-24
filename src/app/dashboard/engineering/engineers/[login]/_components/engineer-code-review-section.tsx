"use client";

import Link from "next/link";
import type {
  DiagnosticFlag,
  EngineerCodeReviewView,
  EngineerRollup,
  PrReviewEntry,
} from "@/lib/data/code-review";
import type {
  AnalysisCategory,
  AnalysisStandout,
  ModelAgreementLevel,
} from "@/lib/integrations/code-review-analyser";

const FLAG_LABEL: Record<DiagnosticFlag, string> = {
  low_evidence: "Light sample",
  low_confidence: "Model wasn't sure",
  quality_variance_high: "Mixed signals across PRs",
  review_churn_high: "Lots of review back-and-forth",
  has_concerning_pr: "PR worth a second look",
  reverted_pr: "Includes a revert",
};

const FLAG_TONE: Record<DiagnosticFlag, "warn" | "info" | "neutral"> = {
  low_evidence: "neutral",
  low_confidence: "info",
  quality_variance_high: "info",
  review_churn_high: "warn",
  has_concerning_pr: "warn",
  reverted_pr: "warn",
};

const FLAG_HELP: Record<DiagnosticFlag, string> = {
  low_evidence:
    "Not many PRs landed in this window — the model is being deliberately cautious here.",
  low_confidence:
    "The model flagged its own reading as unsure. Treat the score as a soft signal.",
  quality_variance_high:
    "Some PRs read very differently from others. Often just a function of varied work.",
  review_churn_high:
    "Several rounds of review or post-review commits. Could be a tricky change, could be a process tweak worth a chat.",
  has_concerning_pr:
    "One PR in the window is worth opening together — not necessarily a problem.",
  reverted_pr:
    "A merged PR was reverted within 14 days. Reverts happen — context usually explains it.",
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
  notably_complex: "Meaty piece of work",
  notably_high_quality: "Stand-out craft",
  notably_low_quality: "Worth a closer look",
  concerning: "Open this one together",
};

const STANDOUT_TONE: Record<AnalysisStandout, "good" | "warn"> = {
  notably_complex: "good",
  notably_high_quality: "good",
  notably_low_quality: "warn",
  concerning: "warn",
};

const AGREEMENT_LABEL: Record<ModelAgreementLevel, string> = {
  single_model: "Single-model read",
  confirmed: "Second opinion agreed",
  minor_adjustment: "Second opinion nudged it",
  material_adjustment: "Second opinion shifted it meaningfully",
};

function pillClass(
  active: boolean,
  tone: "warn" | "info" | "neutral" | "good",
): string {
  const base =
    "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors";
  const palette =
    tone === "warn"
      ? active
        ? "border-amber-500/60 bg-amber-500/15 text-amber-800"
        : "border-amber-500/30 bg-amber-500/5 text-amber-800"
      : tone === "info"
      ? active
        ? "border-sky-500/60 bg-sky-500/15 text-sky-700"
        : "border-sky-500/30 bg-sky-500/5 text-sky-700"
      : tone === "good"
      ? active
        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700"
        : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700"
      : active
      ? "border-primary/60 bg-primary/15 text-primary"
      : "border-border/60 bg-muted/10 text-muted-foreground";
  return `${base} ${palette}`;
}

export function EngineerCodeReviewSection({
  view,
}: {
  view: EngineerCodeReviewView;
}) {
  if (!view.engineer) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/10 p-5 text-sm text-muted-foreground">
        No merged PRs have been analysed for this engineer in the last{" "}
        {view.windowDays} days.{" "}
        <Link
          href="/dashboard/engineering/code-review"
          className="underline underline-offset-2 hover:text-primary"
        >
          Open the code review page
        </Link>{" "}
        to re-run the analysis.
      </div>
    );
  }

  const engineer = view.engineer;
  const lastAnalysed = view.analysedAtLatest
    ? new Date(view.analysedAtLatest).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {engineer.flags.map((flag) => (
            <span
              key={flag}
              title={FLAG_HELP[flag]}
              className={pillClass(false, FLAG_TONE[flag])}
            >
              {FLAG_LABEL[flag]}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 font-mono uppercase tracking-[0.08em]">
          <span>rubric {view.rubricVersion}</span>
          <span>· last refreshed {lastAnalysed}</span>
          <Link
            href="/dashboard/engineering/code-review"
            className="text-primary underline-offset-2 hover:underline"
          >
            Open full report
          </Link>
        </div>
      </div>

      <RollupSummary engineer={engineer} />

      <h3 className="pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Every PR read ({engineer.prs.length})
      </h3>
      {engineer.prs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No PRs merged in the last {view.windowDays} days.
        </p>
      ) : (
        <ul className="space-y-3">
          {engineer.prs.map((pr) => (
            <PrCard key={`${pr.repo}#${pr.prNumber}`} pr={pr} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RollupSummary({ engineer }: { engineer: EngineerRollup }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 shadow-warm">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Snapshot" value={String(Math.round(engineer.finalScore))} />
        <Stat label="Evidence" value={`${engineer.confidencePct}%`} />
        <Stat
          label="PRs read"
          value={`${engineer.prCount} (${engineer.effectivePrCount.toFixed(1)} eff.)`}
        />
        <Stat label="Mostly works on" value={engineer.cohort} />
        <Stat
          label="Avg execution"
          value={engineer.avgExecutionQuality.toFixed(1)}
        />
        <Stat label="Avg tests" value={engineer.avgTestAdequacy.toFixed(1)} />
        <Stat
          label="Avg risk handling"
          value={engineer.avgRiskHandling.toFixed(1)}
        />
        <Stat label="Avg landing" value={engineer.avgOutcomeScore.toFixed(0)} />
      </dl>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border/40 pt-3 sm:grid-cols-5">
        <Stat
          label="Craft (peer)"
          value={Math.round(engineer.qualityPercentile).toString()}
        />
        <Stat
          label="Challenge (peer)"
          value={Math.round(engineer.difficultyPercentile).toString()}
        />
        <Stat
          label="Landing (peer)"
          value={Math.round(engineer.reliabilityPercentile).toString()}
        />
        <Stat
          label="Review flow (peer)"
          value={Math.round(engineer.reviewHealthPercentile).toString()}
        />
        <Stat
          label="Throughput (peer)"
          value={Math.round(engineer.throughputPercentile).toString()}
        />
      </dl>
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
            {CATEGORY_LABEL[pr.category]} · merged {mergedAt} · mostly{" "}
            {pr.primarySurface}
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
        <Stat label="Risk handling" value={String(pr.riskHandling)} />
        <Stat label="Reviewability" value={String(pr.reviewability)} />
        <Stat label="Model confidence" value={`${pr.analysisConfidencePct}%`} />
        <Stat label="Landing" value={String(pr.outcomeScore)} />
        <Stat label="Review rounds" value={String(pr.reviewRounds)} />
        <Stat
          label="Commits post-review"
          value={String(pr.commitsAfterFirstReview)}
        />
        <Stat
          label="Comments"
          value={String(pr.reviewCommentCount + pr.conversationCommentCount)}
        />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        {pr.standout && (
          <span className={pillClass(false, STANDOUT_TONE[pr.standout])}>
            {STANDOUT_LABEL[pr.standout]}
          </span>
        )}
        {pr.revertWithin14d && (
          <span className={pillClass(false, "warn")}>
            Reverted within 14 days
          </span>
        )}
        {pr.secondOpinionUsed && (
          <span className={pillClass(false, "info")}>
            {AGREEMENT_LABEL[pr.agreementLevel]}
          </span>
        )}
      </div>

      {pr.caveats.length > 0 && (
        <div className="mt-3 rounded-md border border-border/40 bg-background/60 p-2 text-[12px] text-muted-foreground">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
            Caveats from the model
          </p>
          <ul className="mt-1 space-y-1">
            {pr.caveats.map((caveat, index) => (
              <li key={`${caveat}-${index}`}>– {caveat}</li>
            ))}
          </ul>
        </div>
      )}
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
