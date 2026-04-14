"use client";

import {
  formatUptime,
  formatLatency,
  formatRelativeTime,
  statusColor,
  heartbeatBadge,
  type SerializedProbeCheckSummary,
} from "./format";
import { Activity, AlertTriangle, Clock, Zap } from "lucide-react";

export function ProbeSummary({
  checks,
}: {
  checks: SerializedProbeCheckSummary[];
}) {
  if (checks.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No probe checks configured.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border/30">
      {checks.map((check) => {
        const badge = heartbeatBadge(check.heartbeatFresh);
        return (
          <div key={check.checkName} className="space-y-3 py-4 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${
                    check.latestStatus === "green"
                      ? "bg-positive"
                      : check.latestStatus === "red"
                        ? "bg-destructive"
                        : "bg-muted-foreground"
                  }`}
                />
                <span className="text-sm font-semibold">{check.checkName}</span>
                <span
                  className={`${statusColor(check.latestStatus)} text-xs font-medium`}
                >
                  {check.latestStatus ?? "no data"}
                </span>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                icon={Activity}
                label="7d Uptime"
                value={formatUptime(check.uptimePercent7d)}
              />
              <Stat
                icon={Zap}
                label="p50 / p95"
                value={`${formatLatency(check.latencyP50)} / ${formatLatency(check.latencyP95)}`}
              />
              <Stat
                icon={Clock}
                label="Last run"
                value={formatRelativeTime(check.latestRunTs)}
              />
              <Stat
                icon={Clock}
                label="Heartbeat"
                value={formatRelativeTime(check.heartbeatLastSeen)}
              />
            </div>

            {check.heartbeatVersion && (
              <p className="text-xs text-muted-foreground">
                Version: <span className="font-mono">{check.heartbeatVersion}</span>
              </p>
            )}

            {check.openIncident && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-xs font-semibold text-destructive">
                    Open Incident #{check.openIncident.id}
                  </span>
                  <span className="text-xs text-destructive/80">
                    Escalation level {check.openIncident.escalationLevel} — opened{" "}
                    {formatRelativeTime(check.openIncident.openedAt)}
                  </span>
                </div>
              </div>
            )}

            {check.recentRedEvents.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Recent failures ({check.recentRedEvents.length})
                </p>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {check.recentRedEvents.map((event, i) => (
                    <div
                      key={`${event.ts}-${i}`}
                      className="flex items-center gap-2 rounded border border-border/30 px-2 py-1 text-xs"
                    >
                      <span className="text-destructive">●</span>
                      <span className="text-muted-foreground">
                        {formatRelativeTime(event.ts)}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {formatLatency(event.latencyMs)}
                      </span>
                      {event.details != null && (
                        <span className="truncate text-muted-foreground/70">
                          {typeof event.details === "string"
                            ? event.details
                            : JSON.stringify(event.details).slice(0, 80)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-muted-foreground/60" />
      <div>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-xs font-medium tabular-nums">{value}</p>
      </div>
    </div>
  );
}
