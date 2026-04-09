"use client";

import { useState, useMemo } from "react";
import { SectionCard } from "@/components/dashboard/section-card";
import {
  Database,
  Table2,
  ChevronRight,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Rows3,
  Clock,
  AlertTriangle,
} from "lucide-react";
import type { QuerySummary, ReportSummary } from "./types";

interface QueryData {
  queryName: string;
  columns: Array<{ name: string; type: string }>;
  data: Record<string, unknown>[];
  rowCount: number;
  sourceRowCount: number;
  storedRowCount: number;
  truncated: boolean;
  storageWindow: unknown;
  syncedAt: string;
}

type SortDirection = "asc" | "desc";

const SECTION_LABELS: Record<string, string> = {
  "unit-economics": "Unit Economics",
  financial: "Financial",
  product: "Product",
  okrs: "OKRs",
  people: "People",
};

const PAGE_SIZE = 50;

export function ModeExplorer({
  reports,
  queries,
}: {
  reports: ReportSummary[];
  queries: QuerySummary[];
}) {
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(null);
  const [queryData, setQueryData] = useState<QueryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(0);

  // Group queries by report
  const queriesByReport = useMemo(() => {
    const map = new Map<number, QuerySummary[]>();
    for (const q of queries) {
      const arr = map.get(q.reportId) ?? [];
      arr.push(q);
      map.set(q.reportId, arr);
    }
    return map;
  }, [queries]);

  // Group reports by section
  const reportsBySection = useMemo(() => {
    const map = new Map<string, ReportSummary[]>();
    for (const r of reports) {
      const arr = map.get(r.section) ?? [];
      arr.push(r);
      map.set(r.section, arr);
    }
    return map;
  }, [reports]);

  const loadQueryData = async (queryId: number) => {
    const query = queries.find((q) => q.id === queryId);
    if (!query) return;

    setSelectedQueryId(queryId);
    setLoading(true);
    setError(null);
    setSearchTerm("");
    setSortColumn(null);
    setPage(0);

    try {
      const res = await fetch(
        `/api/admin/mode-explorer?queryId=${queryId}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load data (${res.status})`);
      }
      const data: QueryData = await res.json();
      setQueryData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      setQueryData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setPage(0);
  };

  // Filter and sort data rows
  const processedRows = useMemo(() => {
    if (!queryData?.data) return [];

    let rows = queryData.data;

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter((row) =>
        Object.values(row).some((val) =>
          String(val ?? "")
            .toLowerCase()
            .includes(term)
        )
      );
    }

    // Sort
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        const aNum = Number(aVal);
        const bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
        }

        const cmp = String(aVal).localeCompare(String(bVal));
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [queryData, searchTerm, sortColumn, sortDirection]);

  const totalPages = Math.ceil(processedRows.length / PAGE_SIZE);
  const pageRows = processedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const selectedQuery = queries.find((q) => q.id === selectedQueryId);
  const selectedReport = selectedQuery
    ? reports.find((r) => r.id === selectedQuery.reportId)
    : null;

  return (
    <div className="space-y-6">
      {/* Report & Query Selector */}
      <SectionCard
        title="Reports & Queries"
        description={`${reports.length} reports, ${queries.length} synced queries`}
      >
        <div className="space-y-4">
          {Array.from(reportsBySection.entries()).map(
            ([section, sectionReports]) => (
              <div key={section}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {SECTION_LABELS[section] ?? section}
                </h4>
                <div className="space-y-1">
                  {sectionReports.map((report) => {
                    const reportQueries = queriesByReport.get(report.id) ?? [];
                    if (reportQueries.length === 0) return null;

                    return (
                      <div key={report.id}>
                        <div className="flex items-center gap-2 px-2 py-1">
                          <Database className="h-3.5 w-3.5 text-muted-foreground/50" />
                          <span className="text-sm font-medium">
                            {report.name}
                          </span>
                          {report.category && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {report.category}
                            </span>
                          )}
                        </div>
                        <div className="ml-6 space-y-0.5">
                          {reportQueries.map((query) => (
                            <button
                              key={query.id}
                              onClick={() => loadQueryData(query.id)}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                                selectedQueryId === query.id
                                  ? "bg-primary/8 text-primary"
                                  : "text-foreground hover:bg-muted/50"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Table2 className="h-3.5 w-3.5 shrink-0" />
                                <span>{query.queryName}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Rows3 className="h-3 w-3" />
                                  {query.storedRowCount.toLocaleString()} rows
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatRelativeTime(query.syncedAt)}
                                </span>
                                {query.truncated && (
                                  <span className="flex items-center gap-1 text-warning">
                                    <AlertTriangle className="h-3 w-3" />
                                    truncated
                                  </span>
                                )}
                                <ChevronRight className="h-3.5 w-3.5" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
      </SectionCard>

      {/* Data Table */}
      {loading && (
        <SectionCard title="Loading..." description="Fetching query data">
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </SectionCard>
      )}

      {error && (
        <SectionCard title="Error" description="Failed to load query data">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        </SectionCard>
      )}

      {queryData && !loading && selectedQuery && selectedReport && (
        <SectionCard
          title={selectedQuery.queryName}
          description={`${selectedReport.name} — ${processedRows.length.toLocaleString()} rows${queryData.truncated ? " (truncated from " + queryData.sourceRowCount.toLocaleString() + ")" : ""}`}
          action={
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Synced {formatRelativeTime(queryData.syncedAt)}
            </div>
          }
        >
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search across all columns..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(0);
                }}
                className="w-full rounded-lg border border-border/60 bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>

            {/* Column info bar */}
            <div className="flex flex-wrap gap-1.5">
              {queryData.columns.map((col) => (
                <span
                  key={col.name}
                  className="rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-mono text-muted-foreground"
                >
                  {col.name}{" "}
                  <span className="text-muted-foreground/50">{col.type}</span>
                </span>
              ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30">
                    {queryData.columns.map((col) => (
                      <th
                        key={col.name}
                        className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
                        onClick={() => handleSort(col.name)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.name}
                          {sortColumn === col.name ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={queryData.columns.length}
                        className="px-3 py-8 text-center text-muted-foreground"
                      >
                        {searchTerm ? "No matching rows" : "No data"}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row, i) => (
                      <tr
                        key={page * PAGE_SIZE + i}
                        className="border-b border-border/20 last:border-0 hover:bg-muted/20"
                      >
                        {queryData.columns.map((col) => (
                          <td
                            key={col.name}
                            className="max-w-[300px] truncate whitespace-nowrap px-3 py-1.5 font-mono text-xs"
                            title={String(row[col.name] ?? "")}
                          >
                            {formatCellValue(row[col.name])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {page * PAGE_SIZE + 1}–
                  {Math.min((page + 1) * PAGE_SIZE, processedRows.length)} of{" "}
                  {processedRows.length.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="rounded px-2 py-1 hover:bg-muted disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <span className="px-2">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                    disabled={page >= totalPages - 1}
                    className="rounded px-2 py-1 hover:bg-muted disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
