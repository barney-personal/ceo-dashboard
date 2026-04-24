"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  COMPOSITE_SIGNAL_KEYS,
  COMPOSITE_SIGNAL_LABELS,
  COMPOSITE_SIGNAL_DESCRIPTIONS,
  COMPOSITE_WEIGHTS,
  type CompositeSignalKey,
  type RankedCompositeEntry,
} from "@/lib/data/engineering-composite";

export interface StackRankTableProps {
  ranked: readonly RankedCompositeEntry[];
}

const QUARTILE_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: "Q1 (bottom)",
  2: "Q2",
  3: "Q3",
  4: "Q4 (top)",
};

function fmtScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function fmtPercentile(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(0)}`;
}

function fmtWeight(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function fmtRaw(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100 || abs < 0.01) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toFixed(2);
}

function FlagBadge({ entry }: { entry: RankedCompositeEntry }) {
  if (entry.quartileFlag === "promote_candidate" && entry.flagEligible) {
    return (
      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-primary">
        Promote candidate
      </span>
    );
  }
  if (entry.quartileFlag === "performance_manage" && entry.flagEligible) {
    return (
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-destructive">
        Performance-manage candidate
      </span>
    );
  }
  if (entry.quartile === 4) {
    return (
      <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Top quartile (inconclusive)
      </span>
    );
  }
  if (entry.quartile === 1) {
    return (
      <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Bottom quartile (inconclusive)
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      {QUARTILE_LABEL[entry.quartile]}
    </span>
  );
}

function ConfidenceBandBar({ entry }: { entry: RankedCompositeEntry }) {
  if (!entry.confidenceBand || entry.score === null) {
    return (
      <span className="text-[10px] italic text-muted-foreground">no band</span>
    );
  }
  const { lower, upper, halfWidth } = entry.confidenceBand;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-2 w-28 rounded-full bg-muted/50">
        <div
          className="absolute top-0 h-2 rounded-full bg-primary/25"
          style={{
            left: `${Math.max(0, Math.min(100, lower))}%`,
            width: `${Math.max(0.5, Math.min(100, upper) - Math.max(0, lower))}%`,
          }}
        />
        <div
          className="absolute top-[-2px] h-3 w-[2px] bg-foreground"
          style={{ left: `calc(${Math.max(0, Math.min(100, entry.score))}% - 1px)` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>
          {lower.toFixed(0)}–{upper.toFixed(0)}
        </span>
        <span>±{halfWidth.toFixed(1)}</span>
      </div>
    </div>
  );
}

function RankCell({
  entry,
  groupCounts,
}: {
  entry: RankedCompositeEntry;
  groupCounts: Map<number, number>;
}) {
  const tieSize = groupCounts.get(entry.tieGroupId) ?? 1;
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-base italic tabular-nums text-foreground">
        #{entry.rank}
      </span>
      {tieSize > 1 && (
        <span className="rounded-sm border border-warning/40 bg-warning/10 px-1 text-[10px] uppercase tracking-[0.12em] text-warning">
          tied · {tieSize}
        </span>
      )}
    </div>
  );
}

function SignalBreakdown({ entry }: { entry: RankedCompositeEntry }) {
  const rows = COMPOSITE_SIGNAL_KEYS.map((key) => {
    const contrib = entry.signals[key];
    const absent = contrib.percentileWithinDiscipline === null;
    return { key, contrib, absent };
  });
  return (
    <table className="w-full border-collapse text-left text-[11px]">
      <thead>
        <tr className="border-b border-border/40 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <th className="py-1 pr-3 font-medium">Signal</th>
          <th className="py-1 pr-3 text-right font-medium">Nominal</th>
          <th className="py-1 pr-3 text-right font-medium">Effective</th>
          <th className="py-1 pr-3 text-right font-medium">Raw</th>
          <th className="py-1 pr-3 text-right font-medium">Percentile</th>
          <th className="py-1 pr-3 text-right font-medium">Contribution</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, contrib, absent }) => (
          <tr key={key} className="border-b border-border/20 align-top">
            <td
              className={`py-1 pr-3 ${
                absent ? "italic text-muted-foreground" : "text-foreground"
              }`}
              title={COMPOSITE_SIGNAL_DESCRIPTIONS[key]}
            >
              {COMPOSITE_SIGNAL_LABELS[key]}
              {absent && (
                <div className="text-[10px] italic text-muted-foreground/80">
                  absent — too few samples, missing rubric, or below minimum
                </div>
              )}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
              {fmtWeight(contrib.weight)}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
              {fmtWeight(contrib.effectiveWeight)}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
              {fmtRaw(contrib.processedValue)}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
              {fmtPercentile(contrib.percentileWithinDiscipline)}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-foreground">
              {contrib.contribution === null
                ? "—"
                : (contrib.contribution * 100).toFixed(1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Drilldown({ entry }: { entry: RankedCompositeEntry }) {
  return (
    <div
      data-testid={`stack-rank-drilldown-${entry.emailHash}`}
      className="space-y-4 border-t border-border/30 bg-muted/20 p-4"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Why this row? (falsifiable evidence)
          </div>
          {entry.evidence.length === 0 ? (
            <p className="mt-2 text-[11px] italic text-muted-foreground">
              No falsifiable evidence — insufficient sample.
            </p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-foreground">
              {entry.evidence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Normalisation applied
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Tenure factor:{" "}
            <span className="font-medium text-foreground">
              {entry.tenureFactor.toFixed(2)}×
            </span>
            {entry.tenureFactor > 1 && (
              <span> (partial-window pro-rate — delivery inflated)</span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Role adjustment:{" "}
            <span className="font-medium text-foreground">
              {entry.roleFactor.isPlatformOrInfra
                ? "Platform / Infra (+30% delivery)"
                : "Standard"}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Confidence band half-width:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {entry.confidenceBand
                ? `±${entry.confidenceBand.halfWidth.toFixed(1)} points`
                : "—"}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Effective sample size:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {entry.nEffective === null
                ? "—"
                : entry.nEffective.toFixed(1)}
            </span>
          </p>
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-background/60 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Signal-level attribution
        </div>
        <div className="mt-2 overflow-x-auto">
          <SignalBreakdown entry={entry} />
        </div>
      </div>
    </div>
  );
}

export function StackRankTable({ ranked }: StackRankTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groupCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of ranked) {
      counts.set(entry.tieGroupId, (counts.get(entry.tieGroupId) ?? 0) + 1);
    }
    return counts;
  }, [ranked]);

  const toggle = (hash: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  if (ranked.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-5 py-8 text-center">
        <p className="font-display text-base italic text-muted-foreground">
          No scored engineers in this cohort yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          The composite refuses to rank until every cohort meets the minimum
          sample (3 engineers per discipline, ≥3 analysed PRs each).
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
      <table className="w-full border-collapse text-sm" data-testid="stack-rank-table">
        <thead className="border-b border-border/40 bg-muted/30 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            <th className="w-10 py-2 pl-4 pr-2 font-medium"></th>
            <th className="py-2 pr-3 font-medium">Rank</th>
            <th className="py-2 pr-3 font-medium">Engineer</th>
            <th className="py-2 pr-3 font-medium">Pillar · squad</th>
            <th className="py-2 pr-3 font-medium">Discipline</th>
            <th className="py-2 pr-3 text-right font-medium">Score</th>
            <th className="py-2 pr-3 font-medium">Confidence band</th>
            <th className="py-2 pr-4 font-medium">Label</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((entry) => {
            const isExpanded = expanded.has(entry.emailHash);
            return (
              <Fragment key={entry.emailHash}>
                <tr
                  className="border-b border-border/30 align-top hover:bg-muted/20"
                  data-testid={`stack-rank-row-${entry.emailHash}`}
                  data-tie-group={entry.tieGroupId}
                  data-quartile={entry.quartile}
                  data-flag={entry.quartileFlag ?? "none"}
                >
                  <td className="py-3 pl-4 pr-2">
                    <button
                      type="button"
                      onClick={() => toggle(entry.emailHash)}
                      className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${entry.displayName}`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                  <td className="py-3 pr-3">
                    <RankCell entry={entry} groupCounts={groupCounts} />
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-medium text-foreground">
                      {entry.displayName}
                    </div>
                    {entry.status === "partial_window_scored" && (
                      <div className="text-[10px] italic text-muted-foreground">
                        partial window — delivery pro-rated
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">
                    {entry.pillar}
                    {entry.squad ? ` · ${entry.squad}` : ""}
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">
                    {entry.discipline}
                  </td>
                  <td className="py-3 pr-3 text-right font-display italic tabular-nums text-foreground">
                    {fmtScore(entry.score)}
                  </td>
                  <td className="py-3 pr-3">
                    <ConfidenceBandBar entry={entry} />
                  </td>
                  <td className="py-3 pr-4">
                    <FlagBadge entry={entry} />
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-border/30">
                    <td colSpan={8} className="p-0">
                      <Drilldown entry={entry} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const __testing = { QUARTILE_LABEL };
