"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Clock,
  Loader2,
  Play,
  Square,
  Swords,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type {
  ConfidenceBand,
  RankingRow,
  TournamentRunDetail,
  TournamentRunSummaryRow,
} from "@/lib/data/tournament";

interface Props {
  latest: TournamentRunDetail | null;
  recent: TournamentRunSummaryRow[];
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const CONFIDENCE_LABEL: Record<ConfidenceBand, string> = {
  low: "Low data",
  medium: "Settling",
  high: "Settled",
};

const CONFIDENCE_TONE: Record<ConfidenceBand, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-50 text-amber-700 border border-amber-200",
  high: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

export function TournamentReport({ latest, recent }: Props) {
  const router = useRouter();
  const [matchTarget, setMatchTarget] = useState(20);
  const [windowDays, setWindowDays] = useState(90);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isActive =
    latest?.run.status === "running" || latest?.run.status === "queued";

  // Auto-refresh while a run is active
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, router]);

  async function trigger() {
    setError(null);
    try {
      const res = await fetch("/api/sync/tournament", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchTarget, windowDays }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Status ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancel(runId: number) {
    setError(null);
    try {
      const res = await fetch(`/api/sync/tournament?runId=${runId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Status ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-serif text-2xl text-foreground flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" /> Engineer Tournament
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Pairwise LLM-judged ranking of engineers. Each match dispatches blinded
              90-day dossiers to Opus 4.7 (high effort) and GPT-5.4 (medium thinking);
              each verdict updates an ELO rating independently. Output and impact
              count more than code quality.
            </p>
          </div>
          <TriggerPanel
            matchTarget={matchTarget}
            setMatchTarget={setMatchTarget}
            windowDays={windowDays}
            setWindowDays={setWindowDays}
            onTrigger={trigger}
            onCancel={() => latest && cancel(latest.run.id)}
            isActive={isActive}
            isPending={isPending}
            currentRunId={latest?.run.id ?? null}
          />
        </div>
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {latest && <RunSummaryCard detail={latest} />}

      {latest && latest.rankings.length > 0 && (
        <LeaderboardCard rankings={latest.rankings} />
      )}

      {latest && latest.rankings.length === 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-12 text-center shadow-warm">
          <p className="text-sm text-muted-foreground">
            {isActive
              ? "Run in progress. Standings will populate as judgments complete."
              : "No judgments recorded yet for this run."}
          </p>
        </div>
      )}

      {!latest && (
        <div className="rounded-xl border border-border/60 bg-card p-12 text-center shadow-warm">
          <Swords className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No tournaments have been run yet. Trigger your first run above.
          </p>
        </div>
      )}

      {recent.length > 1 && <RecentRunsPanel runs={recent} latestId={latest?.run.id ?? null} />}
    </div>
  );
}

function TriggerPanel({
  matchTarget,
  setMatchTarget,
  windowDays,
  setWindowDays,
  onTrigger,
  onCancel,
  isActive,
  isPending,
  currentRunId,
}: {
  matchTarget: number;
  setMatchTarget: (n: number) => void;
  windowDays: number;
  setWindowDays: (n: number) => void;
  onTrigger: () => void;
  onCancel: () => void;
  isActive: boolean;
  isPending: boolean;
  currentRunId: number | null;
}) {
  const estimatedCostUsd = matchTarget * 0.07;

  if (isActive && currentRunId) {
    return (
      <button
        onClick={onCancel}
        disabled={isPending}
        className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
      >
        <Square className="h-3.5 w-3.5" /> Cancel run #{currentRunId}
      </button>
    );
  }

  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          Matches
        </label>
        <input
          type="number"
          min={1}
          max={2000}
          value={matchTarget}
          onChange={(e) => setMatchTarget(parseInt(e.target.value, 10) || 1)}
          className="h-9 w-24 rounded-md border border-border/60 bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          Window (days)
        </label>
        <input
          type="number"
          min={7}
          max={365}
          value={windowDays}
          onChange={(e) => setWindowDays(parseInt(e.target.value, 10) || 90)}
          className="h-9 w-24 rounded-md border border-border/60 bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">
          ~${estimatedCostUsd.toFixed(2)} estimated
        </span>
        <button
          onClick={onTrigger}
          disabled={isPending}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Run tournament
        </button>
      </div>
    </div>
  );
}

function RunSummaryCard({ detail }: { detail: TournamentRunDetail }) {
  const { run } = detail;
  const isActive = run.status === "running" || run.status === "queued";
  const matchProgress =
    run.matchTarget > 0 ? (run.matchesCompleted / run.matchTarget) * 100 : 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Run #{run.id}</span>
          <StatusChip status={run.status} />
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(run.startedAt)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {detail.agreementRate !== null && (
            <span>
              Judge agreement:{" "}
              <span className="font-medium text-foreground">
                {(detail.agreementRate * 100).toFixed(0)}%
              </span>
            </span>
          )}
          {detail.meanLatencyMs !== null && (
            <span>
              Avg latency:{" "}
              <span className="font-medium text-foreground">
                {(detail.meanLatencyMs / 1000).toFixed(1)}s
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
        <Metric
          label="Matches"
          value={`${run.matchesCompleted} / ${run.matchTarget}`}
          sub={isActive ? `${matchProgress.toFixed(0)}% complete` : undefined}
        />
        <Metric
          label="Judgments"
          value={run.judgmentsCompleted.toLocaleString()}
          sub={
            detail.judgmentsByProvider.anthropic !== undefined
              ? `${detail.judgmentsByProvider.anthropic ?? 0} Opus / ${detail.judgmentsByProvider.openai ?? 0} GPT`
              : undefined
          }
        />
        <Metric
          label="Cost"
          value={`$${run.totalCostUsd.toFixed(2)}`}
          sub={
            run.judgmentsCompleted > 0
              ? `$${(run.totalCostUsd / run.judgmentsCompleted).toFixed(3)} per judgment`
              : undefined
          }
        />
        <Metric
          label="Window"
          value={`${formatDays(run.windowStart, run.windowEnd)} days`}
          sub={`Through ${run.windowEnd.toISOString().slice(0, 10)}`}
        />
      </div>
      {run.errorMessage && (
        <div className="border-t border-border/50 bg-destructive/5 px-5 py-3 text-xs text-destructive">
          <span className="font-medium">Error:</span> {run.errorMessage}
        </div>
      )}
      {isActive && (
        <div className="border-t border-border/50 px-5 py-2">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, matchProgress)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LeaderboardCard({ rankings }: { rankings: RankingRow[] }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="border-b border-border/50 px-5 py-3">
        <span className="text-sm font-semibold">Leaderboard</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {rankings.length} engineers ranked · sorted by rating · click a row
          for match-level reasoning
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2 text-left font-medium">#</th>
              <th className="px-5 py-2 text-left font-medium">Engineer</th>
              <th className="px-5 py-2 text-left font-medium">Role</th>
              <th className="px-5 py-2 text-right font-medium">Rating</th>
              <th className="px-5 py-2 text-right font-medium">Δ</th>
              <th className="px-5 py-2 text-right font-medium">W–L–D</th>
              <th className="px-5 py-2 text-right font-medium">Judgments</th>
              <th className="px-5 py-2 text-left font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rankings.map((row) => (
              <tr
                key={row.engineerEmail}
                className="border-b border-border/30 last:border-b-0 transition-colors hover:bg-muted/20"
              >
                <td className="px-5 py-2 font-medium tabular-nums text-muted-foreground">
                  {row.rank}
                </td>
                <td className="px-5 py-2">
                  <Link
                    href={`/dashboard/engineering/tournament/${encodeURIComponent(row.engineerEmail)}`}
                    className="flex items-center gap-3 hover:text-primary"
                  >
                    {row.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.avatarUrl}
                        alt=""
                        className="h-8 w-8 rounded-full bg-muted"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {row.displayName}
                        </span>
                        {row.level && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {row.level}
                          </span>
                        )}
                        {row.tenureMonths != null && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatTenure(row.tenureMonths)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.githubLogin
                          ? `@${row.githubLogin}`
                          : row.engineerEmail}
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-2 text-xs text-muted-foreground">
                  {row.jobTitle ?? "—"}
                </td>
                <td className="px-5 py-2 text-right font-semibold tabular-nums">
                  {Math.round(row.rating)}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">
                  <DeltaCell delta={row.delta} />
                </td>
                <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">
                  {row.wins}–{row.losses}–{row.draws}
                </td>
                <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">
                  {row.judgmentsPlayed}
                </td>
                <td className="px-5 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs ${CONFIDENCE_TONE[row.confidence]}`}
                  >
                    {CONFIDENCE_LABEL[row.confidence]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentRunsPanel({
  runs,
  latestId,
}: {
  runs: TournamentRunSummaryRow[];
  latestId: number | null;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="border-b border-border/50 px-5 py-3">
        <span className="text-sm font-semibold">Recent runs</span>
      </div>
      <div className="divide-y divide-border/40">
        {runs
          .filter((r) => r.id !== latestId)
          .map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground">Run #{r.id}</span>
              <StatusChip status={r.status} />
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatRelativeTime(r.startedAt)}
              </span>
              <span>
                {r.matchesCompleted} / {r.matchTarget} matches
              </span>
              <span>{r.judgmentsCompleted} judgments</span>
              <span>${r.totalCostUsd.toFixed(2)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tones: Record<string, string> = {
    queued: "bg-muted text-muted-foreground",
    running: "bg-amber-50 text-amber-700 border border-amber-200",
    completed: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    failed: "bg-destructive/10 text-destructive border border-destructive/30",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${tones[status] ?? tones.queued}`}
    >
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function DeltaCell({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.5) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600">
        <TrendingUp className="h-3 w-3" /> +{Math.round(delta)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-red-600">
      <TrendingDown className="h-3 w-3" /> {Math.round(delta)}
    </span>
  );
}

function formatRelativeTime(d: Date): string {
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatDays(start: Date, end: Date): number {
  return Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000,
  );
}

function formatTenure(months: number): string {
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder ? `${years}y ${remainder}m` : `${years}y`;
}
