"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import { select } from "d3-selection";
import { scaleBand, scaleLinear } from "d3-scale";
import { axisLeft } from "d3-axis";
import { Flag, AlertTriangle } from "lucide-react";
import { getContentBoxWidth } from "@/components/charts/chart-utils";
import type { PerformanceRating } from "@/lib/data/performance";

const RATING_COLOURS: Record<number | "null", string> = {
  5: "#16a34a",
  4: "#65a30d",
  3: "#ca8a04",
  2: "#ea580c",
  1: "#dc2626",
  null: "#9ca3af",
};

const RATING_LABELS: Record<number | "null", string> = {
  5: "Exceptional",
  4: "Strong",
  3: "Meeting expectations",
  2: "Below expectations",
  1: "Significantly below",
  null: "Missed",
};

function ratingColour(rating: number | null): string {
  if (rating === null) return RATING_COLOURS.null;
  return RATING_COLOURS[rating as keyof typeof RATING_COLOURS] ?? RATING_COLOURS.null;
}

function ratingLabel(rating: number | null): string {
  if (rating === null) return RATING_LABELS.null;
  return RATING_LABELS[rating as keyof typeof RATING_LABELS] ?? "Unknown";
}

/** "2025 H2-B Performance Review" → "H2-B" */
function shortCycleLabel(cycle: string): string {
  const match = cycle.match(/\b(H[12][-–][A-Z]|H[12]|Q[1-4])\b/i);
  if (match) return match[1].toUpperCase().replace("–", "-");
  return cycle.slice(0, 6);
}

function cycleYear(cycle: string): string {
  const match = cycle.match(/\b(20\d{2})\b/);
  return match ? match[1] : "";
}

export interface EngineerPerformanceCardProps {
  ratings: PerformanceRating[];
  reviewCycles: string[];
}

