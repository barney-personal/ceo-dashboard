"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

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
}

type SortKey = "outputScore" | "prsCount" | "commitsCount" | "additions" | "deletions" | "netLines" | "changedFiles";

const COLUMNS: { key: SortKey; label: string; format: (v: number) => string }[] = [
  { key: "outputScore", label: "Impact", format: (v) => v.toLocaleString() },
  { key: "prsCount", label: "PRs Merged", format: (v) => v.toLocaleString() },
  { key: "commitsCount", label: "Commits", format: (v) => v.toLocaleString() },
  { key: "additions", label: "Lines Added", format: (v) => v.toLocaleString() },
  { key: "deletions", label: "Lines Deleted", format: (v) => v.toLocaleString() },
  { key: "netLines", label: "Net Lines", format: (v) => (v >= 0 ? `+${v.toLocaleString()}` : v.toLocaleString()) },
  { key: "changedFiles", label: "Files Changed", format: (v) => v.toLocaleString() },
];

export function EngineeringTable({
  data,
  hideBots = true,
}: {
  data: EngineerRow[];
  hideBots?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("outputScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = (hideBots ? data.filter((r) => !r.isBot) : data).map(
    (r) => ({
      ...r,
      outputScore: r.prsCount > 0
        ? Math.round(r.prsCount * Math.log2(1 + (r.additions + r.deletions) / r.prsCount))
        : 0,
    })
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = [...filtered].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    return sortDir === "desc" ? -diff : diff;
  });

  if (filtered.length === 0) {
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
              {COLUMNS.map((col) => {
                const isActive = sortKey === col.key;
                const SortIcon = isActive
                  ? sortDir === "desc" ? ArrowDown : ArrowUp
                  : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {col.label}
                      <SortIcon className={cn("h-3 w-3", isActive && "text-primary")} />
                    </div>
                  </th>
                );
              })}
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Repos
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.login}
                className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors"
              >
                <td className="px-4 py-3 text-muted-foreground font-medium tabular-nums">
                  {i + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    {row.avatarUrl && (
                      <img
                        src={row.avatarUrl}
                        alt={row.employeeName ?? row.login}
                        className="h-6 w-6 rounded-full"
                      />
                    )}
                    <div className="flex flex-col">
                      {row.employeeName ? (
                        <>
                          <span className="font-medium text-foreground">
                            {row.employeeName}
                          </span>
                          <a
                            href={`https://github.com/${row.login}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                          >
                            @{row.login}
                          </a>
                        </>
                      ) : (
                        <a
                          href={`https://github.com/${row.login}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {row.login}
                        </a>
                      )}
                    </div>
                  </div>
                </td>
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-right tabular-nums font-medium",
                      col.key === "netLines" && row.netLines > 0 && "text-positive",
                      col.key === "netLines" && row.netLines < 0 && "text-negative",
                      col.key === "deletions" && "text-negative/70"
                    )}
                  >
                    {col.format(row[col.key])}
                  </td>
                ))}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {row.repos.slice(0, 3).map((repo) => (
                      <span
                        key={repo}
                        className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {repo}
                      </span>
                    ))}
                    {row.repos.length > 3 && (
                      <span className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        +{row.repos.length - 3}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
