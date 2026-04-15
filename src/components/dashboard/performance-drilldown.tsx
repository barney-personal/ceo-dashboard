"use client";

import { useState, useMemo } from "react";
import { Search, ArrowLeft, Users, Briefcase, Flag, AlertTriangle } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PerformanceRating {
  reviewCycle: string;
  rating: number | null;
  reviewerName: string;
  flagged: boolean;
  missed: boolean;
}

export interface PersonPerformance {
  email: string;
  name: string;
  jobTitle: string;
  level: string;
  squad: string;
  pillar: string;
  function: string;
  ratings: PerformanceRating[];
}

export interface PillarGroup {
  name: string;
  count: number;
  squads: { name: string; people: PersonPerformance[] }[];
}

export interface FunctionGroup {
  name: string;
  people: PersonPerformance[];
}

export interface PerformanceDrilldownProps {
  pillarGroups: PillarGroup[];
  functionGroups: FunctionGroup[];
  reviewCycles: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
  if (rating === null) return RATING_COLOURS["null"];
  return RATING_COLOURS[rating as keyof typeof RATING_COLOURS] ?? "#9ca3af";
}

function ratingLabel(rating: number | null): string {
  if (rating === null) return RATING_LABELS["null"];
  return RATING_LABELS[rating as keyof typeof RATING_LABELS] ?? "Unknown";
}

/** "2025 H2-B Performance Review" → "H2-B" */
function shortCycleLabel(cycle: string): string {
  // Match patterns like H1, H2, H1-A, H2-B, Q1, Q3, etc.
  const match = cycle.match(/\b(H[12][-–][A-Z]|H[12]|Q[1-4])\b/i);
  if (match) return match[1].toUpperCase();
  // Fall back to the first 6 chars if nothing matches
  return cycle.slice(0, 6);
}

/** Compute distribution of ratings over a set of people for a given cycle. */
function cycleDistribution(
  people: PersonPerformance[],
  cycle: string
): { rating: number | null; count: number; pct: number }[] {
  const totals = new Map<number | null, number>();
  let total = 0;
  for (const person of people) {
    const r = person.ratings.find((x) => x.reviewCycle === cycle);
    if (!r) continue;
    total++;
    const key = r.rating;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  if (total === 0) return [];
  const entries: { rating: number | null; count: number; pct: number }[] = [];
  for (const [rating, count] of totals.entries()) {
    entries.push({ rating, count, pct: count / total });
  }
  // Sort descending by rating (5→1→null)
  return entries.sort((a, b) => {
    const av = a.rating ?? 0;
    const bv = b.rating ?? 0;
    return bv - av;
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function RatingBadge({ rating }: { rating: number | null }) {
  return (
    <span
      title={ratingLabel(rating)}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ backgroundColor: ratingColour(rating) }}
    >
      {rating ?? "—"}
    </span>
  );
}

function DistributionBar({
  people,
  cycle,
}: {
  people: PersonPerformance[];
  cycle: string;
}) {
  const segments = cycleDistribution(people, cycle);
  if (segments.length === 0) {
    return (
      <div className="h-2.5 w-full rounded-full bg-border/40" />
    );
  }
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full">
      {segments.map(({ rating, pct }, i) => (
        <div
          key={i}
          style={{ width: `${pct * 100}%`, backgroundColor: ratingColour(rating) }}
          title={`${ratingLabel(rating)}: ${Math.round(pct * 100)}%`}
        />
      ))}
    </div>
  );
}

function DistributionLegend({
  people,
  cycle,
}: {
  people: PersonPerformance[];
  cycle: string;
}) {
  const segments = cycleDistribution(people, cycle);
  if (segments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
      {segments.map(({ rating, count, pct }) => (
        <span
          key={String(rating)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground"
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: ratingColour(rating) }}
          />
          {ratingLabel(rating)}: {count} ({Math.round(pct * 100)}%)
        </span>
      ))}
    </div>
  );
}

// ── View toggle ────────────────────────────────────────────────────────────

