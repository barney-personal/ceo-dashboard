"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Grid3x3,
  X,
} from "lucide-react";

type SlideTheme = "light" | "dark";

interface SlideDef {
  id: string;
  label: string;
  theme: SlideTheme;
  render: () => React.ReactNode;
}

export function StrategyDeck() {
  const slides = useMemo<SlideDef[]>(() => SLIDES, []);
  const total = slides.length;

  const [idx, setIdx] = useState(0);
  const [overview, setOverview] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);

  const go = useCallback(
    (next: number) => {
      setIdx((prev) => {
        const clamped = Math.max(0, Math.min(total - 1, next));
        return clamped === prev ? prev : clamped;
      });
      setOverview(false);
    },
    [total]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
      }
      if (overview) {
        if (e.key === "Escape" || e.key.toLowerCase() === "o") {
          e.preventDefault();
          setOverview(false);
        }
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          go(idx + 1);
          break;
        case " ":
          e.preventDefault();
          if (e.shiftKey) go(idx - 1);
          else go(idx + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          go(idx - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(total - 1);
          break;
        case "o":
        case "O":
          e.preventDefault();
          setOverview(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, total, overview, go]);

  useEffect(() => {
    if (idx > 0 && hintVisible) {
      const t = setTimeout(() => setHintVisible(false), 600);
      return () => clearTimeout(t);
    }
  }, [idx, hintVisible]);

  const current = slides[idx];
  const isDark = current.theme === "dark";

  const onZoneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("a,button,[data-deck-interactive]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.35) go(idx - 1);
    else if (x > rect.width * 0.65) go(idx + 1);
  };

  if (overview) {
    return (
      <OverviewGrid
        slides={slides}
        currentIdx={idx}
        onPick={(i) => go(i)}
        onClose={() => setOverview(false)}
      />
    );
  }

  return (
    <div
      className={`strategy-deck ${isDark ? "strategy-deck-invert" : ""} relative h-screen w-screen select-none overflow-hidden`}
      style={{ background: "var(--paper)", color: "var(--ink)" }}
    >
      <div
        className="strategy-deck-grain pointer-events-none absolute inset-0 opacity-60"
        aria-hidden
      />

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)"
            : "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.06) 100%)",
        }}
        aria-hidden
      />

      <div
        className="absolute inset-0 flex cursor-default flex-col"
        onClick={onZoneClick}
      >
        <DeckChromeTop idx={idx} total={total} label={current.label} />

        <main className="relative flex min-h-0 flex-1 items-center justify-center px-[4vw] py-6">
          <div
            key={current.id}
            className="relative flex h-full w-full max-w-[1240px] items-center justify-center"
          >
            {current.render()}
          </div>
        </main>

        <DeckChromeBottom
          idx={idx}
          total={total}
          slides={slides}
          onPick={(i) => go(i)}
          onOverview={() => setOverview(true)}
          hintVisible={hintVisible}
        />
      </div>

      <HoverArrow
        side="left"
        onClick={() => go(idx - 1)}
        disabled={idx === 0}
      />
      <HoverArrow
        side="right"
        onClick={() => go(idx + 1)}
        disabled={idx === total - 1}
      />
    </div>
  );
}

// ------- Chrome ---------------------------------------------------------

function DeckChromeTop({
  idx,
  total,
  label,
}: {
  idx: number;
  total: number;
  label: string;
}) {
  return (
    <header className="relative z-10 flex items-center justify-between px-[4vw] pt-7">
      <div className="flex items-center gap-6">
        <Link
          href="/dashboard/strategy"
          data-deck-interactive
          className="group flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em]"
          style={{ color: "var(--ink-muted)" }}
        >
          <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
          Back to strategy
        </Link>
        <span
          className="hidden h-3 w-px md:inline-block"
          style={{ background: "var(--rule)" }}
        />
        <span
          className="hidden text-[10px] font-medium uppercase tracking-[0.24em] md:inline-block"
          style={{ color: "var(--ink-muted)" }}
        >
          Cleo · Company Strategy · H1 2025
        </span>
      </div>
      <div className="flex items-center gap-6">
        <span
          className="text-[10px] font-medium uppercase tracking-[0.24em]"
          style={{ color: "var(--ink-muted)" }}
        >
          {label}
        </span>
        <span
          className="tabular-nums text-[10px] font-medium uppercase tracking-[0.24em]"
          style={{ color: "var(--ink-muted)" }}
        >
          {String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
    </header>
  );
}

function DeckChromeBottom({
  idx,
  total,
  slides,
  onPick,
  onOverview,
  hintVisible,
}: {
  idx: number;
  total: number;
  slides: SlideDef[];
  onPick: (i: number) => void;
  onOverview: () => void;
  hintVisible: boolean;
}) {
  return (
    <footer className="relative z-10 flex items-end justify-between gap-4 px-[4vw] pb-6">
      <div
        className={`flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.24em] transition-opacity duration-500 ${
          hintVisible ? "opacity-100" : "opacity-40"
        }`}
        style={{ color: "var(--ink-muted)" }}
      >
        <KeyCap>←</KeyCap>
        <KeyCap>→</KeyCap>
        <span className="hidden sm:inline">to navigate</span>
        <span
          className="mx-2 hidden h-3 w-px sm:inline-block"
          style={{ background: "var(--rule)" }}
        />
        <button
          data-deck-interactive
          onClick={onOverview}
          className="group inline-flex items-center gap-1.5 hover:opacity-70"
          style={{ color: "var(--ink)" }}
        >
          <Grid3x3 className="h-3 w-3" />
          Overview
          <span className="opacity-50">(O)</span>
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center gap-[3px] px-8">
        {slides.map((s, i) => (
          <button
            key={s.id}
            data-deck-interactive
            onClick={() => onPick(i)}
            aria-label={`Go to slide ${i + 1}: ${s.label}`}
            className="group flex h-6 items-center"
          >
            <span
              className="transition-all duration-300"
              style={{
                height: "2px",
                width: i === idx ? "40px" : "12px",
                background: i <= idx ? "var(--ink)" : "var(--rule)",
                opacity: i === idx ? 1 : i < idx ? 0.55 : 1,
              }}
            />
          </button>
        ))}
      </div>

      <div
        className="font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{ color: "var(--ink-muted)" }}
      >
        <span className="tabular-nums">
          {String(idx + 1).padStart(2, "0")}
        </span>
        <span className="mx-1 opacity-40">/</span>
        <span className="tabular-nums opacity-60">
          {String(total).padStart(2, "0")}
        </span>
      </div>
    </footer>
  );
}

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 text-[10px]"
      style={{ borderColor: "var(--rule)", color: "var(--ink)" }}
    >
      {children}
    </span>
  );
}

