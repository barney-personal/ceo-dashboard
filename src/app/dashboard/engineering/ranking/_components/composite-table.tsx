"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  AttributionBundle,
  AttributionContribution,
  CompositeBundle,
  ConfidenceBundle,
  EngineerAttribution,
  EngineerAttributionMethod,
  EngineerCompositeEntry,
  EngineerConfidence,
} from "@/lib/data/engineering-ranking";

const ANY_VALUE = "__any__" as const;

function countBy(
  entries: readonly EngineerCompositeEntry[],
  get: (entry: EngineerCompositeEntry) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const value = get(entry);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function FilterSelect({
  label,
  value,
  onChange,
  counts,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  counts: Map<string, number>;
  allLabel: string;
}) {
  const options = Array.from(counts.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs normal-case tracking-normal text-foreground"
      >
        <option value={ANY_VALUE}>{allLabel}</option>
        {options.map(([name, count]) => (
          <option key={name} value={name}>
            {name} ({count})
          </option>
        ))}
      </select>
    </label>
  );
}

function formatPercentile(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}`;
}

function HeaderCell({
  label,
  tooltip,
  align = "left",
  className = "",
}: {
  label: string;
  tooltip: string;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`py-2 pr-3 font-medium ${
        align === "right" ? "text-right" : ""
      } ${className}`}
    >
      <span className="group relative inline-flex">
        <span
          tabIndex={0}
          aria-label={`${label}: ${tooltip}`}
          className={`inline-flex cursor-help items-center underline decoration-dotted decoration-muted-foreground/50 underline-offset-[3px] outline-none focus-visible:text-foreground ${
            align === "right" ? "flex-row-reverse" : ""
          }`}
        >
          {label}
        </span>
        <span
          role="tooltip"
          className={`pointer-events-none absolute top-full z-50 mt-1.5 w-64 rounded-lg border border-border/60 bg-popover p-3 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {tooltip}
        </span>
      </span>
    </th>
  );
}

function formatRawValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000 || abs < 0.01) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toFixed(2);
}