export function EngineerPerformanceCard({
  ratings,
  reviewCycles,
}: EngineerPerformanceCardProps) {
  // Order ratings by the canonical cycle list; append any extras
  const allRatings = useMemo(() => {
    const ordered = reviewCycles
      .map((c) => ratings.find((r) => r.reviewCycle === c))
      .filter(Boolean) as PerformanceRating[];
    const extras = ratings.filter(
      (r) => !reviewCycles.includes(r.reviewCycle)
    );
    return [...ordered, ...extras];
  }, [ratings, reviewCycles]);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    if (!svgRef.current || !containerRef.current || allRatings.length === 0) return;

    const container = containerRef.current;
    const width = getContentBoxWidth(container);
    const height = 320;
    const margin = { top: 24, right: 24, bottom: 68, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    select(svgRef.current).selectAll("*").remove();

    const svg = select(svgRef.current).attr("width", width).attr("height", height);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = scaleBand()
      .domain(allRatings.map((_, i) => String(i)))
      .range([0, innerWidth])
      .padding(0.35);

    // Fixed 0–5 scale so bars are comparable across profiles
    const y = scaleLinear().domain([0, 5]).range([innerHeight, 0]);

    // Horizontal grid lines at each integer rating
    g.append("g")
      .call(
        axisLeft(y)
          .tickValues([1, 2, 3, 4, 5])
          .tickSize(-innerWidth)
          .tickFormat(() => "")
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick line")
          .attr("stroke", "#eee")
          .attr("stroke-width", 0.5)
      );

    // Y axis — integer rating labels
    g.append("g")
      .call(
        axisLeft(y)
          .tickValues([1, 2, 3, 4, 5])
          .tickFormat((d) => String(d))
          .tickSizeOuter(0)
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick text")
          .attr("fill", "#888")
          .attr("font-size", "11px")
      )
      .call((sel) => sel.selectAll(".tick line").remove());

    // X-axis labels — cycle shortname + year
    const labelGroup = g
      .append("g")
      .attr("transform", `translate(0,${innerHeight + 8})`);

    labelGroup
      .selectAll("g.tick")
      .data(allRatings)
      .join("g")
      .attr("class", "tick")
      .attr(
        "transform",
        (_, i) => `translate(${x(String(i))! + x.bandwidth() / 2},0)`
      )
      .each(function (d) {
        const sel = select(this);
        sel
          .append("text")
          .attr("y", 14)
          .attr("text-anchor", "middle")
          .attr("fill", "#555")
          .attr("font-size", "11px")
          .attr("font-weight", "500")
          .text(shortCycleLabel(d.reviewCycle));
        const year = cycleYear(d.reviewCycle);
        if (year) {
          sel
            .append("text")
            .attr("y", 28)
            .attr("text-anchor", "middle")
            .attr("fill", "#aaa")
            .attr("font-size", "10px")
            .text(year);
        }
      });

    const tooltip = select(tooltipRef.current);

    // Bars for ratings 1–5
    const zeroY = y(0);

    g.selectAll("rect.rating")
      .data(allRatings)
      .join("rect")
      .attr("class", "rating")
      .attr("x", (_, i) => x(String(i))!)
      .attr("y", (d) => (d.rating !== null ? y(d.rating) : y(0)))
      .attr("width", x.bandwidth())
      .attr("height", (d) =>
        d.rating !== null ? zeroY - y(d.rating) : 0
      )
      .attr("fill", (d) => ratingColour(d.rating))
      .attr("rx", 3)
      .attr("opacity", 0.9)
      .style("cursor", "pointer")
      .on("mouseenter", function (event: MouseEvent, d) {
        select(this).attr("opacity", 1);
        const ratingText =
          d.rating !== null ? `${d.rating} — ${ratingLabel(d.rating)}` : "Missed";
        const reviewer = d.reviewerName
          ? `<div style="font-size:11px;color:#666;margin-top:3px">reviewed by ${d.reviewerName}</div>`
          : "";
        const flag = d.flagged
          ? `<div style="font-size:11px;color:#ea580c;margin-top:3px">⚑ Flagged</div>`
          : "";
        tooltip
          .html(
            `<div style="font-size:11px;color:#999;margin-bottom:2px">${d.reviewCycle}</div>
             <div style="font-size:13px;font-weight:600;color:${ratingColour(d.rating)}">${ratingText}</div>
             ${reviewer}${flag}`
          )
          .style("opacity", 1)
          .style("left", `${event.offsetX + 16}px`)
          .style("top", `${event.offsetY - 16}px`);
      })
      .on("mouseleave", function () {
        select(this).attr("opacity", 0.9);
        tooltip.style("opacity", 0);
      });

    // Value label above each bar
    g.selectAll("text.value")
      .data(allRatings)
      .join("text")
      .attr("class", "value")
      .attr("x", (_, i) => x(String(i))! + x.bandwidth() / 2)
      .attr("y", (d) =>
        d.rating !== null ? y(d.rating) - 6 : zeroY - 6
      )
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", (d) => ratingColour(d.rating))
      .text((d) => (d.rating !== null ? d.rating : "—"));

    // Missed/flagged markers at the baseline
    g.selectAll("circle.missed")
      .data(allRatings.filter((d) => d.rating === null))
      .join("circle")
      .attr("class", "missed")
      .attr("cx", (d) => {
        const i = allRatings.indexOf(d);
        return x(String(i))! + x.bandwidth() / 2;
      })
      .attr("cy", zeroY)
      .attr("r", 4)
      .attr("fill", RATING_COLOURS.null)
      .attr("stroke", "white")
      .attr("stroke-width", 1);
  }, [allRatings]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  if (allRatings.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50">
        <p className="text-sm text-muted-foreground">
          No performance ratings on record.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
          <div>
            <span className="text-sm font-semibold text-foreground">
              Rating history
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {allRatings.length} review{allRatings.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {[5, 4, 3, 2, 1].map((r) => (
              <span
                key={r}
                className="flex items-center gap-1 text-[10px] text-muted-foreground"
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: ratingColour(r) }}
                />
                {r}
              </span>
            ))}
          </div>
        </div>
        <div ref={containerRef} className="relative px-4 py-5">
          <svg ref={svgRef} className="w-full" />
          <div
            ref={tooltipRef}
            className="pointer-events-none absolute z-10 rounded-lg border border-border/60 bg-card px-3 py-2 shadow-warm-lg"
            style={{ opacity: 0, transition: "opacity 0.15s" }}
          />
        </div>
      </div>

      {/* Detail list — reviewer names, flags, missed */}
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="border-b border-border/50 px-5 py-3">
          <span className="text-sm font-semibold text-foreground">Cycle detail</span>
        </div>
        <div className="divide-y divide-border/20">
          {allRatings.map((r) => (
            <div
              key={r.reviewCycle}
              className="flex items-center gap-3 px-5 py-3"
            >
              <span
                title={ratingLabel(r.rating)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white shrink-0"
                style={{ backgroundColor: ratingColour(r.rating) }}
              >
                {r.rating ?? "—"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {r.reviewCycle}
                </div>
                {r.reviewerName && (
                  <div className="text-xs text-muted-foreground">
                    reviewed by {r.reviewerName}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {r.flagged && (
                  <span className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-600">
                    <Flag className="h-3 w-3" />
                    Flagged
                  </span>
                )}
                {r.missed && (
                  <span className="flex items-center gap-1 rounded-full bg-gray-400/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <AlertTriangle className="h-3 w-3" />
                    Missed
                  </span>
                )}
                {r.rating !== null && !r.flagged && !r.missed && (
                  <span className="text-xs text-muted-foreground/60">
                    {ratingLabel(r.rating)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
