import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type { EngineeringRankingSnapshot } from "@/lib/data/engineering-ranking";

export function formatDate(iso: string): string {
  // Snapshot dates are always UTC midnight (either a bare `YYYY-MM-DD` string
  // or `...T00:00:00Z`). Render in UTC so viewers in negative offsets (e.g.
  // US timezones) don't see the previous calendar day.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function StatusBadge({
  status,
}: {
  status: EngineeringRankingSnapshot["status"];
}) {
  const label =
    status === "ready"
      ? "Ranking ready"
      : status === "insufficient_data"
        ? "Insufficient data"
        : "Methodology pending";
  const tone =
    status === "ready"
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-warning/40 bg-warning/10 text-warning";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] ${tone}`}
    >
      {label}
    </span>
  );
}

export function SignalIcon({
  state,
}: {
  state: "available" | "planned" | "unavailable";
}) {
  if (state === "available") {
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  }
  if (state === "unavailable") {
    return <AlertTriangle className="h-4 w-4 text-warning" />;
  }
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

export function formatPercentile(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

type HeaderLink = { href: string; label: string };

export function RankingHeader({
  snapshot,
  title,
  subtitle,
  links,
}: {
  snapshot: EngineeringRankingSnapshot;
  title: string;
  subtitle?: string;
  links?: HeaderLink[];
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-3xl italic tracking-tight text-foreground">
              {title}
            </h2>
            <StatusBadge status={snapshot.status} />
          </div>
          {subtitle ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>
            <div>Methodology v{snapshot.methodologyVersion}</div>
            <div className="mt-1">
              Window {formatDate(snapshot.signalWindow.start)} →{" "}
              {formatDate(snapshot.signalWindow.end)}
            </div>
          </div>
          {links && links.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 normal-case tracking-normal">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-xs text-primary hover:underline"
                >
                  {link.label} →
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