function formatLift(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function ConfidenceBand({ entry }: { entry: EngineerConfidence | undefined }) {
  if (
    !entry ||
    entry.composite === null ||
    entry.ciLow === null ||
    entry.ciHigh === null
  ) {
    return (
      <span className="text-[10px] italic text-muted-foreground">no band</span>
    );
  }
  const low = Math.max(0, Math.min(100, entry.ciLow));
  const high = Math.max(0, Math.min(100, entry.ciHigh));
  const point = Math.max(0, Math.min(100, entry.composite));
  const tone = entry.inTieGroup ? "bg-warning/30" : "bg-primary/25";
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-2 w-32 rounded-full bg-muted/50">
        <div
          className={`absolute top-0 h-2 rounded-full ${tone}`}
          style={{
            left: `${low}%`,
            width: `${Math.max(0.5, high - low)}%`,
          }}
        />
        <div
          className="absolute top-[-2px] h-3 w-[2px] bg-foreground"
          style={{ left: `calc(${point}% - 1px)` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {low.toFixed(0)}–{high.toFixed(0)}
        </span>
        {entry.inTieGroup && entry.tieGroupId !== null && (
          <span className="rounded-sm border border-warning/40 bg-warning/10 px-1 text-warning">
            tie {entry.tieGroupId}
          </span>
        )}
      </div>
    </div>
  );
}

function MethodBreakdown({ method }: { method: EngineerAttributionMethod }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {method.label}
          </div>
          <div className="text-[11px] italic text-muted-foreground/80">
            {method.presentReason}
          </div>
        </div>
        <div
          className={`font-display text-lg italic tabular-nums ${
            method.present ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {method.present ? formatPercentile(method.score) : "absent"}
        </div>
      </div>
      {method.components.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          No components surfaced for this method.
        </p>
      ) : (
        <table className="mt-2 w-full border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-border/40 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Signal</th>
              <th className="py-1 pr-2 text-right font-medium">Weight</th>
              <th className="py-1 pr-2 text-right font-medium">Raw</th>
              <th className="py-1 pr-2 text-right font-medium">Percentile</th>
              <th className="py-1 pr-2 text-right font-medium">Lift</th>
            </tr>
          </thead>
          <tbody>
            {method.components.map((component) => (
              <tr
                key={`${method.method}-${component.signal}`}
                className="border-b border-border/20 align-top"
              >
                <td
                  className={`py-1 pr-2 ${
                    component.kind === "absent"
                      ? "italic text-muted-foreground"
                      : "text-foreground"
                  }`}
                >
                  {component.signal}
                  {component.kind === "absent" && component.absenceReason && (
                    <div className="text-[10px] italic text-muted-foreground/80">
                      {component.absenceReason}
                    </div>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {(component.weightInMethod * 100).toFixed(0)}%
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {formatRawValue(component.rawValue)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {formatPercentile(component.percentile)}
                </td>
                <td
                  className={`py-1 pr-2 text-right tabular-nums ${
                    component.approxCompositeLift === null
                      ? "text-muted-foreground"
                      : component.approxCompositeLift > 0
                        ? "text-primary"
                        : "text-destructive"
                  }`}
                >
                  {formatLift(component.approxCompositeLift)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DriverList({
  drivers,
  tone,
  emptyText,
}: {
  drivers: AttributionContribution[];
  tone: "positive" | "negative";
  emptyText: string;
}) {
  if (drivers.length === 0) {
    return (
      <p className="text-[11px] italic text-muted-foreground">{emptyText}</p>
    );
  }
  const color = tone === "positive" ? "text-primary" : "text-destructive";
  return (
    <ul className="space-y-1 text-[11px]">
      {drivers.map((driver) => (
        <li
          key={`${driver.method}-${driver.signal}`}
          className="flex items-baseline justify-between gap-2"
        >
          <span className="text-foreground">
            <span className="text-muted-foreground">[{driver.method}]</span>{" "}
            {driver.signal}
          </span>
          <span className={`tabular-nums ${color}`}>
            {formatLift(driver.approxCompositeLift)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AttributionDetails({
  entry,
  profileSlug,
}: {
  entry: EngineerAttribution;
  profileSlug: string | null;
}) {
  const composite = formatPercentile(entry.compositeScore);
  const reconciliationTone = entry.reconciliation.matches
    ? "text-primary"
    : "text-destructive";
  return (
    <div className="space-y-4 border-t border-border/30 bg-muted/20 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl italic text-foreground">
            {composite}
          </span>
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            composite · {entry.presentMethodCount} / 5 methods present
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {entry.evidence.githubPrSearchUrl && (
            <a
              href={entry.evidence.githubPrSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-border/60 bg-background px-3 py-1 font-medium text-primary hover:border-primary/40"
            >
              Merged PRs on GitHub →
            </a>
          )}
          {profileSlug && (
            <a
              href={`/dashboard/people/${profileSlug}`}
              className="rounded-full border border-border/60 bg-background px-3 py-1 font-medium text-foreground hover:border-primary/40"
            >
              View full profile →
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {entry.methods.map((method) => (
          <MethodBreakdown key={method.method} method={method} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
            Top lifts (what pushed them up)
          </div>
          <div className="mt-2">
            <DriverList
              drivers={entry.topPositiveDrivers}
              tone="positive"
              emptyText="No present signal lifted this engineer above the neutral 50."
            />
          </div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-destructive">
            Top drags (what held them down)
          </div>
          <div className="mt-2">
            <DriverList
              drivers={entry.topNegativeDrivers}
              tone="negative"
              emptyText="No present signal dragged this engineer below the neutral 50."
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
          <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Reconciliation
          </div>
          <p className={`mt-1 italic ${reconciliationTone}`}>
            {entry.reconciliation.matches
              ? "median(methods) = composite"
              : "median(methods) ≠ composite — methodology defect"}
          </p>
          <p className="mt-1 text-muted-foreground">
            recomputed {formatPercentile(entry.reconciliation.recomputedComposite)}
            {" "}·{" "}stored {composite}
          </p>
          <p className="mt-1 text-muted-foreground">
            delta{" "}
            {entry.reconciliation.delta === null
              ? "—"
              : entry.reconciliation.delta.toFixed(3)}
          </p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
          <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Discipline peer comparison
          </div>
          <p className="mt-1 text-muted-foreground">
            {entry.peerComparison.disciplineCohort?.note ??
              "No discipline cohort attached (engineer unscored)."}
          </p>
          <p className="mt-1 text-muted-foreground">
            raw{" "}
            {formatPercentile(entry.peerComparison.rawPercentile)}
            {" "}→ adjusted{" "}
            {formatPercentile(entry.peerComparison.adjustedPercentile)}{" "}
            ({formatLift(entry.peerComparison.adjustmentLift)})
          </p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
          <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Evidence
          </div>
          <p className="mt-1 text-muted-foreground">
            GitHub:{" "}
            {entry.evidence.githubLogin ? (
              entry.evidence.githubPrSearchUrl ? (
                <a
                  href={entry.evidence.githubPrSearchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {entry.evidence.githubLogin}
                </a>
              ) : (
                <span>{entry.evidence.githubLogin}</span>
              )
            ) : (
              <span className="italic">unmapped</span>
            )}
          </p>
          <p className="mt-1 text-muted-foreground">
            Impact model:{" "}
            {entry.evidence.impactModelPresent ? "in training set" : "absent"}
          </p>
          <p className="mt-1 text-muted-foreground">
            Squad context:{" "}
            {entry.evidence.squadContextPresent ? "joined" : "not joined"}
          </p>
          {entry.evidence.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 italic">
              {entry.evidence.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-background/60 p-3 text-[11px]">
        <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Manager · squad · pillar
        </div>
        <p className="mt-1 text-muted-foreground">
          Manager: {entry.context.manager ?? "—"}
        </p>
        <p className="mt-1 text-muted-foreground">
          Squad:{" "}
          {entry.context.canonicalSquad?.name ??
            entry.context.rawSquad ??
            "—"}
          {entry.context.canonicalSquad?.pmName
            ? ` · PM ${entry.context.canonicalSquad.pmName}`
            : ""}
        </p>
        <p className="mt-1 text-muted-foreground">
          Pillar: {entry.context.canonicalSquad?.pillar ?? entry.context.pillar}
        </p>
      </div>

      {entry.absentSignals.length > 0 && (
        <p className="text-[11px] italic text-muted-foreground">
          Labelled absent for this engineer:{" "}
          {entry.absentSignals.join(", ")}.
        </p>
      )}
    </div>
  );
}

export function CompositeTopTable({
  composite,
  confidence,
  attribution,
  profileSlugByHash,
}: {
  composite: CompositeBundle;
  confidence: ConfidenceBundle;
  attribution: AttributionBundle;
  profileSlugByHash: Record<string, string>;
}) {
  const ciByHash = useMemo(
    () => new Map(confidence.entries.map((c) => [c.emailHash, c])),
    [confidence.entries],
  );
  const attributionByHash = useMemo(
    () => new Map(attribution.entries.map((a) => [a.emailHash, a])),
    [attribution.entries],
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [squad, setSquad] = useState<string>(ANY_VALUE);
  const [pillar, setPillar] = useState<string>(ANY_VALUE);

  // Narrow each dropdown by the other's selection so options stay consistent
  // (picking a pillar narrows the squad list to squads in that pillar, etc.).
  const pillarCounts = useMemo(
    () =>
      countBy(
        composite.ranked.filter(
          (e) => squad === ANY_VALUE || e.squad === squad,
        ),
        (e) => e.pillar,
      ),
    [composite.ranked, squad],
  );
  const squadCounts = useMemo(
    () =>
      countBy(
        composite.ranked.filter(
          (e) => pillar === ANY_VALUE || e.pillar === pillar,
        ),
        (e) => e.squad,
      ),
    [composite.ranked, pillar],
  );

  const filteredRanked = useMemo(
    () =>
      composite.ranked.filter((entry) => {
        if (squad !== ANY_VALUE && entry.squad !== squad) return false;
        if (pillar !== ANY_VALUE && entry.pillar !== pillar) return false;
        return true;
      }),
    [composite.ranked, squad, pillar],
  );

  const anySquads = squadCounts.size > 0;
  const anyPillars = pillarCounts.size > 0;
  const filtersActive = squad !== ANY_VALUE || pillar !== ANY_VALUE;
  const heading = filtersActive
    ? `${filteredRanked.length} of ${composite.ranked.length} engineers by composite`
    : `All ${composite.ranked.length} engineers by composite`;

  const toggle = (hash: string) => {
    setExpanded((cur) => (cur === hash ? null : hash));
  };

  return (
    <div className="mt-4 rounded-md border border-border/40 bg-background/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {heading}
        </h4>
        <p className="text-[11px] italic text-muted-foreground">
          Click a row for the per-method score breakdown and PR evidence.
        </p>
      </div>
      {(anySquads || anyPillars) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {anyPillars && (
            <FilterSelect
              label="Pillar"
              value={pillar}
              onChange={setPillar}
              counts={pillarCounts}
              allLabel="All pillars"
            />
          )}
          {anySquads && (
            <FilterSelect
              label="Squad"
              value={squad}
              onChange={setSquad}
              counts={squadCounts}
              allLabel="All squads"
            />
          )}
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setSquad(ANY_VALUE);
                setPillar(ANY_VALUE);
              }}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
          <span className="text-[11px] italic text-muted-foreground">
            Ranks stay against the full cohort — filters only narrow the rows
            shown so reviewers can compare engineers in a similar scope.
          </span>
        </div>
      )}
      {composite.ranked.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          No engineers have a composite yet — fewer than two methods are scored
          for any competitive engineer in this snapshot.
        </p>
      ) : filteredRanked.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          No engineers match the current filters.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="w-6 py-2 pr-1" aria-hidden="true" />
                <HeaderCell
                  label="#"
                  tooltip="Composite rank (1 = highest). Ties broken deterministically by email hash so the order is stable across identical snapshots."
                  align="right"
                  className="w-8 pr-2"
                />
                <HeaderCell
                  label="Engineer"
                  tooltip="Engineer being ranked. Click any row to expand the per-method score breakdown, top lifts / drags, and PR evidence links."
                />
                <HeaderCell
                  label="Discipline · Level"
                  tooltip="Self-identified discipline (BE / FE / FS / ML / DO) and HiBob level. Drives the peer-cohort adjustment on the Adjusted column."
                />
                <HeaderCell
                  label="Squad · Pillar"
                  tooltip="Canonical squad name and pillar (or raw hb_squad / rp_department_name when the squads registry did not match). Use the Squad and Pillar filters above the table to narrow the view to a team or pillar."
                />
                <HeaderCell
                  label="A output"
                  tooltip="Lens A (output) percentile, 0–100. Built from PR count + log-impact inside the 180-day signal window."
                  align="right"
                />
                <HeaderCell
                  label="B impact"
                  tooltip="Lens B (SHAP impact) percentile, 0–100. Taken from the committed ML impact model (predicted business impact per engineer-week)."
                  align="right"
                />
                <HeaderCell
                  label="C delivery"
                  tooltip="Lens C (squad delivery) percentile, 0–100. Team-level cycle time, review rate, time-to-first-review, and in-progress PRs from Swarmia — deliberately down-weighted because it is a squad signal, not individual review evidence."
                  align="right"
                />
                <HeaderCell
                  label="D quality"
                  tooltip="Lens D (code quality) percentile, 0–100. Aggregates the per-PR LLM rubric (technical difficulty, execution quality, test adequacy, risk handling, reviewability) across PRs merged inside the signal window."
                  align="right"
                />
                <HeaderCell
                  label="Adjusted"
                  tooltip="Tenure- and role-adjusted percentile, 0–100. Lifts engineers in small discipline cohorts and damps pure-activity noise; compare against raw lens scores to see the adjustment lift."
                  align="right"
                />
                <HeaderCell
                  label="Composite"
                  tooltip="Median of the present method percentiles on 0–100. Median is used (not weighted mean) so one noisy lens cannot swing the rank."
                  align="right"
                />
                <HeaderCell
                  label="80% CI"
                  tooltip="80% bootstrap confidence band around the composite, on 0–100. Wider band = less certain rank. Orange shading = this engineer overlaps with at least one rank-neighbour (statistical tie)."
                />
                <HeaderCell
                  label="Rank CI"
                  tooltip="Same 80% band translated into rank space. '4–17' means 'with 80% confidence, this engineer is somewhere between rank 4 and rank 17' — narrow bands mean the position is firm."
                  align="right"
                />
                <HeaderCell
                  label="Methods"
                  tooltip="How many of the five composite methods (A output, B impact, C delivery, D quality, Adjusted) returned a score for this engineer. A composite requires at least 2 present methods."
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {filteredRanked.map((e) => {
                const ci = ciByHash.get(e.emailHash);
                const attr = attributionByHash.get(e.emailHash);
                const isOpen = expanded === e.emailHash;
                const rowKey = e.emailHash || e.displayName;
                const slug = profileSlugByHash[e.emailHash] ?? null;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(e.emailHash)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggle(e.emailHash);
                        }
                      }}
                      className={`cursor-pointer border-b border-border/30 align-top outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 ${
                        isOpen ? "bg-muted/30" : ""
                      }`}
                    >
                      <td className="py-2 pr-1 text-muted-foreground">
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                        {e.rank}
                      </td>
                      <td className="py-2 pr-3 text-foreground">
                        {e.displayName}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {e.discipline} · {e.levelLabel}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        <div>{e.squad ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground/80">
                          {e.pillar ?? "—"}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatPercentile(e.output)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatPercentile(e.impact)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatPercentile(e.delivery)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatPercentile(e.quality)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatPercentile(e.adjusted)}
                      </td>
                      <td className="py-2 pr-3 text-right font-display tabular-nums text-foreground">
                        {formatPercentile(e.composite)}
                      </td>
                      <td className="py-2 pr-3">
                        <ConfidenceBand entry={ci} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {ci && ci.ciRankLow !== null && ci.ciRankHigh !== null
                          ? `${ci.ciRankLow}–${ci.ciRankHigh}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {e.presentMethodCount} / 5
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/30 bg-muted/10">
                        <td colSpan={14} className="p-0">
                          {attr ? (
                            <AttributionDetails
                              entry={attr}
                              profileSlug={slug}
                            />
                          ) : (
                            <div className="p-4 text-[11px] italic text-muted-foreground">
                              No attribution entry for this engineer — the
                              snapshot likely did not include them in the
                              competitive cohort this run.
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
