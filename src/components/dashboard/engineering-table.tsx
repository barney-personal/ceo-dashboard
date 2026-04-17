"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  EngineeringFilters,
  EMPTY_FILTERS,
  matchesRole,
  getTenureBucket,
  type EngineeringFilterState,
} from "./engineering-filters";
import { MetricInfoTooltip } from "./metric-info-tooltip";

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

type SortKey = "outputScore" | "prsCount" | "commitsCount" | "additions" | "deletions" | "netLines" | "changedFiles";

const COLUMNS: {
  key: SortKey;
  label: string;
  format: (v: number) => string;
  /** Optional info panel content shown behind a ⓘ icon next to the label. */
  info?: React.ReactNode;
}[] = [
  {
    key: "outputScore",
    label: "Impact",
    format: (v) => v.toLocaleString(),
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
  { key: "prsCount", label: "PRs Merged", format: (v) => v.toLocaleString() },
  { key: "commitsCount", label: "Commits", format: (v) => v.toLocaleString() },
  { key: "additions", label: "Lines Added", format: (v) => v.toLocaleString() },
  { key: "deletions", label: "Lines Deleted", format: (v) => v.toLocaleString() },
  { key: "netLines", label: "Net Lines", format: (v) => (v >= 0 ? `+${v.toLocaleString()}` : v.toLocaleString()) },
  { key: "changedFiles", label: "Files Changed", format: (v) => v.toLocaleString() },
];

function formatTenure(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}m`;
  if (m === 0) return `${y}y`;
  return `${y}y ${m}m`;
}

export function EngineeringTable({
  data,
  hideBots = true,
}: {
  data: EngineerRow[];
  hideBots?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("outputScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<EngineeringFilterState>(EMPTY_FILTERS);

  const humans = useMemo(
    () => (hideBots ? data.filter((r) => !r.isBot) : data),
    [data, hideBots]
  );

  const filtered = useMemo(() => {
    let result = humans;

    if (filters.roles.size > 0) {
      result = result.filter((r) => matchesRole(r.jobTitle, filters.roles));
    }
    if (filters.level !== "all") {
      result = result.filter((r) => r.level === filters.level);
    }
    if (filters.squad !== "all") {
      result = result.filter((r) => r.squad === filters.squad);
    }
    if (filters.tenureBuckets.size > 0) {
      result = result.filter(
        (r) =>
          r.tenureMonths != null &&
          filters.tenureBuckets.has(getTenureBucket(r.tenureMonths))
      );
    }

    return result.map((r) => ({
      ...r,
      outputScore:
        r.prsCount > 0
          ? Math.round(
              r.prsCount *
                Math.log2(1 + (r.additions + r.deletions) / r.prsCount)
            )
          : 0,
    }));
  }, [humans, filters]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const diff = a[sortKey] - b[sortKey];
        return sortDir === "desc" ? -diff : diff;
      }),
    [filtered, sortKey, sortDir]
  );

  const isFiltered = filtered.length !== humans.length;

  if (humans.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-12 text-center shadow-warm">
        <p className="text-sm text-muted-foreground">
          No engineering data yet. Configure GITHUB_API_TOKEN and GITHUB_ORG
          in Doppler, then trigger a sync from Data Status.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EngineeringFilters
          data={humans}
          filters={filters}
          onFiltersChange={setFilters}
        />
        {isFiltered && (
          <span className="text-xs text-muted-foreground">
            Showing {filtered.length} of {humans.length} engineers
          </span>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card shadow-warm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground w-8">
                  #
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Engineer
                </th>
                <th className="hidden md:table-cell px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Role
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
                <th className="hidden md:table-cell px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Squad
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 4}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No engineers match the current filters.
                  </td>
                </tr>
              ) : (
                sorted.map((row, i) => (
                  <tr
                    key={row.login}
                    className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground font-medium tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/engineering/engineers/${row.login}`}
                        className="flex items-center gap-2.5 group"
                      >
                        {row.avatarUrl && (
                          <img
                            src={row.avatarUrl}
                            alt={row.employeeName ?? row.login}
                            className="h-6 w-6 rounded-full"
                          />
                        )}
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                              {row.employeeName ?? row.login}
                            </span>
                            {row.level && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                                {row.level}
                              </span>
                            )}
                            {row.tenureMonths != null && (
                              <span className="text-[10px] text-muted-foreground/60">
                                {formatTenure(row.tenureMonths)}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground group-hover:text-primary transition-colors">
                            @{row.login}
                          </span>
                        </div>
                      </Link>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-xs text-muted-foreground">
                      {row.jobTitle ?? "—"}
                    </td>
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-4 py-3 text-right tabular-nums font-medium",
                          col.key === "netLines" &&
                            row.netLines > 0 &&
                            "text-positive",
                          col.key === "netLines" &&
                            row.netLines < 0 &&
                            "text-negative",
                          col.key === "deletions" && "text-negative/70"
                        )}
                      >
                        {col.format(row[col.key])}
                      </td>
                    ))}
                    <td className="hidden md:table-cell px-4 py-3">
                      {row.squad ? (
                        <span className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {row.squad}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">
                          —
                        </span>
                      )}
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
