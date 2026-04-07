import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ModeEmbed } from "@/components/dashboard/mode-embed";
import { getLatestOkrUpdates, getOkrStatusCounts, getSlackMessageUrl, type OkrSummary } from "@/lib/data/okrs";
import { getChartEmbeds } from "@/lib/integrations/mode-config";
import { ExternalLink } from "lucide-react";

function statusToType(status: string) {
  switch (status) {
    case "on_track": return "on_track" as const;
    case "at_risk": return "at_risk" as const;
    case "behind": return "behind" as const;
    case "completed": return "completed" as const;
    default: return "default" as const;
  }
}

export default async function OKRsPage() {
  const [okrsByPillar, counts] = await Promise.all([
    getLatestOkrUpdates().catch(() => new Map()),
    getOkrStatusCounts().catch(() => ({ onTrack: 0, atRisk: 0, behind: 0, total: 0 })),
  ]);

  const okrCharts = getChartEmbeds("okrs", "company");
  const hasData = counts.total > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="OKRs"
        description="Company objectives and key results from Slack"
      />

      {/* Summary metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total KRs"
          value={hasData ? counts.total.toString() : "—"}
          subtitle={hasData ? "tracked" : "awaiting sync"}
          delay={0}
        />
        <MetricCard
          label="On Track"
          value={hasData ? counts.onTrack.toString() : "—"}
          subtitle={hasData ? `${Math.round((counts.onTrack / counts.total) * 100)}%` : "awaiting sync"}
          delay={50}
        />
        <MetricCard
          label="At Risk"
          value={hasData ? counts.atRisk.toString() : "—"}
          subtitle={hasData ? `${Math.round((counts.atRisk / counts.total) * 100)}%` : "awaiting sync"}
          delay={100}
        />
        <MetricCard
          label="Behind"
          value={hasData ? counts.behind.toString() : "—"}
          subtitle={hasData ? `${Math.round((counts.behind / counts.total) * 100)}%` : "awaiting sync"}
          delay={150}
        />
      </div>

      {/* OKRs by pillar */}
      {hasData ? (
        [...okrsByPillar.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([pillar, okrs]) => {
            // Group by squad within pillar
            const bySquad = new Map<string, OkrSummary[]>();
            for (const okr of okrs) {
              const existing = bySquad.get(okr.squadName) ?? [];
              existing.push(okr);
              bySquad.set(okr.squadName, existing);
            }

            return (
              <div key={pillar} className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {pillar}
                </h3>

                {[...bySquad.entries()].map(([squad, krs]) => (
                  <SectionCard
                    key={squad}
                    title={squad}
                    description={`${krs.length} key results`}
                    action={
                      krs[0] ? (
                        <a
                          href={getSlackMessageUrl(krs[0].channelId, krs[0].slackTs)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Slack
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : undefined
                    }
                  >
                    <div className="space-y-2">
                      {krs.map((kr) => (
                        <div
                          key={`${kr.squadName}-${kr.krName}`}
                          className="flex items-start justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground">{kr.krName}</p>
                            {(kr.actual || kr.target) && (
                              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                {kr.actual}{kr.target ? ` vs ${kr.target} target` : ""}
                              </p>
                            )}
                          </div>
                          <StatusBadge status={statusToType(kr.status)} />
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                ))}
              </div>
            );
          })
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
            <ModeEmbed key={chart.url} url={chart.url} title={chart.title} subtitle="View in Mode" />
          ))}
        </div>
      )}
    </div>
  );
}
