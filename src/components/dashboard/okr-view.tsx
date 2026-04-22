"use client";

import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { RagBar } from "@/components/dashboard/rag-bar";
import { OkrCompanyKrCard } from "@/components/dashboard/okr-company-kr-card";
import {
  ExternalLink,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
} from "lucide-react";
import {
  formatKrValue,
  krTrend,
  progressTowardTarget,
  type ModeKr,
} from "@/lib/data/okr-mode-shared";
import {
  STALE_DAYS,
  daysSince,
  formatAbsoluteDate,
  formatUpdatedAgo,
  staleToneClasses,
} from "@/lib/data/okr-staleness";

interface OkrKr {
  pillar: string;
  squadName: string;
  objectiveName: string;
  krName: string;
  status: string;
  actual: string | null;
  target: string | null;
  userName: string | null;
  postedAt: string;
  slackUrl: string;
}

interface PillarData {
  name: string;
  okrs: OkrKr[];
}

interface OkrViewProps {
  pillars: PillarData[];
  counts: { onTrack: number; atRisk: number; behind: number; total: number };
  /** Company KRs with numeric data, pre-sorted worst-first by the server. */
  companyKrs: ModeKr[];
  /** Company KRs defined in Mode but not yet reporting a current value. */
  untrackedCompanyKrs: ModeKr[];
  /** Count of tracked Company KRs that are trending down or below 50% progress. */
  companyAttentionCount: number;
  squadKrs: ModeKr[];
  modeSquadKrCounts: Record<string, number>;
}

function statusToType(status: string) {
  switch (status) {
    case "on_track": return "on_track" as const;
    case "at_risk": return "at_risk" as const;
    case "behind": return "behind" as const;
    case "completed": return "completed" as const;
    default: return "default" as const;
  }
}

function countStatuses(okrs: OkrKr[]) {
  return {
    green: okrs.filter((o) => o.status === "on_track").length,
    amber: okrs.filter((o) => o.status === "at_risk").length,
    red: okrs.filter((o) => o.status === "behind").length,
    grey: okrs.filter((o) => o.status !== "on_track" && o.status !== "at_risk" && o.status !== "behind").length,
  };
}

function groupBySquad(okrs: OkrKr[]) {
  const map = new Map<string, OkrKr[]>();
  for (const okr of okrs) {
    const existing = map.get(okr.squadName) ?? [];
    existing.push(okr);
    map.set(okr.squadName, existing);
  }
  return [...map.entries()];
}