function HoverArrow({
  side,
  onClick,
  disabled,
}: {
  side: "left" | "right";
  onClick: () => void;
  disabled: boolean;
}) {
  const Icon = side === "left" ? ArrowLeft : ArrowRight;
  return (
    <button
      data-deck-interactive
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className={`absolute top-1/2 z-10 -translate-y-1/2 ${
        side === "left" ? "left-4" : "right-4"
      } flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${
        disabled
          ? "pointer-events-none opacity-0"
          : "opacity-0 hover:opacity-100"
      }`}
      style={{
        background: "var(--paper-warm)",
        color: "var(--ink)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)",
      }}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ------- Overview grid --------------------------------------------------

function OverviewGrid({
  slides,
  currentIdx,
  onPick,
  onClose,
}: {
  slides: SlideDef[];
  currentIdx: number;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="strategy-deck strategy-deck-grain relative h-screen w-screen overflow-y-auto"
      style={{ background: "var(--paper)", color: "var(--ink)" }}
    >
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b px-[4vw] py-5"
        style={{ borderColor: "var(--rule)", background: "var(--paper)" }}
      >
        <div className="flex items-baseline gap-4">
          <h2
            className="text-2xl italic"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Overview
          </h2>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.24em]"
            style={{ color: "var(--ink-muted)" }}
          >
            {slides.length} slides
          </span>
        </div>
        <button
          data-deck-interactive
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full hover:opacity-70"
          style={{ color: "var(--ink)" }}
          aria-label="Close overview"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="mx-auto max-w-[1400px] p-[4vw]">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {slides.map((s, i) => {
            const isDark = s.theme === "dark";
            return (
              <button
                key={s.id}
                data-deck-interactive
                onClick={() => onPick(i)}
                className={`group relative aspect-[16/10] overflow-hidden rounded-md text-left transition-all ${
                  isDark ? "strategy-deck-invert" : ""
                }`}
                style={{
                  background: isDark ? "#141310" : "var(--paper-deep)",
                  boxShadow:
                    i === currentIdx
                      ? "0 0 0 2px var(--ink)"
                      : "0 1px 2px rgba(0,0,0,0.06)",
                  color: isDark ? "#f1ead9" : "var(--ink)",
                }}
              >
                <div className="absolute inset-0 flex flex-col p-3 transition-transform duration-300 group-hover:scale-[1.02]">
                  <div className="flex items-start justify-between">
                    <span className="text-[8px] font-medium uppercase tracking-[0.24em] opacity-60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[8px] font-medium uppercase tracking-[0.24em] opacity-60">
                      {s.label}
                    </span>
                  </div>
                  <div
                    className="mt-auto flex flex-1 items-center justify-center pt-4 text-center"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    <span className="line-clamp-3 text-base italic leading-tight">
                      {SLIDE_PREVIEW[s.id]}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------- Slide preview map (used in overview grid) ---------------------

const SLIDE_PREVIEW: Record<string, string> = {
  cover: "Cleo.",
  mission: "To change the world’s relationship with money.",
  vision: "An AI assistant between people and their money.",
  target: "IPO. Within five years.",
  market: "TAM · SAM · SOM",
  users: "Who uses Cleo today.",
  crux: "By 2026, we exhaust our core audience.",
  "strategy-core": "Build a financial AI assistant.",
  "move-1": "Break the high-cost credit trap.",
  "move-2": "Save users money on recurring expenses.",
  "move-3": "Win on data.",
  "move-4": "Expand beyond the US.",
  flywheel: "The compounding loop.",
  "wont-do": "What we will not do.",
  closing: "The loop starts now.",
};

// ------- Slides ---------------------------------------------------------

function CoverSlide() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      <div
        data-reveal="fade"
        className="mb-10 h-px w-24 origin-left"
        style={{ animationDelay: "120ms" }}
      >
        <div
          data-rule
          className="h-px w-full"
          style={{ background: "var(--ink)", animationDelay: "250ms" }}
        />
      </div>

      <div
        data-reveal="wide"
        className="text-center"
        style={{
          animationDelay: "200ms",
          fontFamily: "var(--font-display)",
        }}
      >
        <h1 className="text-[14vw] leading-[0.85] tracking-[-0.03em] md:text-[180px]">
          <span className="italic">Cleo</span>
          <span style={{ color: "var(--accent)" }}>.</span>
        </h1>
      </div>

      <div
        data-reveal
        className="mt-8 text-center"
        style={{ animationDelay: "550ms" }}
      >
        <p
          className="text-base italic md:text-lg"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-soft)",
          }}
        >
          vision, goals &amp; strategy
        </p>
        <p
          className="mt-4 text-[10px] font-medium uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Written · H1 Twenty Twenty-Five
        </p>
      </div>

      <div
        data-reveal="fade"
        className="mt-16 h-px w-24 origin-left"
        style={{ animationDelay: "950ms" }}
      >
        <div
          data-rule
          className="h-px w-full"
          style={{ background: "var(--ink)", animationDelay: "1100ms" }}
        />
      </div>

      <div
        data-reveal="fade"
        className="mt-8 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em]"
        style={{ animationDelay: "1200ms" }}
      >
        <span style={{ color: "var(--ink-muted)" }}>press</span>
        <KeyCap>→</KeyCap>
        <span style={{ color: "var(--ink-muted)" }}>to begin</span>
      </div>
    </div>
  );
}

function MissionSlide() {
  return (
    <SectionFrame number="01" label="Mission">
      <div className="mx-auto max-w-5xl text-center">
        <p
          data-reveal="wide"
          className="text-[6.2vw] leading-[1.05] tracking-[-0.015em] md:text-[88px]"
          style={{
            animationDelay: "180ms",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="italic">To change the</span>
          <br />
          <span className="italic">world’s relationship</span>
          <br />
          <span className="italic">with </span>
          <span className="relative italic" style={{ color: "var(--accent)" }}>
            money
            <span
              data-reveal="fade"
              aria-hidden
              className="absolute -bottom-1 left-0 right-0"
              style={{
                animationDelay: "900ms",
                background: "var(--accent)",
                height: "3px",
              }}
            />
          </span>
          <span className="italic">.</span>
        </p>

        <p
          data-reveal
          className="mx-auto mt-10 max-w-md text-sm leading-relaxed"
          style={{
            animationDelay: "700ms",
            color: "var(--ink-muted)",
          }}
        >
          The mission is non-negotiable. Everything we build — every product,
          feature, and bet — must serve it.
        </p>
      </div>
    </SectionFrame>
  );
}

function VisionSlide() {
  return (
    <SectionFrame number="02" label="Vision">
      <div className="mx-auto max-w-5xl">
        <p
          data-reveal="wide"
          className="text-[5vw] leading-[1.1] tracking-[-0.01em] md:text-[72px]"
          style={{
            animationDelay: "180ms",
            fontFamily: "var(--font-display)",
          }}
        >
          <span>An </span>
          <span className="italic" style={{ color: "var(--accent)" }}>
            AI assistant
          </span>
          <span> that acts as the </span>
          <span className="italic">primary and trusted interface</span>
          <span> between people and their money.</span>
        </p>
        <div
          data-reveal="fade"
          className="mt-14 h-px w-full"
          style={{
            animationDelay: "900ms",
            background: "var(--rule)",
          }}
        />
        <div
          data-reveal
          className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3"
          style={{ animationDelay: "1000ms" }}
        >
          <VisionPillar
            label="Proactive"
            text="Shows up with the right thing at the right moment."
          />
          <VisionPillar
            label="Honest"
            text="Never nudges against the user’s interests."
          />
          <VisionPillar
            label="Simple & fun"
            text="Friendly enough to use every day, smart enough to matter."
          />
        </div>
      </div>
    </SectionFrame>
  );
}

function VisionPillar({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div
        className="text-[10px] font-medium uppercase tracking-[0.24em]"
        style={{ color: "var(--accent)" }}
      >
        {label}
      </div>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--ink-soft)" }}
      >
        {text}
      </p>
    </div>
  );
}

function TargetSlide() {
  return (
    <SectionFrame number="03" label="Long-term target">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-2">
        <div>
          <p
            data-reveal="wide"
            className="text-[8vw] leading-[0.95] tracking-[-0.02em] md:text-[110px]"
            style={{
              animationDelay: "180ms",
              fontFamily: "var(--font-display)",
            }}
          >
            <span className="italic">IPO.</span>
            <br />
            <span className="italic" style={{ color: "var(--ink-muted)" }}>
              Within
            </span>{" "}
            <span className="italic">five years</span>
            <span style={{ color: "var(--accent)" }}>.</span>
          </p>
        </div>
        <div
          data-reveal
          className="space-y-6"
          style={{ animationDelay: "500ms" }}
        >
          <div>
            <div
              className="text-[10px] font-medium uppercase tracking-[0.24em]"
              style={{ color: "var(--ink-muted)" }}
            >
              The commitment
            </div>
            <p
              className="mt-2 text-lg leading-snug"
              style={{ color: "var(--ink)" }}
            >
              Deliver revenue growth in line with some of the most successful
              technology companies in history — while staying{" "}
              <em>profitable</em>, diversifying the business model, and
              improving retention.
            </p>
          </div>
          <div className="h-px" style={{ background: "var(--rule)" }} />
          <div>
            <div
              className="text-[10px] font-medium uppercase tracking-[0.24em]"
              style={{ color: "var(--ink-muted)" }}
            >
              The benchmark
            </div>
            <div className="mt-3 flex items-baseline gap-5">
              {["Revolut", "Alphabet", "Meta"].map((name, i) => (
                <span
                  key={name}
                  data-reveal
                  className="text-2xl italic"
                  style={{
                    animationDelay: `${700 + i * 120}ms`,
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SectionFrame>
  );
}

function MarketSlide() {
  return (
    <SectionFrame number="04" label="Market">
      <div className="mx-auto w-full max-w-5xl">
        <p
          data-reveal
          className="text-center text-4xl italic leading-tight md:text-5xl"
          style={{
            animationDelay: "180ms",
            fontFamily: "var(--font-display)",
          }}
        >
          From the <em>whole world</em> to the users{" "}
          <em style={{ color: "var(--accent)" }}>Cleo serves best</em>.
        </p>

        <div className="mt-16 space-y-6">
          <MarketRow
            delay={400}
            label="TAM"
            description="Total Addressable Market"
            audience="Global users of financial services"
            users="3bn"
            revenue="$2.8tn"
            intensity={0.25}
          />
          <MarketRow
            delay={600}
            label="SAM"
            description="Serviceable Available Market"
            audience="US adult population"
            users="260m"
            revenue="$800bn"
            intensity={0.55}
          />
          <MarketRow
            delay={800}
            label="SOM"
            description="Serviceable Obtainable Market"
            audience="US ‘vulnerable’ & ‘coping’ consumers"
            users="180m"
            revenue="$70bn"
            intensity={1}
            highlight
          />
        </div>

        <p
          data-reveal
          className="mt-10 text-center text-sm"
          style={{
            animationDelay: "1100ms",
            color: "var(--ink-muted)",
          }}
        >
          Of that 180m, we believe our current product can reach{" "}
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>
            27 million
          </span>
          . We have <em>22m headroom</em> versus today.
        </p>
      </div>
    </SectionFrame>
  );
}

function MarketRow({
  delay,
  label,
  description,
  audience,
  users,
  revenue,
  intensity,
  highlight,
}: {
  delay: number;
  label: string;
  description: string;
  audience: string;
  users: string;
  revenue: string;
  intensity: number;
  highlight?: boolean;
}) {
  return (
    <div
      data-reveal
      className="grid grid-cols-12 items-baseline gap-4 border-b pb-4"
      style={{
        animationDelay: `${delay}ms`,
        borderColor: "var(--rule)",
      }}
    >
      <div className="col-span-12 md:col-span-1">
        <span
          className="font-mono text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: highlight ? "var(--accent)" : "var(--ink-muted)" }}
        >
          {label}
        </span>
      </div>
      <div className="col-span-12 md:col-span-5">
        <div
          className="text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--ink-muted)" }}
        >
          {description}
        </div>
        <div className="mt-1 text-sm" style={{ color: "var(--ink)" }}>
          {audience}
        </div>
      </div>
      <div className="col-span-6 md:col-span-3">
        <span
          className="text-3xl italic md:text-4xl"
          style={{
            fontFamily: "var(--font-display)",
            color: highlight ? "var(--accent)" : "var(--ink)",
            opacity: 0.5 + intensity * 0.5,
          }}
        >
          {users}
        </span>
        <span
          className="ml-2 text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--ink-muted)" }}
        >
          users
        </span>
      </div>
      <div className="col-span-6 md:col-span-3">
        <span
          className="text-3xl italic md:text-4xl"
          style={{
            fontFamily: "var(--font-display)",
            color: highlight ? "var(--accent)" : "var(--ink)",
            opacity: 0.5 + intensity * 0.5,
          }}
        >
          {revenue}
        </span>
        <span
          className="ml-2 text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--ink-muted)" }}
        >
          revenue
        </span>
      </div>
    </div>
  );
}

function UsersSlide() {
  const stats = [
    { value: "80%", label: "aged 18–44", base: "vs. 44% of Americans" },
    { value: "51%", label: "from the South", base: "vs. 38% of Americans" },
    { value: "65%", label: "earn $25k–$60k", base: "vs. 34% of Americans" },
    { value: "79%", label: "no bachelor’s", base: "vs. 65% of Americans" },
  ];
  return (
    <SectionFrame number="05" label="Our users">
      <div className="mx-auto w-full max-w-5xl">
        <p
          data-reveal
          className="text-center text-4xl italic leading-tight md:text-5xl"
          style={{
            animationDelay: "150ms",
            fontFamily: "var(--font-display)",
          }}
        >
          Our users skew <em style={{ color: "var(--accent)" }}>young</em>,
          southern, and <em>financially stretched</em>.
        </p>

        <div className="mt-16 grid grid-cols-2 gap-x-10 gap-y-14 md:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              data-reveal
              className="relative"
              style={{ animationDelay: `${400 + i * 140}ms` }}
            >
              <div
                className="absolute -left-4 top-0 h-full w-px"
                style={{ background: "var(--rule)" }}
                aria-hidden
              />
              <div
                className="font-mono text-[10px] font-medium uppercase tracking-[0.24em]"
                style={{ color: "var(--ink-muted)" }}
              >
                0{i + 1}
              </div>
              <div
                className="mt-2 text-5xl italic leading-none md:text-6xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {s.value}
              </div>
              <div className="mt-3 text-sm" style={{ color: "var(--ink)" }}>
                {s.label}
              </div>
              <div
                className="mt-1 text-[11px]"
                style={{ color: "var(--ink-muted)" }}
              >
                {s.base}
              </div>
            </div>
          ))}
        </div>

        <p
          data-reveal
          className="mt-16 text-center text-sm"
          style={{
            animationDelay: "1000ms",
            color: "var(--ink-muted)",
          }}
        >
          We believe our existing product can capture{" "}
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>27m</span> of
          the users across five demographic clusters.
        </p>
      </div>
    </SectionFrame>
  );
}

