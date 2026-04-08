"use client";

import {
  TrendingUp,
  PoundSterling,
  Activity,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ScrollReveal } from "./scroll-reveal";

interface Section {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  color: string;
  vizType: "bars" | "line" | "sparkline" | "ring" | "dots";
  description: string;
  highlights: string[];
  sources: string[];
}

const sections: Section[] = [
  {
    title: "Unit Economics",
    subtitle: "The fundamentals",
    icon: TrendingUp,
    color: "var(--chart-1)",
    vizType: "bars",
    description:
      "Is the business model working? Track LTV:CAC ratio weekly with a 3x guardrail, see 36-month LTV trend by cohort, and monitor paid CPA, marketing spend, and user acquisition — all with actual vs target overlays.",
    highlights: [
      "LTV:CAC ratio with guardrail line",
      "CPA, spend, and users vs management targets",
      "Multi-year cohort-level LTV trend",
    ],
    sources: ["Analytics platform", "Marketing performance data"],
  },
  {
    title: "Financial",
    subtitle: "Management accounts",
    icon: PoundSterling,
    color: "var(--chart-2)",
    vizType: "line",
    description:
      "Monthly P&L automatically extracted from spreadsheets shared in team channels. Revenue, margins, EBITDA, and cash position — available the moment the finance team posts the numbers.",
    highlights: [
      "Auto-parsed P&L from shared spreadsheets",
      "Period-over-period comparison",
      "Zero manual data entry — AI extraction",
    ],
    sources: ["Team messaging", "AI-powered document parsing"],
  },
  {
    title: "Product",
    subtitle: "Engagement & retention",
    icon: Activity,
    color: "var(--chart-1)",
    vizType: "sparkline",
    description:
      "The heartbeat of the product. Toggle between daily, weekly, and monthly active users. See engagement ratios trending over time and a full retention cohort heatmap showing how each monthly cohort retains.",
    highlights: [
      "DAU / WAU / MAU with cadence toggle",
      "WAU/MAU and DAU/MAU stickiness ratios",
      "Retention cohort heatmap by month",
    ],
    sources: ["Analytics platform"],
  },
  {
    title: "OKRs",
    subtitle: "Objectives & key results",
    icon: Target,
    color: "var(--chart-3)",
    vizType: "ring",
    description:
      "Company, pillar, and squad-level objectives parsed directly from team updates. AI reads weekly posts and extracts structured OKR data — status, metrics, progress — without anyone changing their workflow.",
    highlights: [
      "Automatic extraction from team updates",
      "Company → Pillar → Squad drill-down",
      "RAG status and metric tracking",
    ],
    sources: ["Team messaging", "AI-powered text parsing"],
  },
  {
    title: "People",
    subtitle: "Org & workforce",
    icon: Users,
    color: "var(--chart-2)",
    vizType: "dots",
    description:
      "Headcount by department, tenure distribution, and joiners-vs-departures over time. Drill down by pillar to see squad-level team composition and identify where the organisation is growing or contracting.",
    highlights: [
      "Headcount breakdown by department and pillar",
      "Joiners vs departures trend",
      "Tenure distribution across the org",
    ],
    sources: ["HR analytics platform"],
  },
];

