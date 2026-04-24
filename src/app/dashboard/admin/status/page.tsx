import Link from "next/link";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { SlackMembersSyncCard } from "@/components/dashboard/slack-members-sync-card";
import { getSlackSyncStatus } from "@/lib/data/slack-members-sync-status";
import { SyncRunLog } from "@/components/dashboard/sync-run-log";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { ModeReportSyncControls } from "@/components/dashboard/mode-report-sync-controls";
import { db } from "@/lib/db";
import {
  syncLog,
  syncPhases,
  modeReports,
  modeReportData,
  okrUpdates,
  financialPeriods,
  squads,
} from "@/lib/db/schema";
import { desc, count, inArray } from "drizzle-orm";
import { getEffectiveSyncState } from "@/lib/sync/config";
import { getSourceHealth, type SourceHealth } from "@/lib/sync/health";
import {
  getCodeReviewBackfillStatus,
  type CodeReviewBackfillStatus,
} from "@/lib/sync/code-review";
import {
  getSyncEnabledModeReportControls,
  getModeReportNamesByToken,
} from "@/lib/integrations/mode-config";
import {
  getSchemaCompatibilityMessage,
  isSchemaCompatibilityError,
} from "@/lib/db/errors";
import { LastSyncedAt } from "@/components/dashboard/last-synced-at";
import {
  Database,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

const CODE_REVIEW_RECENT_ACTIVITY_MS = 15 * 60 * 1000;

export default async function DataStatusPage() {
  await requireDashboardPermission("admin.status");

  const warnings: string[] = [];
  const addWarning = (warning: string) => {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  };

  let recentRuns: (typeof syncLog.$inferSelect)[] = [];
  let phases: (typeof syncPhases.$inferSelect)[] = [];
  let modeSyncReports: (typeof modeReports.$inferSelect)[] = [];
  let sourceHealths: SourceHealth[] = [];
  let codeReviewBackfill: CodeReviewBackfillStatus | null = null;
  const slackSyncStatus = await getSlackSyncStatus().catch(() => null);

  try {
    sourceHealths = await getSourceHealth();

    recentRuns = await db
      .select()
      .from(syncLog)
      .orderBy(desc(syncLog.startedAt))
      .limit(20);

    modeSyncReports = await db.select().from(modeReports);

    const runIds = recentRuns.map((r) => r.id);
    if (runIds.length > 0) {
      try {
        phases = await db
          .select()
          .from(syncPhases)
          .where(inArray(syncPhases.syncLogId, runIds))
          .orderBy(syncPhases.startedAt);
      } catch (error) {
        if (!isSchemaCompatibilityError(error)) {
          throw error;
        }
      }
    }
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }

    addWarning(getSchemaCompatibilityMessage(error));
  }

  try {
    codeReviewBackfill = await getCodeReviewBackfillStatus();
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }

    addWarning(getSchemaCompatibilityMessage(error));
  }

  // Group phases by run
  const phasesByRun = new Map<number, typeof phases>();
  for (const phase of phases) {
    const arr = phasesByRun.get(phase.syncLogId) ?? [];
    arr.push(phase);
    phasesByRun.set(phase.syncLogId, arr);
  }
  // Source report names from config so they're available before any sync seeds
  // the mode_reports table (fresh-DB environments).
  const modeReportNamesByToken = getModeReportNamesByToken();
  const describeModeScope = (scope: unknown): string | null => {
    if (!scope || typeof scope !== "object") {
      return null;
    }

    const reportToken = (scope as { reportToken?: unknown }).reportToken;
    if (typeof reportToken !== "string") {
      return null;
    }

    const reportName = modeReportNamesByToken.get(reportToken);
    return reportName
      ? `Mode report ${reportName} (${reportToken})`
      : `Mode report ${reportToken}`;
  };

  // Build enriched runs for the client component
  const enrichedRuns = recentRuns.map((run) => ({
    id: run.id,
    source: run.source,
    status: run.status,
    trigger: run.trigger,
    attempt: run.attempt,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
    leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
    recordsSynced: run.recordsSynced,
    skipReason: run.skipReason,
    errorMessage: run.errorMessage,
    scopeDescription: run.source === "mode" ? describeModeScope(run.scope) : null,
    phases: (phasesByRun.get(run.id) ?? []).map((p) => ({
      id: p.id,
      phase: p.phase,
      status: p.status,
      startedAt: p.startedAt.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
      detail: p.detail,
      itemsProcessed: p.itemsProcessed ?? 0,
      errorMessage: p.errorMessage,
    })),
  }));

  // Calculate average run durations per source (from last 5 successful runs)
  const avgDurations: Record<string, number> = {};
  for (const source of ["mode", "slack", "management-accounts"]) {
    const successfulRuns = recentRuns.filter(
      (r) =>
        r.source === source &&
        (r.status === "success" || r.status === "partial") &&
        r.completedAt
    ).slice(0, 5);
    if (successfulRuns.length > 0) {
      const totalMs = successfulRuns.reduce(
        (sum, r) => sum + (r.completedAt!.getTime() - r.startedAt.getTime()),
        0
      );
      avgDurations[source] = totalMs / successfulRuns.length;
    }
  }

  // Check if any sync is currently running (for auto-refresh)
  const now = new Date();
  const hasRunning = recentRuns.some((run) => {
    const effectiveState = getEffectiveSyncState(run, now);
    return effectiveState === "queued" || effectiveState === "running";
  });
  const hasRecentCodeReviewActivity =
    codeReviewBackfill !== null &&
    codeReviewBackfill.remainingCount > 0 &&
    codeReviewBackfill.latestAnalysedAt !== null &&
    now.getTime() - codeReviewBackfill.latestAnalysedAt.getTime() <
      CODE_REVIEW_RECENT_ACTIVITY_MS;
  const activeModeRun = recentRuns.find((run) => {
    if (run.source !== "mode") {
      return false;
    }

    const effectiveState = getEffectiveSyncState(run, now);
    return effectiveState === "queued" || effectiveState === "running";
  });
  const activeModeScopeDescription =
    activeModeRun != null
      ? describeModeScope(activeModeRun.scope) ?? "all Mode reports"
      : null;
  // Build controls from config so they appear even on a fresh DB with no
  // mode_reports rows. Any DB row explicitly marked inactive is still excluded.
  const inactiveTokens = new Set(
    modeSyncReports.filter((r) => !r.isActive).map((r) => r.reportToken)
  );
  const syncEnabledModeReports = getSyncEnabledModeReportControls(inactiveTokens);

  let tables = [
    { name: "mode_reports", label: "Mode Reports", count: 0, description: "Report definitions synced from Mode" },
    { name: "mode_report_data", label: "Mode Report Data", count: 0, description: "Query result rows from Mode reports" },
    { name: "okr_updates", label: "OKR Updates", count: 0, description: "Key results across 0 pillars, 0 squads" },
    { name: "squads", label: "Squads", count: 0, description: "Canonical squad registry" },
    { name: "financial_periods", label: "Financial Periods", count: 0, description: "Monthly management accounts" },
  ];

  try {
    const [
      [modeReportCount],
      [modeDataCount],
      [okrCount],
      [squadCount],
      [financialCount],
      okrPillars,
      okrSquads,
    ] = await Promise.all([
      db.select({ count: count() }).from(modeReports),
      db.select({ count: count() }).from(modeReportData),
      db.select({ count: count() }).from(okrUpdates),
      db.select({ count: count() }).from(squads),
      db.select({ count: count() }).from(financialPeriods),
      db.selectDistinct({ pillar: okrUpdates.pillar }).from(okrUpdates),
      db.selectDistinct({ squad: okrUpdates.squadName }).from(okrUpdates),
    ]);

    tables = [
      { name: "mode_reports", label: "Mode Reports", count: modeReportCount.count, description: "Report definitions synced from Mode" },
      { name: "mode_report_data", label: "Mode Report Data", count: modeDataCount.count, description: "Query result rows from Mode reports" },
      { name: "okr_updates", label: "OKR Updates", count: okrCount.count, description: `Key results across ${okrPillars.length} pillars, ${okrSquads.length} squads` },
      { name: "squads", label: "Squads", count: squadCount.count, description: "Canonical squad registry" },
      { name: "financial_periods", label: "Financial Periods", count: financialCount.count, description: "Monthly management accounts" },
    ];
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }

    addWarning(getSchemaCompatibilityMessage(error));
  }

  const envChecks = [
    { key: "DATABASE_URL", label: "Database", required: true },
    { key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", label: "Clerk (Public)", required: true },
    { key: "CLERK_SECRET_KEY", label: "Clerk (Secret)", required: true },
    { key: "MODE_API_TOKEN", label: "Mode API Token", required: false },
    { key: "MODE_API_SECRET", label: "Mode API Secret", required: false },
    { key: "MODE_WORKSPACE", label: "Mode Workspace", required: false },
    { key: "SLACK_BOT_TOKEN", label: "Slack Bot Token", required: false },
    { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", required: false },
    { key: "OPENAI_API_KEY", label: "OpenAI API Key", required: false },
    {
      key: "CODE_REVIEW_OPENAI_MODEL",
      label: "Code Review OpenAI Model",
      required: false,
    },
    {
      key: "CODE_REVIEW_ENABLE_OPENAI_SECOND_OPINION",
      label: "Code Review OpenAI Toggle",
      required: false,
    },
    {
      key: "CODE_REVIEW_OPENAI_REASONING_EFFORT",
      label: "Code Review OpenAI Reasoning",
      required: false,
    },
    {
      key: "CODE_REVIEW_ANALYSIS_CONCURRENCY",
      label: "Code Review Concurrency",
      required: false,
    },
    { key: "HIBOB_API_TOKEN", label: "HiBob API Token", required: false },
    { key: "CRON_SECRET", label: "Cron Secret", required: false },
  ];

  const envStatus = envChecks.map((e) => ({ ...e, present: !!process.env[e.key] }));

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      {(hasRunning || hasRecentCodeReviewActivity) && (
        <AutoRefresh intervalMs={5000} />
      )}

      <PageHeader
        title="Data Status"
        description="Sync pipelines, database tables, and environment configuration"
      />

      {warnings.length > 0 && (
        <SectionCard
          title="Schema Rollout Warning"
          description="The page is showing partial data while the database catches up."
        >
          <div className="space-y-2">
            {warnings.map((warning, index) => (
              <div
                key={`${warning}-${index}`}
                className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning"
              >
                {warning}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SourceHealthSection healths={sourceHealths} />

      <CodeReviewBackfillSection status={codeReviewBackfill} now={now} />

      {slackSyncStatus && <SlackMembersSyncCard status={slackSyncStatus} />}

      {/* Sync Run Log — the main feature */}
      <SyncRunLog runs={enrichedRuns} avgDurations={avgDurations} />

      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Mode Re-Sync
        </h3>
        <SectionCard
          title="Active Mode Reports"
          description="Trigger a targeted Mode re-sync for one active report"
        >
          <ModeReportSyncControls
            activeModeScopeDescription={activeModeScopeDescription}
            reports={syncEnabledModeReports}
          />
        </SectionCard>
      </div>

      {/* Database Tables */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Database Tables
        </h3>
        <SectionCard title="Record Counts" description="Current row counts across all tables">
          <div className="divide-y divide-border/30">
            {tables.map((table) => (
              <div key={table.name} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <div>
                  <span className="text-sm font-medium">{table.label}</span>
                  <p className="text-xs text-muted-foreground">{table.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-sm font-mono font-medium tabular-nums">{formatInteger(table.count)}</span>
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
        <SectionCard title="Configuration" description="Required and optional environment variables">
          <div className="grid grid-cols-2 gap-2">
            {envStatus.map((env) => (
              <div key={env.key} className="flex items-center gap-2 rounded-lg border border-border/30 px-3 py-2">
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

function formatPercent(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remSeconds}s`;
}

function successRateTone(rate: number | null): string {
  if (rate == null) return "text-muted-foreground";
  if (rate >= 0.95) return "text-positive";
  if (rate >= 0.8) return "text-warning";
  return "text-destructive";
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-GB");
}

function CodeReviewBackfillSection({
  status,
  now,
}: {
  status: CodeReviewBackfillStatus | null;
  now: Date;
}) {
  if (!status) {
    return null;
  }

  const skippedTotal =
    status.skippedBotCount + status.skippedExcludedCount;
  const statusTone =
    status.remainingCount === 0
      ? "border-positive/25 bg-positive/10 text-positive"
      : status.latestAnalysedAt !== null &&
          now.getTime() - status.latestAnalysedAt.getTime() <
            CODE_REVIEW_RECENT_ACTIVITY_MS
        ? "border-warning/25 bg-warning/10 text-warning"
        : "border-border/60 bg-muted/30 text-muted-foreground";
  const statusLabel =
    status.remainingCount === 0
      ? "Current"
      : status.latestAnalysedAt !== null &&
          now.getTime() - status.latestAnalysedAt.getTime() <
            CODE_REVIEW_RECENT_ACTIVITY_MS
        ? "Backfill running"
        : "Backlog pending";

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Code Review
      </h3>
      <SectionCard
        title="Backfill Coverage"
        description={`Current-rubric coverage of merged PRs in the last ${status.windowDays} days`}
        action={
          <Link
            href="/dashboard/engineering/code-review"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Open report
          </Link>
        }
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                  {status.progressPct.toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatInteger(status.analysedCount)} of{" "}
                  {formatInteger(status.eligibleTotal)} eligible PRs analysed
                </div>
              </div>
              <div
                className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone}`}
              >
                {statusLabel}
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/60">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, status.progressPct))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatInteger(status.remainingCount)} remaining</span>
              <span>{formatInteger(skippedTotal)} skipped</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              label="Analysed"
              value={formatInteger(status.analysedCount)}
              detail="Current rubric"
            />
            <MetricTile
              label="Remaining"
              value={formatInteger(status.remainingCount)}
              detail="Still missing"
            />
            <MetricTile
              label="Eligible"
              value={formatInteger(status.eligibleTotal)}
              detail="Human-authored PRs"
            />
            <MetricTile
              label="Skipped"
              value={formatInteger(skippedTotal)}
              detail={`${formatInteger(status.skippedBotCount)} bots, ${formatInteger(status.skippedExcludedCount)} excluded`}
            />
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border/30 px-3 py-2">
              <LastSyncedAt at={status.latestAnalysedAt} now={now} prefix="Last analysis" />
            </div>
            <div className="rounded-lg border border-border/30 px-3 py-2">
              <LastSyncedAt
                at={status.oldestRemainingMergedAt}
                now={now}
                prefix="Oldest missing merged"
              />
            </div>
            <div className="rounded-lg border border-border/30 px-3 py-2">
              <LastSyncedAt
                at={status.newestRemainingMergedAt}
                now={now}
                prefix="Newest missing merged"
              />
            </div>
            <div className="rounded-lg border border-border/30 px-3 py-2">
              <span className="font-medium text-foreground">Rubric</span>{" "}
              <span className="font-mono">{status.rubricVersion}</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            This is a rolling window, so the totals can move while new PRs land
            and older PRs age out of scope.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-3">
      <div className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function SourceHealthSection({ healths }: { healths: SourceHealth[] }) {
  if (healths.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Source Health
      </h3>
      <SectionCard
        title="Per-source sync health"
        description="Last success and failure are all-time; success rate and p95 duration are rolling 7-day"
      >
        <div className="divide-y divide-border/30">
          {healths.map((health) => (
            <div
              key={health.source}
              className="grid grid-cols-1 gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-5 sm:items-center"
            >
              <div className="text-sm font-medium">{health.source}</div>
              <div className="text-xs text-muted-foreground">
                <LastSyncedAt
                  at={health.lastSuccessAt}
                  prefix="Last success"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                <LastSyncedAt
                  at={health.lastFailureAt}
                  prefix="Last failure"
                />
              </div>
              <div
                className={`text-xs font-mono tabular-nums ${successRateTone(health.successRate7d)}`}
                title={`${health.successRuns7d}/${health.totalRuns7d} runs succeeded in the last 7 days`}
              >
                {formatPercent(health.successRate7d)}
                <span className="ml-1 text-[0.65rem] text-muted-foreground">
                  ({health.successRuns7d}/{health.totalRuns7d})
                </span>
              </div>
              <div className="text-xs font-mono tabular-nums text-muted-foreground">
                p95 {formatDurationMs(health.p95DurationMs)}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
