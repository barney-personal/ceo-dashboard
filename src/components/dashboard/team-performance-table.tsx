"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from "lucide-react";
import type {
  TeamMemberRow,
  TrendDirection,
} from "@/lib/data/team-performance";
import { cn } from "@/lib/utils";

function fmtPercentile(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}

function TrendIcon({
  direction,
  className,
}: {
  direction: TrendDirection | null;
  className?: string;
}) {
  if (direction === "up") return <ArrowUp className={cn("h-3 w-3 text-emerald-600", className)} />;
  if (direction === "down") return <ArrowDown className={cn("h-3 w-3 text-rose-600", className)} />;
  if (direction === "flat") return <Minus className={cn("h-3 w-3 text-muted-foreground/60", className)} />;
  return null;
}

function PercentileBar({ value, tone = "primary" }: { value: number | null; tone?: "primary" | "warning" }) {
  if (value === null) return <span className="text-xs text-muted-foreground/40">—</span>;
  const pct = Math.round(value * 100);
  const isBottom = value <= 0.25;
  const fill = isBottom
    ? "bg-rose-500/60"
    : value >= 0.7
      ? "bg-emerald-500/70"
      : tone === "warning"
        ? "bg-amber-500/70"
        : "bg-primary/60";
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={cn("w-9 text-right tabular-nums text-xs", isBottom && "font-medium text-rose-700")}>
        {pct}%
      </span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function TeamPerformanceTable({ rows }: { rows: TeamMemberRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: "44px" }} />
            <col style={{ width: "240px" }} />
            <col style={{ width: "130px" }} />
            <col style={{ width: "160px" }} />
            <col style={{ width: "160px" }} />
            <col style={{ width: "180px" }} />
            <col style={{ width: "160px" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"></th>
              <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Member
              </th>
              <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Function
              </th>
              <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Slack engagement
              </th>
              <th
                className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                title="Latest performance rating, with trend direction vs the prior review cycle"
              >
                Perf rating
              </th>
              <th
                className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                title="Engineering impact score (PRs × log₂(1 + lines/PR)) over the window. Trend compares last 90 days to the prior 90 days."
              >
                Impact (trend)
              </th>
              <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Alerts
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No direct reports.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const slug = r.email.split("@")[0] ?? r.email;
                const hasAlerts = r.alerts.length > 0;
                return (
                  <tr
                    key={r.email}
                    className={cn(
                      "group border-b border-border/30 transition-colors last:border-0 hover:bg-muted/20",
                      hasAlerts && "bg-rose-500/5",
                    )}
                  >
                    <td className="px-3 py-3">
                      {hasAlerts ? (
                        <AlertTriangle className="h-4 w-4 text-rose-500" aria-label={`${r.alerts.length} alert${r.alerts.length === 1 ? "" : "s"}`} />
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/dashboard/people/${slug}`} className="block min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-foreground transition-colors group-hover:text-primary">
                            {r.name}
                          </span>
                          {r.level && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                              {r.level}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {r.jobTitle ?? (r.squad ?? "—")}
                        </p>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {r.function ?? "—"}
                    </td>
                    {/* Engagement */}
                    <td className="px-3 py-3 text-right">
                      {r.slackEngagement !== null ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="tabular-nums font-medium text-foreground">
                            {r.slackEngagement}/100
                          </span>
                          <PercentileBar value={r.slackFunctionPercentile} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    {/* Perf rating */}
                    <td className="px-3 py-3 text-right">
                      {r.latestRating !== null ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <TrendIcon direction={r.ratingTrend} />
                            <span className="tabular-nums font-medium text-foreground">
                              {r.latestRating}
                            </span>
                            {r.priorRating !== null && r.priorRating !== r.latestRating && (
                              <span className="text-[10px] text-muted-foreground/60">
                                (was {r.priorRating})
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            vs {r.function}: {fmtPercentile(r.ratingFunctionPercentile)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">no rating</span>
                      )}
                    </td>
                    {/* Impact */}
                    <td className="px-3 py-3 text-right">
                      {r.impactTotal !== null ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <TrendIcon direction={r.impactTrendDirection} />
                            <span className="tabular-nums font-medium text-foreground">
                              {r.impactTotal.toLocaleString()}
                            </span>
                            {r.impactTrend !== null && (
                              <span
                                className={cn(
                                  "text-[10px] tabular-nums",
                                  r.impactTrendDirection === "down" && "text-rose-600",
                                  r.impactTrendDirection === "up" && "text-emerald-600",
                                  r.impactTrendDirection === "flat" && "text-muted-foreground/60",
                                )}
                              >
                                {r.impactTrend >= 0 ? "+" : ""}
                                {Math.round(r.impactTrend * 100)}%
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            company pct: {fmtPercentile(r.impactCompanyPercentile)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">
                          {r.isEngineer ? "—" : "not eng"}
                        </span>
                      )}
                    </td>
                    {/* Alerts */}
                    <td className="px-3 py-3">
                      {hasAlerts ? (
                        <div className="flex flex-col gap-0.5">
                          {r.alerts.map((a, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
                            >
                              {a.message}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40">—</span>
                      )}
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
