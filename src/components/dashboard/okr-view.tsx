"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { RagBar } from "@/components/dashboard/rag-bar";
import { ExternalLink, ArrowLeft } from "lucide-react";

interface OkrKr {
  pillar: string;
  squadName: string;
  objectiveName: string;
  krName: string;
  status: string;
  actual: string | null;
  target: string | null;
  userName: string | null;
  slackUrl: string;
}

interface PillarData {
  name: string;
  okrs: OkrKr[];
}

interface OkrViewProps {
  pillars: PillarData[];
  counts: { onTrack: number; atRisk: number; behind: number; total: number };
}

function statusToType(status: string) {
  switch (status) {
    case "on_track": return "on_track" as const;
    case "at_risk": return "at_risk" as const;
    case "behind": return "behind" as const;
    case "completed": return "completed" as const;
    default: return "default" as const;
  }
}

function countStatuses(okrs: OkrKr[]) {
  return {
    green: okrs.filter((o) => o.status === "on_track").length,
    amber: okrs.filter((o) => o.status === "at_risk").length,
    red: okrs.filter((o) => o.status === "behind").length,
    grey: okrs.filter((o) => o.status !== "on_track" && o.status !== "at_risk" && o.status !== "behind").length,
  };
}

function groupBySquad(okrs: OkrKr[]) {
  const map = new Map<string, OkrKr[]>();
  for (const okr of okrs) {
    const existing = map.get(okr.squadName) ?? [];
    existing.push(okr);
    map.set(okr.squadName, existing);
  }
  return [...map.entries()];
}

export function OkrView({ pillars, counts }: OkrViewProps) {
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);

  const activePillar = pillars.find((p) => p.name === selectedPillar);

  return (
    <div className="space-y-6">
      {/* Summary strip — always visible */}
      <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
        {[
          { label: "Total KRs", value: counts.total, color: "text-foreground" },
          { label: "On Track", value: counts.onTrack, color: "text-positive" },
          { label: "At Risk", value: counts.atRisk, color: "text-warning" },
          { label: "Behind", value: counts.behind, color: "text-negative" },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className={`flex flex-col gap-1 px-5 py-4 ${i > 0 ? "border-l border-border/50" : ""}`}
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {stat.label}
            </span>
            <span className={`font-mono text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      <RagBar
        green={counts.onTrack}
        amber={counts.atRisk}
        red={counts.behind}
        grey={counts.total - counts.onTrack - counts.atRisk - counts.behind}
      />

      {/* Overview: pillar cards */}
      {!selectedPillar && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pillars.map((pillar) => {
            const rag = countStatuses(pillar.okrs);
            const squads = groupBySquad(pillar.okrs);

            return (
              <button
                key={pillar.name}
                onClick={() => setSelectedPillar(pillar.name)}
                className="group min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card p-5 shadow-warm text-left transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
              >
                <h3 className="text-base font-semibold text-foreground">
                  {pillar.name}
                </h3>

                <div className="mb-3 mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  {rag.green > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-positive" />
                      {rag.green}
                    </span>
                  )}
                  {rag.amber > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-warning" />
                      {rag.amber}
                    </span>
                  )}
                  {rag.red > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-negative" />
                      {rag.red}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground/50">
                    {pillar.okrs.length} KRs
                  </span>
                </div>

                <RagBar
                  green={rag.green}
                  amber={rag.amber}
                  red={rag.red}
                  grey={rag.grey}
                  className="mb-4"
                />

                <div className="space-y-1.5">
                  {squads.map(([squad, krs]) => (
                    <div key={squad} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm text-muted-foreground">
                        {squad}
                      </span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {krs.map((kr, i) => (
                          <span
                            key={i}
                            className={`h-2.5 w-2.5 rounded-sm ${
                              kr.status === "on_track"
                                ? "bg-positive"
                                : kr.status === "at_risk"
                                  ? "bg-warning"
                                  : kr.status === "behind"
                                    ? "bg-negative"
                                    : "bg-muted-foreground/30"
                            }`}
                            title={kr.krName}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail view: selected pillar */}
      {selectedPillar && activePillar && (
        <div className="space-y-5">
          <button
            onClick={() => setSelectedPillar(null)}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All pillars
          </button>

          <div>
            <h3 className="text-xl font-semibold text-foreground">
              {activePillar.name}
            </h3>
            <div className="mt-2 max-w-md">
              <RagBar
                green={countStatuses(activePillar.okrs).green}
                amber={countStatuses(activePillar.okrs).amber}
                red={countStatuses(activePillar.okrs).red}
                grey={countStatuses(activePillar.okrs).grey}
              />
            </div>
          </div>

          {groupBySquad(activePillar.okrs).map(([squad, krs]) => (
            <div
              key={squad}
              className="rounded-xl border border-border/60 bg-card shadow-warm"
            >
              <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
                <div>
                  <span className="text-sm font-semibold text-foreground">
                    {squad}
                  </span>
                  {krs[0]?.userName && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {krs[0].userName}
                    </span>
                  )}
                </div>
                <a
                  href={krs[0].slackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:border-border hover:text-foreground"
                >
                  Slack
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <div className="p-5 space-y-2">
                {krs.map((kr) => (
                  <div
                    key={`${kr.squadName}-${kr.krName}`}
                    className="flex items-start gap-3 rounded-lg bg-muted/30 px-3 py-2.5"
                  >
                    <span
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${
                        kr.status === "on_track"
                          ? "bg-positive"
                          : kr.status === "at_risk"
                            ? "bg-warning"
                            : kr.status === "behind"
                              ? "bg-negative"
                              : "bg-muted-foreground/30"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {kr.krName}
                      </p>
                      {(kr.actual || kr.target) && (
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {kr.actual}
                          {kr.target ? ` vs ${kr.target} target` : ""}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                        {kr.objectiveName}
                      </p>
                    </div>
                    <StatusBadge status={statusToType(kr.status)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