function LargeViz({ type, color }: { type: string; color: string }) {
  if (type === "bars") {
    return (
      <svg viewBox="0 0 200 80" className="w-full max-w-[200px]">
        {[10, 18, 14, 26, 22, 32, 28, 38, 34, 46, 42, 50, 48, 58, 54, 62].map((h, i) => (
          <rect
            key={i}
            x={i * 12.5}
            y={80 - h}
            width="9"
            height={h}
            rx="2"
            fill={color}
            opacity={0.12 + (i / 16) * 0.4}
            className="origin-bottom"
            style={{ animation: `landing-bar-grow 1s ease-out ${i * 0.04}s both` }}
          />
        ))}
      </svg>
    );
  }

  if (type === "line") {
    return (
      <svg viewBox="0 0 200 80" className="w-full max-w-[200px]" fill="none">
        <path
          d="M0 70 C15 66, 25 50, 40 46 S60 52, 75 40 S95 30, 110 26 S130 22, 145 18 S165 14, 180 10 L200 6"
          stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.35"
          style={{ strokeDasharray: 260, strokeDashoffset: 260, animation: "landing-line-draw 2s ease-out 0.2s forwards" }}
        />
        <path
          d="M0 72 C15 70, 25 58, 40 56 S60 60, 75 52 S95 44, 110 42 S130 38, 145 34 S165 30, 180 28 L200 24"
          stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.12" strokeDasharray="3,5"
        />
      </svg>
    );
  }

  if (type === "sparkline") {
    return (
      <svg viewBox="0 0 200 80" className="w-full max-w-[200px]" fill="none">
        <path
          d="M4 50 L18 46 L32 54 L46 40 L60 48 L74 32 L88 38 L102 24 L116 30 L130 18 L144 22 L158 14 L172 18 L186 10"
          stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35"
          style={{ strokeDasharray: 260, strokeDashoffset: 260, animation: "landing-line-draw 1.8s ease-out 0.2s forwards" }}
        />
        <path
          d="M4 50 L18 46 L32 54 L46 40 L60 48 L74 32 L88 38 L102 24 L116 30 L130 18 L144 22 L158 14 L172 18 L186 10 L186 80 L4 80Z"
          fill={color} opacity="0"
          style={{ animation: "landing-dot-appear 1s ease-out 1.2s forwards" }}
        />
        <circle cx="186" cy="10" r="3.5" fill={color} opacity="0"
          style={{ animation: "landing-dot-appear 0.4s ease-out 2s forwards" }}
        />
      </svg>
    );
  }

  if (type === "ring") {
    const r = 30;
    const circ = 2 * Math.PI * r;
    return (
      <svg viewBox="0 0 80 80" className="w-full max-w-[80px]">
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="4" opacity="0.08" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="4"
          opacity="0.4" strokeLinecap="round" transform="rotate(-90 40 40)"
          style={{ strokeDasharray: circ, strokeDashoffset: circ, animation: `landing-ring-fill-xl 2s ease-out 0.3s forwards` }}
        />
      </svg>
    );
  }

  // dots
  return (
    <svg viewBox="0 0 200 80" className="w-full max-w-[200px]">
      {[
        [25, 14], [50, 10], [75, 16], [100, 8], [125, 14], [150, 12], [175, 10],
        [15, 32], [40, 28], [65, 34], [90, 26], [115, 30], [140, 28], [165, 32], [190, 26],
        [25, 50], [50, 46], [75, 52], [100, 44], [125, 48], [150, 50], [175, 46],
        [15, 68], [40, 66], [65, 70], [90, 64], [115, 68], [140, 66], [165, 70], [190, 64],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.5" fill={color} opacity="0"
          style={{ animation: `landing-dot-appear 0.3s ease-out ${i * 0.03}s forwards` }}
        />
      ))}
    </svg>
  );
}

function SectionBlock({ section, index }: { section: Section; index: number }) {
  const isEven = index % 2 === 0;

  return (
    <div className="py-20 md:py-28">
      <div className="mx-auto max-w-5xl">
        {/* Section number */}
        <ScrollReveal>
          <div className="mb-8 flex items-center gap-4">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/25">
              0{index + 1}
            </span>
            <div className="h-px flex-1 bg-border/30" />
          </div>
        </ScrollReveal>

        <div className={`flex flex-col gap-10 md:gap-16 ${isEven ? "md:flex-row" : "md:flex-row-reverse"} md:items-center`}>
          {/* Viz side */}
          <ScrollReveal delay={100} className="flex flex-col items-center gap-5 md:w-2/5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/40 bg-card shadow-warm">
              <section.icon className="h-6 w-6 text-primary/40" />
            </div>
            <div className="w-full px-4">
              <LargeViz type={section.vizType} color={section.color} />
            </div>
            {/* Source pills */}
            <div className="flex flex-wrap justify-center gap-1.5">
              {section.sources.map((source) => (
                <span
                  key={source}
                  className="rounded-full border border-border/30 bg-card/60 px-3 py-1 text-[10px] font-medium text-muted-foreground/40"
                >
                  {source}
                </span>
              ))}
            </div>
          </ScrollReveal>

          {/* Content side */}
          <div className="flex-1 space-y-5">
            <ScrollReveal delay={150}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/35">
                {section.subtitle}
              </p>
              <h2 className="mt-1 font-display text-4xl tracking-tight text-foreground md:text-5xl">
                {section.title}
              </h2>
            </ScrollReveal>

            <ScrollReveal delay={250}>
              <p className="text-[15px] leading-[1.75] text-muted-foreground/70">
                {section.description}
              </p>
            </ScrollReveal>

            <ScrollReveal delay={350}>
              <ul className="space-y-2.5">
                {section.highlights.map((highlight) => (
                  <li key={highlight} className="flex items-start gap-3">
                    <div
                      className="mt-2 h-1 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: section.color, opacity: 0.6 }}
                    />
                    <span className="text-[13px] text-foreground/60">
                      {highlight}
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollReveal>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SectionPortals() {
  return (
    <div>
      {sections.map((section, i) => (
        <SectionBlock key={section.title} section={section} index={i} />
      ))}
    </div>
  );
}
