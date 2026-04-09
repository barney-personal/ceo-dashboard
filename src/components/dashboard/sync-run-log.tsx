"use client";

import { useState, useEffect } from "react";
import { getEffectiveSyncState, type EffectiveSyncState } from "@/lib/sync/config";
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
  trigger: string;
  attempt: number;
  startedAt: string;
  completedAt: string | null;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  recordsSynced: number;
  skipReason: string | null;
  errorMessage: string | null;
  scopeDescription?: string | null;
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

type PhaseDisplayStatus =
  | "success"
  | "partial"
  | "error"
  | "skipped"
  | "running"
  | "queued"
  | "cancelled"
  | "abandoned"
  | "stale";

type PhaseBadge = {
  label: string;
  value: string;
};

function getDisplayPhaseStatus(
  phase: Phase,
  runEffectiveStatus: EffectiveSyncState,
): PhaseDisplayStatus {
  const isInterrupted =
    phase.status === "running" &&
    !phase.completedAt &&
    runEffectiveStatus !== "running" &&
    runEffectiveStatus !== "queued";

  return (isInterrupted ? "error" : phase.status) as PhaseDisplayStatus;
}

function getPhaseTone(status: PhaseDisplayStatus) {
  if (status === "success") {
    return {
      container: "border-positive/20 bg-positive/[0.04]",
      bar: "var(--positive)",
      badge: "border-positive/20 bg-positive/10 text-positive",
    };
  }

  if (status === "partial" || status === "running" || status === "queued") {
    return {
      container: "border-warning/20 bg-warning/[0.05]",
      bar: "var(--warning)",
      badge: "border-warning/20 bg-warning/10 text-warning",
    };
  }

  if (status === "stale") {
    return {
      container: "border-warning/20 bg-warning/[0.05]",
      bar: "var(--warning)",
      badge: "border-warning/20 bg-warning/10 text-warning",
    };
  }

  if (status === "error" || status === "abandoned") {
    return {
      container: "border-destructive/20 bg-destructive/[0.04]",
      bar: "var(--destructive)",
      badge: "border-destructive/20 bg-destructive/10 text-destructive",
    };
  }

  return {
    container: "border-border/40 bg-background/40",
    bar: "var(--muted-foreground)",
    badge: "border-border/40 bg-muted/40 text-muted-foreground",
  };
}

function getPhaseBadges(phase: Phase): PhaseBadge[] {
  if (!phase.detail) {
    return phase.itemsProcessed > 0
      ? [{ label: "Items", value: String(phase.itemsProcessed) }]
      : [];
  }

  if (phase.phase.startsWith("sync_report:")) {
    const match = phase.detail.match(
      /Stored (\d+) rows(?:\s+[—-]\s+(\d+) queries succeeded, (\d+) failed)?(?:,\s+(\d+) warnings?)?/,
    );
    if (match) {
      const [, rows, ok, failed, warnings] = match;
      const badges: PhaseBadge[] = [{ label: "Rows", value: rows }];
      if (ok && failed) {
        badges.push({ label: "Queries", value: `${ok} ok / ${failed} failed` });
      }
      if (warnings) {
        badges.push({ label: "Warnings", value: warnings });
      }
      return badges;
    }
  }

  if (phase.phase.startsWith("sync_channel:")) {
    const match = phase.detail.match(
      /#(.+?)\s+[—-]\s+(\d+) parsed, (\d+) skipped, (\d+) KRs stored/,
    );
    if (match) {
      const [, channel, parsed, skipped, stored] = match;
      return [
        { label: "Channel", value: `#${channel}` },
        { label: "Messages", value: `${parsed} parsed / ${skipped} skipped` },
        { label: "KRs", value: stored },
      ];
    }
  }

  return phase.itemsProcessed > 0
    ? [{ label: "Items", value: String(phase.itemsProcessed) }]
    : [];
}

