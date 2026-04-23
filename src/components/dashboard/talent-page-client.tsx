"use client";

import { useMemo, useState } from "react";
import { HireForecastChart } from "@/components/charts/hire-forecast-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";
import {
  addMonths,
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  currentMonthKey,
  sumToTeamMonthly,
  type EmploymentRecord,
  type RecruiterRole,
  type RecruiterSummary,
  type TalentHireRow,
  type TalentTargetRow,
} from "@/lib/data/talent-utils";
import {
  forecastFromActiveCapacity,
  totalForecastOverRange,
} from "@/lib/data/talent-forecast";
import { forecastFromRoster } from "@/lib/data/talent-forecast-roster";
import { TALENT_ROSTER_AS_OF } from "@/lib/config/talent-roster";

interface TalentPageClientProps {
  hireRows: TalentHireRow[];
  targets: TalentTargetRow[];
  employmentByRecruiter: Record<string, EmploymentRecord>;
  modeUrl: string;
  emptyReason: string | null;
}

type EmploymentFilter = "active" | "all" | "departed";
type RoleFilter = RecruiterRole | "all";

const PROJECTION_MONTHS = 3;
const FORECAST_THROUGH = "2027-12";
// Per-person productivity window — trailing-3 reflects ramp for new joiners
// and a stable steady state for tenured TPs.
const PRODUCTIVITY_WINDOW_MONTHS = 3;

function formatNumber(n: number, fractionDigits = 1): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  return n.toFixed(fractionDigits);
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

function attainmentClass(attainment: number | null): string {
  if (attainment == null) return "text-muted-foreground";
  if (attainment >= 1) return "text-positive";
  if (attainment >= 0.7) return "text-foreground";
  return "text-negative";
}

function lastActualMonth(rows: TalentHireRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.actionType !== "hires" || !(row.cnt > 0)) continue;
    const month = row.actionDate.slice(0, 7);
    if (!latest || month > latest) latest = month;
  }
  return latest;
}