function CruxSlide() {
  return (
    <SectionFrame number="06" label="The crux">
      <div className="mx-auto w-full max-w-5xl text-center">
        <div
          data-reveal="fade"
          className="mb-8 inline-block px-3 py-1"
          style={{ animationDelay: "150ms" }}
        >
          <span
            className="font-mono text-[11px] font-medium uppercase tracking-[0.3em]"
            style={{ color: "var(--accent-bright)" }}
          >
            ▲ Challenge
          </span>
        </div>
        <p
          data-reveal="wide"
          className="text-[6vw] leading-[1.03] tracking-[-0.015em] md:text-[84px]"
          style={{
            animationDelay: "250ms",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="italic">By </span>
          <span className="italic" style={{ color: "var(--accent-bright)" }}>
            2026
          </span>
          <span className="italic">, we begin to </span>
          <span className="italic">exhaust our core</span>
          <br />
          <span className="italic">U.S. audience.</span>
        </p>

        <div
          data-reveal
          className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 text-left md:grid-cols-3"
          style={{ animationDelay: "900ms" }}
        >
          {[
            {
              n: "70%",
              text: "of users acquired through paid marketing.",
            },
            {
              n: "80%",
              text: "of paid spend flows to EWA ads.",
            },
            {
              n: "26%",
              text: "M1 chat retention today (target: 42%).",
            },
          ].map((d) => (
            <div
              key={d.n}
              className="border-l pl-4"
              style={{ borderColor: "var(--rule)" }}
            >
              <div
                className="text-4xl italic"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--accent-bright)",
                }}
              >
                {d.n}
              </div>
              <p
                className="mt-2 text-sm"
                style={{ color: "var(--ink-soft)" }}
              >
                {d.text}
              </p>
            </div>
          ))}
        </div>

        <p
          data-reveal="fade"
          className="mx-auto mt-12 max-w-2xl text-sm leading-relaxed"
          style={{
            animationDelay: "1400ms",
            color: "var(--ink-muted)",
          }}
        >
          Without expanding beyond this group or driving meaningful retention,
          acquisition costs rise unsustainably and growth stalls. Every user we
          retain is one we don’t have to acquire.
        </p>
      </div>
    </SectionFrame>
  );
}

