"use client";

import { cn } from "@/lib/utils";
import type { ImpactAnalysis } from "@/lib/data/engineering-impact";
import {
  computeRampUp,
  steadyStateFromEngineers,
  timeToTarget,
  percentile,
  median,
} from "@/components/charts/impact/stats";

interface Finding {
  label: string;
  value: string;
  unit?: string;
  copy: React.ReactNode;
}

function FindingCard({ f, delay }: { f: Finding; delay: number }) {
  return (
    <div
      className="rounded-xl border border-border/60 bg-card p-5 shadow-warm animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {f.label}
      </div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-display text-4xl italic tracking-tight text-foreground">
          {f.value}
        </span>
        {f.unit && (
          <span className="text-xs text-muted-foreground">{f.unit}</span>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {f.copy}
      </p>
    </div>
  );
}

const Accent = ({ children }: { children: React.ReactNode }) => (
  <span className="text-foreground font-medium">{children}</span>
);

export function ImpactFindings({ analysis }: { analysis: ImpactAnalysis }) {
  const { engineers, tenureBuckets, metadata } = analysis;
  const byEmail = new Map(engineers.map((e) => [e.email, e]));

  const ics = engineers.filter(
    (e) => e.isMatched && e.levelTrack === "IC" && e.impact90d > 0,
  );
  const impacts90 = ics.map((e) => e.impact90d);
  const p10 = Math.round(percentile(impacts90, 0.1));
  const med = Math.round(median(impacts90));
  const p90 = Math.round(percentile(impacts90, 0.9));
  const spread = Math.round(p90 / Math.max(p10, 1));

  const rampRows = computeRampUp(
    tenureBuckets,
    byEmail,
    (e) => e.levelTrack === "IC",
    { maxMonth: 18 },
  );
  const ssInfo = steadyStateFromEngineers(
    engineers,
    (e) => e.levelTrack === "IC",
    18,
  );
  const ss = ssInfo?.value ?? null;
  const t50 = ss != null ? timeToTarget(rampRows, ss * 0.5) : null;
  const t80 = ss != null ? timeToTarget(rampRows, ss * 0.8) : null;

  const longTenure = engineers
    .filter(
      (e) => e.isMatched && e.levelTrack === "IC" && e.tenureMonthsNow >= 18,
    )
    .map((e) => e.impact90d);
  const ssP75 = longTenure.length ? percentile(longTenure, 0.75) : 0;
  const ssJitter = ss != null ? Math.round(ssP75 - ss) : 0;

  const m0 = rampRows.find((r) => r.month === 0);
  const m3 = rampRows.find((r) => r.month === 2);
  const m6 = rampRows.find((r) => r.month === 5);

  const beMed = Math.round(
    median(
      ics.filter((e) => e.discipline === "BE").map((e) => e.impact90d),
    ),
  );
  const feMed = Math.round(
    median(
      ics.filter((e) => e.discipline === "FE").map((e) => e.impact90d),
    ),
  );

  const findings: Finding[] = [
    {
      label: "Data window",
      value: metadata.dataWindowDays.toString(),
      unit: "days",
      copy: (
        <>
          GitHub history from <Accent>{metadata.dataStart}</Accent> to{" "}
          <Accent>{metadata.dataEnd}</Accent>.{" "}
          <Accent>{metadata.matchedEngineers}</Accent> of{" "}
          {metadata.totalActiveEngineers} engineers matched to GitHub.
        </>
      ),
    },
    {
      label: "Headline spread",
      value: `${spread}×`,
      copy: (
        <>
          Top-decile engineers ship <Accent>{spread}×</Accent> the 90-day
          impact of the bottom decile (<Accent>{p90}</Accent> vs{" "}
          <Accent>{p10}</Accent>). Median is <Accent>{med}</Accent>.
        </>
      ),
    },
    {
      label: "Steady state",
      value: Math.round(ss ?? 0).toString(),
      copy: (
        <>
          Median <code className="font-mono text-[11px]">impact_90d</code>{" "}
          across <Accent>{ssInfo?.n ?? 0}</Accent> ICs with tenure ≥ 18
          months. Interquartile spread <Accent>±{ssJitter}</Accent>.
        </>
      ),
    },
    {
      label: "Time to steady state",
      value: t50 != null ? `${t50 + 1}` : "—",
      unit: t50 != null ? "mo" : undefined,
      copy: t50 != null ? (
        <>
          Half of steady state by <Accent>month {t50 + 1}</Accent>;{" "}
          {t80 != null ? (
            <>
              80% ({Math.round((ss ?? 0) * 0.8)}) by{" "}
              <Accent>month {t80 + 1}</Accent>.
            </>
          ) : (
            <>
              80% ({Math.round((ss ?? 0) * 0.8)}) not reached within 18
              months.
            </>
          )}{" "}
          The first quarter carries most of the ramp.
        </>
      ) : (
        <>Insufficient tenure data to estimate.</>
      ),
    },
    {
      label: "The ramp curve",
      value: m3 && m3.p50 != null ? Math.round(m3.p50).toString() : "—",
      copy: (
        <>
          Month&nbsp;1{" "}
          <Accent>
            {m0 && m0.p50 != null ? Math.round(m0.p50) : "—"}
          </Accent>{" "}
          → month&nbsp;3{" "}
          <Accent>
            {m3 && m3.p50 != null ? Math.round(m3.p50) : "—"}
          </Accent>{" "}
          → month&nbsp;6{" "}
          <Accent>
            {m6 && m6.p50 != null ? Math.round(m6.p50) : "—"}
          </Accent>
          . Steep climb through the first quarter, flat by month 6.
        </>
      ),
    },
    {
      label: "BE vs FE",
      value: `${beMed} vs ${feMed}`,
      copy: (
        <>
          Backend median 90-day impact <Accent>{beMed}</Accent>; Frontend{" "}
          <Accent>{feMed}</Accent>. The metric rewards PR count, and BE
          tends to ship more, smaller PRs.
        </>
      ),
    },
  ];

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3")}>
      {findings.map((f, i) => (
        <FindingCard key={f.label} f={f} delay={i * 60} />
      ))}
    </div>
  );
}
