"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PageViewRow {
  id: number;
  userName: string;
  section: string;
  path: string;
  viewedAt: string;
}

interface RecentPageViewsTableProps {
  rows: PageViewRow[];
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function RecentPageViewsTable({
  rows,
  currentPage,
  pageSize,
  totalPages,
  totalCount,
}: RecentPageViewsTableProps) {
  const start = (currentPage - 1) * pageSize + 1;
  const end = start + rows.length - 1;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_1fr_1.5fr_140px] items-center gap-4 border-b border-border/50 bg-muted/30 px-5 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          User
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Section
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Path
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Time
        </span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/30">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_1fr_1.5fr_140px] items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/20"
          >
            <span className="truncate text-sm font-medium text-foreground">
              {row.userName}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {row.section}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.path}
            </span>
            <span className="text-sm text-muted-foreground">
              {formatRelativeTime(row.viewedAt)}
            </span>
          </div>
        ))}
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-border/50 bg-muted/30 px-5 py-3">
        <span className="text-xs text-muted-foreground">
          Showing {start}–{end} of {totalCount.toLocaleString()}
        </span>

        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/admin/analytics?page=${currentPage - 1}`}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-sm transition-colors hover:bg-muted/50",
              currentPage <= 1 && "pointer-events-none opacity-40"
            )}
            aria-disabled={currentPage <= 1}
            tabIndex={currentPage <= 1 ? -1 : undefined}
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>

          <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
            {currentPage} / {totalPages}
          </span>

          <Link
            href={`/dashboard/admin/analytics?page=${currentPage + 1}`}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-sm transition-colors hover:bg-muted/50",
              currentPage >= totalPages && "pointer-events-none opacity-40"
            )}
            aria-disabled={currentPage >= totalPages}
            tabIndex={currentPage >= totalPages ? -1 : undefined}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
