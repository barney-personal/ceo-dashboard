"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, Users, ChevronRight } from "lucide-react";
import { EngineeringTable } from "./engineering-table";

interface EngineerRow {
  login: string;
  avatarUrl: string | null;
  prsCount: number;
  commitsCount: number;
  additions: number;
  deletions: number;
  netLines: number;
  changedFiles: number;
  repos: string[];
  employeeName: string | null;
  isBot: boolean;
  jobTitle: string | null;
  level: string | null;
  squad: string | null;
  pillar: string | null;
  tenureMonths: number | null;
}

interface SquadSummary {
  name: string;
  pillar: string | null;
  engineers: number;
  prsCount: number;
  commitsCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  impact: number;
  levels: Map<string, number>;
}

function computeImpact(prs: number, additions: number, deletions: number) {
  if (prs === 0) return 0;
  return Math.round(prs * Math.log2(1 + (additions + deletions) / prs));
}

type SortField = "impact" | "engineers" | "prsCount" | "commitsCount";

export function EngineeringSquadView({ data }: { data: EngineerRow[] }) {
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("impact");

  const humans = useMemo(
    () => data.filter((r) => !r.isBot),
    [data]
  );

  const squads = useMemo(() => {
    const map = new Map<string, SquadSummary>();

    for (const eng of humans) {
      const squadName = eng.squad ?? "Unassigned";
      let squad = map.get(squadName);
      if (!squad) {
        squad = {
          name: squadName,
          pillar: eng.pillar,
          engineers: 0,
          prsCount: 0,
          commitsCount: 0,
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          impact: 0,
          levels: new Map(),
        };
        map.set(squadName, squad);
      }
      squad.engineers++;
      squad.prsCount += eng.prsCount;
      squad.commitsCount += eng.commitsCount;
      squad.additions += eng.additions;
      squad.deletions += eng.deletions;
      squad.changedFiles += eng.changedFiles;
      if (eng.level) {
        squad.levels.set(eng.level, (squad.levels.get(eng.level) ?? 0) + 1);
      }
    }

    // Compute impact at squad level
    for (const squad of map.values()) {
      squad.impact = computeImpact(
        squad.prsCount,
        squad.additions,
        squad.deletions
      );
    }

    return [...map.values()].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [humans, sortBy]);

  // Drill-down: show filtered table for selected squad
  if (selectedSquad) {
    const squadData = data.filter(
      (r) => (r.squad ?? "Unassigned") === selectedSquad
    );
    return (
      <div className="space-y-3">
        <button
          onClick={() => setSelectedSquad(null)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to squads
        </button>
        <h3 className="text-lg font-semibold font-serif text-foreground">
          {selectedSquad}
        </h3>
        <EngineeringTable data={squadData} />
      </div>
    );
  }

  if (squads.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-12 text-center shadow-warm">
        <p className="text-sm text-muted-foreground">
          No squad data available. Employee metadata is needed for squad grouping.
        </p>
      </div>
    );
  }

  const sortOptions: { key: SortField; label: string }[] = [
    { key: "impact", label: "Impact" },
    { key: "prsCount", label: "PRs" },
    { key: "commitsCount", label: "Commits" },
    { key: "engineers", label: "Team size" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort by</span>
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
          {sortOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortBy(opt.key)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                sortBy === opt.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {squads.map((squad) => {
          const sortedLevels = [...squad.levels.entries()].sort(
            (a, b) => b[1] - a[1]
          );
          return (
            <button
              key={squad.name}
              onClick={() => setSelectedSquad(squad.name)}
              className="group rounded-xl border border-border/60 bg-card p-4 text-left shadow-warm transition-all hover:border-primary/30 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-foreground group-hover:text-primary transition-colors">
                    {squad.name}
                  </h4>
                  {squad.pillar && (
                    <p className="text-[11px] text-muted-foreground">
                      {squad.pillar}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Impact</span>
                  <span className="font-medium tabular-nums">
                    {squad.impact.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Engineers</span>
                  <span className="font-medium tabular-nums">
                    {squad.engineers}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PRs</span>
                  <span className="font-medium tabular-nums">
                    {squad.prsCount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Commits</span>
                  <span className="font-medium tabular-nums">
                    {squad.commitsCount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lines +</span>
                  <span className="font-medium tabular-nums">
                    {squad.additions.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lines −</span>
                  <span className="font-medium tabular-nums text-negative/70">
                    {squad.deletions.toLocaleString()}
                  </span>
                </div>
              </div>

              {sortedLevels.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {sortedLevels.map(([level, count]) => (
                    <span
                      key={level}
                      className="rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary"
                    >
                      {level}
                      {count > 1 && (
                        <span className="ml-0.5 opacity-60">×{count}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <Users className="h-3 w-3" />
                <span>
                  {squad.engineers} engineer{squad.engineers !== 1 ? "s" : ""}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