function PhaseSummary({
  phases,
  runEffectiveStatus,
}: {
  phases: Phase[];
  runEffectiveStatus: EffectiveSyncState;
}) {
  const statuses = phases.map((phase) => getDisplayPhaseStatus(phase, runEffectiveStatus));
  const warningCount = statuses.filter((status) => status === "partial").length;
  const errorCount = statuses.filter((status) => status === "error").length;
  const skippedCount = statuses.filter((status) => status === "skipped").length;
  const processedItems = phases.reduce(
    (sum, phase) => sum + (phase.itemsProcessed > 0 ? phase.itemsProcessed : 0),
    0,
  );

  const stats = [
    { label: "Phases", value: String(phases.length) },
    { label: "Warnings", value: String(warningCount) },
    { label: "Errors", value: String(errorCount) },
    { label: "Skipped", value: String(skippedCount) },
    ...(processedItems > 0 ? [{ label: "Items", value: String(processedItems) }] : []),
  ];

  return (
    <div
      className="mt-3 grid gap-2 rounded-lg border border-border/50 bg-background/70 p-3 sm:grid-cols-5"
      data-testid="phase-summary"
    >
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-md border border-border/40 bg-background/70 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
            {stat.label}
          </p>
          <p className="mt-1 font-mono text-sm text-foreground/80">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function StatusIcon({ status, className = "" }: { status: string; className?: string }) {
  if (status === "success") return <CheckCircle2 className={`text-positive ${className}`} />;
  if (status === "partial") return <AlertTriangle className={`text-warning ${className}`} />;
  if (status === "error") return <XCircle className={`text-destructive ${className}`} />;
  if (status === "abandoned") return <AlertTriangle className={`text-destructive ${className}`} />;
  if (status === "stale") return <Clock className={`text-warning ${className}`} />;
  if (status === "running") return <RefreshCw className={`text-warning animate-spin ${className}`} />;
  if (status === "queued") return <Clock className={`text-warning ${className}`} />;
  if (status === "skipped") return <SkipForward className={`text-muted-foreground/40 ${className}`} />;
  if (status === "cancelled") return <XCircle className={`text-muted-foreground/50 ${className}`} />;
  return <Clock className={`text-muted-foreground/40 ${className}`} />;
}

function PhaseTimeline({
  phases,
  totalDurationMs,
  now,
  runEffectiveStatus,
}: {
  phases: Phase[];
  totalDurationMs: number;
  now: number;
  runEffectiveStatus: EffectiveSyncState;
}) {
  if (phases.length === 0) {
    return (
      <p className="py-4 text-center text-[12px] text-muted-foreground/40">
        No phase data (run predates instrumentation)
      </p>
    );
  }

  return (
    <div className="space-y-1 py-3">
      <PhaseSummary phases={phases} runEffectiveStatus={runEffectiveStatus} />
      {phases.map((phase) => {
        const durationMs = phase.completedAt
          ? new Date(phase.completedAt).getTime() - new Date(phase.startedAt).getTime()
          : now - new Date(phase.startedAt).getTime();
        const widthPct = totalDurationMs > 0 ? Math.max(2, (durationMs / totalDurationMs) * 100) : 50;
        const displayStatus = getDisplayPhaseStatus(phase, runEffectiveStatus);
        const isInterrupted = displayStatus === "error" && phase.status === "running" && !phase.completedAt;
        const tone = getPhaseTone(displayStatus);
        const badges = getPhaseBadges(phase);

        return (
          <div
            key={phase.id}
            className={`group rounded-lg border px-3 py-2 transition-colors ${tone.container}`}
            data-phase-status={displayStatus}
            data-testid={`phase-row-${phase.id}`}
          >
            <div className="flex items-center gap-3">
              <StatusIcon
                status={displayStatus}
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
                      backgroundColor: tone.bar,
                      opacity: displayStatus === "skipped" ? 0.2 : 0.3,
                    }}
                  />
                </div>
                {badges.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {badges.map((badge) => (
                      <span
                        key={`${phase.id}-${badge.label}`}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}
                      >
                        {badge.label}: {badge.value}
                      </span>
                    ))}
                  </div>
                )}
                {/* Detail text */}
                {phase.detail && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/40">
                    {phase.detail}
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
  const [now, setNow] = useState(() => Date.now());
  const Icon = SOURCE_ICONS[run.source] ?? Database;
  const label = SOURCE_LABELS[run.source] ?? run.source;
  const effectiveStatus = getEffectiveSyncState(run, new Date(now));
  const isActive = effectiveStatus === "running" || effectiveStatus === "queued";
  const isRunning = effectiveStatus === "running";

  // Tick `now` every 2s for queued/running syncs
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, [isActive]);

  const isStale = effectiveStatus === "stale";
  const isAbandoned = effectiveStatus === "abandoned";

  const durationMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : now - new Date(run.startedAt).getTime();

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
        <StatusIcon status={effectiveStatus} className="h-3.5 w-3.5 shrink-0" />

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

        {/* Stale / abandoned warning */}
        {isStale && (
          <Clock className="h-3.5 w-3.5 shrink-0 text-warning" />
        )}
        {isAbandoned && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
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
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground/50">
            <span>State: {effectiveStatus}</span>
            <span>Trigger: {run.trigger}</span>
            <span>Attempt: {run.attempt}</span>
            {run.scopeDescription && <span>Scope: {run.scopeDescription}</span>}
            {run.skipReason && <span>Reason: {run.skipReason}</span>}
          </div>
          <PhaseTimeline
            phases={run.phases}
            totalDurationMs={durationMs}
            now={now}
            runEffectiveStatus={effectiveStatus}
          />
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
