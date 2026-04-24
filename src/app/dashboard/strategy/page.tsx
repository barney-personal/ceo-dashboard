import Link from "next/link";
import {
  ArrowUpRight,
  ExternalLink,
  FileText,
  Play,
  Presentation,
  Target,
} from "lucide-react";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";

type StrategyLink = {
  title: string;
  description: string;
  source: "Notion" | "Google Doc" | "Google Slides";
  url: string;
  icon: React.ElementType;
};

type StrategyGroup = {
  label: string;
  links: StrategyLink[];
};

const STRATEGY_GROUPS: StrategyGroup[] = [
  {
    label: "Vision & Strategy",
    links: [
      {
        title: "Cleo Vision & Strategy",
        description:
          "The long-form articulation of where Cleo is heading and why.",
        source: "Notion",
        url: "https://www.notion.so/meetcleo/Cleo-Vision-Strategy-1a85c63b874580cb845acf6b49c223ba",
        icon: FileText,
      },
      {
        title: "Company Strategy Doc",
        description:
          "Narrative strategy deck in doc form. Due a refresh — planned for T2.",
        source: "Google Doc",
        url: "https://docs.google.com/document/d/1j-WDg0UVYcW92AD0irxqy4y6kYFgwtVdoTk6gtFnM0U/edit?tab=t.0#heading=h.5tzyc2kk6yk8",
        icon: FileText,
      },
      {
        title: "Onboarding Strategy Deck",
        description:
          "Slide deck used for new-joiner onboarding. Due a refresh alongside the strategy doc.",
        source: "Google Slides",
        url: "https://docs.google.com/presentation/d/1CQlXumjidQODsVcZcl-lu6Y8EOfjDCNv1YTzu4drblc/edit?slide=id.g36c54e66c16_0_1482#slide=id.g36c54e66c16_0_1482",
        icon: Presentation,
      },
    ],
  },
  {
    label: "Company OKRs & Bets",
    links: [
      {
        title: "T1 2026 Company OKRs & Bets",
        description: "Trimester 1 company-level objectives, key results, and bets.",
        source: "Notion",
        url: "https://www.notion.so/meetcleo/T1-2026-Company-OKRs-Bets-28c5c63b8745805e896cd1e1f630bec1",
        icon: Target,
      },
      {
        title: "T2 2026 Company OKRs & Bets",
        description: "Trimester 2 company-level objectives, key results, and bets.",
        source: "Notion",
        url: "https://www.notion.so/meetcleo/T2-26-Company-OKRs-Bets-30d5c63b8745809490efd006d6f4f1ec",
        icon: Target,
      },
    ],
  },
];

export default async function StrategyPage() {
  await requireDashboardPermission("dashboard.strategy");

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-8">
      <PageHeader
        title="Strategy"
        description="Links to Cleo's living strategy, vision, and company OKR documents."
      />

      <Link
        href="/strategy-deck"
        className="group relative block overflow-hidden rounded-2xl ring-1 ring-foreground/10 transition-all hover:ring-foreground/20"
        style={{
          background:
            "linear-gradient(135deg, #141310 0%, #1f1b17 55%, #0f2a1b 100%)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 30%, rgba(255,255,255,0.08) 0.5px, transparent 1px), radial-gradient(circle at 72% 62%, rgba(255,255,255,0.06) 0.5px, transparent 1px)",
            backgroundSize: "120px 120px, 180px 180px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl"
          style={{ background: "rgba(18, 194, 91, 0.22)" }}
        />
        <div className="relative flex flex-col gap-6 p-7 md:flex-row md:items-end md:justify-between md:p-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span
                className="font-mono text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: "rgba(241,234,217,0.6)" }}
              >
                Featured · Presentation
              </span>
              <span
                className="inline-block h-3 w-px"
                style={{ background: "rgba(241,234,217,0.3)" }}
              />
              <span
                className="text-[10px] font-medium uppercase tracking-[0.24em]"
                style={{ color: "rgba(241,234,217,0.6)" }}
              >
                15 slides
              </span>
            </div>
            <h2
              className="mt-3 text-3xl italic md:text-4xl"
              style={{
                fontFamily: "var(--font-display)",
                color: "#F1EAD9",
              }}
            >
              Cleo
              <span style={{ color: "#12c25b" }}>.</span>{" "}
              <span style={{ color: "rgba(241,234,217,0.7)" }}>
                vision, goals &amp; strategy
              </span>
            </h2>
            <p
              className="mt-2 max-w-lg text-sm leading-relaxed"
              style={{ color: "rgba(241,234,217,0.65)" }}
            >
              An interactive deck built from the H1 2025 strategy doc — mission,
              market, the crux, four strategic moves, and what we will not do.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 self-start md:self-end">
            <span
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all group-hover:translate-x-0.5"
              style={{ background: "#F1EAD9", color: "#141310" }}
            >
              <Play className="h-3.5 w-3.5" />
              Present
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </Link>

      <div className="space-y-10">
        {STRATEGY_GROUPS.map((group) => (
          <section key={group.label} className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              {group.label}
            </h3>
            <ul className="space-y-2">
              {group.links.map((link) => {
                const Icon = link.icon;
                return (
                  <li key={link.url}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-4 rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10 transition-all hover:ring-foreground/20 hover:shadow-sm"
                    >
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/8">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground group-hover:text-primary">
                            {link.title}
                          </span>
                          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {link.source}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {link.description}
                        </p>
                      </div>
                      <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