function StrategyCoreSlide() {
  return (
    <SectionFrame number="07" label="The strategy">
      <div className="mx-auto w-full max-w-6xl">
        <div
          data-reveal
          className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.24em]"
          style={{ animationDelay: "150ms" }}
        >
          <span style={{ color: "var(--accent)" }}>↳</span>{" "}
          <span style={{ color: "var(--ink-muted)" }}>Guiding policy</span>
        </div>
        <p
          data-reveal="wide"
          className="text-[5.5vw] leading-[1.02] tracking-[-0.02em] md:text-[78px]"
          style={{
            animationDelay: "250ms",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="italic">Build an </span>
          <span className="italic" style={{ color: "var(--accent)" }}>
            AI assistant
          </span>
          <br />
          <span className="italic">that delivers </span>
          <span className="italic">better financial health</span>
          <span style={{ color: "var(--accent)" }}>.</span>
        </p>

        <div
          data-reveal="fade"
          className="mt-14 h-px w-full"
          style={{
            animationDelay: "700ms",
            background: "var(--rule)",
          }}
        />

        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Conversational experiences",
              d: "Help users spend less through chat that actually knows their money.",
            },
            {
              n: "02",
              t: "Proactive triggers",
              d: "Show up at the right moment with the right nudge, not a generic notification.",
            },
            {
              n: "03",
              t: "Gamified progression",
              d: "Make daily financial progress visible, rewarding, and habitual.",
            },
          ].map((p, i) => (
            <div
              key={p.n}
              data-reveal
              style={{ animationDelay: `${800 + i * 150}ms` }}
            >
              <div
                className="font-mono text-[11px] font-medium uppercase tracking-[0.24em]"
                style={{ color: "var(--accent)" }}
              >
                — {p.n}
              </div>
              <h3
                className="mt-2 text-xl leading-snug"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--ink)",
                }}
              >
                <em>{p.t}</em>
              </h3>
              <p
                className="mt-3 text-sm leading-relaxed"
                style={{ color: "var(--ink-muted)" }}
              >
                {p.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionFrame>
  );
}

