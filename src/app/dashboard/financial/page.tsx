import Link from "next/link";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { SpreadsheetTable } from "@/components/dashboard/spreadsheet-table";
import { DataStateCard } from "@/components/dashboard/data-state-card";
import {
  DataStateBanner,
  UnavailablePage,
} from "@/components/dashboard/page-data-boundary";
import { getManagementAccountsData } from "@/lib/data/management-accounts";
import { getLatestTerminalSyncRun } from "@/lib/data/mode";
import { resolveDataState, safeLoad } from "@/lib/data/data-state";
import { DatabaseUnavailableError } from "@/lib/db/errors";
import { getChartEmbeds } from "@/lib/integrations/mode-config";
import { cn } from "@/lib/utils";
import { ExternalLink, FileSpreadsheet } from "lucide-react";

export default async function FinancialPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireDashboardPermission("dashboard.financial");

  const { period } = await searchParams;
  const seasonalityCharts = getChartEmbeds("financial", "seasonality");

  const latestSyncRunResult = await safeLoad(
    () => getLatestTerminalSyncRun("management-accounts"),
    null,
  );

  let data: Awaited<ReturnType<typeof getManagementAccountsData>> = null;
  let dbError: DatabaseUnavailableError | null = null;
  try {
    data = await getManagementAccountsData(period);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      dbError = error;
    } else {
      // Slack/download/parse failures are not empty-state — let the route
      // error boundary surface them instead of masking as "no files yet".
      throw error;
    }
  }

  const pageState = resolveDataState({
    source: "management-accounts",
    hasData: data !== null,
    latestSyncRun: latestSyncRunResult.data,
    error: latestSyncRunResult.error ?? dbError,
  });

  if (pageState.kind === "unavailable") {
    return (
      <UnavailablePage
        title="Financial"
        description="Management accounts and financial reporting"
        dataTitle="Management accounts from Slack"
        lastSyncedAt={pageState.lastSyncedAt}
      />
    );
  }

  if (data === null) {
    return (
      <div className="mx-auto min-w-0 max-w-7xl space-y-6 2xl:max-w-[96rem]">
        <PageHeader
          title="Financial"
          description="Management accounts and financial reporting"
        />
        <DataStateCard
          variant="empty"
          title="Management accounts from Slack"
          lastSyncedAt={pageState.lastSyncedAt}
          description="No management accounts have been synced yet. Trigger a sync or drop a new xlsx into #fyi-management_accounts."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Financial"
        description="Management accounts and financial reporting"
      />

      <DataStateBanner
        pageState={pageState}
        title="Management accounts from Slack"
      />

      {/* Period selector */}
      <div className="space-y-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
          Period
        </h3>
        <div className="flex flex-wrap gap-2">
          {data.files.map((file) => (
            <Link
              key={file.id}
              href={`/dashboard/financial${file.period ? `?period=${file.period}` : ""}`}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                file.id === data.currentFile.id
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : "border-border/50 bg-card text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {file.periodLabel}
            </Link>
          ))}
        </div>
      </div>

      {/* Source links */}
      <div className="flex flex-wrap gap-3">
        <a
          href={data.currentFile.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-warm transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 transition-colors group-hover:bg-emerald-500/15">
            <FileSpreadsheet className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {data.currentFile.periodLabel}
            </p>
            <p className="text-[11px] text-muted-foreground">Open in Slack</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary" />
        </a>

        {seasonalityCharts.map((chart) => (
          <ModeEmbed
            key={chart.url}
            url={chart.url}
            title={chart.title}
            subtitle="View in Mode"
            className="flex-1"
          />
        ))}
      </div>

      {/* P&L Embed */}
      <SectionCard
        title={`Management Accounts — ${data.currentFile.periodLabel}`}
        description={data.currentFile.name}
        action={
          <a
            href={data.currentFile.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-primary"
          >
            Open original
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        }
      >
        <SpreadsheetTable
          sheets={data.sheetData.sheets}
          sheetNames={data.sheetData.sheetNames}
          defaultSheet="P&L Summary"
        />
      </SectionCard>
    </div>
  );
}
