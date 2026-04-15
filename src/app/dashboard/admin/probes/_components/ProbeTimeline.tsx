"use client";

import {
  formatRelativeTime,
  formatLatency,
  statusColor,
  groupTimelineByHour,
  type SerializedTimelineRun,
} from "./format";

export function ProbeTimeline({ runs }: { runs: SerializedTimelineRun[] }) {
  const groups = groupTimelineByHour(runs);

  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No probe runs in the last 24 hours.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const hourDate = new Date(group.hour);
        const hourLabel = hourDate.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        });

        return (
          <div key={group.hour}>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
              {hourLabel} UTC
            </p>
            <div className="space-y-1">
              {group.runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-2 rounded border border-border/30 px-2.5 py-1.5 text-xs"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      run.status === "green"
                        ? "bg-positive"
                        : run.status === "red"
                          ? "bg-destructive"
                          : "bg-warning"
                    }`}
                  />
                  <span className="font-medium">{run.checkName}</span>
                  <span className={statusColor(run.status)}>{run.status}</span>
                  <span className="font-mono text-muted-foreground">
                    {formatLatency(run.latencyMs)}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {formatRelativeTime(run.ts)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