function formatMonthLabel(month: string | null): string {
  if (!month) return "—";
  const [y, m] = month.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ForecastMethodologyCard({
  activeTpCount,
  eligibleTpCount,
  nonRosterGap,
  forecast2026H2,
  forecast2027,
  forecastMonth,
}: {
  activeTpCount: number;
  eligibleTpCount: number;
  nonRosterGap: number;
  forecast2026H2: { low: number; mid: number; high: number } | null;
  forecast2027: { low: number; mid: number; high: number } | null;
  forecastMonth: { low: number; mid: number; high: number } | null | undefined;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">
          How the forecast works
        </span>
      </div>
      <div className="space-y-4 px-4 py-4 text-xs leading-relaxed text-muted-foreground">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            Inputs
          </div>
          <p className="mt-1">
            <span className="font-semibold text-foreground">
              {activeTpCount} active Talent Partners
            </span>{" "}
            on Lucy&apos;s Apr 23 roster.{" "}
            <span className="font-semibold text-foreground">
              {eligibleTpCount}
            </span>{" "}
            have ≥3 months of post-ramp history (first 2 months of tenure
            dropped to strip ramp-up noise); the rest contribute what partial
            post-ramp data they have.
          </p>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            Model
          </div>
          <p className="mt-1">
            For each TP: <span className="font-semibold text-foreground">median</span>{" "}
            of their post-ramp monthly hires (robust to one-off spikes).
            Summed across all active TPs, plus a{" "}
            <span className="font-semibold text-foreground">
              {nonRosterGap.toFixed(1)} hires/mo
            </span>{" "}
            non-roster gap (sourcers, managers, departed TPs, alias mismatches —
            historically observed in the last 6 months).
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            Per-TP backtest MAE at h=3:{" "}
            <span className="font-mono text-foreground">~2.5 hires/mo</span>{" "}
            — ~3× tighter than the previous team-total ensemble, which
            over-extrapolated from a single spike month.
          </p>
        </div>
        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            Forecast band · P10 — P50 — P90
          </div>
          <ForecastRow
            label="Next month"
            data={forecastMonth ?? null}
          />
          <div className="h-px bg-border/50" />
          <ForecastRow label="2026 H2 · May – Dec" data={forecast2026H2} />
          <ForecastRow label="2027 · full year" data={forecast2027} />
        </div>
        <div className="text-[11px] italic text-muted-foreground/70">
          Flat by design — respects the domain prior that the current roster
          won&apos;t ramp further. New joiners lift the forecast as they
          accumulate post-ramp history; departures drop it immediately.
        </div>
      </div>
    </div>
  );
}

function ForecastRow({
  label,
  data,
  unit,
}: {
  label: string;
  data: { low: number; mid: number; high: number } | null;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-muted-foreground/80">{label}</span>
      {data ? (
        <span className="tabular-nums">
          <span className="font-mono text-[11px] text-muted-foreground/60">
            {data.low.toFixed(0)}–
          </span>
          <span className="text-sm font-semibold text-foreground">
            {data.mid.toFixed(0)}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/60">
            –{data.high.toFixed(0)}
          </span>
          {unit && (
            <span className="ml-1 text-[10px] text-muted-foreground/60">
              {unit}
            </span>
          )}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground/50">—</span>
      )}
    </div>
  );
}

function TalentEmpty({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-warning" />
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}

type SortKey =
  | "recruiter"
  | "role"
  | "tech"
  | "hiresLast12m"
  | "trailing3mAvg"
  | "projectedNext3m"
  | "hiresQtd"
  | "targetQtd"
  | "attainmentQtd";

type SortDirection = "asc" | "desc";

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

const DEFAULT_DIRECTION_BY_KEY: Record<SortKey, SortDirection> = {
  recruiter: "asc",
  role: "asc",
  tech: "asc",
  hiresLast12m: "desc",
  trailing3mAvg: "desc",
  projectedNext3m: "desc",
  hiresQtd: "desc",
  targetQtd: "desc",
  attainmentQtd: "desc",
};

function compareNullable(
  a: number | string | null,
  b: number | string | null,
  direction: SortDirection,
): number {
  // Nulls always sink to the bottom regardless of sort direction — they
  // represent missing data, not a min/max value.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const mult = direction === "asc" ? 1 : -1;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * mult;
  }
  return (Number(a) - Number(b)) * mult;
}

function sortSummaries(
  summaries: RecruiterSummary[],
  sort: SortState,
): RecruiterSummary[] {
  return [...summaries].sort((a, b) => {
    const aVal = a[sort.key];
    const bVal = b[sort.key];
    const primary = compareNullable(
      aVal as number | string | null,
      bVal as number | string | null,
      sort.direction,
    );
    if (primary !== 0) return primary;
    // Stable tiebreak on recruiter name for predictable ordering.
    return a.recruiter.localeCompare(b.recruiter);
  });
}

interface SortableHeaderProps {
  label: string;
  sortKey: SortKey;
  active: SortState;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}

function SortableHeader({ label, sortKey, active, onSort, align = "left" }: SortableHeaderProps) {
  const isActive = active.key === sortKey;
  const Icon = !isActive ? ArrowUpDown : active.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={
        isActive
          ? active.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground ${
          isActive ? "text-foreground" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <Icon
          className={`h-3 w-3 ${isActive ? "opacity-100" : "opacity-40"}`}
          aria-hidden
        />
        <span>{label}</span>
      </button>
    </th>
  );
}

const EMPLOYMENT_FILTERS: {
  value: EmploymentFilter;
  label: string;
}[] = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  { value: "departed", label: "Departed" },
];

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: "talent_partner", label: "Talent Partner" },
  { value: "sourcer", label: "Sourcer" },
  { value: "other", label: "Other" },
  { value: "all", label: "All" },
];

const ROLE_LABELS: Record<RecruiterRole, string> = {
  talent_partner: "Talent Partner",
  sourcer: "Sourcer",
  other: "Other",
};

interface FilterButtonGroupProps<T extends string> {
  ariaLabel: string;
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  counts: Record<T, number>;
  onChange: (next: T) => void;
}

