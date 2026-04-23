"use client";

import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/line-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  aggregateHiresByRecruiterMonth,
  buildRecruiterSummaries,
  buildTeamChartSeries,
  currentMonthKey,
  predictHiresPerRecruiter,
  sumToTeamMonthly,
  type EmploymentRecord,
  type RecruiterRole,
  type RecruiterSummary,
  type TalentHireRow,
  type TalentTargetRow,
} from "@/lib/data/talent-utils";

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
      className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground ${
          isActive ? "text-foreground" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
        aria-sort={
          isActive
            ? active.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
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
                        {isDeparted && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                            {formatTerminationLabel(s.employment.terminationDate)}
                          </span>
                        )}
                      </div>
                      {s.employment.jobTitle && (
                        <div className="mt-0.5 text-[11px] font-normal text-muted-foreground/80">
                          {s.employment.jobTitle}
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

  const { histories, teamActual, teamProjection, summaries, latestMonth } =
    useMemo(() => {
      const now = currentMonthKey();
      const histories = aggregateHiresByRecruiterMonth(hireRows);
      const teamActual = sumToTeamMonthly(histories);
      const teamProjection = sumToTeamMonthly(
        predictHiresPerRecruiter(histories, PROJECTION_MONTHS, now),
      );
      const summaries = buildRecruiterSummaries(
        histories,
        targets,
        now,
        employmentByRecruiter,
      );
      const latestMonth = lastActualMonth(hireRows);
      return {
        histories,
        teamActual,
        teamProjection,
        summaries,
        latestMonth,
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

  // Trailing team average uses only complete months — the projection already
  // does this, so we read the first projected month (which is `avg * 1`) to
  // get an in-progress-aware headline number that matches the forecast.
  const trailing3mAvgTeam = teamProjection[0]?.hires ?? 0;
  const projectedNext3Total = teamProjection.reduce((s, m) => s + m.hires, 0);
  const hiresLast12m = teamActual
    .slice(-12)
    .reduce((s, m) => s + m.hires, 0);

  const hiresQtdTeam = targets.reduce((s, t) => s + t.hiresQtd, 0);
  const targetQtdTeam = targets.reduce((s, t) => s + t.targetQtd, 0);
  const qtdAttainment =
    targetQtdTeam > 0 ? hiresQtdTeam / targetQtdTeam : null;

  const chartSeries = buildTeamChartSeries(
    teamActual.slice(-24),
    teamProjection,
  );

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
          label="Trailing 3mo avg"
          value={formatNumber(trailing3mAvgTeam)}
          subtitle="hires / month"
        />
        <MetricCard
          label={`Projected next ${PROJECTION_MONTHS}mo`}
          value={formatNumber(projectedNext3Total, 0)}
          subtitle="hires (team)"
        />
        <MetricCard
          label="QTD vs target"
          value={
            qtdAttainment == null
              ? "—"
              : formatPercent(qtdAttainment)
          }
          subtitle={
            qtdAttainment == null
              ? undefined
              : `${formatNumber(hiresQtdTeam)} / ${formatNumber(targetQtdTeam)}`
          }
        />
      </div>

      <SectionDivider
        title="Team trajectory"
        subtitle={`Monthly hires summed across all recruiters. Data through ${formatMonthLabel(
          latestMonth,
        )}; the dashed tail projects ${PROJECTION_MONTHS} months forward at each recruiter's trailing-3-month average.`}
      />

      {chartSeries.length > 0 ? (
        <LineChart
          series={chartSeries}
          title="Team hires per month"
          yLabel="hires"
          yFormatType="number"
          modeUrl={modeUrl}
        />
      ) : (
        <TalentEmpty reason="No hire data to chart yet — refresh the Mode sync." />
      )}

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
