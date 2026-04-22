import { PageHeader } from "@/components/dashboard/page-header";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { OkrView } from "@/components/dashboard/okr-view";
import {
  DataStateBanner,
  UnavailablePage,
} from "@/components/dashboard/page-data-boundary";
import {
  getLatestOkrUpdates,
  getOkrStatusCounts,
  getSlackMessageUrl,
} from "@/lib/data/okrs";
import { getLatestTerminalSyncRun } from "@/lib/data/mode";
import { getModeOkrs } from "@/lib/data/okr-mode";
import {
  hasCurrentValue,
  needsAttention,
  progressTowardTarget,
} from "@/lib/data/okr-mode-shared";
import { resolveDataState, safeLoad } from "@/lib/data/data-state";
import { getChartEmbeds } from "@/lib/integrations/mode-config";

export default async function OKRsPage() {
  const [
    okrsByPillarResult,
    countsResult,
    latestSyncRunResult,
    modeOkrsResult,
  ] = await Promise.all([
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
    safeLoad(() => getModeOkrs(), {
      company: [],
      pillar: [],
      squad: [],
      bySquad: new Map(),
      lastSync: null,
    } as Awaited<ReturnType<typeof getModeOkrs>>),
  ]);

  const firstUnavailable =
    okrsByPillarResult.error ?? countsResult.error ?? latestSyncRunResult.error;

  const okrsByPillar = okrsByPillarResult.data;
  const counts = countsResult.data;
  const latestSyncRun = latestSyncRunResult.data;
  const modeOkrs = modeOkrsResult.data;

  const okrCharts = getChartEmbeds("okrs", "company");
  const hasSlackData = counts.total > 0;
  const hasModeData =
    modeOkrs.company.length > 0 ||
    modeOkrs.pillar.length > 0 ||
    modeOkrs.squad.length > 0;
  const hasData = hasSlackData || hasModeData;

  const pageState = resolveDataState({
    source: "slack",
    hasData,
    latestSyncRun,
    error: firstUnavailable,
  });

  if (pageState.kind === "unavailable") {
    return (
      <UnavailablePage
        title="OKRs"
        description="Company objectives and key results"
        dataTitle="OKR updates from Slack"
        lastSyncedAt={pageState.lastSyncedAt}
      />
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
        postedAt: okr.postedAt.toISOString(),
        slackUrl: getSlackMessageUrl(okr.channelId, okr.slackTs),
      })),
    }));

  const modeSquadKrCounts: Record<string, number> = {};
  for (const [squadName, krs] of modeOkrs.bySquad.entries()) {
    modeSquadKrCounts[squadName] = krs.length;
  }

  // Sort Company KRs so CEO triage reads top-down. Tracked KRs with a current
  // value come first, ordered by progress ascending (worst first). KRs with no
  // current value drop to a secondary "not tracked" list.
  const trackedCompanyKrs = modeOkrs.company
    .filter(hasCurrentValue)
    .slice()
    .sort((a, b) => {
      const pa = progressTowardTarget(a) ?? 1;
      const pb = progressTowardTarget(b) ?? 1;
      if (pa !== pb) return pa - pb;
      return a.description.localeCompare(b.description);
    });
  const untrackedCompanyKrs = modeOkrs.company
    .filter((kr) => !hasCurrentValue(kr))
    .slice()
    .sort((a, b) => a.description.localeCompare(b.description));
  const companyAttentionCount = trackedCompanyKrs.filter(needsAttention).length;

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="OKRs"
        description="Company objectives and key results"
      />

      <DataStateBanner
        pageState={pageState}
        title="OKR updates from Slack"
      />

      {hasData ? (
        <OkrView
          pillars={pillars}
          counts={counts}
          companyKrs={trackedCompanyKrs}
          untrackedCompanyKrs={untrackedCompanyKrs}
          companyAttentionCount={companyAttentionCount}
          squadKrs={modeOkrs.squad}
          modeSquadKrCounts={modeSquadKrCounts}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No OKR data synced yet. Trigger the Slack and Mode syncs to pull
            updates and numeric KRs.
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
