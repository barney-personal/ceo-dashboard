"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Monitor, Smartphone, Apple } from "lucide-react";
import type { SlackMemberRow } from "@/lib/data/slack-members";
import { cn } from "@/lib/utils";

type SortKey =
  | "engagementScore"
  | "daysActive"
  | "activeDayRate"
  | "messagesPosted"
  | "msgsPerCalendarDay"
  | "msgsPerActiveDay"
  | "reactionsAdded"
  | "tenureDays"
  | "daysSinceLastActive";

interface Column {
  key: SortKey;
  label: string;
  shortLabel?: string;
  align?: "left" | "right";
  info?: string;
}

const COLUMNS: Column[] = [
  {
    key: "engagementScore",
    label: "Engagement",
    info: "Average percentile rank of (messages/day) and (reactions/day), tenure-normalised. These are the two strongest Slack-side predictors of engineering impact (Spearman 0.60 and 0.58). Active-day rate and desktop-share were dropped from the composite — they don't correlate with impact. 0 = least engaged, 100 = most engaged within the ranking population.",
  },
  {
    key: "activeDayRate",
    label: "Active days",
    info: "Distinct calendar days the member was active on Slack / tenure-normalised days (capped at 1.0). Display-only — not part of the engagement composite because it doesn't correlate with impact.",
  },
  {
    key: "msgsPerCalendarDay",
    label: "Msgs/day",
    info: "Messages posted per calendar day within the tenure-normalised window.",
  },
  {
    key: "msgsPerActiveDay",
    label: "Msgs/active day",
    info: "Average messages posted on the days the member actually showed up.",
  },
  {
    key: "messagesPosted",
    label: "Messages",
    info: "Total messages posted (DMs + channels) across the window.",
  },
  {
    key: "reactionsAdded",
    label: "Reactions",
    info: "Emoji reactions added across the window.",
  },
  {
    key: "daysSinceLastActive",
    label: "Last seen",
    info: "Calendar days between the snapshot's window end and the member's last active timestamp. Sorts ascending = most recent first.",
  },
];

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

function fmtRate(n: number): string {
  return (n * 100).toFixed(0) + "%";
}

function fmtDecimal(n: number, digits = 1): string {
  if (n === 0) return "0";
  if (n < 0.05) return n.toFixed(2);
  return n.toFixed(digits);
}

