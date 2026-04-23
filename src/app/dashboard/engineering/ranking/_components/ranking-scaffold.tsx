import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type {
  EligibilityEntry,
  EligibilityStatus,
  EngineeringRankingSnapshot,
} from "@/lib/data/engineering-ranking";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({
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

function SignalIcon({
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

const ELIGIBILITY_LABEL: Record<EligibilityStatus, string> = {
  competitive: "Competitive",
  ramp_up: "Ramp-up (<90d)",
  insufficient_mapping: "Insufficient GitHub mapping",
  inactive_or_leaver: "Inactive / leaver",
  missing_required_data: "Missing required data",
};

const ELIGIBILITY_TONE: Record<EligibilityStatus, string> = {
  competitive: "border-primary/40 bg-primary/5 text-primary",
  ramp_up: "border-muted-foreground/30 bg-muted/40 text-foreground",
  insufficient_mapping:
    "border-warning/40 bg-warning/5 text-warning",
  inactive_or_leaver:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  missing_required_data:
    "border-destructive/40 bg-destructive/5 text-destructive",
};

function CoverageSection({
  snapshot,
}: {
  snapshot: EngineeringRankingSnapshot;
}) {
  const { entries, coverage, sourceNotes } = snapshot.eligibility;
  const buckets: Array<{ status: EligibilityStatus; count: number }> = [
    { status: "competitive", count: coverage.competitive },
    { status: "ramp_up", count: coverage.rampUp },
    { status: "insufficient_mapping", count: coverage.insufficientMapping },
    { status: "missing_required_data", count: coverage.missingRequiredData },
    { status: "inactive_or_leaver", count: coverage.inactiveOrLeaver },
  ];

  return (
    <section className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Eligibility coverage
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Preflight before any ranking claim. Unmapped or under-tenure
            engineers are surfaced, not dropped. Ramp-up threshold:{" "}
            {coverage.rampUpThresholdDays} days.
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <div>{coverage.totalEngineers} engineers in roster</div>
          <div className="mt-1">
            {coverage.mappedToGitHub} mapped to GitHub ·{" "}
            {coverage.presentInImpactModel} in impact model
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {buckets.map((b) => (
          <div
            key={b.status}
            className={`rounded-md border px-3 py-2 ${ELIGIBILITY_TONE[b.status]}`}
          >
            <div className="text-[10px] uppercase tracking-[0.12em] opacity-80">
              {ELIGIBILITY_LABEL[b.status]}
            </div>
            <div className="mt-1 font-display text-2xl tabular-nums">
              {b.count}
            </div>
          </div>
        ))}
      </div>

      {sourceNotes.length > 0 && (
        <div className="mt-4 rounded-md border border-border/40 bg-background/60 p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Source provenance
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {sourceNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-4 text-xs italic text-muted-foreground">
          Roster preflight is empty — live Mode and GitHub-map fetches have
          not returned data yet. The ranking stays methodology-pending.
        </p>
      ) : (
        <RosterTable entries={entries} />
      )}
    </section>
  );
}

function RosterTable({ entries }: { entries: EligibilityEntry[] }) {
  const preview = entries.slice(0, 12);
  const remaining = entries.length - preview.length;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Engineer</th>
            <th className="py-2 pr-3 font-medium">Discipline</th>
            <th className="py-2 pr-3 font-medium">Tenure</th>
            <th className="py-2 pr-3 font-medium">GitHub</th>
            <th className="py-2 pr-3 font-medium">Impact model</th>
            <th className="py-2 pr-3 font-medium">Eligibility</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((e) => (
            <tr
              key={e.emailHash || e.email || e.displayName}
              className="border-b border-border/30 align-top"
            >
              <td className="py-2 pr-3">
                <div className="text-sm text-foreground">{e.displayName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {e.manager ? `Manager: ${e.manager}` : "No manager on row"}
                </div>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.discipline} · {e.levelLabel}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.tenureDays === null ? "—" : `${e.tenureDays}d`}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.githubLogin ?? "unmapped"}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {e.hasImpactModelRow ? "yes" : "no"}
              </td>
              <td className="py-2 pr-3">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${ELIGIBILITY_TONE[e.eligibility]}`}
                >
                  {ELIGIBILITY_LABEL[e.eligibility]}
                </span>
                <div className="mt-1 text-[11px] italic text-muted-foreground">
                  {e.reason}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {remaining > 0 && (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          Showing first {preview.length} of {entries.length} engineers — the
          full roster will be visible when scoring lands.
        </p>
      )}
    </div>
  );
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
              drilldowns all land in later milestones. The eligibility roster
              below is the foundation the scoring will run on.
            </p>
          </div>
        </div>
      </section>

      <CoverageSection snapshot={snapshot} />

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
            No engineers are ranked yet. The signal orthogonality audit and
            independent scoring lenses land in the next milestones, with the
            eligibility roster above as input.
          </p>
        </section>
      ) : null}
    </div>
  );
}
