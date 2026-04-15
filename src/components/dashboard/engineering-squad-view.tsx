"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
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

interface SquadRow {
  name: string;
  pillar: string | null;
  engineers: number;
  avgImpact: number;
  avgPrs: number;
  avgCommits: number;
  avgAdditions: number;
  avgDeletions: number;
}

function computeImpact(prs: number, additions: number, deletions: number) {
  if (prs === 0) return 0;
  return Math.round(prs * Math.log2(1 + (additions + deletions) / prs));
}

type SortField = keyof Omit<SquadRow, "name" | "pillar">;

const COLUMNS: {
  key: SortField;
  label: string;
  format: (v: number) => string;
}[] = [
  { key: "avgImpact", label: "Avg Impact", format: (v) => Math.round(v).toLocaleString() },
  { key: "engineers", label: "Engineers", format: (v) => v.toLocaleString() },
  { key: "avgPrs", label: "Avg PRs", format: (v) => v.toFixed(1) },
  { key: "avgCommits", label: "Avg Commits", format: (v) => v.toFixed(1) },
  { key: "avgAdditions", label: "Avg Lines +", format: (v) => Math.round(v).toLocaleString() },
  { key: "avgDeletions", label: "Avg Lines −", format: (v) => Math.round(v).toLocaleString() },
];

export function EngineeringSquadView({ data }: { data: EngineerRow[] }) {
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortField>("avgImpact");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const humans = useMemo(() => data.filter((r) => !r.isBot), [data]);

  const squads = useMemo(() => {
    const map = new Map<
      string,
      {
        pillar: string | null;
        engineers: number;
        totalPrs: number;
        totalCommits: number;
        totalAdditions: number;
        totalDeletions: number;
      }
    >();

    for (const eng of humans) {
      const squadName = eng.squad ?? "Unassigned";
      let squad = map.get(squadName);
      if (!squad) {
        squad = {
          pillar: eng.pillar,
          engineers: 0,
          totalPrs: 0,
          totalCommits: 0,
          totalAdditions: 0,
          totalDeletions: 0,
        };
        map.set(squadName, squad);
      }
      squad.engineers++;
      squad.totalPrs += eng.prsCount;
      squad.totalCommits += eng.commitsCount;
      squad.totalAdditions += eng.additions;
      squad.totalDeletions += eng.deletions;
    }

    const rows: SquadRow[] = [...map.entries()].map(([name, s]) => {
      const n = s.engineers;
      return {
        name,
        pillar: s.pillar,
        engineers: n,
        avgImpact: computeImpact(s.totalPrs, s.totalAdditions, s.totalDeletions) / n,
        avgPrs: s.totalPrs / n,
        avgCommits: s.totalCommits / n,
        avgAdditions: s.totalAdditions / n,
        avgDeletions: s.totalDeletions / n,
      };
    });

    return rows.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortDir === "desc" ? -diff : diff;
    });
  }, [humans, sortKey, sortDir]);

  const handleSort = (key: SortField) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

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
          No squad data available. Employee metadata is needed for squad
          grouping.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground w-8">
                #
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Squad
              </th>
              {COLUMNS.map((col) => {
                const isActive = sortKey === col.key;
                const SortIcon = isActive
                  ? sortDir === "desc"
                    ? ArrowDown
                    : ArrowUp
                  : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {col.label}
                      <SortIcon
                        className={cn(
                          "h-3 w-3",
                          isActive && "text-primary"
                        )}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {squads.map((squad, i) => (
              <tr
                key={squad.name}
                onClick={() => setSelectedSquad(squad.name)}
                className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 text-muted-foreground font-medium tabular-nums">
                  {i + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {squad.name}
                    </span>
                    {squad.pillar && (
                      <span className="text-[11px] text-muted-foreground">
                        {squad.pillar}
                      </span>
                    )}
                  </div>
                </td>
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-right tabular-nums font-medium",
                      col.key === "avgDeletions" && "text-negative/70"
                    )}
                  >
                    {col.format(squad[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
