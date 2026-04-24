"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  CodeReviewView,
  DiagnosticFlag,
  EngineerRollup,
  PrReviewEntry,
  SecondLookReason,
  SquadCodeReviewView,
  SquadRollup,
} from "@/lib/data/code-review";
import type {
  AnalysisCategory,
  AnalysisStandout,
  ModelAgreementLevel,
  SecondOpinionReason,
} from "@/lib/integrations/code-review-analyser";

type ReviewMode = "engineers" | "squads";

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
    "More review back-and-forth than similar-type, similar-difficulty PRs in this window. Refactors and features naturally churn more than chores — this adjusts for that.",
  has_concerning_pr:
    "At least one PR is worth opening together — either the model flagged it, or review signals did (heavy change requests, post-review churn, a revert). Not necessarily a problem.",
  reverted_pr:
    "A merged PR was reverted within 14 days. Reverts happen — context usually explains it.",
};

const SECOND_LOOK_LABEL: Record<SecondLookReason, string> = {
  model_flagged_concerning: "Model raised a concern",
  model_flagged_low_quality: "Model read it as low quality",
  reverted_within_14d: "Reverted within 14 days",
  heavy_change_requests: "Lots of change requests",
  heavy_post_review_commits: "Many post-review commits",
  low_landing_high_churn: "Rough landing with heavy review",
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

const SECOND_OPINION_LABEL: Record<SecondOpinionReason, string> = {
  truncated_diff: "Diff was long",
  large_pr: "Large PR",
  low_confidence: "Initial read was unsure",
  concerning_flag: "First model raised something",
  review_churn: "Lots of review activity",
  revert_signal: "Revert nearby",
};

export function CodeReviewReport({
  view,
  squadView,
}: {
  view: CodeReviewView;
  squadView: SquadCodeReviewView;
}) {
  const [mode, setMode] = useState<ReviewMode>("engineers");
  const [activeFlag, setActiveFlag] = useState<DiagnosticFlag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (!activeFlag) return view.engineers;
    return view.engineers.filter((engineer) => engineer.flags.includes(activeFlag));
  }, [view.engineers, activeFlag]);

  const selectedEngineer = useMemo(
    () => view.engineers.find((engineer) => engineer.authorLogin === selected) ?? null,
    [view.engineers, selected],
  );

  const selectedSquadRollup = useMemo(
    () =>
      squadView.squads.find((squad) => squad.squadName === selectedSquad) ??
      null,
    [squadView.squads, selectedSquad],
  );

  return (
    <div className="space-y-6">
      <Header view={view} />
      <ReassuranceBanner />
      <ViewToggle mode={mode} onChange={setMode} />
      {mode === "engineers" ? (
        <>
          <FlagPills view={view} active={activeFlag} onChange={setActiveFlag} />
          <EngineerTable
            rows={visible}
            windowDays={view.windowDays}
            onSelect={setSelected}
          />
        </>
      ) : (
        <SquadTable
          squadView={squadView}
          onSelect={setSelectedSquad}
        />
      )}
      <FooterNote />
      {selectedEngineer && (
        <Drawer engineer={selectedEngineer} onClose={() => setSelected(null)} />
      )}
      {selectedSquadRollup && (
        <SquadDrawer
          squad={selectedSquadRollup}
          onClose={() => setSelectedSquad(null)}
          onSelectEngineer={(login) => {
            setSelectedSquad(null);
            setMode("engineers");
            setSelected(login);
          }}
        />
      )}
    </div>
  );
}

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ReviewMode;
  onChange: (next: ReviewMode) => void;
}) {
  const options: Array<{ key: ReviewMode; label: string }> = [
    { key: "engineers", label: "Engineers" },
    { key: "squads", label: "Squads" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/10 p-1 text-[12px] w-fit">
      {options.map((option) => {
        const active = option.key === mode;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
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
      const failedCount = body.failed?.length ?? 0;
      const skippedCount = body.skipped?.length ?? 0;
      const remaining =
        body.candidatesConsidered -
        body.cached -
        body.analysed -
        failedCount -
        skippedCount;
      const parts = [
        `Read ${body.analysed} new PRs`,
        `re-used ${body.cached} prior reads`,
      ];
      if (failedCount > 0) parts.push(`${failedCount} failed`);
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      const suffix =
        remaining > 0
          ? ` · ${remaining} PR${remaining === 1 ? "" : "s"} still pending.`
          : ".";
      setStatus(`${parts.join(" · ")}${suffix}`);
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
          Engineering · Code review reflection
        </p>
        <h1 className="mt-1 font-display text-3xl italic tracking-tight text-foreground">
          A reading of merged work over the last {view.windowDays} days
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          An LLM reads each merged PR against a shared rubric, blends in
          GitHub review signals, and rolls everything up into a peer-relative
          snapshot. Sparse evidence is pulled toward the middle on purpose, so
          you&apos;ll never get a confident judgement from a thin sample. Think of
          this as a starting point for a conversation, not a grade.
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-mono uppercase tracking-[0.08em]">
            rubric {view.rubricVersion}
          </span>
          <span className="font-mono uppercase tracking-[0.08em]">
            · {view.totalPrs} PRs read
          </span>
          <span className="font-mono uppercase tracking-[0.08em]">
            · last refreshed {lastAnalysed}
          </span>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {isPending ? "Refreshing…" : "Refresh reading"}
        </button>
        {status && <span className="text-[11px] text-primary">{status}</span>}
        {error && <span className="text-[11px] text-rose-600">{error}</span>}
      </div>
    </div>
  );
}

function ReassuranceBanner() {
  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-[12px] leading-relaxed text-foreground/90">
      <p className="font-medium text-foreground">
        How to read this fairly
      </p>
      <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-muted-foreground">
        <li>
          The model only sees merged diffs — it can&apos;t see design conversations,
          pairing, mentoring, on-call work, or anything outside the PR.
        </li>
        <li>
          Scores are relative to peers in your cohort. There&apos;s no &ldquo;passing&rdquo; bar
          and no thresholds anyone is being held to.
        </li>
        <li>
          A small number of PRs is treated as low-confidence on purpose. The
          score is shrunk toward the middle until enough evidence accumulates.
        </li>
        <li>
          This is one input alongside many others your manager already uses —
          not a substitute for their judgement, and never used in isolation.
        </li>
      </ul>
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
        Conversation starters:
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={pillClass(active === null, "neutral")}
      >
        Everyone ({view.engineers.length})
      </button>
      {flags.map((flag) => (
        <button
          key={flag}
          type="button"
          onClick={() => onChange(active === flag ? null : flag)}
          title={FLAG_HELP[flag]}
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
        ? "border-amber-500/60 bg-amber-500/15 text-amber-800"
        : "border-amber-500/30 bg-amber-500/5 text-amber-800 hover:bg-amber-500/10"
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

type SortKey =
  | "engineer"
  | "cohort"
  | "prCount"
  | "evidence"
  | "craft"
  | "challenge"
  | "landing"
  | "snapshot"
  | "delta"
  | "flags";

type SortDirection = "asc" | "desc";

interface ColumnSpec {
  key: SortKey;
  label: string;
  tooltip: string;
  align: "left" | "right";
  defaultDirection: SortDirection;
  numeric: boolean;
  getValue: (engineer: EngineerRollup) => number | string | null;
}

function buildColumns(windowDays: number): ColumnSpec[] {
  return [
    {
      key: "engineer",
      label: "Engineer",
      tooltip:
        "Author of the merged PRs read in this window. Click any row to open the per-PR detail.",
      align: "left",
      defaultDirection: "asc",
      numeric: false,
      getValue: (engineer) =>
        (engineer.employeeName ?? engineer.authorLogin).toLowerCase(),
    },
    {
      key: "cohort",
      label: "Mostly works on",
      tooltip:
        "The surface area (backend, frontend, infra, mixed…) most of this engineer's PRs touch. Scores below are peer-relative within this cohort.",
      align: "left",
      defaultDirection: "asc",
      numeric: false,
      getValue: (engineer) => engineer.cohort.toLowerCase(),
    },
    {
      key: "prCount",
      label: "PRs read",
      tooltip:
        "Merged PRs the model read in this window. The 'eff.' number is the recency-weighted count — recent PRs count slightly more than older ones, and that effective count drives evidence.",
      align: "right",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) => engineer.prCount,
    },
    {
      key: "evidence",
      label: "Evidence",
      tooltip:
        "How much the model has to go on (0–100%). Blends effective PR count with the model's average per-PR confidence. Higher is more evidence, not better quality — thin evidence pulls the snapshot toward the middle.",
      align: "right",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) => engineer.confidencePct,
    },
    {
      key: "craft",
      label: "Craft",
      tooltip:
        "Peer-relative craft percentile (0–100) within this cohort. Blends execution, test adequacy, risk handling, and reviewability across every PR in the window.",
      align: "right",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) => engineer.qualityPercentile,
    },
    {
      key: "challenge",
      label: "Challenge",
      tooltip:
        "Peer-relative percentile (0–100) for the technical difficulty of the work that landed. Higher means the PRs in this window were more challenging than the cohort average — it is not a judgement of the engineer.",
      align: "right",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) => engineer.difficultyPercentile,
    },
    {
      key: "landing",
      label: "Landing",
      tooltip:
        "Peer-relative percentile (0–100) for how smoothly work landed: no reverts within 14 days, few post-review commits, and clean merges. Higher is smoother landings.",
      align: "right",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) => engineer.reliabilityPercentile,
    },
    {
      key: "snapshot",
      label: "Snapshot",
      tooltip:
        "Blended summary (0–100) of craft, challenge, landing, review flow, and throughput percentiles. Shrunk toward the cohort median when evidence is light so thin samples never produce confident scores.",
      align: "right",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) => engineer.finalScore,
    },
    {
      key: "delta",
      label: `Δ vs prior ${windowDays}d`,
      tooltip: `Change in snapshot vs the previous ${windowDays}-day window of the same length. '—' means there is no prior window to compare to yet.`,
      align: "right",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) =>
        engineer.prevFinalScore === null
          ? null
          : engineer.finalScore - engineer.prevFinalScore,
    },
    {
      key: "flags",
      label: "Things to chat about",
      tooltip:
        "Diagnostic flags raised during the reading — light samples, mixed signals, lots of review back-and-forth, PRs worth a second look, reverts. Hover any pill for the detail.",
      align: "left",
      defaultDirection: "desc",
      numeric: true,
      getValue: (engineer) => engineer.flags.length,
    },
  ];
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
  const columns = useMemo(() => buildColumns(windowDays), [windowDays]);
  const [sortKey, setSortKey] = useState<SortKey>("snapshot");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    const column = columns.find((col) => col.key === sortKey) ?? columns[0];
    const direction = sortDirection === "asc" ? 1 : -1;
    const copy = [...rows];
    copy.sort((a, b) => {
      const aValue = column.getValue(a);
      const bValue = column.getValue(b);
      // Null values always sort to the bottom regardless of direction.
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (typeof aValue === "number" && typeof bValue === "number") {
        if (aValue === bValue) return 0;
        return aValue < bValue ? -1 * direction : 1 * direction;
      }
      return (
        String(aValue).localeCompare(String(bValue), undefined, {
          sensitivity: "base",
        }) * direction
      );
    });
    return copy;
  }, [rows, sortKey, sortDirection, columns]);

  function handleSort(column: ColumnSpec) {
    if (column.key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDirection(column.defaultDirection);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/10 p-5 text-sm text-muted-foreground">
        Nobody matches this filter right now — which is a good thing if it&apos;s a
        warning filter. Clear it to see everyone again.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card shadow-warm">
      <table className="min-w-full text-[12px]">
        <thead className="bg-muted/20 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            {columns.map((column) => {
              const isActive = column.key === sortKey;
              const indicator = isActive
                ? sortDirection === "asc"
                  ? "▲"
                  : "▼"
                : "↕";
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    isActive
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={`px-3 py-2 ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(column)}
                    title={column.tooltip}
                    className={`inline-flex cursor-help items-center gap-1 whitespace-nowrap uppercase tracking-[0.12em] transition-colors hover:text-foreground ${
                      column.align === "right" ? "flex-row-reverse" : ""
                    } ${isActive ? "text-foreground" : ""}`}
                  >
                    <span className="underline decoration-dotted decoration-muted-foreground/50 underline-offset-[3px]">
                      {column.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`text-[9px] ${
                        isActive ? "opacity-100" : "opacity-40"
                      }`}
                    >
                      {indicator}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((engineer, index) => (
            <tr
              key={engineer.authorLogin}
              onClick={() => onSelect(engineer.authorLogin)}
              className={`cursor-pointer border-t border-border/40 hover:bg-primary/5 ${
                index % 2 === 0 ? "bg-transparent" : "bg-muted/10"
              }`}
            >
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
                      title={FLAG_HELP[flag]}
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

function FooterNote() {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Spot something that reads unfairly? Tell your manager — the rubric and
      weighting evolve from feedback, and noisy or unhelpful signals are exactly
      what we want to know about.
    </p>
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
      ? "text-amber-700"
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
  const highlights = engineer.prs.filter(
    (pr) =>
      pr.standout === "notably_high_quality" ||
      pr.standout === "notably_complex",
  );
  const totalPrs = engineer.prs.length;

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
              @{engineer.authorLogin} · {totalPrs} merged PR{totalPrs === 1 ? "" : "s"} read
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
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

        {highlights.length > 0 && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-emerald-800">
              Worth celebrating
            </p>
            <ul className="mt-1 space-y-1 text-[12px] text-foreground/90">
              {highlights.map((pr) => (
                <li key={`${pr.repo}#${pr.prNumber}`}>
                  <a
                    href={pr.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {pr.repo} #{pr.prNumber}
                  </a>{" "}
                  — {STANDOUT_LABEL[pr.standout!].toLowerCase()}.{" "}
                  <span className="text-muted-foreground">{pr.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Snapshot" value={String(Math.round(engineer.finalScore))} />
          <Stat label="Evidence" value={`${engineer.confidencePct}%`} />
          <Stat label="PRs read" value={`${engineer.prCount} (${engineer.effectivePrCount.toFixed(1)} eff.)`} />
          <Stat label="Mostly works on" value={engineer.cohort} />
          <Stat label="Avg execution" value={engineer.avgExecutionQuality.toFixed(1)} />
          <Stat label="Avg tests" value={engineer.avgTestAdequacy.toFixed(1)} />
          <Stat label="Avg risk handling" value={engineer.avgRiskHandling.toFixed(1)} />
          <Stat label="Avg landing" value={engineer.avgOutcomeScore.toFixed(0)} />
        </dl>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Craft (peer)" value={Math.round(engineer.qualityPercentile).toString()} />
          <Stat label="Challenge (peer)" value={Math.round(engineer.difficultyPercentile).toString()} />
          <Stat label="Landing (peer)" value={Math.round(engineer.reliabilityPercentile).toString()} />
          <Stat label="Review flow (peer)" value={Math.round(engineer.reviewHealthPercentile).toString()} />
          <Stat label="Throughput (peer)" value={Math.round(engineer.throughputPercentile).toString()} />
        </div>

        <div className="mb-4 rounded-md border border-border/40 bg-muted/5 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
            Review back-and-forth vs similar work
          </p>
          <p className="mt-1 font-mono text-[12px] text-foreground">
            {formatChurnResidual(engineer.reviewChurnResidual)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Zero means in line with peers on similar category + difficulty.
            Positive means more churn than comparable work; negative, less.
          </p>
        </div>

        {engineer.weeklyScore.length > 1 && (
          <div className="mb-4 rounded-lg border border-border/40 bg-muted/5 p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
              Weekly PR score (oldest → newest)
            </p>
            <Sparkline values={engineer.weeklyScore} />
          </div>
        )}

        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Every PR read ({engineer.prs.length})
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
            {CATEGORY_LABEL[pr.category]} · merged {mergedAt} · mostly {pr.primarySurface}
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
          <span className={pillClass(false, "warn")}>Reverted within 14 days</span>
        )}
        {pr.secondOpinionUsed && (
          <span className={pillClass(false, "info")}>
            {AGREEMENT_LABEL[pr.agreementLevel]}
          </span>
        )}
      </div>

      {pr.secondLookReasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Worth a second look:
          </span>
          {pr.secondLookReasons.map((reason) => (
            <span key={reason} className={pillClass(false, "warn")}>
              {SECOND_LOOK_LABEL[reason]}
            </span>
          ))}
        </div>
      )}

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

      <p className="mt-3 text-[11px] text-muted-foreground">
        Read by {pr.reviewProvider} · {pr.reviewModel}
      </p>
    </li>
  );
}

function formatChurnResidual(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  const figure = `(${sign}${rounded.toFixed(1)})`;
  if (rounded >= 1) return `Noticeably more than similar work ${figure}`;
  if (rounded >= 0.5) return `Slightly more than similar work ${figure}`;
  if (rounded <= -1) return `Noticeably less than similar work ${figure}`;
  if (rounded <= -0.5) return `Slightly less than similar work ${figure}`;
  return `In line with similar work ${figure}`;
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

type SquadSortKey =
  | "squad"
  | "pillar"
  | "engineers"
  | "prCount"
  | "evidence"
  | "craft"
  | "challenge"
  | "landing"
  | "snapshot";

interface SquadColumnSpec {
  key: SquadSortKey;
  label: string;
  tooltip: string;
  align: "left" | "right";
  defaultDirection: SortDirection;
  numeric: boolean;
  getValue: (squad: SquadRollup) => number | string | null;
}

const SQUAD_COLUMNS: SquadColumnSpec[] = [
  {
    key: "squad",
    label: "Squad",
    tooltip:
      "Canonical squad name from the `squads` registry. Engineers are attached via Headcount SSoT → GitHub login map. Click any row to drill into the squad.",
    align: "left",
    defaultDirection: "asc",
    numeric: false,
    getValue: (squad) => squad.squadName.toLowerCase(),
  },
  {
    key: "pillar",
    label: "Pillar",
    tooltip:
      "Pillar the squad rolls up to, pulled from the `squads` registry. Blank if the squad isn't in the registry.",
    align: "left",
    defaultDirection: "asc",
    numeric: false,
    getValue: (squad) => (squad.pillar ?? "").toLowerCase(),
  },
  {
    key: "engineers",
    label: "Engineers",
    tooltip:
      "Engineers with at least one merged PR read in this window, resolved to this squad.",
    align: "right",
    defaultDirection: "desc",
    numeric: true,
    getValue: (squad) => squad.engineerCount,
  },
  {
    key: "prCount",
    label: "PRs read",
    tooltip:
      "Merged PRs read across all engineers in this squad. The 'eff.' number is the recency- and confidence-weighted count.",
    align: "right",
    defaultDirection: "desc",
    numeric: true,
    getValue: (squad) => squad.prCount,
  },
  {
    key: "evidence",
    label: "Evidence",
    tooltip:
      "How much the squad view has to go on (0–100%). 100% ≈ 20+ effective PRs. Thin evidence pulls the snapshot toward 50 on purpose.",
    align: "right",
    defaultDirection: "desc",
    numeric: true,
    getValue: (squad) => squad.confidencePct,
  },
  {
    key: "craft",
    label: "Craft",
    tooltip:
      "Squad percentile (0–100) against other squads on the blended craft metric — execution, tests, risk handling, reviewability.",
    align: "right",
    defaultDirection: "desc",
    numeric: true,
    getValue: (squad) => squad.qualityPercentile,
  },
  {
    key: "challenge",
    label: "Challenge",
    tooltip:
      "Squad percentile (0–100) for the technical difficulty of the work that landed. Higher means harder work than peer squads this window.",
    align: "right",
    defaultDirection: "desc",
    numeric: true,
    getValue: (squad) => squad.difficultyPercentile,
  },
  {
    key: "landing",
    label: "Landing",
    tooltip:
      "Squad percentile (0–100) for smooth landings — no reverts, few post-review commits, clean merges.",
    align: "right",
    defaultDirection: "desc",
    numeric: true,
    getValue: (squad) => squad.reliabilityPercentile,
  },
  {
    key: "snapshot",
    label: "Snapshot",
    tooltip:
      "Blended squad score (0–100). Same weighting as the engineer table (40/20/15/15/10 across craft/challenge/landing/review flow/throughput) with squad-level shrinkage toward 50 when evidence is thin.",
    align: "right",
    defaultDirection: "desc",
    numeric: true,
    getValue: (squad) => squad.finalScore,
  },
];

function SquadTable({
  squadView,
  onSelect,
}: {
  squadView: SquadCodeReviewView;
  onSelect: (squadName: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SquadSortKey>("snapshot");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    const column =
      SQUAD_COLUMNS.find((col) => col.key === sortKey) ?? SQUAD_COLUMNS[0];
    const direction = sortDirection === "asc" ? 1 : -1;
    const copy = [...squadView.squads];
    copy.sort((a, b) => {
      const aValue = column.getValue(a);
      const bValue = column.getValue(b);
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (typeof aValue === "number" && typeof bValue === "number") {
        if (aValue === bValue) return 0;
        return aValue < bValue ? -1 * direction : 1 * direction;
      }
      return (
        String(aValue).localeCompare(String(bValue), undefined, {
          sensitivity: "base",
        }) * direction
      );
    });
    return copy;
  }, [squadView.squads, sortKey, sortDirection]);

  function handleSort(column: SquadColumnSpec) {
    if (column.key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDirection(column.defaultDirection);
    }
  }

  if (squadView.squads.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/10 p-5 text-sm text-muted-foreground">
        No squads resolved from the PRs in this window. This usually means the
        Headcount SSoT, GitHub employee map, or `squads` registry isn&apos;t
        lined up — check the admin status page.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border/60 bg-card shadow-warm">
        <table className="min-w-full text-[12px]">
          <thead className="bg-muted/20 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              {SQUAD_COLUMNS.map((column) => {
                const isActive = column.key === sortKey;
                const indicator = isActive
                  ? sortDirection === "asc"
                    ? "▲"
                    : "▼"
                  : "↕";
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      isActive
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={`px-3 py-2 ${
                      column.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      title={column.tooltip}
                      className={`inline-flex cursor-help items-center gap-1 whitespace-nowrap uppercase tracking-[0.12em] transition-colors hover:text-foreground ${
                        column.align === "right" ? "flex-row-reverse" : ""
                      } ${isActive ? "text-foreground" : ""}`}
                    >
                      <span className="underline decoration-dotted decoration-muted-foreground/50 underline-offset-[3px]">
                        {column.label}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`text-[9px] ${
                          isActive ? "opacity-100" : "opacity-40"
                        }`}
                      >
                        {indicator}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((squad, index) => (
              <tr
                key={squad.squadName}
                onClick={() => onSelect(squad.squadName)}
                className={`cursor-pointer border-t border-border/40 hover:bg-primary/5 ${
                  index % 2 === 0 ? "bg-transparent" : "bg-muted/10"
                }`}
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">
                    {squad.squadName}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {squad.pillar ? (
                    <span className="rounded-full border border-border/60 bg-muted/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {squad.pillar}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {squad.engineerCount}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {squad.prCount}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({squad.effectivePrCount.toFixed(1)} eff.)
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {squad.confidencePct}%
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {Math.round(squad.qualityPercentile)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {Math.round(squad.difficultyPercentile)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {Math.round(squad.reliabilityPercentile)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">
                  {Math.round(squad.finalScore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {squadView.unassignedEngineerCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {squadView.unassignedEngineerCount} engineer
          {squadView.unassignedEngineerCount === 1 ? "" : "s"} with{" "}
          {squadView.unassignedPrCount} PR
          {squadView.unassignedPrCount === 1 ? "" : "s"} in this window
          couldn&apos;t be resolved to a squad — usually a missing Headcount
          row or an unmapped GitHub login. They show up on the engineer view
          but are excluded here.
        </p>
      )}
    </div>
  );
}

function SquadDrawer({
  squad,
  onClose,
  onSelectEngineer,
}: {
  squad: SquadRollup;
  onClose: () => void;
  onSelectEngineer: (login: string) => void;
}) {
  const categories = (Object.entries(squad.categoryCounts) as Array<
    [AnalysisCategory, number]
  >)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-3xl flex-col overflow-y-auto rounded-xl border border-border/60 bg-card p-5 shadow-warm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Squad · {squad.pillar ?? "no pillar"}
            </p>
            <h2 className="mt-1 font-display text-2xl italic tracking-tight text-foreground">
              {squad.squadName}
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {squad.engineerCount} engineer
              {squad.engineerCount === 1 ? "" : "s"} · {squad.prCount} merged
              PR{squad.prCount === 1 ? "" : "s"} read ·{" "}
              {squad.distinctRepos} repo{squad.distinctRepos === 1 ? "" : "s"}
            </p>
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
          <Stat label="Snapshot" value={String(Math.round(squad.finalScore))} />
          <Stat label="Evidence" value={`${squad.confidencePct}%`} />
          <Stat
            label="PRs read"
            value={`${squad.prCount} (${squad.effectivePrCount.toFixed(1)} eff.)`}
          />
          <Stat label="Engineers" value={String(squad.engineerCount)} />
          <Stat label="Avg execution" value={squad.avgExecutionQuality.toFixed(1)} />
          <Stat label="Avg tests" value={squad.avgTestAdequacy.toFixed(1)} />
          <Stat label="Avg risk handling" value={squad.avgRiskHandling.toFixed(1)} />
          <Stat label="Avg landing" value={squad.avgOutcomeScore.toFixed(0)} />
        </dl>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Craft (peer)" value={Math.round(squad.qualityPercentile).toString()} />
          <Stat label="Challenge (peer)" value={Math.round(squad.difficultyPercentile).toString()} />
          <Stat label="Landing (peer)" value={Math.round(squad.reliabilityPercentile).toString()} />
          <Stat label="Review flow (peer)" value={Math.round(squad.reviewHealthPercentile).toString()} />
          <Stat label="Throughput (peer)" value={Math.round(squad.throughputPercentile).toString()} />
        </div>

        {categories.length > 0 && (
          <div className="mb-4 rounded-md border border-border/40 bg-muted/5 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
              Work mix
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {categories.map(([category, count]) => (
                <span
                  key={category}
                  className="rounded-full border border-border/60 bg-muted/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {CATEGORY_LABEL[category]} · {count}
                </span>
              ))}
            </div>
          </div>
        )}

        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Engineers in this squad ({squad.engineers.length})
        </h3>
        <ul className="mb-4 divide-y divide-border/40 rounded-lg border border-border/40">
          {squad.engineers.map((engineer) => (
            <li key={engineer.authorLogin}>
              <button
                type="button"
                onClick={() => onSelectEngineer(engineer.authorLogin)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-primary/5"
              >
                <div>
                  <div className="text-[13px] font-medium text-foreground">
                    {engineer.employeeName ?? engineer.authorLogin}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    @{engineer.authorLogin} · {engineer.prCount} PR
                    {engineer.prCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="font-mono text-[14px] font-semibold text-foreground">
                  {Math.round(engineer.finalScore)}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          PRs shipped ({squad.prs.length})
        </h3>
        <ul className="space-y-3">
          {squad.prs.map((pr) => (
            <PrCard key={`${pr.repo}#${pr.prNumber}`} pr={pr} />
          ))}
        </ul>
      </div>
    </div>
  );
}
