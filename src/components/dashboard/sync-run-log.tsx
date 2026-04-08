"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronDown,
  SkipForward,
  Database,
  MessageSquare,
  FileSpreadsheet,
  Clock,
  AlertTriangle,
} from "lucide-react";

interface Phase {
  id: number;
  phase: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  detail: string | null;
  itemsProcessed: number;
  errorMessage: string | null;
}

interface SyncRun {
  id: number;
  source: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  recordsSynced: number;
  errorMessage: string | null;
  phases: Phase[];
}

interface SyncRunLogProps {
  runs: SyncRun[];
  avgDurations: Record<string, number>;
}

const SOURCE_ICONS: Record<string, typeof Database> = {
  mode: Database,
  slack: MessageSquare,
  "management-accounts": FileSpreadsheet,
};

const SOURCE_LABELS: Record<string, string> = {
  mode: "Mode",
  slack: "Slack OKRs",
  "management-accounts": "Mgmt Accounts",
};

const FILTERS = ["all", "mode", "slack", "management-accounts"] as const;
const FILTER_LABELS: Record<string, string> = {
  all: "All",
  mode: "Mode",
  slack: "Slack",
  "management-accounts": "Accounts",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatPhaseName(phase: string): string {
  // "sync_report:Strategic Finance KPIs" → "Sync Report — Strategic Finance KPIs"
  const [action, ...rest] = phase.split(":");
  const label = action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return rest.length > 0 ? `${label} — ${rest.join(":")}` : label;
}

function StatusIcon({ status, className = "" }: { status: string; className?: string }) {
  if (status === "success") return <CheckCircle2 className={`text-positive ${className}`} />;
  if (status === "error") return <XCircle className={`text-destructive ${className}`} />;
  if (status === "running") return <RefreshCw className={`text-warning animate-spin ${className}`} />;
  if (status === "skipped") return <SkipForward className={`text-muted-foreground/40 ${className}`} />;
  return <Clock className={`text-muted-foreground/40 ${className}`} />;
}

function PhaseTimeline({ phases, totalDurationMs }: { phases: Phase[]; totalDurationMs: number }) {
  if (phases.length === 0) {
    return (
      <p className="py-4 text-center text-[12px] text-muted-foreground/40">
        No phase data (run predates instrumentation)
      </p>
    );
  }

  return (
    <div className="space-y-1 py-3">
      {phases.map((phase) => {
        const durationMs = phase.completedAt
          ? new Date(phase.completedAt).getTime() - new Date(phase.startedAt).getTime()
          : Date.now() - new Date(phase.startedAt).getTime();
        const widthPct = totalDurationMs > 0 ? Math.max(2, (durationMs / totalDurationMs) * 100) : 50;
        const isInterrupted = phase.status === "running" && !phase.completedAt;

        return (
          <div key={phase.id} className="group">
            <div className="flex items-center gap-3">
              <StatusIcon
                status={isInterrupted ? "error" : phase.status}
                className="h-3 w-3 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-foreground/70">
                    {formatPhaseName(phase.phase)}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/40">
                    {formatDuration(durationMs)}
                  </span>
                </div>
                {/* Duration bar */}
                <div className="mt-1 h-1 w-full rounded-full bg-border/30">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor:
                        phase.status === "error" ? "var(--destructive)" :
                        phase.status === "skipped" ? "var(--muted-foreground)" :
                        phase.status === "running" ? "var(--warning)" :
                        "var(--primary)",
                      opacity: phase.status === "skipped" ? 0.2 : 0.3,
                    }}
                  />
                </div>
                {/* Detail text */}
                {phase.detail && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/40">
                    {phase.detail}
                    {phase.itemsProcessed > 0 && ` (${phase.itemsProcessed} items)`}
                  </p>
                )}
              </div>
            </div>
            {/* Error detail */}
            {phase.errorMessage && (
              <div className="ml-6 mt-1 rounded-md bg-destructive/5 px-3 py-2">
                <p className="text-[11px] text-destructive/70">{phase.errorMessage}</p>
              </div>
            )}
            {isInterrupted && (
              <div className="ml-6 mt-1 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-warning" />
                <p className="text-[11px] text-warning">Phase interrupted — sync failed before completion</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunRow({ run, avgDuration }: { run: SyncRun; avgDuration: number }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = SOURCE_ICONS[run.source] ?? Database;
  const label = SOURCE_LABELS[run.source] ?? run.source;
  const isRunning = run.status === "running";
  const isStale = isRunning && Date.now() - new Date(run.startedAt).getTime() > 600_000; // 10 min

  const durationMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : Date.now() - new Date(run.startedAt).getTime();

  // Estimate remaining time for running syncs
  const completedPhases = run.phases.filter((p) => p.status !== "running").length;
  const totalPhases = run.phases.length || 1;
  const estimatedRemaining = isRunning && avgDuration > 0
    ? Math.max(0, avgDuration - durationMs)
    : null;

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        {/* Source icon */}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />

        {/* Status dot */}
        <StatusIcon status={run.status} className="h-3.5 w-3.5 shrink-0" />

        {/* Source label */}
        <span className="w-28 shrink-0 text-[13px] font-medium text-foreground/80">
          {label}
        </span>

        {/* Time ago */}
        <span className="w-16 shrink-0 text-[11px] text-muted-foreground/40">
          {timeAgo(run.startedAt)}
        </span>

        {/* Duration */}
        <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/50">
          {formatDuration(durationMs)}
        </span>

        {/* Records */}
        <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/40">
          {run.recordsSynced > 0 ? `${run.recordsSynced} rec` : "—"}
        </span>

        {/* Phase count */}
        <span className="flex-1 text-[11px] text-muted-foreground/30">
          {run.phases.length > 0 ? `${run.phases.length} phases` : ""}
        </span>

        {/* Running estimate */}
        {isRunning && estimatedRemaining != null && (
          <span className="shrink-0 text-[11px] text-warning">
            ~{formatDuration(estimatedRemaining)} remaining
          </span>
        )}

        {/* Stale warning */}
        {isStale && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
        )}

        {/* Chevron */}
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-transform duration-200"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
        />
      </button>

      {/* Expanded phase detail */}
      {expanded && (
        <div className="border-t border-border/20 bg-accent/10 px-4">
          {run.errorMessage && (
            <div className="mt-3 rounded-md bg-destructive/5 px-3 py-2">
              <p className="text-[11px] font-medium text-destructive/60">Run error</p>
              <p className="mt-0.5 text-[11px] text-destructive/50">{run.errorMessage}</p>
            </div>
          )}
          <PhaseTimeline phases={run.phases} totalDurationMs={durationMs} />
        </div>
      )}
    </div>
  );
}

export function SyncRunLog({ runs, avgDurations }: SyncRunLogProps) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? runs : runs.filter((r) => r.source === filter);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      {/* Header + filters */}
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Sync Runs</h3>
          <p className="text-[11px] text-muted-foreground/50">
            Last {runs.length} runs with phase detail
          </p>
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filter === f
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/40 hover:text-muted-foreground"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Run list */}
      <div className="max-h-[600px] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground/40">
            No sync runs found
          </p>
        ) : (
          filtered.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              avgDuration={avgDurations[run.source] ?? 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
