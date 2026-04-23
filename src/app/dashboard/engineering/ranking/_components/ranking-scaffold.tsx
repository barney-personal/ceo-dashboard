import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type { EngineeringRankingSnapshot } from "@/lib/data/engineering-ranking";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: EngineeringRankingSnapshot["status"] }) {
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

function SignalIcon({ state }: { state: "available" | "planned" | "unavailable" }) {
  if (state === "available") {
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  }
  if (state === "unavailable") {
    return <AlertTriangle className="h-4 w-4 text-warning" />;
  }
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

export function RankingScaffold({
  snapshot,
}: {
  snapshot: EngineeringRankingSnapshot;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-3xl italic tracking-tight text-foreground">
                Engineer ranking
              </h2>
              <StatusBadge status={snapshot.status} />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A defensible, methodology-first ranking of every engineer at Cleo
              from the signals we already collect. This page is the artifact;
              the methodology is the product — each cycle should move the
              ranking toward one the CEO can defend for any engineer on it.
            </p>
          </div>
          <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <div>Methodology v{snapshot.methodologyVersion}</div>
            <div className="mt-1">
              Window {formatDate(snapshot.signalWindow.start)} →{" "}
              {formatDate(snapshot.signalWindow.end)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-warning/40 bg-warning/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              Why there is no ranked list yet
            </h3>
            <p className="text-sm text-muted-foreground">
              Shipping a list today without the methodology underneath would
              mean defending numbers we cannot yet explain. The scoring lenses,
              tenure/role normalisation, confidence bands, and attribution
              drilldowns all land in later milestones. Until they do, this
              scaffold exists so the gate, route, and contract are correct.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <h3 className="text-sm font-semibold text-foreground">
          Signals this ranking will use
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Availability of each input signal at the time this page was rendered.
          Unavailable signals are documented as known methodology limitations
          and not silently synthesised.
        </p>
        <ul className="mt-4 space-y-2">
          {snapshot.plannedSignals.map((signal) => (
            <li
              key={signal.name}
              className="flex items-start gap-3 rounded-md border border-border/40 bg-background/60 px-3 py-2"
            >
              <SignalIcon state={signal.state} />
              <div className="flex-1">
                <div className="text-sm text-foreground">{signal.name}</div>
                {signal.note && (
                  <div className="text-xs text-muted-foreground">
                    {signal.note}
                  </div>
                )}
              </div>
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {signal.state}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
        <h3 className="text-sm font-semibold text-foreground">
          Known methodology limitations
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Surfaced on the page so the ranking never claims more than it can
          defend. These are what the next cycles will close.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {snapshot.knownLimitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      {snapshot.engineers.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border/60 bg-background/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No engineers are ranked yet. The eligibility preflight, signal
            orthogonality audit, and independent scoring lenses land in the
            next milestones.
          </p>
        </section>
      ) : null}
    </div>
  );
}
