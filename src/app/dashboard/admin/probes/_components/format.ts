import type { ProbeCheckSummary } from "@/lib/data/probes";

// ---------------------------------------------------------------------------
// Serialized types — Date fields converted to ISO strings for client props
// ---------------------------------------------------------------------------

export interface SerializedProbeCheckSummary {
  checkName: string;
  latestStatus: string | null;
  latestRunTs: string | null;
  heartbeatFresh: boolean;
  heartbeatLastSeen: string | null;
  heartbeatVersion: string | null;
  openIncident: {
    id: number;
    escalationLevel: number;
    openedAt: string;
  } | null;
  uptimePercent7d: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  recentRedEvents: Array<{
    ts: string;
    latencyMs: number;
    details: unknown;
  }>;
}

export interface SerializedTimelineRun {
  id: number;
  probeId: string;
  checkName: string;
  status: string;
  latencyMs: number;
  detailsJson: unknown;
  runId: string | null;
  target: string;
  ts: string;
}

export interface TimelineHourGroup {
  hour: string;
  runs: SerializedTimelineRun[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatUptime(value: number | null): string {
  if (value === null) return "—";
  return `${value}%`;
}

export function formatLatency(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value)}ms`;
}

export function formatRelativeTime(
  isoTs: string | null,
  now: Date = new Date(),
): string {
  if (isoTs === null) return "—";
  const diffMs = now.getTime() - new Date(isoTs).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

export function statusColor(status: string | null): string {
  switch (status) {
    case "green":
      return "text-positive";
    case "red":
      return "text-destructive";
    case "timeout":
      return "text-warning";
    default:
      return "text-muted-foreground";
  }
}

export function heartbeatBadge(fresh: boolean): {
  label: string;
  className: string;
} {
  return fresh
    ? { label: "Fresh", className: "bg-positive/10 text-positive border-positive/30" }
    : { label: "Stale", className: "bg-warning/10 text-warning border-warning/30" };
}

// ---------------------------------------------------------------------------
// Serializers — convert server Date objects to strings for client components
// ---------------------------------------------------------------------------

export function serializeSummary(
  s: ProbeCheckSummary,
): SerializedProbeCheckSummary {
  return {
    checkName: s.checkName,
    latestStatus: s.latestStatus,
    latestRunTs: s.latestRunTs?.toISOString() ?? null,
    heartbeatFresh: s.heartbeatFresh,
    heartbeatLastSeen: s.heartbeatLastSeen?.toISOString() ?? null,
    heartbeatVersion: s.heartbeatVersion,
    openIncident: s.openIncident
      ? {
          id: s.openIncident.id,
          escalationLevel: s.openIncident.escalationLevel,
          openedAt: s.openIncident.openedAt.toISOString(),
        }
      : null,
    uptimePercent7d: s.uptimePercent7d,
    latencyP50: s.latencyP50,
    latencyP95: s.latencyP95,
    recentRedEvents: s.recentRedEvents.map((e) => ({
      ts: e.ts.toISOString(),
      latencyMs: e.latencyMs,
      details: e.details,
    })),
  };
}

export function serializeTimelineRun(r: {
  id: number;
  probeId: string;
  checkName: string;
  status: string;
  latencyMs: number;
  detailsJson: unknown;
  runId: string | null;
  target: string;
  ts: Date;
}): SerializedTimelineRun {
  return {
    id: r.id,
    probeId: r.probeId,
    checkName: r.checkName,
    status: r.status,
    latencyMs: r.latencyMs,
    detailsJson: r.detailsJson,
    runId: r.runId,
    target: r.target,
    ts: r.ts.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Timeline grouping
// ---------------------------------------------------------------------------

export function groupTimelineByHour(
  runs: SerializedTimelineRun[],
): TimelineHourGroup[] {
  if (runs.length === 0) return [];

  const buckets = new Map<string, SerializedTimelineRun[]>();

  for (const run of runs) {
    const d = new Date(run.ts);
    const hourKey = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()),
    ).toISOString();
    const arr = buckets.get(hourKey) ?? [];
    arr.push(run);
    buckets.set(hourKey, arr);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
    .map(([hour, hourRuns]) => ({ hour, runs: hourRuns }));
}
