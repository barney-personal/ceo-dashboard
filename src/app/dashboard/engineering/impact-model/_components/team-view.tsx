"use client";

import { useState, useMemo } from "react";
import { ManagerPicker } from "@/components/dashboard/manager-picker";
import type { TeamView, TeamCoachingEntry } from "@/lib/data/impact-model.server";
import type { CoachingSignal } from "@/lib/data/impact-model-coaching";

const ABOVE_COLOR = "#2e7d52";
const BELOW_COLOR = "#b8472a";
const NEUTRAL_COLOR = "#8b5a2a";

interface ManagerOption {
  email: string;
  name: string;
  directReports: number;
  jobTitle: string | null;
}

export function TeamView({
  team,
  canPickAnyManager,
  allManagers,
  isViewerOwnTeam,
}: {
  team: TeamView;
  canPickAnyManager: boolean;
  allManagers: ManagerOption[];
  isViewerOwnTeam: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = useMemo(() => {
    if (team.entries.length === 0) return null;
    const above = team.entries.filter((e) => e.coaching.residualDirection === "above").length;
    const below = team.entries.filter((e) => e.coaching.residualDirection === "below").length;
    const conversationsTotal = team.entries.reduce(
      (n, e) => n + e.coaching.conversations.length,
      0,
    );
    return { above, below, conversationsTotal };
  }, [team]);

  const title = isViewerOwnTeam
    ? "Your team"
    : team.managerName
    ? `${team.managerName}'s team`
    : "Team view";

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-warm">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-primary">
            Manager view
          </p>
          <h2 className="mt-1 font-display text-3xl italic tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One card per direct report, ordered by predicted impact. Each shows
            what the model thinks is helping them and — for things you can
            actually influence — worth-a-conversation prompts. None of this is
            a verdict; it&rsquo;s a starting point for a 1:1.
          </p>
        </div>
        {canPickAnyManager && allManagers.length > 0 && (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <label className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
              Viewing manager
            </label>
            <ManagerPicker
              current={team.managerEmail}
              managers={allManagers}
              basePath="/dashboard/engineering/impact-model"
            />
          </div>
        )}
      </div>

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Reports in model" value={`${team.entries.length}`} />
          <Stat
            label="Above prediction"
            value={`${summary.above}`}
            tone={summary.above > 0 ? "good" : undefined}
            hint="exceeding the model's read"
          />
          <Stat
            label="Below prediction"
            value={`${summary.below}`}
            tone={summary.below > 0 ? "warn" : undefined}
            hint="under what the model expects"
          />
          <Stat
            label="Conversation starters"
            value={`${summary.conversationsTotal}`}
            hint="across your team"
          />
        </div>
      )}

      {team.entries.length === 0 && (
        <p className="rounded-lg border border-border/60 bg-card p-4 text-sm text-muted-foreground">
          None of this manager&rsquo;s reports are in the impact model yet —
          usually means they haven&rsquo;t shipped a merged PR in the 360-day
          training window.
        </p>
      )}

      <div className="space-y-3">
        {team.entries.map((entry) => {
          const id = entry.engineer.email;
          const isOpen = expanded.has(id);
          return (
            <CoachingRow
              key={id}
              entry={entry}
              expanded={isOpen}
              onToggle={() => toggle(id)}
            />
          );
        })}
      </div>

      {team.reportsNotInModel.length > 0 && (
        <div className="mt-5 rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">Not in the model: </span>
          {team.reportsNotInModel.map((r) => r.name).join(", ")}
          <span className="ml-1 text-muted-foreground/80">
            (usually means no merged PRs in the 360-day window — e.g. recent
            joiners, non-coding roles, or engineers on leave).
          </span>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn";
}) {
  const color =
    tone === "good"
      ? ABOVE_COLOR
      : tone === "warn"
      ? BELOW_COLOR
      : "currentColor";
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {label}
      </p>
      <p
        className="mt-1 font-display text-2xl italic tracking-tight"
        style={{ color }}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CoachingRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: TeamCoachingEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { engineer, coaching, report } = entry;
  const dir = coaching.residualDirection;
  const dirColor =
    dir === "above" ? ABOVE_COLOR : dir === "below" ? BELOW_COLOR : NEUTRAL_COLOR;
  const dirLabel =
    dir === "above"
      ? `${Math.round(coaching.residualPct)}% above prediction`
      : dir === "below"
      ? `${Math.round(Math.abs(coaching.residualPct))}% below prediction`
      : "on prediction";

  const subtitleParts = [
    report.jobTitle || engineer.discipline,
    engineer.level_label,
    `${Math.round(engineer.tenure_months)}mo tenure`,
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/20"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-display text-xl italic tracking-tight text-foreground">
              {engineer.name}
            </h3>
            <span className="text-[12px] text-muted-foreground">
              {subtitleParts.join(" · ")}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px]">
            <span className="text-muted-foreground">
              Predicted{" "}
              <span className="font-mono text-foreground">
                {Math.round(engineer.predicted).toLocaleString()}
              </span>
            </span>
            <span className="text-muted-foreground">
              Actual{" "}
              <span className="font-mono text-foreground">
                {Math.round(engineer.actual).toLocaleString()}
              </span>
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
              style={{ color: dirColor, backgroundColor: `${dirColor}1a` }}
            >
              {dirLabel}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {expanded ? "Hide detail" : `Show ${coaching.strengths.length + coaching.conversations.length} signals`}
        </span>
      </button>

      {expanded && (
        <div className="grid grid-cols-1 gap-4 border-t border-border/60 p-5 sm:grid-cols-2">
          <SignalList
            title="Strengths"
            subtitle="what the model sees going right"
            color={ABOVE_COLOR}
            signals={coaching.strengths}
            emptyText="No dominant positive signals — performance is balanced rather than lifted by one thing."
          />
          <SignalList
            title="Worth a conversation"
            subtitle="actionable areas dragging the prediction down"
            color={BELOW_COLOR}
            signals={coaching.conversations}
            emptyText="No actionable coaching signals — the model's negative contributors here are mostly context (tenure, seniority) rather than things you'd push on."
          />
        </div>
      )}
    </div>
  );
}

function SignalList({
  title,
  subtitle,
  color,
  signals,
  emptyText,
}: {
  title: string;
  subtitle: string;
  color: string;
  signals: CoachingSignal[];
  emptyText: string;
}) {
  return (
    <div>
      <h4
        className="text-[11px] font-medium uppercase tracking-[0.12em]"
        style={{ color }}
      >
        {title}
      </h4>
      <p className="mt-0.5 text-[11px] italic text-muted-foreground">
        {subtitle}
      </p>
      <ul className="mt-3 space-y-3">
        {signals.length === 0 && (
          <li className="text-[12px] text-muted-foreground">{emptyText}</li>
        )}
        {signals.map((s) => {
          const pct = s.pctMultiplier;
          const sign = pct > 0 ? "+" : "";
          return (
            <li
              key={s.feature}
              className="rounded-lg border border-border/40 bg-muted/10 p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-medium text-foreground">
                  {s.label}
                </span>
                <span
                  className="font-mono text-[11px]"
                  style={{ color }}
                >
                  {sign}
                  {pct.toFixed(1)}%
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {s.detail}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
