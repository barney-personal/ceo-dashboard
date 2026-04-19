"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { EngineeringTable } from "./engineering-table";
import { MetricInfoTooltip } from "./metric-info-tooltip";
import {
  normalizeTeamName,
  type SquadPillarLookup,
} from "@/lib/data/swarmia";

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
  tenureDays: number | null;
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
  /** From Swarmia — null when the team name doesn't match. */
  cycleTimeHours: number | null;
  reviewRatePercent: number | null;
}

function computeImpact(prs: number, additions: number, deletions: number) {
  if (prs === 0) return 0;
  return Math.round(prs * Math.log2(1 + (additions + deletions) / prs));
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

type SortField = keyof Omit<SquadRow, "name" | "pillar">;

const COLUMNS: {
  key: SortField;
  label: string;
  format: (v: number | null) => string;
  /** Lower is better — used to tint the worst outliers. */
  lowerIsBetter?: boolean;
  /** true → null/missing rows sort to the bottom regardless of direction. */
  nullable?: boolean;
  /** Optional info panel content shown behind a ⓘ icon next to the label. */
  info?: React.ReactNode;
}[] = [
  {
    key: "avgImpact",
    label: "Avg Impact",
    format: (v) => (v == null ? "—" : Math.round(v).toLocaleString()),
    info: (
      <>
        <p>
          Combines how much someone ships (PR count) with how meaningful each
          change is (lines per PR).
        </p>
        <p className="font-mono text-[11px] text-foreground/80">
          PRs × log₂(1 + lines / PR)
        </p>
        <p>
          Log-scaling prevents one huge PR from dominating a steady stream of
          smaller changes, so both breadth and depth count.
        </p>
      </>
    ),
  },
  { key: "engineers", label: "Engineers", format: (v) => (v == null ? "—" : v.toLocaleString()) },
  { key: "avgPrs", label: "Avg PRs", format: (v) => (v == null ? "—" : v.toFixed(1)) },
  { key: "avgCommits", label: "Avg Commits", format: (v) => (v == null ? "—" : v.toFixed(1)) },
  { key: "cycleTimeHours", label: "Cycle Time", format: (v) => (v == null ? "—" : formatHours(v)), lowerIsBetter: true, nullable: true },
  { key: "reviewRatePercent", label: "Review Rate", format: (v) => (v == null ? "—" : `${v.toFixed(0)}%`), nullable: true },
  { key: "avgAdditions", label: "Avg Lines +", format: (v) => (v == null ? "—" : Math.round(v).toLocaleString()) },
  { key: "avgDeletions", label: "Avg Lines −", format: (v) => (v == null ? "—" : Math.round(v).toLocaleString()) },
];

export function EngineeringSquadView({
  data,
  groupBy = "squad",
  swarmiaMetrics,
  periodDays = 30,
}: {
  data: EngineerRow[];
  groupBy?: "squad" | "pillar";
  swarmiaMetrics?: SquadPillarLookup;
  periodDays?: number;
}) {
  const groupLabel = groupBy === "pillar" ? "Pillar" : "Squad";
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortField>("avgImpact");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  /** Filter: show only groups with engineers > minEngineers. 0 = all. */
  const [minEngineers, setMinEngineers] = useState<number>(0);

  const humans = useMemo(() => data.filter((r) => !r.isBot), [data]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        subtitle: string | null;
        engineers: number;
        totalPrs: number;
        totalCommits: number;
        totalAdditions: number;
        totalDeletions: number;
      }
    >();

    for (const eng of humans) {
      const key =
        groupBy === "pillar"
          ? eng.pillar ?? "Unassigned"
          : eng.squad ?? "Unassigned";
      const subtitle = groupBy === "pillar" ? null : eng.pillar;
      let group = map.get(key);
      if (!group) {
        group = {
          subtitle,
          engineers: 0,
          totalPrs: 0,
          totalCommits: 0,
          totalAdditions: 0,
          totalDeletions: 0,
        };
        map.set(key, group);
      }
      group.engineers++;
      group.totalPrs += eng.prsCount;
      group.totalCommits += eng.commitsCount;
      group.totalAdditions += eng.additions;
      group.totalDeletions += eng.deletions;
    }

    const swarmiaSource =
      groupBy === "pillar" ? swarmiaMetrics?.pillars : swarmiaMetrics?.squads;

    const rows: SquadRow[] = [...map.entries()].map(([name, s]) => {
      const n = s.engineers;
      const swarmia = swarmiaSource?.[normalizeTeamName(name)];
      return {
        name,
        pillar: s.subtitle,
        engineers: n,
        avgImpact: computeImpact(s.totalPrs, s.totalAdditions, s.totalDeletions) / n,
        avgPrs: s.totalPrs / n,
        avgCommits: s.totalCommits / n,
        avgAdditions: s.totalAdditions / n,
        avgDeletions: s.totalDeletions / n,
        cycleTimeHours: swarmia?.cycleTimeHours ?? null,
        reviewRatePercent: swarmia?.reviewRatePercent ?? null,
      };
    });

    return rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Push nulls/undefined to the bottom regardless of sort direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const diff = av - bv;
      return sortDir === "desc" ? -diff : diff;
    });
  }, [humans, sortKey, sortDir, groupBy, swarmiaMetrics]);

  const visibleGroups = useMemo(
    () => groups.filter((g) => g.engineers > minEngineers),
    [groups, minEngineers]
  );

  const SIZE_FILTERS = [0, 1, 2, 3, 5] as const;

  const handleSort = (key: SortField) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Drill-down: show filtered table for selected group
  if (selectedGroup) {
    const groupData = data.filter((r) => {
      const val =
        groupBy === "pillar"
          ? r.pillar ?? "Unassigned"
          : r.squad ?? "Unassigned";
      return val === selectedGroup;
    });
    return (
      <div className="space-y-3">
        <button
          onClick={() => setSelectedGroup(null)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {groupLabel.toLowerCase()}s
        </button>
        <h3 className="text-lg font-semibold font-serif text-foreground">
          {selectedGroup}
        </h3>
        <EngineeringTable data={groupData} periodDays={periodDays} />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-12 text-center shadow-warm">
        <p className="text-sm text-muted-foreground">
          No {groupLabel.toLowerCase()} data available. Employee metadata is
          needed for grouping.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Size filter */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Team size
          </span>
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
            {SIZE_FILTERS.map((threshold) => {
              const isActive = minEngineers === threshold;
              const label = threshold === 0 ? "All" : `>${threshold}`;
              return (
                <button
                  key={threshold}
                  onClick={() => setMinEngineers(threshold)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {visibleGroups.length} of {groups.length} {groupLabel.toLowerCase()}
          {groups.length === 1 ? "" : "s"}
        </span>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card p-12 text-center shadow-warm">
          <p className="text-sm text-muted-foreground">
            No {groupLabel.toLowerCase()}s with more than {minEngineers} engineer
            {minEngineers === 1 ? "" : "s"}.
          </p>
        </div>
      ) : (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground w-8">
                #
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {groupLabel}
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
                      {col.info && (
                        <MetricInfoTooltip label={col.label}>
                          {col.info}
                        </MetricInfoTooltip>
                      )}
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
            {visibleGroups.map((group, i) => (
              <tr
                key={group.name}
                onClick={() => setSelectedGroup(group.name)}
                className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 text-muted-foreground font-medium tabular-nums">
                  {i + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {group.name}
                    </span>
                    {group.pillar && (
                      <span className="text-[11px] text-muted-foreground">
                        {group.pillar}
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
                    {col.format(group[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
      )}
    </div>
  );
}