function ViewToggle({
  view,
  onChange,
}: {
  view: "pillar" | "department";
  onChange: (v: "pillar" | "department") => void;
}) {
  return (
    <div className="flex rounded-lg border border-border/60 bg-card shadow-warm p-0.5 w-fit">
      {(["pillar", "department"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={[
            "rounded-md px-3 py-1 text-xs font-medium transition-colors capitalize",
            view === v
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          By {v === "pillar" ? "Pillar" : "Department"}
        </button>
      ))}
    </div>
  );
}

// ── Distribution table (Level 1 + Level 2) ───────────────────────────────

function DistributionTable({
  rows,
  cycle,
  onSelect,
}: {
  rows: { name: string; people: PersonPerformance[] }[];
  cycle: string;
  onSelect: (name: string) => void;
}) {
  // Compute distribution for each row
  const rowData = rows.map((row) => {
    const dist = cycleDistribution(row.people, cycle);
    const distMap = new Map(dist.map((d) => [d.rating, d]));
    const reviewed = dist.reduce((sum, d) => sum + d.count, 0);
    return { ...row, distMap, reviewed };
  });

  // Compute totals
  const totalPeople = rowData.reduce((sum, r) => sum + r.people.length, 0);
  const totalReviewed = rowData.reduce((sum, r) => sum + r.reviewed, 0);
  const totalDist = new Map<number | null, number>();
  for (const r of rowData) {
    for (const [rating, d] of r.distMap) {
      totalDist.set(rating, (totalDist.get(rating) ?? 0) + d.count);
    }
  }

  const ratingColumns = [5, 4, 3, 2, 1] as const;

  function pct(count: number, total: number): string {
    if (total === 0) return "—";
    return `${Math.round((count / total) * 100)}%`;
  }

  function pctCell(count: number, total: number, rating: number | null) {
    if (total === 0) return <span className="text-muted-foreground/30">—</span>;
    const percentage = Math.round((count / total) * 100);
    if (count === 0) return <span className="text-muted-foreground/30">—</span>;
    return (
      <span className="font-medium" style={{ color: ratingColour(rating) }}>
        {percentage}%
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-border/30">
            <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Name
            </th>
            <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              People
            </th>
            {ratingColumns.map((r) => (
              <th
                key={r}
                className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60"
              >
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: ratingColour(r) }}
                  />
                  {r}
                </span>
              </th>
            ))}
            <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: ratingColour(null) }}
                />
                Missed
              </span>
            </th>
            <th className="w-40 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Distribution
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {rowData.map((row) => {
            const missed = row.distMap.get(null)?.count ?? 0;
            return (
              <tr
                key={row.name}
                onClick={() => onSelect(row.name)}
                className="cursor-pointer transition-colors hover:bg-muted/30"
              >
                <td className="px-5 py-3 font-medium text-foreground">{row.name}</td>
                <td className="px-3 py-3 text-right font-mono text-xs text-muted-foreground">
                  {row.people.length}
                </td>
                {ratingColumns.map((r) => (
                  <td key={r} className="px-3 py-3 text-center text-xs">
                    {pctCell(row.distMap.get(r)?.count ?? 0, row.reviewed, r)}
                  </td>
                ))}
                <td className="px-3 py-3 text-center text-xs">
                  {pctCell(missed, row.reviewed, null)}
                </td>
                <td className="px-3 py-3">
                  <DistributionBar people={row.people} cycle={cycle} />
                </td>
              </tr>
            );
          })}
        </tbody>
        {rowData.length > 1 && (
          <tfoot>
            <tr className="border-t border-border/40 bg-muted/10">
              <td className="px-5 py-3 text-xs font-semibold text-muted-foreground">Total</td>
              <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-muted-foreground">
                {totalPeople}
              </td>
              {ratingColumns.map((r) => (
                <td key={r} className="px-3 py-3 text-center text-xs">
                  {pctCell(totalDist.get(r) ?? 0, totalReviewed, r)}
                </td>
              ))}
              <td className="px-3 py-3 text-center text-xs">
                {pctCell(totalDist.get(null) ?? 0, totalReviewed, null)}
              </td>
              <td className="px-3 py-3" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── Level 3: Individual table ──────────────────────────────────────────────

function IndividualTable({
  people,
  cycles,
  onSelect,
}: {
  people: PersonPerformance[];
  cycles: string[];
  onSelect: (person: PersonPerformance) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border/30">
            <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Name
            </th>
            <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Level
            </th>
            {cycles.map((c) => (
              <th
                key={c}
                className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60"
              >
                {shortCycleLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {people.map((person) => (
            <tr
              key={person.email}
              onClick={() => onSelect(person)}
              className="cursor-pointer transition-colors hover:bg-muted/30"
            >
              <td className="px-5 py-3">
                <span className="font-medium text-foreground">{person.name}</span>
                {person.jobTitle && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {person.jobTitle}
                  </span>
                )}
              </td>
              <td className="px-3 py-3">
                {person.level ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {person.level}
                  </span>
                ) : (
                  <span className="text-muted-foreground/40">—</span>
                )}
              </td>
              {cycles.map((c) => {
                const r = person.ratings.find((x) => x.reviewCycle === c);
                return (
                  <td key={c} className="px-3 py-3 text-center">
                    {r ? (
                      <div className="flex items-center justify-center gap-1">
                        <RatingBadge rating={r.rating} />
                        {r.flagged && (
                          <Flag className="h-3 w-3 text-orange-500" />
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/30 text-xs">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Level 4: Person detail ─────────────────────────────────────────────────

function PersonDetail({
  person,
  cycles,
  backLabel,
  onBack,
}: {
  person: PersonPerformance;
  cycles: string[];
  backLabel: string;
  onBack: () => void;
}) {
  // Build ordered rating history using the canonical cycle order
  const orderedRatings = cycles
    .map((c) => person.ratings.find((r) => r.reviewCycle === c) ?? null)
    .filter(Boolean) as PerformanceRating[];

  // Include any ratings for cycles not in the prop list (edge case)
  const extraRatings = person.ratings.filter(
    (r) => !cycles.includes(r.reviewCycle)
  );

  const allRatings = [...orderedRatings, ...extraRatings];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </button>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm space-y-5">
        {/* Header */}
        <div>
          <h3 className="text-xl font-semibold text-foreground">{person.name}</h3>
          {person.jobTitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{person.jobTitle}</p>
          )}
        </div>

        {/* Metadata */}
        <div className="grid gap-4 sm:grid-cols-2">
          {person.level && (
            <div className="flex items-start gap-2.5">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Level
                </p>
                <p className="text-sm text-foreground">{person.level}</p>
              </div>
            </div>
          )}
          {person.squad && (
            <div className="flex items-start gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Squad
                </p>
                <p className="text-sm text-foreground">{person.squad}</p>
              </div>
            </div>
          )}
          {person.pillar && (
            <div className="flex items-start gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Pillar
                </p>
                <p className="text-sm text-foreground">{person.pillar}</p>
              </div>
            </div>
          )}
          {person.function && (
            <div className="flex items-start gap-2.5">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Function
                </p>
                <p className="text-sm text-foreground">{person.function}</p>
              </div>
            </div>
          )}
        </div>

        {/* Rating history */}
        {allRatings.length > 0 && (
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Rating History
            </p>
            <div className="space-y-2">
              {allRatings.map((r) => (
                <div
                  key={r.reviewCycle}
                  className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-4 py-3"
                >
                  <RatingBadge rating={r.rating} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground">
                      {r.reviewCycle}
                    </span>
                    {r.reviewerName && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        reviewed by {r.reviewerName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.flagged && (
                      <span
                        title="Flagged"
                        className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-600"
                      >
                        <Flag className="h-3 w-3" />
                        Flagged
                      </span>
                    )}
                    {r.missed && (
                      <span
                        title="Review missed"
                        className="flex items-center gap-1 rounded-full bg-gray-400/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
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
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function PerformanceDrilldown({
  pillarGroups,
  functionGroups,
  reviewCycles,
}: PerformanceDrilldownProps) {
  const [view, setView] = useState<"pillar" | "department">("pillar");
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedFunction, setSelectedFunction] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonPerformance | null>(null);
  const [search, setSearch] = useState("");

  const latestCycle = reviewCycles[reviewCycles.length - 1] ?? "";

  const activePillar = pillarGroups.find((p) => p.name === selectedPillar);
  const activeSquad = activePillar?.squads.find((s) => s.name === selectedSquad);
  const activeFunction = functionGroups.find((f) => f.name === selectedFunction);

  // People to show in the individual table — either squad or function path
  const activeTablePeople: PersonPerformance[] = useMemo(() => {
    if (activeSquad) return activeSquad.people;
    if (activeFunction) return activeFunction.people;
    return [];
  }, [activeSquad, activeFunction]);

  const filteredTablePeople = useMemo(() => {
    if (!search.trim()) return activeTablePeople;
    const q = search.toLowerCase();
    return activeTablePeople.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.jobTitle.toLowerCase().includes(q) ||
        p.level.toLowerCase().includes(q)
    );
  }, [activeTablePeople, search]);

  // Handle view toggle: reset all drill-down state
  function handleViewChange(v: "pillar" | "department") {
    setView(v);
    setSelectedPillar(null);
    setSelectedSquad(null);
    setSelectedFunction(null);
    setSelectedPerson(null);
    setSearch("");
  }

  // ── Determine which level we're at ────────────────────────────────────────

  const atPersonDetail = selectedPerson !== null;
  const atIndividualTable =
    !atPersonDetail && (activeSquad !== undefined || activeFunction !== undefined);
  const atSquadList = !atIndividualTable && !atPersonDetail && activePillar !== undefined;
  const atTopLevel = !atPersonDetail && !atIndividualTable && !atSquadList;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header + view toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Performance Ratings
          </h3>
          {atTopLevel && latestCycle && (
            <p className="mt-0.5 text-xs text-muted-foreground/70">
              Showing distributions from <span className="font-medium text-muted-foreground">{latestCycle}</span>
            </p>
          )}
        </div>
        {atTopLevel && (
          <ViewToggle view={view} onChange={handleViewChange} />
        )}
      </div>

      {/* ── Person detail (Level 4) ── */}
      {atPersonDetail && selectedPerson && (
        <PersonDetail
          person={selectedPerson}
          cycles={reviewCycles}
          backLabel={activeSquad?.name ?? activeFunction?.name ?? "Back"}
          onBack={() => setSelectedPerson(null)}
        />
      )}

      {/* ── Individual table (Level 3) ── */}
      {atIndividualTable && (
        <div className="space-y-4">
          {/* Breadcrumb back button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedSquad(null);
                setSelectedFunction(null);
                setSearch("");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {activePillar?.name ?? activeFunction?.name ?? "Back"}
            </button>
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                {activeSquad?.name ?? activeFunction?.name}
              </h3>
              <span className="text-xs text-muted-foreground">
                {activeTablePeople.length} {activeTablePeople.length === 1 ? "person" : "people"}
              </span>
            </div>
          </div>

          {/* Search */}
          {activeTablePeople.length > 8 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people..."
                className="w-full rounded-xl border border-border/60 bg-card py-2.5 pl-10 pr-4 text-sm outline-none shadow-warm placeholder:text-muted-foreground/40 focus:border-primary/30"
              />
            </div>
          )}

          {filteredTablePeople.length > 0 ? (
            <IndividualTable
              people={filteredTablePeople}
              cycles={reviewCycles}
              onSelect={setSelectedPerson}
            />
          ) : search.trim() ? (
            <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No results for &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Squad list (Level 2, pillar path) ── */}
      {atSquadList && activePillar && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedPillar(null);
                setSearch("");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All pillars
            </button>
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                {activePillar.name}
              </h3>
              <span className="text-xs text-muted-foreground">
                {activePillar.count} people · {activePillar.squads.length} squads
              </span>
            </div>
          </div>

          <DistributionTable
            rows={activePillar.squads}
            cycle={latestCycle}
            onSelect={(name) => {
              setSelectedSquad(name);
              setSearch("");
            }}
          />
        </div>
      )}

      {/* ── Top level (Level 1) ── */}
      {atTopLevel && (
        <>
          {view === "pillar" && (
            <DistributionTable
              rows={pillarGroups.map((g) => ({
                name: g.name,
                people: g.squads.flatMap((s) => s.people),
              }))}
              cycle={latestCycle}
              onSelect={(name) => {
                setSelectedPillar(name);
                setSearch("");
              }}
            />
          )}

          {view === "department" && (
            <DistributionTable
              rows={functionGroups}
              cycle={latestCycle}
              onSelect={(name) => {
                setSelectedFunction(name);
                setSearch("");
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
