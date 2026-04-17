"use client";

import { StatusBadge } from "./status-badge";
import { buildSlackMessageUrl } from "@/lib/config/slack";
import { ExternalLink } from "lucide-react";

interface OkrItem {
  objectiveName: string;
  krName: string;
  status: string;
  actual: string | null;
  target: string | null;
  channelId: string;
  slackTs: string;
}

export function EngineerOkrCard({
  squadName,
  okrs,
}: {
  squadName: string;
  okrs: OkrItem[];
}) {
  if (okrs.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50">
        <p className="text-sm text-muted-foreground">
          No OKR updates found for {squadName}.
        </p>
      </div>
    );
  }

  // Group by objective
  const byObjective = new Map<string, OkrItem[]>();
  for (const okr of okrs) {
    const existing = byObjective.get(okr.objectiveName) ?? [];
    existing.push(okr);
    byObjective.set(okr.objectiveName, existing);
  }

  return (
    <div className="space-y-4">
      {[...byObjective.entries()].map(([objective, krs]) => (
        <div
          key={objective}
          className="rounded-xl border border-border/60 bg-card p-4 shadow-warm"
        >
          <h4 className="mb-3 text-sm font-semibold text-foreground">
            {objective}
          </h4>
          <div className="space-y-2.5">
            {krs.map((kr) => (
              <div
                key={`${objective}-${kr.krName}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{kr.krName}</p>
                  {(kr.actual || kr.target) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {kr.actual != null && `Actual: ${kr.actual}`}
                      {kr.actual != null && kr.target != null && " · "}
                      {kr.target != null && `Target: ${kr.target}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={
                      kr.status as
                        | "on_track"
                        | "at_risk"
                        | "behind"
                        | "completed"
                        | "default"
                    }
                  />
                  <a
                    href={buildSlackMessageUrl(kr.channelId, kr.slackTs)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground/40 hover:text-primary transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
