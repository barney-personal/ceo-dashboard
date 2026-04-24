"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  HcPlanDepartment,
  HcPlanTeam,
  HcPlanTotals,
} from "@/lib/data/hc-plan";

interface PlannedOrgBreakdownProps {
  departments: HcPlanDepartment[];
  totals: HcPlanTotals;
  snapshotDate: string;
  source: string;
}

// Treat hired/offer-out as future hires, alongside in-pipeline + T2.
const SEGMENTS = [
  { key: "currentEmployees" as const, label: "Today", color: "#3b3bba" },
  { key: "hiredOfferOut" as const, label: "Hired / Offer out", color: "#7b6cf6" },
  { key: "inPipeline" as const, label: "In pipeline", color: "#a89cf2" },
  { key: "t2Hire" as const, label: "T2 hire", color: "#cfc8ee" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface RowSegmentValues {
  currentEmployees: number;
  hiredOfferOut: number;
  inPipeline: number;
  t2Hire: number;
  totalHc: number;
}

function StackedBar({
  values,
  maxTotal,
}: {
  values: RowSegmentValues;
  maxTotal: number;
}) {
  // Width is proportional to row total against the largest row total in view,
  // so visual length communicates "share of biggest team", not absolute scale.
  const widthPct = maxTotal > 0 ? (values.totalHc / maxTotal) * 100 : 0;

  return (
    <div className="flex h-5 w-full overflow-hidden rounded-md bg-muted/30">
      <div className="flex h-full" style={{ width: `${widthPct}%` }}>
        {SEGMENTS.map((seg) => {
          const v = values[seg.key];
          if (v === 0) return null;
          const segPct = values.totalHc > 0 ? (v / values.totalHc) * 100 : 0;
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${v}`}
              style={{ width: `${segPct}%`, backgroundColor: seg.color }}
              className="h-full"
            />
          );
        })}
      </div>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex h-5 min-w-[34px] items-center justify-center rounded-md border border-border/50 bg-muted/30 px-1.5 text-[10px] font-medium text-muted-foreground">
        +0
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 min-w-[34px] items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-700">
      +{delta}
    </span>
  );
}

function Row({
  label,
  values,
  maxTotal,
  onClick,
}: {
  label: string;
  values: RowSegmentValues;
  maxTotal: number;
  onClick?: () => void;
}) {
  const delta =
    values.hiredOfferOut + values.inPipeline + values.t2Hire;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-2.5 text-left",
        onClick && "transition-colors hover:bg-muted/30"
      )}
    >
      <span className="truncate text-sm text-foreground">{label}</span>
      <StackedBar values={values} maxTotal={maxTotal} />
      <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
        {values.currentEmployees} → {values.totalHc}
      </span>
      <DeltaBadge delta={delta} />
    </Wrapper>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {SEGMENTS.map((seg) => (
        <div
          key={seg.key}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: seg.color }}
          />
          {seg.label}
        </div>
      ))}
    </div>
  );
}

export function PlannedOrgBreakdown({
  departments,
  totals,
  snapshotDate,
  source,
}: PlannedOrgBreakdownProps) {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  const futureHires =
    totals.hiredOfferOut + totals.inPipeline + totals.t2Hire;

  const selected = useMemo(
    () => departments.find((d) => d.department === selectedDept) ?? null,
    [selectedDept, departments]
  );

  // Drilldown into a single department's teams.
  if (selected) {
    const teams: Array<HcPlanTeam & { delta: number }> = selected.teams.map(
      (t) => ({
        ...t,
        delta: t.hiredOfferOut + t.inPipeline + t.t2Hire,
      })
    );
    const maxTotal = Math.max(...teams.map((t) => t.totalHc), 1);

    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="flex items-center gap-3 border-b border-border/30 px-5 py-3">
          <button
            onClick={() => setSelectedDept(null)}
            className="flex items-center gap-0.5 rounded-md border border-border/50 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Back
          </button>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">
              {selected.department}
            </h3>
            <p className="text-xs text-muted-foreground">
              {teams.length} team{teams.length === 1 ? "" : "s"} ·{" "}
              {selected.currentEmployees} today → {selected.totalHc} planned (+
              {selected.hiredOfferOut +
                selected.inPipeline +
                selected.t2Hire}
              )
            </p>
          </div>
          <Legend />
        </div>
        <div className="divide-y divide-border/30">
          {teams.map((t) => (
            <Row
              key={t.team}
              label={t.team}
              values={t}
              maxTotal={maxTotal}
            />
          ))}
        </div>
      </div>
    );
  }

  const maxTotal = Math.max(...departments.map((d) => d.totalHc), 1);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Planned org breakdown
            </h3>
            <span className="text-xs text-muted-foreground">
              {departments.length} departments · {totals.currentEmployees}{" "}
              today → {totals.totalHc} planned
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] text-primary/60">
              <MousePointerClick className="h-2.5 w-2.5" />
              Click a row
            </span>
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:border-border hover:text-foreground"
            >
              Source · {formatDate(snapshotDate)}
            </a>
          </div>
        </div>
        <div className="border-b border-border/30 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Legend />
            <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
              <span>
                +{totals.hiredOfferOut} hired/offer out
              </span>
              <span>+{totals.inPipeline} in pipeline</span>
              <span>+{totals.t2Hire} T2 hire</span>
              <span className="font-semibold text-foreground">
                +{futureHires} total
              </span>
            </div>
          </div>
        </div>
        <div className="divide-y divide-border/30">
          {departments.map((d) => (
            <Row
              key={d.department}
              label={d.department}
              values={d}
              maxTotal={maxTotal}
              onClick={() => setSelectedDept(d.department)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
