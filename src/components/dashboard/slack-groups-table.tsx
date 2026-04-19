"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import type { SlackGroupSummary } from "@/lib/data/slack-members";
import { cn } from "@/lib/utils";

type SortKey =
  | "avgEngagement"
  | "medianEngagement"
  | "activeShare"
  | "memberCount"
  | "totalMessages"
  | "msgsPerMemberPerDay"
  | "totalReactions";

const COLUMNS: {
  key: SortKey;
  label: string;
  info?: string;
}[] = [
  {
    key: "avgEngagement",
    label: "Avg engagement",
    info: "Mean of member percentile composites (0–100).",
  },
  {
    key: "medianEngagement",
    label: "Median",
    info: "Median engagement score across group members.",
  },
  {
    key: "activeShare",
    label: "Active 30d",
    info: "Share of group members active in the last 30 days.",
  },
  {
    key: "msgsPerMemberPerDay",
    label: "Msgs/member/day",
    info: "Total messages / members / window days (normalised).",
  },
  {
    key: "totalMessages",
    label: "Messages",
  },
  {
    key: "totalReactions",
    label: "Reactions",
  },
  {
    key: "memberCount",
    label: "Members",
  },
];

function ScoreBar({ value }: { value: number }) {
  const color =
    value >= 70
      ? "bg-emerald-500/70"
      : value >= 40
        ? "bg-primary/70"
        : value >= 20
          ? "bg-amber-500/70"
          : "bg-rose-500/60";
  return (
    <div className="flex items-center justify-end gap-2.5">
      <span className="w-8 text-right tabular-nums font-medium text-foreground">
        {value}
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export interface SlackGroupsTableProps {
  groups: SlackGroupSummary[];
  /** "pillar" → rows drill into /slack/members?pillar=X; "squad" → ?squad=X. */
  groupBy: "pillar" | "squad";
}

export function SlackGroupsTable({ groups, groupBy }: SlackGroupsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("avgEngagement");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const get: Record<SortKey, (g: SlackGroupSummary) => number> = {
      avgEngagement: (g) => g.avgEngagement,
      medianEngagement: (g) => g.medianEngagement,
      activeShare: (g) => g.activeShare,
      memberCount: (g) => g.memberCount,
      totalMessages: (g) => g.totalMessages,
      msgsPerMemberPerDay: (g) => g.msgsPerMemberPerDay,
      totalReactions: (g) => g.totalReactions,
    };
    const accessor = get[sortKey];
    return [...groups].sort((a, b) => {
      const d = accessor(a) - accessor(b);
      return sortDir === "desc" ? -d : d;
    });
  }, [groups, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: "44px" }} />
            <col style={{ width: "260px" }} />
            <col style={{ width: "180px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "110px" }} />
            <col style={{ width: "100px" }} />
            <col style={{ width: "220px" }} />
            <col style={{ width: "40px" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                #
              </th>
              <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {groupBy === "pillar" ? "Pillar" : "Squad"}
              </th>
              {COLUMNS.map((col) => {
                const isActive = sortKey === col.key;
                const Icon = isActive
                  ? sortDir === "desc"
                    ? ArrowDown
                    : ArrowUp
                  : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    className="cursor-pointer select-none px-3 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => handleSort(col.key)}
                    title={col.info}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {col.label}
                      <Icon className={cn("h-3 w-3", isActive && "text-primary")} />
                    </div>
                  </th>
                );
              })}
              <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Extremes
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 4}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No groups to show.
                </td>
              </tr>
            ) : (
              sorted.map((g, i) => {
                const drillHref =
                  groupBy === "pillar"
                    ? `/dashboard/slack/members?pillar=${encodeURIComponent(g.key)}`
                    : `/dashboard/slack/members?squad=${encodeURIComponent(g.key)}`;
                return (
                  <tr
                    key={g.key}
                    className="group border-b border-border/30 transition-colors last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-3 tabular-nums font-medium text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={drillHref}
                        className="block min-w-0"
                      >
                        <div className="truncate font-medium text-foreground group-hover:text-primary transition-colors">
                          {g.key}
                        </div>
                        {g.pillar && (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {g.pillar}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ScoreBar value={g.avgEngagement} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {g.medianEngagement}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="font-medium text-foreground">
                        {Math.round(g.activeShare * 100)}%
                      </span>
                      <span className="ml-1 text-[10px] text-muted-foreground/60">
                        ({g.activeLast30dCount}/{g.memberCount})
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {g.msgsPerMemberPerDay.toFixed(1)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {g.totalMessages.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {g.totalReactions.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      {g.memberCount}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5 text-[11px]">
                        {g.mostEngaged && (
                          <PersonPill
                            label="Top"
                            name={g.mostEngaged.name}
                            score={g.mostEngaged.engagementScore}
                            slug={g.mostEngaged.slug}
                            tone="emerald"
                          />
                        )}
                        {g.leastEngaged && (
                          <PersonPill
                            label="Bottom"
                            name={g.leastEngaged.name}
                            score={g.leastEngaged.engagementScore}
                            slug={g.leastEngaged.slug}
                            tone="rose"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={drillHref}
                        className="flex items-center justify-end text-muted-foreground/40 transition-colors hover:text-primary"
                        aria-label={`Drill into ${g.key}`}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PersonPill({
  label,
  name,
  score,
  slug,
  tone,
}: {
  label: string;
  name: string;
  score: number;
  slug: string | null;
  tone: "emerald" | "rose";
}) {
  const color =
    tone === "emerald" ? "text-emerald-700" : "text-rose-700";
  const content = (
    <span className={cn("inline-flex items-center gap-1.5", slug && "hover:underline")}>
      <span className={cn("text-[9px] uppercase tracking-wider", color)}>{label}</span>
      <span className="truncate text-foreground">{name}</span>
      <span className="tabular-nums text-muted-foreground">{score}</span>
    </span>
  );
  if (slug) {
    return (
      <Link href={`/dashboard/people/${slug}`} className="truncate">
        {content}
      </Link>
    );
  }
  return <div className="truncate">{content}</div>;
}
