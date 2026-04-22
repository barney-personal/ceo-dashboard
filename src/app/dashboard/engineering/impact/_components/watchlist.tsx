"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { scaleLinear, scaleBand } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import { cn } from "@/lib/utils";
import type { ImpactEngineer } from "@/lib/data/engineering-impact";
import {
  computePeerStats,
  percentile,
  type Severity,
  type PeerStat,
} from "@/components/charts/impact/stats";
import {
  useContainerWidth,
  showTooltip,
  moveTooltip,
  hideTooltip,
  SEVERITY_COLOR,
} from "@/components/charts/impact/shared";
import { AlertTriangle, ExternalLink } from "lucide-react";

function Frame({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="rounded-xl border border-border/60 bg-card shadow-warm">
      <figcaption className="border-b border-border/50 px-5 py-3">
        <h3 className="font-display text-lg italic tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground max-w-3xl">
          {caption}
        </p>
      </figcaption>
      <div className="px-5 py-4">{children}</div>
    </figure>
  );
}

// ─── Caveat callout ──────────────────────────────────────────────────

export function WatchlistCaveat() {
  return (
    <div className="rounded-xl border border-negative/30 bg-negative/5 p-5">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-negative">
        <AlertTriangle className="h-3.5 w-3.5" />
        Read this before using the watchlist
      </div>
      <p className="mb-2 text-sm leading-relaxed text-foreground/85">
        This metric only sees <strong>merged PRs in synced repos</strong>.
        It cannot see code review, pair programming, mentorship, design
        documents, incident response, on-call rotations, work under a
        different GitHub identity, or PRs in repos that aren&rsquo;t
        synced. A quarter of low output can reflect parental leave,
        sickness, bereavement, a long cross-team project without visible
        merges, or a deliberate shift to tech-debt or review work.
      </p>
      <p className="text-sm leading-relaxed text-foreground/85">
        <strong>Every name here is a conversation starter, not a
        conclusion.</strong> The expectation is that each flag gets
        checked against the engineer&rsquo;s manager&rsquo;s full context
        before any action is taken.
      </p>
    </div>
  );
}

// ─── D.1 Bottom performers (diverging bars) ──────────────────────────