function FilterButtonGroup<T extends string>({
  ariaLabel,
  legend,
  options,
  value,
  counts,
  onChange,
}: FilterButtonGroupProps<T>) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
        {legend}
      </span>
      <div
        role="group"
        aria-label={ariaLabel}
        className="inline-flex shrink-0 rounded-md border border-border/60 bg-background"
      >
        {options.map((opt, i) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              } ${i !== 0 ? "border-l border-border/60" : ""}`}
              aria-pressed={active}
            >
              {opt.label}{" "}
              <span className={active ? "opacity-70" : "opacity-60"}>
                ({counts[opt.value] ?? 0})
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function filterByEmployment(
  summaries: RecruiterSummary[],
  filter: EmploymentFilter,
): RecruiterSummary[] {
  if (filter === "all") return summaries;
  if (filter === "active") {
    // Treat "unknown" as active — external contractors, hiring managers with
    // hires attributed to them, etc. are generally still engaged. Explicit
    // "departed" is the only thing we hide.
    return summaries.filter((s) => s.employment.status !== "departed");
  }
  return summaries.filter((s) => s.employment.status === "departed");
}

function filterByRole(
  summaries: RecruiterSummary[],
  filter: RoleFilter,
): RecruiterSummary[] {
  if (filter === "all") return summaries;
  return summaries.filter((s) => s.role === filter);
}

function formatTerminationLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  const label = date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return date.getTime() > today.getTime()
    ? `leaving ${label}`
    : `left ${label}`;
}

interface RecruiterTableProps {
  summaries: RecruiterSummary[];
  employmentCounts: Record<EmploymentFilter, number>;
  roleCounts: Record<RoleFilter, number>;
  employmentFilter: EmploymentFilter;
  roleFilter: RoleFilter;
  onEmploymentChange: (filter: EmploymentFilter) => void;
  onRoleChange: (filter: RoleFilter) => void;
}

function RecruiterTable({
  summaries,
  employmentCounts,
  roleCounts,
  employmentFilter,
  roleFilter,
  onEmploymentChange,
  onRoleChange,
}: RecruiterTableProps) {
  const [sort, setSort] = useState<SortState>({
    key: "hiresLast12m",
    direction: "desc",
  });

  const sorted = useMemo(() => sortSummaries(summaries, sort), [summaries, sort]);

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: DEFAULT_DIRECTION_BY_KEY[key] },
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex flex-col gap-3 border-b border-border/50 px-5 py-3">
        <div>
          <span className="text-sm font-semibold text-foreground">
            Recruiter performance
          </span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Last 12 months of activity, per-recruiter trailing-3-month average,
            projected next {PROJECTION_MONTHS} months, and current-quarter
            hires vs target. Click any column header to sort.
          </p>
          <p className="mt-1 text-[11px] italic text-muted-foreground/70">
            Employment status reflects Lucy's roster as of {TALENT_ROSTER_AS_OF}
            , overriding HiBob where HR hasn&apos;t yet processed an exit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <FilterButtonGroup
            ariaLabel="Role filter"
            legend="Role"
            options={ROLE_FILTERS}
            value={roleFilter}
            counts={roleCounts}
            onChange={onRoleChange}
          />
          <FilterButtonGroup
            ariaLabel="Employment filter"
            legend="Status"
            options={EMPLOYMENT_FILTERS}
            value={employmentFilter}
            counts={employmentCounts}
            onChange={onEmploymentChange}
          />
        </div>
      </div>
      {summaries.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No recruiters match this filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <SortableHeader label="Recruiter" sortKey="recruiter" active={sort} onSort={handleSort} />
                <SortableHeader label="Role" sortKey="role" active={sort} onSort={handleSort} />
                <SortableHeader label="Pillar" sortKey="tech" active={sort} onSort={handleSort} />
                <SortableHeader label="Hires L12m" sortKey="hiresLast12m" active={sort} onSort={handleSort} align="right" />
                <SortableHeader label="Trailing 3mo" sortKey="trailing3mAvg" active={sort} onSort={handleSort} align="right" />
                <SortableHeader
                  label={`Proj. next ${PROJECTION_MONTHS}mo`}
                  sortKey="projectedNext3m"
                  active={sort}
                  onSort={handleSort}
                  align="right"
                />
                <SortableHeader label="QTD" sortKey="hiresQtd" active={sort} onSort={handleSort} align="right" />
                <SortableHeader label="Target" sortKey="targetQtd" active={sort} onSort={handleSort} align="right" />
                <SortableHeader label="Attainment" sortKey="attainmentQtd" active={sort} onSort={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const isDeparted = s.employment.status === "departed";
                return (
                  <tr
                    key={s.recruiter}
                    className={`border-t border-border/40 hover:bg-muted/30 ${
                      isDeparted ? "text-muted-foreground/80" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <span className={isDeparted ? "opacity-70" : ""}>
                          {s.recruiter}
                        </span>
                        {isDeparted &&
                          s.employment.terminationDate && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                              {formatTerminationLabel(s.employment.terminationDate)}
                            </span>
                          )}
                        {isDeparted && !s.employment.terminationDate && (
                          <span
                            className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider text-warning"
                            title={s.employment.overrideNote ?? undefined}
                          >
                            Exit (HR lag)
                          </span>
                        )}
                      </div>
                      {s.employment.jobTitle && (
                        <div className="mt-0.5 text-[11px] font-normal text-muted-foreground/80">
                          {s.employment.jobTitle}
                        </div>
                      )}
                      {s.employment.overrideNote && (
                        <div className="mt-0.5 text-[11px] font-normal italic text-muted-foreground/60">
                          {s.employment.overrideNote}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ROLE_LABELS[s.role]}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {s.tech ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatNumber(s.hiresLast12m, 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatNumber(s.trailing3mAvg)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatNumber(s.projectedNext3m)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {s.hiresQtd == null ? "—" : formatNumber(s.hiresQtd)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {s.targetQtd == null ? "—" : formatNumber(s.targetQtd)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-medium tabular-nums ${attainmentClass(s.attainmentQtd)}`}
                    >
                      {s.attainmentQtd == null
                        ? "—"
                        : formatPercent(s.attainmentQtd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TalentPageClient({
  hireRows,
  targets,
  employmentByRecruiter,
  modeUrl,
  emptyReason,
}: TalentPageClientProps) {
  const [employmentFilter, setEmploymentFilter] =
    useState<EmploymentFilter>("active");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("talent_partner");

  const {
    histories,
    teamActual,
    summaries,
    latestMonth,
    forecast,
    roster,
    activeTpCount,
    teamMeanMonthly,
    forecast2026H2,
    forecast2027,
  } = useMemo(() => {
    const now = currentMonthKey();
    const histories = aggregateHiresByRecruiterMonth(hireRows);
    const teamActual = sumToTeamMonthly(histories);
    const summaries = buildRecruiterSummaries(
      histories,
      targets,
      now,
      employmentByRecruiter,
    );
    const latestMonth = lastActualMonth(hireRows);

    // Headline forecast: roster-anchored, per-TP median of post-ramp history
    // (first 2 months of each TP's tenure dropped), summed across today's 17
    // active Talent Partners, plus a historical non-roster gap (sourcers,
    // departed TPs who hired before leaving, managers). Per-TP backtest at
    // h=3 gives team MAE ≈ 2.5 hires/mo — ~3× tighter than the team-total
    // trend-aware model (which over-extrapolates March's spike). See
    // scripts/backtest-per-tp.ts.
    const activeTpNames = summaries
      .filter(
        (s) => s.employment.status !== "departed" && s.role === "talent_partner",
      )
      .map((s) => s.recruiter);
    const forecastStart = addMonths(latestMonth ?? now, 1);
    const roster = forecastFromRoster(
      histories,
      activeTpNames,
      forecastStart,
      FORECAST_THROUGH,
      { currentMonth: now },
    );
    const forecast = roster.forecast;

    // Secondary view: capacity snapshot (retained for the per-TP breakdown
    // and the steady-state headline card).
    const capacity = forecastFromActiveCapacity(
      histories,
      activeTpNames,
      forecastStart,
      FORECAST_THROUGH,
      {
        productivityWindowMonths: PRODUCTIVITY_WINDOW_MONTHS,
        currentMonth: now,
      },
    );

    const forecast2026H2 = totalForecastOverRange(forecast, {
      from: "2026-05",
      to: "2026-12",
    });
    const forecast2027 = totalForecastOverRange(forecast, {
      from: "2027-01",
      to: "2027-12",
    });

    return {
      histories,
      teamActual,
      summaries,
      latestMonth,
      forecast,
      roster,
      activeTpCount: activeTpNames.length,
      teamMeanMonthly: capacity.teamMeanMonthly,
      forecast2026H2,
      forecast2027,
    };
  }, [hireRows, targets, employmentByRecruiter]);

  // Counts are computed against the *other* dimension so each filter row
  // shows how many would match if you switched only it.
  const employmentCounts = useMemo(() => {
    const scoped = filterByRole(summaries, roleFilter);
    return {
      active: scoped.filter((s) => s.employment.status !== "departed").length,
      departed: scoped.filter((s) => s.employment.status === "departed").length,
      all: scoped.length,
    };
  }, [summaries, roleFilter]);

  const roleCounts = useMemo(() => {
    const scoped = filterByEmployment(summaries, employmentFilter);
    return {
      talent_partner: scoped.filter((s) => s.role === "talent_partner").length,
      sourcer: scoped.filter((s) => s.role === "sourcer").length,
      other: scoped.filter((s) => s.role === "other").length,
      all: scoped.length,
    };
  }, [summaries, employmentFilter]);

  const filteredSummaries = useMemo(
    () => filterByRole(filterByEmployment(summaries, employmentFilter), roleFilter),
    [summaries, employmentFilter, roleFilter],
  );

  if (emptyReason) {
    return <TalentEmpty reason={emptyReason} />;
  }

  const hiresLast12m = teamActual
    .slice(-12)
    .reduce((s, m) => s + m.hires, 0);

  const hiresQtdTeam = targets.reduce((s, t) => s + t.hiresQtd, 0);
  const targetQtdTeam = targets.reduce((s, t) => s + t.targetQtd, 0);
  const qtdAttainment =
    targetQtdTeam > 0 ? hiresQtdTeam / targetQtdTeam : null;

  // Chart data for the purpose-built ForecastChart: 24 months of solid
  // actuals + forecast fan (band + mid line) starting the month after.
  const actualTail = teamActual.slice(-24);
  const actualSeries = actualTail.map((m) => ({
    date: `${m.month}-01`,
    value: m.hires,
  }));
  const forecastSeries = forecast.map((m) => ({
    date: `${m.month}-01`,
    low: m.low,
    mid: m.mid,
    high: m.high,
  }));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Hires · last 12 months"
          value={formatNumber(hiresLast12m, 0)}
          subtitle="total"
          modeUrl={modeUrl}
        />
        <MetricCard
          label="Steady-state capacity"
          value={formatNumber(teamMeanMonthly)}
          subtitle={
            forecast[0]
              ? `${formatNumber(forecast[0].low, 0)}–${formatNumber(forecast[0].high, 0)} / mo · ${activeTpCount} active TPs`
              : "hires / month"
          }
        />
        <MetricCard
          label="2027 · forecast (year)"
          value={
            forecast2027 ? formatNumber(forecast2027.mid, 0) : "—"
          }
          subtitle={
            forecast2027
              ? `range ${formatNumber(forecast2027.low, 0)}–${formatNumber(forecast2027.high, 0)}`
              : undefined
          }
        />
        <MetricCard
          label="QTD vs target"
          value={
            qtdAttainment == null ? "—" : formatPercent(qtdAttainment)
          }
          subtitle={
            qtdAttainment == null
              ? undefined
              : `${formatNumber(hiresQtdTeam)} / ${formatNumber(targetQtdTeam)}`
          }
        />
      </div>

      <SectionDivider
        title="Team trajectory & forecast"
        subtitle="Monthly hires through today, with a trend-aware forecast to the end of 2027."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        {actualSeries.length > 0 ? (
          <HireForecastChart
            title="Team hires per month"
            subtitle={`Actual through ${formatMonthLabel(latestMonth)}; forecast = Σ per-TP post-ramp median across ${activeTpCount} active TPs + historical non-roster gap. Per-TP backtest MAE ≈ 2.5 hires/mo at h=3.`}
            actual={actualSeries}
            forecast={forecastSeries}
            yLabel="hires / month"
            modeUrl={modeUrl}
          />
        ) : (
          <TalentEmpty reason="No hire data to chart yet — refresh the Mode sync." />
        )}
        <ForecastMethodologyCard
          activeTpCount={activeTpCount}
          eligibleTpCount={
            roster.contributors.filter((c) => c.eligible).length
          }
          nonRosterGap={roster.nonRosterGap}
          forecast2026H2={forecast2026H2}
          forecast2027={forecast2027}
          forecastMonth={forecast[0]}
        />
      </div>

      <SectionDivider
        title="Per-recruiter breakdown"
        subtitle="Current-quarter attainment and projected 3-month output for each recruiter on the target roster."
      />

      <RecruiterTable
        summaries={filteredSummaries}
        employmentCounts={employmentCounts}
        roleCounts={roleCounts}
        employmentFilter={employmentFilter}
        roleFilter={roleFilter}
        onEmploymentChange={setEmploymentFilter}
        onRoleChange={setRoleFilter}
      />

      {histories.length === 0 && (
        <TalentEmpty reason="No per-recruiter hire history available." />
      )}
    </>
  );
}