function fmtTenure(days: number | null): string {
  if (days === null) return "—";
  if (days < 30) return `${days}d`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months}mo`;
  }
  const years = Math.floor(days / 365);
  const remMonths = Math.round((days - years * 365) / 30);
  return remMonths === 0 ? `${years}y` : `${years}y ${remMonths}mo`;
}

function fmtDaysAgo(days: number | null): string {
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function PlatformIcon({
  platform,
  className,
}: {
  platform: SlackMemberRow["primaryPlatform"];
  className?: string;
}) {
  if (platform === "desktop") return <Monitor className={className} />;
  if (platform === "android") return <Smartphone className={className} />;
  if (platform === "ios") return <Apple className={className} />;
  return null;
}

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
      <span className="tabular-nums font-medium text-foreground w-8 text-right">
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

function ActivityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center justify-end gap-2.5">
      <span className="tabular-nums text-foreground w-9 text-right text-xs">
        {pct}%
      </span>
      <div className="h-1 w-14 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/60"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function lastSeenTone(days: number | null): string {
  if (days === null) return "text-muted-foreground/60";
  if (days <= 3) return "text-emerald-600";
  if (days <= 14) return "text-foreground";
  if (days <= 45) return "text-amber-600";
  return "text-rose-600";
}

export interface SlackMembersTableProps {
  rows: SlackMemberRow[];
  /** Pre-select a pillar filter (used when drilling down from /slack/pillars). */
  initialPillar?: string;
  /** Pre-select a squad filter (used when drilling down from /slack/squads). */
  initialSquad?: string;
  /** Pre-select a function filter. */
  initialFunction?: string;
}

export function SlackMembersTable({
  rows,
  initialPillar,
  initialSquad,
  initialFunction,
}: SlackMembersTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("engagementScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hideGuests, setHideGuests] = useState(true);
  const [hideDeactivated, setHideDeactivated] = useState(true);
  const [hideServiceAccounts, setHideServiceAccounts] = useState(true);
  const [tenuredOnly, setTenuredOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [pillar, setPillar] = useState<string>(initialPillar ?? "all");
  const [squad, setSquad] = useState<string>(initialSquad ?? "all");
  const [func, setFunc] = useState<string>(initialFunction ?? "all");
  const [query, setQuery] = useState("");

  // Distinct pillars / squads / functions present in the data
  const pillarOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.pillar) s.add(r.pillar);
    return ["all", ...Array.from(s).sort(), "unmatched"];
  }, [rows]);
  const squadOptions = useMemo(() => {
    const s = new Set<string>();
    // When a pillar is selected, only show squads within it
    const relevant = pillar !== "all" && pillar !== "unmatched"
      ? rows.filter((r) => r.pillar === pillar)
      : rows;
    for (const r of relevant) if (r.squad) s.add(r.squad);
    return ["all", ...Array.from(s).sort()];
  }, [rows, pillar]);
  const functionOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.function) s.add(r.function);
    return ["all", ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (hideGuests && r.isGuest) return false;
      if (hideDeactivated && r.isDeactivated) return false;
      if (hideServiceAccounts && r.isServiceAccount) return false;
      if (tenuredOnly && (r.tenureDays === null || r.tenureDays < 180)) return false;
      if (
        activeOnly &&
        (r.daysSinceLastActive === null || r.daysSinceLastActive > 30)
      )
        return false;
      if (pillar !== "all") {
        if (pillar === "unmatched") {
          if (r.employeeEmail !== null) return false;
        } else if (r.pillar !== pillar) {
          return false;
        }
      }
      if (squad !== "all" && r.squad !== squad) return false;
      if (func !== "all" && r.function !== func) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (
          !r.name.toLowerCase().includes(q) &&
          !(r.username ?? "").toLowerCase().includes(q) &&
          !(r.title ?? "").toLowerCase().includes(q) &&
          !(r.jobTitle ?? "").toLowerCase().includes(q) &&
          !(r.manager ?? "").toLowerCase().includes(q) &&
          !(r.squad ?? "").toLowerCase().includes(q) &&
          !(r.pillar ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, hideGuests, hideDeactivated, hideServiceAccounts, tenuredOnly, activeOnly, pillar, squad, func, query]);

  const sorted = useMemo(() => {
    const keyAccessor: Record<SortKey, (r: SlackMemberRow) => number> = {
      engagementScore: (r) => r.engagementScore,
      daysActive: (r) => r.daysActive,
      activeDayRate: (r) => r.activeDayRate,
      messagesPosted: (r) => r.messagesPosted,
      msgsPerCalendarDay: (r) => r.msgsPerCalendarDay,
      msgsPerActiveDay: (r) => r.msgsPerActiveDay,
      reactionsAdded: (r) => r.reactionsAdded,
      tenureDays: (r) => r.tenureDays ?? -1,
      daysSinceLastActive: (r) =>
        r.daysSinceLastActive ?? Number.MAX_SAFE_INTEGER,
    };
    const accessor = keyAccessor[sortKey];
    return [...filtered].sort((a, b) => {
      const d = accessor(a) - accessor(b);
      return sortDir === "desc" ? -d : d;
    });
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // For "last seen", ascending (recent first) is the useful default;
      // everything else defaults to descending.
      setSortDir(key === "daysSinceLastActive" || key === "engagementScore" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, title, manager, squad…"
          className="h-8 w-64 rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
        />
        <select
          value={pillar}
          onChange={(e) => {
            setPillar(e.target.value);
            setSquad("all"); // squad options depend on pillar — reset when switching
          }}
          className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground focus:border-primary/60 focus:outline-none"
        >
          {pillarOptions.map((p) => (
            <option key={p} value={p}>
              {p === "all" ? "All pillars" : p === "unmatched" ? "Unmatched" : p}
            </option>
          ))}
        </select>
        <select
          value={squad}
          onChange={(e) => setSquad(e.target.value)}
          className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground focus:border-primary/60 focus:outline-none"
        >
          {squadOptions.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All squads" : s}
            </option>
          ))}
        </select>
        <select
          value={func}
          onChange={(e) => setFunc(e.target.value)}
          className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground focus:border-primary/60 focus:outline-none"
        >
          {functionOptions.map((f) => (
            <option key={f} value={f}>
              {f === "all" ? "All functions" : f}
            </option>
          ))}
        </select>
        <FilterPill active={hideGuests} onClick={() => setHideGuests((v) => !v)}>
          Hide guests
        </FilterPill>
        <FilterPill
          active={hideDeactivated}
          onClick={() => setHideDeactivated((v) => !v)}
        >
          Hide deactivated
        </FilterPill>
        <FilterPill
          active={hideServiceAccounts}
          onClick={() => setHideServiceAccounts((v) => !v)}
        >
          Hide service accounts
        </FilterPill>
        <FilterPill active={tenuredOnly} onClick={() => setTenuredOnly((v) => !v)}>
          Tenured (180d+)
        </FilterPill>
        <FilterPill active={activeOnly} onClick={() => setActiveOnly((v) => !v)}>
          Active last 30d
        </FilterPill>
        <span className="ml-auto text-xs text-muted-foreground">
          {sorted.length.toLocaleString()} of {rows.length.toLocaleString()}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: "48px" }} />
              <col style={{ width: "240px" }} />
              <col className="hidden xl:table-column" style={{ width: "180px" }} />
              <col className="hidden lg:table-column" style={{ width: "80px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "80px" }} />
              <col
                className="hidden md:table-column"
                style={{ width: "110px" }}
              />
              <col style={{ width: "160px" }} />
              <col
                className="hidden md:table-column"
                style={{ width: "80px" }}
              />
              <col style={{ width: "100px" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  #
                </th>
                <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Member
                </th>
                <th className="hidden px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground xl:table-cell">
                  Team
                </th>
                <th className="hidden px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground lg:table-cell">
                  Tenure
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
                      className={cn(
                        "cursor-pointer select-none px-3 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground",
                        (col.key === "msgsPerActiveDay" ||
                          col.key === "reactionsAdded") &&
                          "hidden md:table-cell",
                      )}
                      onClick={() => handleSort(col.key)}
                      title={col.info}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {col.shortLabel ?? col.label}
                        <Icon
                          className={cn(
                            "h-3 w-3",
                            isActive && "text-primary",
                          )}
                        />
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 4}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No members match the current filters.
                  </td>
                </tr>
              ) : (
                sorted.map((row, i) => (
                  <tr
                    key={row.slackUserId}
                    className="border-b border-border/30 transition-colors last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-3 tabular-nums font-medium text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="px-3 py-3">
                      <MemberCell row={row} />
                    </td>
                    <td className="hidden px-3 py-3 text-xs xl:table-cell">
                      {row.pillar || row.squad ? (
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-foreground">
                            {row.pillar ?? "—"}
                          </span>
                          {row.squad && (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {row.squad}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-3 text-xs text-muted-foreground lg:table-cell">
                      {fmtTenure(row.tenureDays)}
                    </td>
                    {/* Engagement score */}
                    <td className="px-3 py-3 text-right">
                      {row.engagementScore > 0 || !row.isDeactivated ? (
                        <ScoreBar value={row.engagementScore} />
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    {/* Active-day rate */}
                    <td className="px-3 py-3 text-right">
                      <ActivityBar value={row.activeDayRate} />
                    </td>
                    {/* Msgs / calendar day */}
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      {fmtDecimal(row.msgsPerCalendarDay)}
                    </td>
                    {/* Msgs / active day */}
                    <td className="hidden px-3 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
                      {row.daysActive === 0 ? "—" : fmtDecimal(row.msgsPerActiveDay)}
                    </td>
                    {/* Total messages */}
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="text-foreground">{fmtNumber(row.messagesPosted)}</span>
                      {row.channelShare !== null && (
                        <span className="ml-1 text-[10px] text-muted-foreground/60">
                          ({fmtRate(row.channelShare)} ch.)
                        </span>
                      )}
                    </td>
                    {/* Reactions */}
                    <td className="hidden px-3 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
                      {fmtNumber(row.reactionsAdded)}
                    </td>
                    {/* Last seen */}
                    <td
                      className={cn(
                        "px-3 py-3 text-right tabular-nums text-xs",
                        lastSeenTone(row.daysSinceLastActive),
                      )}
                    >
                      {fmtDaysAgo(row.daysSinceLastActive)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MemberCell({ row }: { row: SlackMemberRow }) {
  const pills = (
    <>
      {row.isDeactivated && (
        <span className="shrink-0 rounded-full bg-rose-500/10 px-1.5 py-px text-[9px] font-medium text-rose-600">
          Deactivated
        </span>
      )}
      {row.isGuest && (
        <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-px text-[9px] font-medium text-amber-700">
          Guest
        </span>
      )}
      {row.isServiceAccount && (
        <span className="shrink-0 rounded-full bg-slate-500/10 px-1.5 py-px text-[9px] font-medium text-slate-600">
          Service
        </span>
      )}
      {row.matchMethod === "external" && (
        <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-px text-[9px] font-medium text-sky-700">
          External
        </span>
      )}
      {row.matchMethod === "unmatched" && (
        <span
          className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground"
          title="No SSoT employee record found for this Slack user"
        >
          Unmatched
        </span>
      )}
    </>
  );

  const inner = (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate font-medium text-foreground",
              row.employeeEmail && "group-hover:text-primary transition-colors",
            )}
          >
            {row.employeeName ?? row.name}
          </span>
          {pills}
        </div>
        <span className="truncate text-[11px] text-muted-foreground">
          {row.jobTitle ?? row.title ?? (row.username ? `@${row.username}` : "—")}
        </span>
      </div>
      {row.primaryPlatform !== "none" && (
        <PlatformIcon
          platform={row.primaryPlatform}
          className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
        />
      )}
    </div>
  );

  if (row.employeeEmail) {
    const slug = row.employeeEmail.split("@")[0]!;
    return (
      <Link href={`/dashboard/people/${slug}`} className="group block">
        {inner}
      </Link>
    );
  }
  return inner;
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