function MoveSlide({
  n,
  sectionNumber,
  title,
  principle,
  focusAreas,
}: {
  n: number;
  sectionNumber: string;
  title: string;
  principle: string;
  focusAreas: string[];
}) {
  return (
    <SectionFrame number={sectionNumber} label={`Strategic move ${n}`}>
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 items-start gap-10">
        <div className="col-span-12 md:col-span-5">
          <div
            data-reveal
            className="flex items-baseline gap-4"
            style={{ animationDelay: "150ms" }}
          >
            <span
              className="text-[11vw] italic leading-[0.85] md:text-[160px]"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--accent)",
              }}
            >
              0{n}
            </span>
          </div>
          <div
            data-reveal="fade"
            className="mt-4 h-px w-20"
            style={{
              animationDelay: "400ms",
              background: "var(--rule)",
            }}
          />
          <h2
            data-reveal
            className="mt-6 text-4xl italic leading-tight md:text-5xl"
            style={{
              animationDelay: "400ms",
              fontFamily: "var(--font-display)",
            }}
          >
            {title}
          </h2>
        </div>
        <div className="col-span-12 md:col-span-7 md:pt-4">
          <p
            data-reveal
            className="text-lg leading-relaxed md:text-xl"
            style={{
              animationDelay: "550ms",
              color: "var(--ink-soft)",
            }}
          >
            {principle}
          </p>
          <div
            data-reveal="fade"
            className="mt-8 h-px w-full"
            style={{
              animationDelay: "750ms",
              background: "var(--rule)",
            }}
          />
          <div className="mt-6">
            <div
              className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.24em]"
              style={{ color: "var(--ink-muted)" }}
            >
              Focus areas
            </div>
            <ul className="space-y-3">
              {focusAreas.map((area, i) => (
                <li
                  key={area}
                  data-reveal
                  className="flex items-start gap-3 text-sm leading-relaxed"
                  style={{ animationDelay: `${900 + i * 120}ms` }}
                >
                  <span
                    className="mt-[7px] h-[6px] w-[6px] shrink-0 rotate-45"
                    style={{ background: "var(--accent)" }}
                    aria-hidden
                  />
                  <span style={{ color: "var(--ink)" }}>{area}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SectionFrame>
  );
}

function FlywheelSlide() {
  const nodes = [
    "Better AI",
    "Better products",
    "More value",
    "More trust",
    "More data",
    "Smarter AI",
  ];
  return (
    <SectionFrame number="12" label="The flywheel">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 items-center gap-10">
        <div className="col-span-12 md:col-span-5">
          <p
            data-reveal="wide"
            className="text-[7vw] leading-[0.95] md:text-[80px]"
            style={{
              animationDelay: "180ms",
              fontFamily: "var(--font-display)",
            }}
          >
            <span className="italic">A compounding </span>
            <span className="italic" style={{ color: "var(--accent)" }}>
              loop
            </span>
            <span className="italic">.</span>
          </p>
          <p
            data-reveal
            className="mt-8 text-base leading-relaxed"
            style={{
              animationDelay: "500ms",
              color: "var(--ink-muted)",
            }}
          >
            Each move reinforces the next, creating a flywheel that accelerates
            our strategic advantage and delivers long-term financial health at
            scale.
          </p>
        </div>

        <div className="col-span-12 flex justify-center md:col-span-7">
          <Flywheel nodes={nodes} />
        </div>
      </div>
    </SectionFrame>
  );
}

function Flywheel({ nodes }: { nodes: string[] }) {
  const size = 460;
  const cx = size / 2;
  const cy = size / 2;
  const r = 180;
  const innerR = r - 28;
  const innerCircumference = 2 * Math.PI * innerR;
  const labelPad = 160;
  const viewW = size + labelPad * 2;
  return (
    <div
      data-reveal="fade"
      className="relative w-full max-w-[640px]"
      style={{ animationDelay: "500ms" }}
    >
      <svg
        width="100%"
        height="auto"
        viewBox={`${-labelPad} 0 ${viewW} ${size}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        <circle
          cx={cx}
          cy={cy}
          r={innerR}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeDasharray={innerCircumference}
          strokeDashoffset={innerCircumference}
          style={{
            animation: "deck-ring-draw 1800ms 700ms cubic-bezier(0.3,0.7,0.3,1) forwards",
          }}
        />

        {nodes.map((_, i) => {
          const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * innerR;
          const y = cy + Math.sin(angle) * innerR;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={4}
              fill="var(--accent)"
              style={{
                opacity: 0,
                animation: `deck-fade 400ms ${1100 + i * 120}ms forwards`,
              }}
            />
          );
        })}

        {nodes.map((label, i) => {
          const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * (r + 30);
          const y = cy + Math.sin(angle) * (r + 30);
          const anchor =
            Math.cos(angle) > 0.3
              ? "start"
              : Math.cos(angle) < -0.3
                ? "end"
                : "middle";
          return (
            <text
              key={label}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "16px",
                fill: "var(--ink)",
                opacity: 0,
                animation: `deck-fade 600ms ${1300 + i * 120}ms forwards`,
              }}
            >
              {label}
            </text>
          );
        })}

        <circle
          cx={cx}
          cy={cy}
          r={70}
          fill="var(--paper-warm)"
          style={{
            opacity: 0,
            animation: "deck-fade 600ms 700ms forwards",
          }}
        />
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "10px",
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            fill: "var(--ink-muted)",
            opacity: 0,
            animation: "deck-fade 600ms 1000ms forwards",
          }}
        >
          the
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "28px",
            fill: "var(--accent)",
            opacity: 0,
            animation: "deck-fade 600ms 1100ms forwards",
          }}
        >
          loop
        </text>
      </svg>
      <style>{`
        @keyframes deck-ring-draw {
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </div>
  );
}

function WontDoSlide() {
  const items = [
    {
      t: "Growth at all costs",
      d: "Unsustainable CAC or deteriorating LTV are not trade-offs we accept.",
    },
    {
      t: "Distraction from the mission",
      d: "Non-financial verticals and ideas outside personal money stay off the roadmap.",
    },
    {
      t: "Expansion beyond core financial health",
      d: "Wealth, insurance, and emergency savings wait until debt and spending are solved.",
    },
    {
      t: "New products outside New Bets",
      d: "All new ideas channel through the New Bets pillar. No skunkworks.",
    },
    {
      t: "Building without reinforcing our USP",
      d: "Every product must deepen our AI and data edge — or it doesn’t ship.",
    },
  ];
  return (
    <SectionFrame number="13" label="What we won’t do">
      <div className="mx-auto w-full max-w-5xl">
        <p
          data-reveal="wide"
          className="text-[5.5vw] leading-[1.0] tracking-[-0.015em] md:text-[70px]"
          style={{
            animationDelay: "180ms",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="italic">Clarity comes from</span>
          <br />
          <span className="italic" style={{ color: "var(--accent-bright)" }}>
            what we refuse to do
          </span>
          <span className="italic">.</span>
        </p>

        <div className="mt-14 space-y-5">
          {items.map((it, i) => (
            <div
              key={it.t}
              data-reveal
              className="grid grid-cols-12 items-baseline gap-4 border-b pb-4"
              style={{
                animationDelay: `${400 + i * 110}ms`,
                borderColor: "var(--rule)",
              }}
            >
              <div className="col-span-1">
                <span
                  className="font-mono text-[11px] font-medium uppercase tracking-[0.24em]"
                  style={{ color: "var(--accent-bright)" }}
                >
                  ✕
                </span>
              </div>
              <div className="col-span-11 md:col-span-4">
                <div
                  className="text-xl italic"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {it.t}
                </div>
              </div>
              <div className="col-span-12 md:col-span-7">
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "var(--ink-soft)" }}
                >
                  {it.d}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionFrame>
  );
}

function ClosingSlide() {
  return (
    <SectionFrame number="14" label="Coda">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <div
          data-reveal="fade"
          className="mb-6 h-px w-24"
          style={{ animationDelay: "150ms" }}
        >
          <div
            data-rule
            className="h-px w-full"
            style={{ background: "var(--ink)", animationDelay: "250ms" }}
          />
        </div>

        <p
          data-reveal="wide"
          className="text-[7vw] leading-[1.02] tracking-[-0.02em] md:text-[92px]"
          style={{
            animationDelay: "300ms",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="italic">The loop</span>
          <br />
          <span className="italic">starts </span>
          <span className="italic" style={{ color: "var(--accent)" }}>
            now
          </span>
          <span className="italic">.</span>
        </p>

        <p
          data-reveal
          className="mt-10 max-w-lg text-sm leading-relaxed"
          style={{
            animationDelay: "700ms",
            color: "var(--ink-muted)",
          }}
        >
          A compounding loop only compounds if we keep turning it. Every shipped
          feature, every retained user, every deeper data point — they all feed
          back in. The work is collective.
        </p>

        <Link
          href="/dashboard/strategy"
          data-reveal
          data-deck-interactive
          className="mt-12 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-all hover:translate-x-0.5"
          style={{
            animationDelay: "900ms",
            background: "var(--ink)",
            color: "var(--paper)",
          }}
        >
          Back to the strategy page
          <ArrowUpRight className="h-4 w-4" />
        </Link>

        <p
          data-reveal="fade"
          className="mt-16 font-mono text-[10px] uppercase tracking-[0.3em]"
          style={{
            animationDelay: "1100ms",
            color: "var(--ink-muted)",
          }}
        >
          Cleo · Company Strategy · H1 2025 · fin.
        </p>
      </div>
    </SectionFrame>
  );
}

// ------- Shared section frame ------------------------------------------

function SectionFrame({
  number,
  label,
  children,
}: {
  number: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-full w-full">
      <div
        data-reveal="fade"
        className="absolute -top-2 left-0 flex items-center gap-3"
        style={{ animationDelay: "50ms" }}
      >
        <span
          className="font-mono text-[11px] font-medium uppercase tracking-[0.24em]"
          style={{ color: "var(--ink-muted)" }}
        >
          § {number}
        </span>
        <span className="h-px w-10" style={{ background: "var(--rule)" }} />
        <span
          className="text-sm italic"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {label}
        </span>
      </div>

      <div className="flex h-full w-full items-center justify-center pt-6">
        {children}
      </div>
    </div>
  );
}

// ------- Slide registry -------------------------------------------------

const SLIDES: SlideDef[] = [
  { id: "cover", label: "Cover", theme: "light", render: () => <CoverSlide /> },
  {
    id: "mission",
    label: "Mission",
    theme: "light",
    render: () => <MissionSlide />,
  },
  {
    id: "vision",
    label: "Vision",
    theme: "light",
    render: () => <VisionSlide />,
  },
  {
    id: "target",
    label: "Target",
    theme: "light",
    render: () => <TargetSlide />,
  },
  {
    id: "market",
    label: "Market",
    theme: "light",
    render: () => <MarketSlide />,
  },
  {
    id: "users",
    label: "Users",
    theme: "light",
    render: () => <UsersSlide />,
  },
  {
    id: "crux",
    label: "The crux",
    theme: "dark",
    render: () => <CruxSlide />,
  },
  {
    id: "strategy-core",
    label: "The strategy",
    theme: "light",
    render: () => <StrategyCoreSlide />,
  },
  {
    id: "move-1",
    label: "Move 01 · Credit",
    theme: "light",
    render: () => (
      <MoveSlide
        n={1}
        sectionNumber="08"
        title="Break the high-cost credit trap."
        principle="Help users break the credit trap with a suite of affordable products and guided support across the cycle — driving scale and profitability via retention and cross-selling."
        focusAreas={[
          "Build a product suite that addresses additional stages in the debt cycle.",
          "Improve product economics to offer competitive pricing at scale.",
          "Use AI to drive behavioural change through credit guidance.",
          "Optimise for credit-suite-level success and retention.",
        ]}
      />
    ),
  },
  {
    id: "move-2",
    label: "Move 02 · Recurring",
    theme: "light",
    render: () => (
      <MoveSlide
        n={2}
        sectionNumber="09"
        title="Save users money on recurring expenses."
        principle="Help users reduce recurring expenses and free up cashflow — using AI to spot savings opportunities and take action: cancel, switch, or optimise."
        focusAreas={[
          "Cut major expenses via bundling services directly.",
          "Transform cashflow via consolidated payments and credit.",
          "Save money automatically across the long-tail via affiliate offers and negotiation.",
        ]}
      />
    ),
  },
  {
    id: "move-3",
    label: "Move 03 · Data",
    theme: "light",
    render: () => (
      <MoveSlide
        n={3}
        sectionNumber="10"
        title="Win on data."
        principle="Use data to make the AI smarter every day — the flywheel that sharpens recommendations and decisions, boosts trust, and deepens engagement."
        focusAreas={[
          "Understand each user’s financial life in depth.",
          "Prioritise data accuracy and quality.",
          "Provide universal data accessibility across the platform.",
        ]}
      />
    ),
  },
  {
    id: "move-4",
    label: "Move 04 · Geo",
    theme: "light",
    render: () => (
      <MoveSlide
        n={4}
        sectionNumber="11"
        title="Expand beyond the US."
        principle="Bring Cleo to more lives by expanding into geographies where we can deliver fast value — phased, scalable, and locally informed."
        focusAreas={[
          "Start in markets most similar to the U.S.",
          "Dual-track rollout: chat & EWA.",
          "Modularise tech to enable repeatable launches.",
          "Operate within regulations, in close contact with regulators.",
          "Ramp paid growth only once metrics validate readiness.",
        ]}
      />
    ),
  },
  {
    id: "flywheel",
    label: "The flywheel",
    theme: "light",
    render: () => <FlywheelSlide />,
  },
  {
    id: "wont-do",
    label: "What we won’t do",
    theme: "dark",
    render: () => <WontDoSlide />,
  },
  {
    id: "closing",
    label: "Coda",
    theme: "light",
    render: () => <ClosingSlide />,
  },
];