export function BottomPerformers({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const stats = computePeerStats(engineers).filter(
      (e) =>
        e.tenureMonthsNow >= 6 &&
        e.peerRatio90d != null &&
        e.severity !== "uncomparable",
    );
    const bottom = stats
      .slice()
      .sort((a, b) => (a.peerRatio90d ?? 0) - (b.peerRatio90d ?? 0))
      .slice(0, 25);

    const rowH = 28;
    const margin = { top: 36, right: 200, bottom: 60, left: 220 };
    const innerW = width - margin.left - margin.right;
    const height = margin.top + margin.bottom + bottom.length * rowH;
    const innerH = bottom.length * rowH;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMax = Math.min(
      1.5,
      (bottom.reduce((m, e) => Math.max(m, e.peerRatio90d ?? 0), 0) || 1) *
        1.05,
    );
    const x = scaleLinear().domain([0, Math.max(1, xMax)]).range([0, innerW]);
    const y = scaleBand<string>()
      .domain(bottom.map((d) => d.email))
      .range([0, innerH])
      .paddingInner(0.3);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6).tickSize(-innerH).tickFormat(() => ""))
      .select(".domain")
      .remove();

    // Peer-median reference
    g.append("line")
      .attr("x1", x(1))
      .attr("x2", x(1))
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3");
    g.append("text")
      .attr("x", x(1))
      .attr("y", -10)
      .attr("text-anchor", "middle")
      .style("font-family", "var(--font-display)")
      .style("font-style", "italic")
      .style("font-size", "11px")
      .attr("fill", "var(--foreground)")
      .text("peer median (100%)");

    [
      { at: 0.5, color: SEVERITY_COLOR.severe },
      { at: 0.75, color: SEVERITY_COLOR.moderate },
    ].forEach((ref) => {
      g.append("line")
        .attr("x1", x(ref.at))
        .attr("x2", x(ref.at))
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", ref.color)
        .attr("stroke-dasharray", "3 3")
        .attr("opacity", 0.7);
    });

    const colorFor = (sev: Severity) =>
      sev === "severe"
        ? SEVERITY_COLOR.severe
        : sev === "moderate"
          ? SEVERITY_COLOR.moderate
          : SEVERITY_COLOR.ok;

    g.append("g")
      .selectAll("rect")
      .data(bottom)
      .join("rect")
      .attr("x", 0)
      .attr("y", (d) => y(d.email) ?? 0)
      .attr("width", (d) => x(Math.min(d.peerRatio90d ?? 0, xMax)))
      .attr("height", y.bandwidth())
      .attr("fill", (d) => colorFor(d.severity))
      .attr("fill-opacity", 0.72)
      .style("cursor", "pointer")
      .on("mouseenter", (event: MouseEvent, d) =>
        showTooltip(event, {
          title: d.name,
          subtitle: `${d.levelLabel} ${d.discipline} · ${d.pillar}`,
          meta: `${Math.round((d.peerRatio90d ?? 0) * 100)}% of peer median · 90d ${d.impact90d}${d.declining ? " · declining" : ""}`,
        }),
      )
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);

    g.append("g")
      .selectAll("circle")
      .data(bottom)
      .join("circle")
      .attr("cx", (d) => x(Math.min(d.peerRatio90d ?? 0, xMax)))
      .attr("cy", (d) => (y(d.email) ?? 0) + y.bandwidth() / 2)
      .attr("r", 4)
      .attr("fill", (d) => colorFor(d.severity))
      .attr("stroke", "var(--card)")
      .attr("stroke-width", 1);

    g.append("g")
      .selectAll("text.name")
      .data(bottom)
      .join("text")
      .attr("x", -12)
      .attr("y", (d) => (y(d.email) ?? 0) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "end")
      .style("font-weight", "500")
      .style("font-size", "12px")
      .attr("fill", "var(--foreground)")
      .text((d) => d.name);

    g.append("g")
      .selectAll("text.sub")
      .data(bottom)
      .join("text")
      .attr("x", -12)
      .attr("y", (d) => (y(d.email) ?? 0) + y.bandwidth() / 2 + 15)
      .attr("text-anchor", "end")
      .style("font-size", "9px")
      .attr("fill", "var(--muted-foreground)")
      .text(
        (d) =>
          `${d.levelLabel} ${d.discipline} · ${d.pillar} · ${d.tenureMonthsNow}mo`,
      );

    g.append("g")
      .selectAll("text.pct")
      .data(bottom)
      .join("text")
      .attr("x", innerW + 12)
      .attr("y", (d) => (y(d.email) ?? 0) + y.bandwidth() / 2 + 4)
      .style("font-family", "var(--font-mono)")
      .style("font-size", "11px")
      .attr("fill", "var(--foreground)")
      .text(
        (d) =>
          `${Math.round((d.peerRatio90d ?? 0) * 100)}% · ${d.impact90d}/${Math.round(d.peerMedian90d ?? 0)}${d.declining ? " ↓" : ""}`,
      );

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(
        axisBottom(x)
          .ticks(6)
          .tickFormat((d) => `${Math.round(Number(d) * 100)}%`),
      )
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 44)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("impact_90d as % of peer median (same discipline × level)");
  }, [engineers, width]);

  return (
    <Frame
      title="D.1  Peer-relative impact (bottom 25)"
      caption="Peers = other ICs in the same discipline (BE/FE/ML/QA) and same level. Bars below 50% are flagged severe; 50–75% moderate. New hires (< 6 months) are excluded — peer comparison isn't fair yet."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}

// ─── D.2 Trajectory scatter ──────────────────────────────────────────

