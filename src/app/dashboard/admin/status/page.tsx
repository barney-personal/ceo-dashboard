import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { db } from "@/lib/db";
import {
  syncLog,
  modeReports,
  modeReportData,
  okrUpdates,
  financialPeriods,
  squads,
} from "@/lib/db/schema";
import { desc, count } from "drizzle-orm";
import {
  RefreshCw,
  Database,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";

interface SyncEntry {
  id: number;
  source: string;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  recordsSynced: number;
  errorMessage: string | null;
}

function formatAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-positive" />;
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "running":
      return <RefreshCw className="h-4 w-4 animate-spin text-warning" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

const PIPELINE_META: Record<
  string,
  { label: string; interval: string; description: string }
> = {
  mode: {
    label: "Mode Analytics",
    interval: "Every 4 hours",
    description: "Unit economics, product metrics, and chart data from Mode reports",
  },
  slack: {
    label: "Slack OKRs",
    interval: "Every 2 hours",
    description: "OKR updates parsed from pillar Slack channels via Claude",
  },
  "management-accounts": {
    label: "Management Accounts",
    interval: "Daily",
    description: "Financial data extracted from Excel files in #fyi-management_accounts",
  },
};

export default async function DataStatusPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  // Fetch last 5 sync runs per source
  const recentSyncs = await db
    .select()
    .from(syncLog)
    .orderBy(desc(syncLog.startedAt))
    .limit(50);

  // Group by source
  const syncsBySource: Record<string, SyncEntry[]> = {};
  for (const entry of recentSyncs) {
    if (!syncsBySource[entry.source]) {
      syncsBySource[entry.source] = [];
    }
    if (syncsBySource[entry.source].length < 5) {
      syncsBySource[entry.source].push(entry);
    }
  }

  // Table record counts
  const [modeReportCount] = await db
    .select({ count: count() })
    .from(modeReports);
  const [modeDataCount] = await db
    .select({ count: count() })
    .from(modeReportData);
  const [okrCount] = await db.select({ count: count() }).from(okrUpdates);
  const [squadCount] = await db.select({ count: count() }).from(squads);
  const [financialCount] = await db
    .select({ count: count() })
    .from(financialPeriods);

  // Distinct pillars and squads from OKRs
  const okrPillars = await db
    .selectDistinct({ pillar: okrUpdates.pillar })
    .from(okrUpdates);
  const okrSquads = await db
    .selectDistinct({ squad: okrUpdates.squadName })
    .from(okrUpdates);

  const tables = [
    {
      name: "mode_reports",
      label: "Mode Reports",
      count: modeReportCount.count,
      description: "Report definitions synced from Mode",
    },
    {
      name: "mode_report_data",
      label: "Mode Report Data",
      count: modeDataCount.count,
      description: "Query result rows from Mode reports",
    },
    {
      name: "okr_updates",
      label: "OKR Updates",
      count: okrCount.count,
      description: `Key results across ${okrPillars.length} pillars, ${okrSquads.length} squads`,
    },
    {
      name: "squads",
      label: "Squads",
      count: squadCount.count,
      description: "Canonical squad registry",
    },
    {
      name: "financial_periods",
      label: "Financial Periods",
      count: financialCount.count,
      description: "Monthly management accounts",
    },
  ];

  // Check for env vars
  const envChecks = [
    { key: "DATABASE_URL", label: "Database", required: true },
    {
      key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      label: "Clerk (Public)",
      required: true,
    },
    { key: "CLERK_SECRET_KEY", label: "Clerk (Secret)", required: true },
    { key: "MODE_API_TOKEN", label: "Mode API Token", required: false },
    { key: "MODE_API_SECRET", label: "Mode API Secret", required: false },
    { key: "MODE_WORKSPACE", label: "Mode Workspace", required: false },
    { key: "SLACK_BOT_TOKEN", label: "Slack Bot Token", required: false },
    { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", required: false },
    { key: "HIBOB_API_TOKEN", label: "HiBob API Token", required: false },
    { key: "CRON_SECRET", label: "Cron Secret", required: false },
  ];

  const envStatus = envChecks.map((e) => ({
    ...e,
    present: !!process.env[e.key],
  }));

  const pipelines = Object.entries(PIPELINE_META);

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Data Status"
        description="Sync pipelines, database tables, and environment configuration"
      />

      {/* Sync Pipelines */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Sync Pipelines
        </h3>
        <div className="grid gap-4">
          {pipelines.map(([source, meta]) => {
            const runs = syncsBySource[source] ?? [];
            const latest = runs[0];
            const successRate =
              runs.length > 0
                ? Math.round(
                    (runs.filter((r) => r.status === "success").length /
                      runs.length) *
                      100
                  )
                : null;

            return (
              <SectionCard
                key={source}
                title={meta.label}
                description={meta.description}
                action={
                  <span className="text-xs text-muted-foreground">
                    {meta.interval}
                  </span>
                }
              >
                {latest ? (
                  <div className="space-y-3">
                    {/* Current status summary */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusIcon status={latest.status} />
                        <span className="text-sm font-medium capitalize">
                          {latest.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatAgo(latest.startedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {latest.completedAt && (
                          <span>
                            Duration:{" "}
                            {formatDuration(
                              latest.startedAt,
                              latest.completedAt
                            )}
                          </span>
                        )}
                        <span>
                          {latest.recordsSynced} records
                        </span>
                        {successRate !== null && (
                          <span
                            className={
                              successRate === 100
                                ? "text-positive"
                                : successRate >= 80
                                  ? "text-warning"
                                  : "text-destructive"
                            }
                          >
                            {successRate}% success (last {runs.length})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Error message if present */}
                    {latest.errorMessage && (
                      <div className="rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        {latest.errorMessage}
                      </div>
                    )}

                    {/* Recent run history */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground/60 mr-1">
                        History:
                      </span>
                      {runs.map((run) => (
                        <div
                          key={run.id}
                          className={`h-2 w-2 rounded-full ${
                            run.status === "success"
                              ? "bg-positive"
                              : run.status === "error"
                                ? "bg-destructive"
                                : "bg-warning"
                          }`}
                          title={`${run.status} — ${run.startedAt.toISOString()} — ${run.recordsSynced} records`}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    Never synced
                  </div>
                )}
              </SectionCard>
            );
          })}
        </div>
      </div>

      {/* Database Tables */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Database Tables
        </h3>
        <SectionCard title="Record Counts" description="Current row counts across all tables">
          <div className="divide-y divide-border/30">
            {tables.map((table) => (
              <div
                key={table.name}
                className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
              >
                <div>
                  <span className="text-sm font-medium">{table.label}</span>
                  <p className="text-xs text-muted-foreground">
                    {table.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-sm font-mono font-medium tabular-nums">
                    {table.count.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Environment */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Environment
        </h3>
        <SectionCard
          title="Configuration"
          description="Required and optional environment variables"
        >
          <div className="grid grid-cols-2 gap-2">
            {envStatus.map((env) => (
              <div
                key={env.key}
                className="flex items-center gap-2 rounded-lg border border-border/30 px-3 py-2"
              >
                {env.present ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
                ) : env.required ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                )}
                <span className="text-xs font-medium">{env.label}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
