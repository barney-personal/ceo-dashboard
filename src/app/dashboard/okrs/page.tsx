import { PageHeader } from "@/components/dashboard/page-header";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { OkrView } from "@/components/dashboard/okr-view";
import { DataStateCard } from "@/components/dashboard/data-state-card";
import {
  getLatestOkrUpdates,
  getOkrStatusCounts,
  getSlackMessageUrl,
} from "@/lib/data/okrs";
import { getLatestTerminalSyncRun } from "@/lib/data/mode";
import { resolveDataState, safeLoad } from "@/lib/data/data-state";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default async function OKRsPage() {
  const [okrsByPillarResult, countsResult, latestSyncRunResult] =
    await Promise.all([
      safeLoad(
        () => getLatestOkrUpdates(),
        new Map() as Awaited<ReturnType<typeof getLatestOkrUpdates>>,
      ),
      safeLoad(() => getOkrStatusCounts(), {
        onTrack: 0,
        atRisk: 0,
        behind: 0,
        total: 0,
      }),
      safeLoad(() => getLatestTerminalSyncRun("slack"), null),
    ]);

  const firstUnavailable =
    okrsByPillarResult.error ?? countsResult.error ?? latestSyncRunResult.error;

  const okrsByPillar = okrsByPillarResult.data;
  const counts = countsResult.data;
  const latestSyncRun = latestSyncRunResult.data;

  const okrCharts = getChartEmbeds("okrs", "company");
  const hasData = counts.total > 0;

  const pageState = resolveDataState({
    source: "slack",
    hasData,
    latestSyncRun,
    error: firstUnavailable,
  });

  if (pageState.kind === "unavailable") {
    return (
      <div className="mx-auto min-w-0 max-w-7xl space-y-6 2xl:max-w-[96rem]">
        <PageHeader
          title="OKRs"
          description="Company objectives and key results"
        />
        <DataStateCard
          variant="unavailable"
          title="OKR updates from Slack"
          lastSyncedAt={pageState.lastSyncedAt}
        />
      </div>
    );
  }

  // Serialize for client component
  const pillars = [...okrsByPillar.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, okrs]) => ({
      name,
      okrs: okrs.map((okr) => ({
        pillar: okr.pillar,
        squadName: okr.squadName,
        objectiveName: okr.objectiveName,
        krName: okr.krName,
        status: okr.status,
        actual: okr.actual,
        target: okr.target,
        userName: okr.userName,
        slackUrl: getSlackMessageUrl(okr.channelId, okr.slackTs),
      })),
    }));

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="OKRs"
        description="Company objectives and key results"
      />

      {pageState.kind === "stale" ? (
        <DataStateCard
          variant="stale"
          title="OKR updates from Slack"
          lastSyncedAt={pageState.lastSyncedAt}
        />
      ) : null}

      {hasData ? (
        <OkrView pillars={pillars} counts={counts} />
      ) : (
        <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No OKR updates synced yet. Trigger a sync to pull updates from Slack.
          </p>
        </div>
      )}

      {/* Mode OKR dashboard links */}
      {okrCharts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Mode Reports
          </h3>
          {okrCharts.map((chart) => (
            <ModeEmbed
              key={chart.url}
              url={chart.url}
              title={chart.title}
              subtitle="View in Mode"
            />
          ))}
        </div>
      )}
    </div>
  );
}