export function TrajectoryScatter({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  useEffect(() => {
    if (!svgRef.current) return;
    const stats = computePeerStats(engineers).filter(
      (e) => e.tenureMonthsNow >= 6 && e.impact90d > 0,
    );

    const height = 460;
    const margin = { top: 30, right: 30, bottom: 64, left: 60 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMax = percentile(
      stats.map((s) => s.impact90d),
      0.98,
    );
    const yMax = percentile(
      stats.map((s) => s.impact30d * 3),
      0.98,
    );
    const axisMax = Math.max(xMax, yMax);

    const x = scaleLinear().domain([0, axisMax]).nice().range([0, innerW]);
    const y = scaleLinear().domain([0, axisMax]).nice().range([innerH, 0]);

    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(() => ""))
      .select(".domain")
      .remove();

    g.append("line")
      .attr("x1", x(0))
      .attr("x2", x(axisMax))
      .attr("y1", y(0))
      .attr("y2", y(axisMax))
      .attr("stroke", "var(--foreground)")
      .attr("stroke-dasharray", "4 3");
    g.append("text")
      .attr("x", x(axisMax * 0.92))
      .attr("y", y(axisMax * 0.95) + 4)
      .attr("text-anchor", "end")
      .style("font-family", "var(--font-display)")
      .style("font-style", "italic")
      .style("font-size", "12px")
      .attr("fill", "var(--foreground)")
      .text("holding pace");

    g.append("line")
      .attr("x1", x(0))
      .attr("x2", x(axisMax))
      .attr("y1", y(0))
      .attr("y2", y(axisMax * 0.6))
      .attr("stroke", SEVERITY_COLOR.severe)
      .attr("stroke-dasharray", "2 3")
      .attr("opacity", 0.8);
    g.append("text")
      .attr("x", x(axisMax * 0.92))
      .attr("y", y(axisMax * 0.6 * 0.95) + 4)
      .attr("text-anchor", "end")
      .style("font-size", "10px")
      .style("font-style", "italic")
      .attr("fill", SEVERITY_COLOR.severe)
      .text("60% of pace — declining");

    g.append("g")
      .selectAll("circle")
      .data(stats)
      .join("circle")
      .attr("cx", (d) => x(Math.min(d.impact90d, axisMax)))
      .attr("cy", (d) => y(Math.min(d.impact30d * 3, axisMax)))
      .attr("r", 4)
      .attr("fill", (d) =>
        d.declining && d.severity === "severe"
          ? SEVERITY_COLOR.severe
          : d.declining
            ? SEVERITY_COLOR.moderate
            : SEVERITY_COLOR.ok,
      )
      .attr("fill-opacity", 0.78)
      .attr("stroke", "var(--card)")
      .attr("stroke-width", 0.8)
      .style("cursor", "pointer")
      .on("mouseenter", (event: MouseEvent, d) =>
        showTooltip(event, {
          title: d.name,
          subtitle: `${d.levelLabel} · ${d.discipline} · ${d.pillar}`,
          meta: `90d ${d.impact90d} · 30d×3 ${Math.round(d.impact30d * 3)} · traj ${d.trajectoryRatio != null ? d.trajectoryRatio.toFixed(2) : "—"}`,
        }),
      )
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);

    g.append("g")
      .selectAll("text")
      .data(stats.filter((s) => s.declining && s.severity !== "ok"))
      .join("text")
      .attr("x", (d) => x(Math.min(d.impact90d, axisMax)) + 7)
      .attr("y", (d) => y(Math.min(d.impact30d * 3, axisMax)) + 3)
      .style("font-size", "10px")
      .attr("fill", "var(--foreground)")
      .text((d) => d.name);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .attr("color", "var(--border)")
      .call(axisBottom(x).ticks(6))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );
    g.append("g")
      .attr("color", "var(--border)")
      .call(axisLeft(y).ticks(5))
      .call((s) =>
        s.selectAll("text").attr("fill", "var(--muted-foreground)"),
      );

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 44)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("impact_90d (baseline)");
    g.append("text")
      .attr("transform", `translate(${-44},${innerH / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.08em")
      .attr("fill", "var(--muted-foreground)")
      .text("impact_30d × 3 (recent pace)");

    // Legend
    const legend = svg
      .append("g")
      .attr("transform", `translate(${margin.left + 12},${margin.top + 12})`);
    [
      ["severe + declining", SEVERITY_COLOR.severe],
      ["declining only", SEVERITY_COLOR.moderate],
      ["holding or above", SEVERITY_COLOR.ok],
    ].forEach(([lbl, col], i) => {
      legend
        .append("circle")
        .attr("cx", 6)
        .attr("cy", i * 16)
        .attr("r", 4)
        .attr("fill", col);
      legend
        .append("text")
        .attr("x", 16)
        .attr("y", i * 16 + 4)
        .style("font-size", "10px")
        .attr("fill", "var(--foreground)")
        .text(lbl);
    });
  }, [engineers, width]);

  return (
    <Frame
      title="D.2  Recent trajectory vs 90-day baseline"
      caption="Scatter of recent-30d × 3 (annualised to 90d scale) against impact_90d. Dots below the 45° line have slowed over the last month versus their own baseline — the steeper the drop, the more concerning."
    >
      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} className="w-full" />
      </div>
    </Frame>
  );
}

// ─── D.3 Watchlist table ─────────────────────────────────────────────

type WatchRow = ImpactEngineer & PeerStat;

const COLS: {
  key: keyof WatchRow | "flags";
  label: string;
  sort: "string" | "num" | "none";
  num?: boolean;
}[] = [
  { key: "name", label: "Engineer", sort: "string" },
  { key: "discipline", label: "Disc.", sort: "string" },
  { key: "levelLabel", label: "Level", sort: "string" },
  { key: "pillar", label: "Pillar", sort: "string" },
  { key: "tenureMonthsNow", label: "Tenure (mo)", sort: "num", num: true },
  { key: "impact90d", label: "Impact 90d", sort: "num", num: true },
  { key: "peerMedian90d", label: "Peer median", sort: "num", num: true },
  { key: "peerRatio90d", label: "% of peer", sort: "num", num: true },
  { key: "impact30d", label: "Impact 30d", sort: "num", num: true },
  { key: "trajectoryRatio", label: "Traj.", sort: "num", num: true },
  { key: "aiSpend", label: "AI $/mo", sort: "num", num: true },
  { key: "flags", label: "Flags", sort: "none" },
];

export function WatchlistTable({
  engineers,
}: {
  engineers: ImpactEngineer[];
}) {
  const watchlist = useMemo(() => {
    const stats = computePeerStats(engineers);
    return stats.filter(
      (s) =>
        s.tenureMonthsNow >= 6 &&
        s.severity !== "uncomparable" &&
        s.severity !== "ok" &&
        s.declining,
    );
  }, [engineers]);

  // When NO engineer on the page has any AI spend recorded (Mode outage,
  // or the report hasn't been synced yet) we hide both the AI column and
  // the "try AI?" pill — otherwise every row gets the pill, including
  // engineers who are heavy AI users whose data is just missing.
  const hasAnyAiData = useMemo(
    () => engineers.some((e) => e.aiSpend != null),
    [engineers],
  );
  const visibleCols = useMemo(
    () => (hasAnyAiData ? COLS : COLS.filter((c) => c.key !== "aiSpend")),
    [hasAnyAiData],
  );

  const [sortKey, setSortKey] = useState<string>("peerRatio90d");
  const [sortAsc, setSortAsc] = useState(true);

  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey);
    if (!col || col.sort === "none") return watchlist;
    return watchlist.slice().sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (col.sort === "string") {
        const as = typeof av === "string" ? av : "";
        const bs = typeof bv === "string" ? bv : "";
        return sortAsc ? as.localeCompare(bs) : bs.localeCompare(as);
      }
      const an =
        typeof av === "number" ? av : av == null ? Infinity : Number(av);
      const bn =
        typeof bv === "number" ? bv : bv == null ? Infinity : Number(bv);
      return sortAsc ? an - bn : bn - an;
    });
  }, [watchlist, sortKey, sortAsc]);

  function setSort(key: string) {
    const col = COLS.find((c) => c.key === key);
    if (!col || col.sort === "none") return;
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  return (
    <Frame
      title="D.3  The watchlist"
      caption="Cross-section: engineers flagged by peer-relative impact (D.1) AND declining trajectory (D.2). These are the highest-signal candidates for a manager conversation."
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm italic text-muted-foreground">
          No engineers currently meet both criteria — good news.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {visibleCols.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => setSort(c.key)}
                    className={cn(
                      "sticky top-0 border-b border-border/50 bg-card px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
                      c.sort !== "none" &&
                        "cursor-pointer select-none hover:text-primary",
                      sortKey === c.key && "text-primary",
                    )}
                  >
                    {c.label}
                    {sortKey === c.key && (
                      <span className="ml-1 text-primary">
                        {sortAsc ? "▴" : "▾"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.email}
                  className="border-b border-border/40 hover:bg-muted/20"
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    {r.githubLogin ? (
                      <a
                        href={`https://github.com/${encodeURIComponent(r.githubLogin)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        {r.name}
                        <ExternalLink className="h-3 w-3 opacity-40" />
                      </a>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.discipline}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.levelLabel}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.pillar}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {r.tenureMonthsNow}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                    {r.impact90d}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {r.peerMedian90d != null
                      ? Math.round(r.peerMedian90d)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                    {r.peerRatio90d != null
                      ? `${Math.round(r.peerRatio90d * 100)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {r.impact30d}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {r.trajectoryRatio != null
                      ? r.trajectoryRatio.toFixed(2)
                      : "—"}
                  </td>
                  {hasAnyAiData && (
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                      {r.aiSpend == null
                        ? "—"
                        : r.aiSpend === 0
                          ? "$0"
                          : r.aiSpend >= 100
                            ? `$${Math.round(r.aiSpend)}`
                            : `$${r.aiSpend.toFixed(0)}`}
                    </td>
                  )}
                  <td className="px-3 py-2 text-xs">
                    {r.severity === "severe" && (
                      <span className="mr-1 rounded-full bg-negative/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-negative">
                        severe
                      </span>
                    )}
                    {r.severity === "moderate" && (
                      <span className="mr-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-warning">
                        moderate
                      </span>
                    )}
                    {r.declining && (
                      <span className="mr-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
                        declining
                      </span>
                    )}
                    {/* AI coaching hint: matched in the AI dataset but
                        spent $0 last month. Strictly r.aiSpend === 0,
                        NOT null — null means the engineer's email
                        hasn't been matched in Mode yet (or Mode is
                        unreachable), and showing the pill in that case
                        flags heavy AI users as non-adopters. */}
                    {hasAnyAiData && r.aiSpend === 0 && (
                      <span
                        className="rounded-full bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary/80"
                        title="$0 AI usage recorded for the latest month — consider an onboarding chat about Claude Code / Cursor"
                      >
                        try AI?
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  );
}
