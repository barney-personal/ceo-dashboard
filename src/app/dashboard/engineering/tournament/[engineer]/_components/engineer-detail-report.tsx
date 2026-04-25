import Link from "next/link";
import { ArrowLeft, Bot, Sparkles } from "lucide-react";
import type {
  EngineerTournamentDetail,
  JudgmentEntry,
} from "@/lib/data/tournament";

const STARTING_RATING = 1500;

export function EngineerDetailReport({
  detail,
}: {
  detail: EngineerTournamentDetail;
}) {
  const wins = detail.judgments.filter((j) => j.verdict === "win").length;
  const losses = detail.judgments.filter((j) => j.verdict === "loss").length;
  const draws = detail.judgments.filter((j) => j.verdict === "draw").length;
  const total = detail.judgments.length;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/engineering/tournament"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to leaderboard
      </Link>

      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <div className="flex items-start gap-4">
          {detail.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.avatarUrl}
              alt=""
              className="h-16 w-16 flex-shrink-0 rounded-full bg-muted"
            />
          ) : (
            <div className="h-16 w-16 flex-shrink-0 rounded-full bg-muted" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-2xl text-foreground">
                {detail.displayName}
              </h1>
              {detail.level && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {detail.level}
                </span>
              )}
              {detail.tenureMonths != null && (
                <span className="text-xs text-muted-foreground">
                  {formatTenure(detail.tenureMonths)}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {detail.jobTitle ?? "—"}
              {detail.squad && detail.squad !== "no squad" && (
                <span> · {detail.squad}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {detail.githubLogin
                ? `@${detail.githubLogin} · ${detail.engineerEmail}`
                : detail.engineerEmail}
            </div>
          </div>
          {detail.ranking && (
            <div className="flex flex-col items-end gap-1 text-right">
              <span className="text-3xl font-semibold tabular-nums">
                {Math.round(detail.ranking.rating)}
              </span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Rank #{detail.ranking.rank} · Δ
                {detail.ranking.rating - STARTING_RATING >= 0 ? "+" : ""}
                {Math.round(detail.ranking.rating - STARTING_RATING)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Judgments" value={String(total)} />
          <Metric label="Win rate" value={`${winRate.toFixed(0)}%`} />
          <Metric label="W–L–D" value={`${wins}–${losses}–${draws}`} />
          <Metric
            label="From run"
            value={`#${detail.runId}`}
            sub="Most recent tournament"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="border-b border-border/50 px-5 py-3">
          <span className="text-sm font-semibold">Match history</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {total} judgments · most recent first · expand any row for the full
            verdict
          </span>
        </div>
        <div className="divide-y divide-border/40">
          {detail.judgments.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No judgments yet for this engineer.
            </div>
          ) : (
            detail.judgments.map((j) => (
              <JudgmentRow key={j.matchId + ":" + j.judgeProvider} entry={j} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function JudgmentRow({ entry }: { entry: JudgmentEntry }) {
  const tone =
    entry.verdict === "win"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : entry.verdict === "loss"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-muted text-muted-foreground border-border/50";
  return (
    <details className="group">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/20">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
        >
          {entry.verdict === "win"
            ? "Won"
            : entry.verdict === "loss"
            ? "Lost"
            : "Draw"}
        </span>
        <span className="text-xs text-muted-foreground">vs</span>
        <Link
          href={`/dashboard/engineering/tournament/${encodeURIComponent(entry.opponentEmail)}`}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {entry.opponentAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.opponentAvatarUrl}
              alt=""
              className="h-5 w-5 rounded-full bg-muted"
            />
          ) : null}
          {entry.opponentDisplayName}
        </Link>
        {entry.opponentRating !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            ({Math.round(entry.opponentRating)})
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {entry.judgeProvider === "anthropic" ? (
            <Sparkles className="h-3 w-3" />
          ) : (
            <Bot className="h-3 w-3" />
          )}
          {entry.judgeModel}
          {entry.confidencePct !== null && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
              {entry.confidencePct}% confident
            </span>
          )}
        </span>
      </summary>
      <div className="border-t border-border/30 bg-muted/10 px-5 py-3 text-sm text-foreground">
        {entry.reasoning ? (
          <p className="whitespace-pre-wrap leading-relaxed">
            {entry.reasoning}
          </p>
        ) : (
          <p className="italic text-muted-foreground">
            No reasoning recorded for this judgment.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>Match #{entry.matchId}</span>
          <span>{new Date(entry.createdAt).toLocaleString()}</span>
          {entry.latencyMs != null && (
            <span>{(entry.latencyMs / 1000).toFixed(1)}s</span>
          )}
          {entry.costUsd != null && entry.costUsd > 0 && (
            <span>${entry.costUsd.toFixed(4)}</span>
          )}
        </div>
      </div>
    </details>
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

function formatTenure(months: number): string {
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder ? `${years}y ${remainder}m` : `${years}y`;
}