export function OkrView({
  pillars,
  counts,
  companyKrs,
  untrackedCompanyKrs,
  companyAttentionCount,
  squadKrs,
  modeSquadKrCounts,
}: OkrViewProps) {
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);

  const pillarStats = useMemo(
    () =>
      pillars.map((pillar) => {
        const squads = groupBySquad(pillar.okrs);
        const rag = countStatuses(pillar.okrs);
        const staleSquadCount = squads.filter(
          ([, krs]) => daysSince(krs[0].postedAt) > STALE_DAYS,
        ).length;
        return { pillar, squads, rag, staleSquadCount };
      }),
    [pillars],
  );

  const activePillarStats = pillarStats.find(
    (p) => p.pillar.name === selectedPillar,
  );

  const totalStaleSquads = pillarStats.reduce(
    (sum, p) => sum + p.staleSquadCount,
    0,
  );

  const squadKrsBySquad = useMemo(() => {
    const map = new Map<string, ModeKr[]>();
    for (const kr of squadKrs) {
      if (!kr.squad) continue;
      const existing = map.get(kr.squad) ?? [];
      existing.push(kr);
      map.set(kr.squad, existing);
    }
    return map;
  }, [squadKrs]);

  return (
    <div className="space-y-6">
      {/* Summary strip — always visible */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm sm:grid-cols-5">
        {[
          { label: "Total KRs", value: counts.total, color: "text-foreground" },
          { label: "On Track", value: counts.onTrack, color: "text-positive" },
          { label: "At Risk", value: counts.atRisk, color: "text-warning" },
          { label: "Behind", value: counts.behind, color: "text-negative" },
          {
            label: `Stale squads (>${STALE_DAYS}d)`,
            value: totalStaleSquads,
            color: totalStaleSquads > 0 ? "text-warning" : "text-muted-foreground",
          },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className={`flex flex-col gap-1 border-border/50 px-5 py-4 ${
              i % 2 === 1 ? "border-l" : ""
            } ${i > 0 ? "sm:border-l" : ""} ${
              i >= 2 ? "border-t sm:border-t-0" : ""
            }`}
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {stat.label}
            </span>
            <span className={`font-mono text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      <RagBar
        green={counts.onTrack}
        amber={counts.atRisk}
        red={counts.behind}
        grey={counts.total - counts.onTrack - counts.atRisk - counts.behind}
      />

      {/* Company KRs: numeric truth from Mode */}
      {!selectedPillar && (companyKrs.length > 0 || untrackedCompanyKrs.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Company KRs
            </h3>
            <span className="text-[10px] text-muted-foreground/60">
              {companyKrs.length > 0
                ? "Worst first · baseline → current → target from Mode"
                : "From Mode"}
            </span>
          </div>

          {companyAttentionCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold">
                  {companyAttentionCount} of {companyKrs.length}
                </span>{" "}
                Company {companyAttentionCount === 1 ? "KR needs" : "KRs need"} attention —
                trending away from target or below 50% progress.
              </span>
            </div>
          )}

          {companyKrs.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {companyKrs.map((kr, i) => (
                <OkrCompanyKrCard
                  key={`${kr.krType}::${kr.description}`}
                  kr={kr}
                  delay={i * 40}
                />
              ))}
            </div>
          )}

          {untrackedCompanyKrs.length > 0 && (
            <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-4 py-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                  Not yet tracked in Mode
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  {untrackedCompanyKrs.length}
                </span>
              </div>
              <ul className="space-y-0.5">
                {untrackedCompanyKrs.map((kr) => (
                  <li
                    key={`${kr.krType}::${kr.description}`}
                    className="text-xs text-muted-foreground/70"
                  >
                    {kr.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Overview: pillar cards */}
      {!selectedPillar && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pillarStats.map(({ pillar, squads, rag, staleSquadCount }) => {
            return (
              <button
                key={pillar.name}
                onClick={() => setSelectedPillar(pillar.name)}
                className="group min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card p-5 shadow-warm text-left transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
              >
                <h3 className="text-base font-semibold text-foreground">
                  {pillar.name}
                </h3>

                <div className="mb-3 mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  {rag.green > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-positive" />
                      {rag.green}
                    </span>
                  )}
                  {rag.amber > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-warning" />
                      {rag.amber}
                    </span>
                  )}
                  {rag.red > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-negative" />
                      {rag.red}
                    </span>
                  )}
                  {staleSquadCount > 0 && (
                    <span className="flex items-center gap-1 text-warning">
                      <span className="h-2 w-2 rounded-full bg-warning/60 ring-1 ring-warning" />
                      {staleSquadCount} stale
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground/50">
                    {pillar.okrs.length} KRs
                  </span>
                </div>

                <RagBar
                  green={rag.green}
                  amber={rag.amber}
                  red={rag.red}
                  grey={rag.grey}
                  className="mb-4"
                />

                <div className="space-y-1.5">
                  {squads.map(([squad, krs]) => {
                    const days = daysSince(krs[0].postedAt);
                    const isStale = days > STALE_DAYS;
                    const toneClasses = staleToneClasses(days);
                    const modeCount = modeSquadKrCounts[squad] ?? 0;
                    return (
                      <div key={squad} className="flex items-center gap-2">
                        <span
                          className={`flex-1 truncate text-sm ${
                            isStale ? "text-warning" : "text-muted-foreground"
                          }`}
                        >
                          {squad}
                        </span>
                        {modeCount > 0 && (
                          <span
                            className="shrink-0 rounded-full border border-border/50 px-1.5 py-0 font-mono text-[9px] tabular-nums text-muted-foreground/70"
                            title={`${modeCount} KR${modeCount === 1 ? "" : "s"} tracked in Mode`}
                          >
                            {modeCount} KR
                          </span>
                        )}
                        <span
                          className={`shrink-0 font-mono text-[10px] tabular-nums ${toneClasses}`}
                          title={`Last posted ${formatAbsoluteDate(krs[0].postedAt)} (${formatUpdatedAgo(days)})`}
                        >
                          {formatUpdatedAgo(days)}
                        </span>
                        <div className="flex flex-wrap justify-end gap-1">
                          {krs.map((kr, i) => (
                            <span
                              key={i}
                              className={`h-2.5 w-2.5 rounded-sm ${
                                kr.status === "on_track"
                                  ? "bg-positive"
                                  : kr.status === "at_risk"
                                    ? "bg-warning"
                                    : kr.status === "behind"
                                      ? "bg-negative"
                                      : "bg-muted-foreground/30"
                              }`}
                              title={kr.krName}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail view: selected pillar */}
      {selectedPillar && activePillarStats && (
        <div className="space-y-5">
          <button
            onClick={() => setSelectedPillar(null)}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All pillars
          </button>

          <div>
            <h3 className="text-xl font-semibold text-foreground">
              {activePillarStats.pillar.name}
            </h3>
            <div className="mt-2 max-w-md">
              <RagBar
                green={activePillarStats.rag.green}
                amber={activePillarStats.rag.amber}
                red={activePillarStats.rag.red}
                grey={activePillarStats.rag.grey}
              />
            </div>
          </div>

          {activePillarStats.squads.map(([squad, krs]) => {
            const days = daysSince(krs[0].postedAt);
            const isStale = days > STALE_DAYS;
            const modeKrs = squadKrsBySquad.get(squad) ?? [];
            return (
              <div
                key={squad}
                className="rounded-xl border border-border/60 bg-card shadow-warm"
              >
                <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {squad}
                      </span>
                      {krs[0]?.userName && (
                        <span className="text-xs text-muted-foreground">
                          {krs[0].userName}
                        </span>
                      )}
                    </div>
                    <div
                      className={`mt-0.5 text-[11px] ${
                        isStale ? "text-warning" : "text-muted-foreground"
                      }`}
                    >
                      Last updated {formatAbsoluteDate(krs[0].postedAt)} ·{" "}
                      <span className="font-medium tabular-nums">
                        {formatUpdatedAgo(days)}
                      </span>
                    </div>
                  </div>
                  {isStale && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        days > 30
                          ? "bg-negative/10 text-negative"
                          : "bg-warning/10 text-warning"
                      }`}
                      title={`No update in ${days} days`}
                    >
                      Stale · {days}d
                    </span>
                  )}
                  <a
                    href={krs[0].slackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:border-border hover:text-foreground"
                  >
                    Slack
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
                <div className="p-5 space-y-2">
                  {krs.map((kr) => (
                    <div
                      key={`${kr.squadName}-${kr.krName}`}
                      className="flex items-start gap-3 rounded-lg bg-muted/30 px-3 py-2.5"
                    >
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${
                          kr.status === "on_track"
                            ? "bg-positive"
                            : kr.status === "at_risk"
                              ? "bg-warning"
                              : kr.status === "behind"
                                ? "bg-negative"
                                : "bg-muted-foreground/30"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {kr.krName}
                        </p>
                        {(kr.actual || kr.target) && (
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {kr.actual}
                            {kr.target ? ` vs ${kr.target} target` : ""}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                          {kr.objectiveName}
                        </p>
                      </div>
                      <StatusBadge status={statusToType(kr.status)} />
                    </div>
                  ))}
                </div>
                {modeKrs.length > 0 && (
                  <div className="border-t border-border/40 bg-muted/10 px-5 py-4">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        Numeric KRs (Mode)
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {modeKrs.length} tracked
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {modeKrs.map((kr) => (
                        <ModeKrRow
                          key={`${kr.krType}::${kr.description}`}
                          kr={kr}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModeKrRow({ kr }: { kr: ModeKr }) {
  const progress = progressTowardTarget(kr);
  const trend = krTrend(kr);
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up"
      ? "text-positive"
      : trend === "down"
        ? "text-negative"
        : "text-muted-foreground/60";

  const barColor =
    progress == null
      ? "bg-muted-foreground/20"
      : progress >= 0.95
        ? "bg-positive"
        : progress >= 0.6
          ? "bg-primary"
          : progress >= 0.25
            ? "bg-warning"
            : "bg-negative";

  return (
    <div className="flex items-center gap-3 rounded-md px-1 py-1.5 text-xs">
      <span className="flex-1 truncate text-muted-foreground">
        {kr.description}
      </span>
      {progress != null && (
        <div className="hidden h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted/40 sm:block">
          <div
            className={`h-full rounded-full ${barColor}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
      <span className="w-28 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
        {formatKrValue(kr.current, kr.format)}
        {kr.target != null && (
          <span className="text-muted-foreground/50">
            {" / "}
            {formatKrValue(kr.target, kr.format)}
          </span>
        )}
      </span>
      {kr.previous != null && kr.current != null && (
        <span className={`flex w-6 shrink-0 items-center justify-end ${trendColor}`}>
          <TrendIcon className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}
