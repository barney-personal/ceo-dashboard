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
} from "@/lib/integrations/code-review-analyser";

const FLAG_LABEL: Record<DiagnosticFlag, string> = {
  high_volume_low_quality: "High volume, low quality",
  low_volume_high_complexity: "Few PRs, high complexity",
  quality_variance_high: "Quality varies a lot",
  all_tiny_prs: "Only tiny PRs",
  low_evidence: "Low evidence (<3 PRs)",
  has_concerning_pr: "Has a concerning PR",
};

const FLAG_TONE: Record<DiagnosticFlag, "warn" | "info" | "neutral"> = {
  high_volume_low_quality: "warn",
  low_volume_high_complexity: "info",
  quality_variance_high: "warn",
  all_tiny_prs: "warn",
  low_evidence: "neutral",
  has_concerning_pr: "warn",
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

export function CodeReviewReport({ view }: { view: CodeReviewView }) {
  const [activeFlag, setActiveFlag] = useState<DiagnosticFlag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (!activeFlag) return view.engineers;
    return view.engineers.filter((e) => e.flags.includes(activeFlag));
  }, [view.engineers, activeFlag]);

  const selectedEngineer = useMemo(
    () =>
      view.engineers.find((e) => e.authorLogin === selected) ??
      view.lowEvidenceEngineers.find((e) => e.authorLogin === selected) ??
      null,
    [view, selected],
  );

  return (
    <div className="space-y-6">
      <Header view={view} />
      <CalibrationBanner />
      <FlagPills
        view={view}
        active={activeFlag}
        onChange={setActiveFlag}
      />
      <EngineerTable
        rows={visible}
        windowDays={view.windowDays}
        onSelect={setSelected}
      />
      {view.lowEvidenceEngineers.length > 0 && (
        <LowEvidenceSection
          rows={view.lowEvidenceEngineers}
          onSelect={setSelected}
        />
      )}
      {selectedEngineer && (
        <Drawer
          engineer={selectedEngineer}
          onClose={() => setSelected(null)}
        />
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
          ? ` · ${remaining} PR${remaining === 1 ? "" : "s"} still pending (click again or wait for the weekly cron).`
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
          What did engineers ship in the last {view.windowDays} days?
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every merged PR reviewed by Claude against a fixed rubric. Each
          engineer is ranked by the sum of complexity × quality across their
          merged PRs. Expand any row to see per-PR evidence.
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
      These scores are an LLM&rsquo;s structured opinion of merged code, not a
      performance judgement. Treat as one input into calibration or a starting
      point for a diagnostic conversation — not as a ranking you&rsquo;d share
      or act on without context.
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
    const out = {} as Record<DiagnosticFlag, number>;
    for (const e of view.engineers) {
      for (const f of e.flags) {
        out[f] = (out[f] ?? 0) + 1;
      }
    }
    return out;
  }, [view.engineers]);

  const flags = (Object.keys(FLAG_LABEL) as DiagnosticFlag[]).filter(
    (f) => f !== "low_evidence" && (counts[f] ?? 0) > 0,
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
      {flags.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChange(active === f ? null : f)}
          className={pillClass(active === f, FLAG_TONE[f])}
        >
          {FLAG_LABEL[f]} ({counts[f]})
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
        No engineers match the current filter. Click a different diagnostic
        pill, or run the analysis if nothing&rsquo;s been scored yet.
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
            <th className="px-3 py-2 text-right">PRs</th>
            <th className="px-3 py-2 text-right">Repos</th>
            <th className="px-3 py-2 text-right">Med complexity</th>
            <th className="px-3 py-2 text-right">Med quality</th>
            <th className="px-3 py-2 text-right">Composite</th>
            <th className="px-3 py-2 text-right">{`vs prev ${windowDays}d`}</th>
            <th className="px-3 py-2 text-left">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr
              key={e.authorLogin}
              onClick={() => onSelect(e.authorLogin)}
              className={`cursor-pointer border-t border-border/40 hover:bg-primary/5 ${
                i % 2 === 0 ? "bg-transparent" : "bg-muted/10"
              }`}
            >
              <td className="px-3 py-2 font-mono text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-2">
                <div className="font-medium text-foreground">
                  {e.employeeName ?? e.authorLogin}
                </div>
                {e.employeeName && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    @{e.authorLogin}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono">{e.prCount}</td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                {e.distinctRepos}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {e.medianComplexity.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {e.medianQuality.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">
                {Math.round(e.compositeScore)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                <DeltaCell
                  current={e.compositeScore}
                  prev={e.prevCompositeScore}
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {e.flags
                    .filter((f) => f !== "low_evidence")
                    .map((f) => (
                      <span
                        key={f}
                        className={pillClass(false, FLAG_TONE[f])}
                      >
                        {FLAG_LABEL[f]}
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
  if (prev === 0 && current === 0)
    return <span className="text-muted-foreground">—</span>;
  const delta = current - prev;
  const pct = prev > 0 ? (delta / prev) * 100 : null;
  const color =
    delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-muted-foreground";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={color}>
      {sign}
      {Math.round(delta)}
      {pct !== null && <span className="ml-1 text-[10px]">({sign}{Math.round(pct)}%)</span>}
    </span>
  );
}

function LowEvidenceSection({
  rows,
  onSelect,
}: {
  rows: EngineerRollup[];
  onSelect: (login: string) => void;
}) {
  return (
    <details className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-4">
      <summary className="cursor-pointer text-[12px] font-medium text-foreground">
        {rows.length} engineer{rows.length === 1 ? "" : "s"} with under 3 PRs
        (excluded from the main ranking)
      </summary>
      <ul className="mt-3 space-y-1 text-[12px]">
        {rows.map((e) => (
          <li key={e.authorLogin}>
            <button
              type="button"
              onClick={() => onSelect(e.authorLogin)}
              className="text-foreground underline-offset-2 hover:underline"
            >
              {e.employeeName ?? e.authorLogin}
            </button>
            <span className="ml-2 text-muted-foreground">
              · {e.prCount} PR{e.prCount === 1 ? "" : "s"} · composite{" "}
              {Math.round(e.compositeScore)}
            </span>
          </li>
        ))}
      </ul>
    </details>
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
        onClick={(e) => e.stopPropagation()}
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
              {engineer.flags.map((f) => (
                <span key={f} className={pillClass(false, FLAG_TONE[f])}>
                  {FLAG_LABEL[f]}
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
          <Stat label="PRs merged" value={String(engineer.prCount)} />
          <Stat label="Distinct repos" value={String(engineer.distinctRepos)} />
          <Stat
            label="Med complexity"
            value={engineer.medianComplexity.toFixed(1)}
          />
          <Stat
            label="Med quality"
            value={engineer.medianQuality.toFixed(1)}
          />
        </dl>

        {engineer.weeklyComposite.length > 1 && (
          <div className="mb-4 rounded-lg border border-border/40 bg-muted/5 p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
              Weekly composite (oldest → newest)
            </p>
            <Sparkline values={engineer.weeklyComposite} />
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
  const barWidthPct = 100 / values.length;
  return (
    <div className="mt-2 flex h-10 items-end gap-1">
      {values.map((v, i) => {
        const heightPct = (v / max) * 100;
        return (
          <div
            key={i}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            style={{ maxWidth: `${barWidthPct}%` }}
          >
            <div
              className="w-full rounded-t-sm bg-primary/60"
              style={{ height: `${Math.max(heightPct, 4)}%` }}
              title={`${Math.round(v)}`}
            />
            <span className="font-mono text-[9px] text-muted-foreground/70">
              {Math.round(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {label}
      </p>
      <p className="mt-0.5 font-display text-lg italic tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}

function PrCard({ pr }: { pr: PrReviewEntry }) {
  const date = new Date(pr.mergedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  return (
    <li className="rounded-lg border border-border/60 bg-muted/5 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <a
          href={pr.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {pr.repo} #{pr.prNumber}
        </a>
        <span className="font-mono text-[10px] text-muted-foreground">
          {date}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{pr.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
          {CATEGORY_LABEL[pr.category]}
        </span>
        <span className="font-mono text-muted-foreground">
          complexity {pr.complexity}/5
        </span>
        <span className="font-mono text-muted-foreground">
          quality {pr.quality}/5
        </span>
        {pr.standout && (
          <span className={pillClass(false, STANDOUT_TONE[pr.standout])}>
            {STANDOUT_LABEL[pr.standout]}
          </span>
        )}
      </div>
      {pr.caveats.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] italic text-muted-foreground">
          {pr.caveats.map((c) => (
            <li key={c}>· {c}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
