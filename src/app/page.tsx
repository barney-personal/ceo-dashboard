import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, ChevronDown } from "lucide-react";
import { PulseCanvas } from "@/components/landing/pulse-canvas";
import { MetricTicker } from "@/components/landing/metric-ticker";
import { SectionPortals } from "@/components/landing/section-portals";

export default async function LandingPage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="relative bg-background">
      {/* Noise texture overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />

      {/* ── Hero: full viewport ── */}
      <div className="relative flex min-h-screen flex-col">
        {/* Header */}
        <header className="relative z-20 flex items-center justify-between px-8 py-6 md:px-12 lg:px-20">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/20">
              <span className="font-display text-sm text-primary-foreground">C</span>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Cleo
            </span>
          </div>
          <Link
            href="/sign-in"
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-primary"
          >
            Sign in
          </Link>
        </header>

        {/* Canvas + hero content */}
        <div className="relative flex flex-1 flex-col items-center justify-center px-8 md:px-12 lg:px-20">
          {/* Animated background */}
          <div className="absolute inset-0 overflow-hidden">
            <PulseCanvas />
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background to-transparent" />
            <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
            <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
          </div>

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="animate-fade-up mb-8 flex items-center gap-4" style={{ animationDelay: "0ms" }}>
              <div className="h-px w-10 bg-primary/30" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-primary/50">
                Command Centre
              </span>
              <div className="h-px w-10 bg-primary/30" />
            </div>

            <div className="animate-fade-up" style={{ animationDelay: "100ms" }}>
              <h1 className="font-display text-[clamp(3rem,7vw,6.5rem)] leading-[0.85] tracking-tight text-foreground">
                The numbers
              </h1>
            </div>
            <div className="animate-fade-up" style={{ animationDelay: "180ms" }}>
              <h1 className="font-display text-[clamp(3rem,7vw,6.5rem)] italic leading-[0.85] tracking-tight text-foreground">
                are in
              </h1>
            </div>

            <div className="animate-fade-up mt-8" style={{ animationDelay: "300ms" }}>
              <MetricTicker />
            </div>

            <div className="animate-fade-up mt-10" style={{ animationDelay: "400ms" }}>
              <Link
                href="/sign-in"
                className="group inline-flex items-center gap-3 rounded-full border border-primary/20 bg-card px-8 py-3.5 text-sm font-medium text-primary shadow-warm transition-all hover:border-primary/30 hover:bg-primary/[0.04] hover:shadow-warm-lg"
              >
                Sign in with Google
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="relative z-10 flex justify-center pb-8 animate-fade-up" style={{ animationDelay: "600ms" }}>
          <div className="flex flex-col items-center gap-2 text-muted-foreground/30">
            <span className="text-[9px] font-semibold uppercase tracking-[0.3em]">Explore</span>
            <ChevronDown className="h-3.5 w-3.5 animate-bounce" />
          </div>
        </div>
      </div>

      {/* ── Sections: scroll-driven ── */}
      <div className="relative z-10 px-8 md:px-12 lg:px-20">
        <SectionPortals />
      </div>

      {/* ── Final CTA ── */}
      <div className="relative z-10 flex flex-col items-center gap-8 py-28 text-center">
        <div className="h-px w-20 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <div className="space-y-3">
          <p className="font-display text-3xl tracking-tight text-foreground md:text-4xl">
            Everything in
          </p>
          <p className="font-display text-3xl italic tracking-tight text-foreground md:text-4xl">
            one place
          </p>
        </div>
        <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground/50">
          No more switching between tools. Your metrics, objectives, and team data — unified and always current.
        </p>
        <Link
          href="/sign-in"
          className="group inline-flex items-center gap-3 rounded-full bg-primary px-8 py-3.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/25"
        >
          Get started
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </Link>
        <div className="h-px w-20 bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      {/* Footer */}
      <footer className="relative z-20 flex items-center justify-between px-8 py-6 md:px-12 lg:px-20">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/30">
          Internal use only
        </span>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-positive/60 animate-[pulse_3s_ease-in-out_infinite]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/30">
            All systems operational
          </span>
        </div>
      </footer>
    </div>
  );
}
