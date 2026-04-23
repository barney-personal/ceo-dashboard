// Client-safe pure transformations for the Talent dashboard.
// No DB, no Mode client — just types and math. Paired with talent.ts which
// handles the server-side Mode load.

export interface TalentHireRow {
  recruiter: string;
  actionType: string;
  actionDate: string;
  cnt: number;
  role: string;
  department: string;
  candidate: string;
  level: string | null;
  tech: string | null;
}

export interface TalentTargetRow {
  recruiter: string;
  tech: string;
  hiresQtd: number;
  targetQtd: number;
  teamQtd: number;
}

export interface MonthlyHires {
  month: string;
  hires: number;
}

export interface RecruiterHistory {
  recruiter: string;
  monthly: MonthlyHires[];
}

export type EmploymentStatus = "active" | "departed" | "unknown";

export interface EmploymentRecord {
  /** "active" = currently at Cleo (or on notice with future termination date).
   *  "departed" = has a termination date in the past.
   *  "unknown" = no match in the HR employees query — likely external or
   *  spelled differently than HR has them. */
  status: EmploymentStatus;
  /** Present for status = "departed". ISO `YYYY-MM-DD`. */
  terminationDate: string | null;
  /** Display name as HR has it (may differ slightly from the recruiter name). */
  matchedName: string | null;
  /** Department from HR — useful for distinguishing People-team recruiters
   *  from hiring managers who happen to have been attributed hires. */
  department: string | null;
}

export interface RecruiterSummary {
  recruiter: string;
  tech: string | null;
  hiresLast12m: number;
  hiresLast3m: number;
  trailing3mAvg: number;
  projectedNext3m: number;
  hiresQtd: number | null;
  targetQtd: number | null;
  attainmentQtd: number | null;
  employment: EmploymentRecord;
}

export interface TalentData {
  hireRows: TalentHireRow[];
  targets: TalentTargetRow[];
  employmentByRecruiter: Record<string, EmploymentRecord>;
  syncedAt: Date | null;
}

const HIRES_ACTION = "hires";

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * YYYY-MM for "now" — used to decide which month of the history is still
 * in progress so the trailing-3mo forecast doesn't get dragged down by a
 * half-finished current month.
 */
export function currentMonthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

export function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string): string[] {
  if (from > to) return [];
  const result: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    result.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return result;
}

export function onlyHires(rows: TalentHireRow[]): TalentHireRow[] {
  // `talent_summary_gh` includes `cnt = 0` placeholder rows for the current
  // quarter so every recruiter appears in the roster even before they've
  // logged their first hire. Those rows must not set the month axis or they
  // pad the trailing-3-month window with zeros and flatten the projection.
  return rows.filter((r) => r.actionType === HIRES_ACTION && r.cnt > 0);
}

/**
 * Aggregate hire rows into per-recruiter monthly counts. Months without any
 * hires for a recruiter are filled with zero up to the overall last month
 * seen across *all* recruiters, so histories align on a common axis.
 */
export function aggregateHiresByRecruiterMonth(
  rows: TalentHireRow[],
): RecruiterHistory[] {
  const hires = onlyHires(rows).filter(
    (r) => r.recruiter && r.recruiter.trim().length > 0,
  );
  if (hires.length === 0) return [];

  const allMonths = new Set<string>();
  const byRecruiter = new Map<string, Map<string, number>>();

  for (const row of hires) {
    const month = monthKey(row.actionDate);
    if (!month) continue;
    allMonths.add(month);
    const bucket = byRecruiter.get(row.recruiter) ?? new Map<string, number>();
    bucket.set(month, (bucket.get(month) ?? 0) + (row.cnt || 0));
    byRecruiter.set(row.recruiter, bucket);
  }

  if (allMonths.size === 0) return [];

  const sortedMonths = [...allMonths].sort();
  const firstMonth = sortedMonths[0];
  const lastMonth = sortedMonths[sortedMonths.length - 1];
  const axis = monthsBetween(firstMonth, lastMonth);

  const result: RecruiterHistory[] = [];
  for (const [recruiter, monthly] of byRecruiter.entries()) {
    const filled = axis.map((month) => ({
      month,
      hires: monthly.get(month) ?? 0,
    }));
    result.push({ recruiter, monthly: filled });
  }
  result.sort((a, b) => a.recruiter.localeCompare(b.recruiter));
  return result;
}

/**
 * Trailing 3-month average of the *last 3 actual months* in the history.
 * Returns 0 if there is no data. When fewer than 3 months are available the
 * mean is taken over what exists.
 */
export function trailing3mAvg(monthly: MonthlyHires[]): number {
  if (monthly.length === 0) return 0;
  const slice = monthly.slice(-3);
  const sum = slice.reduce((s, m) => s + m.hires, 0);
  return sum / slice.length;
}

/**
 * Per-recruiter projection — horizonMonths of the trailing-3mo average,
 * starting the month after the last actual month.
 *
 * When `currentMonth` matches the most-recent history entry, that entry is
 * treated as a partial in-progress month: the trailing window uses the 3
 * complete months before it, and the projection begins at `currentMonth`.
 * This avoids a half-finished current month dragging the forecast down.
 */
export function predictHiresPerRecruiter(
  histories: RecruiterHistory[],
  horizonMonths: number,
  currentMonth?: string,
): RecruiterHistory[] {
  return histories.map((h) => {
    const last = h.monthly[h.monthly.length - 1]?.month;
    if (!last) return { recruiter: h.recruiter, monthly: [] };

    const isPartialCurrent = Boolean(
      currentMonth && h.monthly[h.monthly.length - 1]?.month === currentMonth,
    );
    const completedMonthly = isPartialCurrent ? h.monthly.slice(0, -1) : h.monthly;
    const avg = trailing3mAvg(completedMonthly);

    // The projection always starts at `last + 1`, so when the current month
    // is in progress the chart keeps showing its actual value and the
    // dashed forecast picks up from the month after.
    const monthly: MonthlyHires[] = [];
    for (let i = 1; i <= horizonMonths; i++) {
      monthly.push({ month: addMonths(last, i), hires: avg });
    }
    return { recruiter: h.recruiter, monthly };
  });
}

/**
 * Sum histories across recruiters into a single team-wide monthly series.
 * All histories must share the same month axis (as produced by
 * aggregateHiresByRecruiterMonth). If they don't, missing months are
 * treated as 0.
 */
export function sumToTeamMonthly(
  histories: RecruiterHistory[],
): MonthlyHires[] {
  const totals = new Map<string, number>();
  for (const h of histories) {
    for (const m of h.monthly) {
      totals.set(m.month, (totals.get(m.month) ?? 0) + m.hires);
    }
  }
  return [...totals.entries()]
    .map(([month, hires]) => ({ month, hires }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface LineChartSeriesLike {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  dashed?: boolean;
}

/**
 * Build the team actual + dashed projection series for the headline chart.
 * The projection series includes the last actual month as its first point
 * so the dashed segment visually continues from the solid line with no gap.
 */
export function buildTeamChartSeries(
  actual: MonthlyHires[],
  projection: MonthlyHires[],
  colors: { actual: string; projection: string } = {
    actual: "#2563eb",
    projection: "#2563eb",
  },
): LineChartSeriesLike[] {
  const series: LineChartSeriesLike[] = [];

  if (actual.length > 0) {
    series.push({
      label: "Hires",
      color: colors.actual,
      data: actual.map((m) => ({ date: `${m.month}-01`, value: m.hires })),
    });
  }

  if (projection.length > 0) {
    const anchor = actual[actual.length - 1];
    const projectionData = [
      ...(anchor
        ? [{ date: `${anchor.month}-01`, value: anchor.hires }]
        : []),
      ...projection.map((m) => ({ date: `${m.month}-01`, value: m.hires })),
    ];
    series.push({
      label: "Projected",
      color: colors.projection,
      data: projectionData,
      dashed: true,
    });
  }

  return series;
}

const UNKNOWN_EMPLOYMENT: EmploymentRecord = {
  status: "unknown",
  terminationDate: null,
  matchedName: null,
  department: null,
};

/**
 * Per-recruiter summary row for the talent table — trailing average, last
 * 12-month volume, QTD attainment vs target, projected next 3 months.
 *
 * When `currentMonth` matches the final history entry, that entry is treated
 * as a partial in-progress month: the trailing 3-month average and last-3m
 * total both look at the 3 complete months before it. `hiresLast12m` still
 * includes the partial current month so the "last 12 months" total reflects
 * the data shown in the chart.
 */
export function buildRecruiterSummaries(
  histories: RecruiterHistory[],
  targets: TalentTargetRow[],
  currentMonth?: string,
  employmentByRecruiter: Record<string, EmploymentRecord> = {},
): RecruiterSummary[] {
  const targetByRecruiter = new Map(targets.map((t) => [t.recruiter, t]));

  return histories
    .map((h) => {
      const isPartialCurrent = Boolean(
        currentMonth &&
          h.monthly[h.monthly.length - 1]?.month === currentMonth,
      );
      const completed = isPartialCurrent
        ? h.monthly.slice(0, -1)
        : h.monthly;

      const last12 = h.monthly.slice(-12);
      const last3Completed = completed.slice(-3);
      const avg = trailing3mAvg(completed);
      const target = targetByRecruiter.get(h.recruiter);

      return {
        recruiter: h.recruiter,
        tech: target?.tech ?? null,
        hiresLast12m: last12.reduce((s, m) => s + m.hires, 0),
        hiresLast3m: last3Completed.reduce((s, m) => s + m.hires, 0),
        trailing3mAvg: avg,
        projectedNext3m: avg * 3,
        hiresQtd: target ? target.hiresQtd : null,
        targetQtd: target ? target.targetQtd : null,
        attainmentQtd:
          target && target.targetQtd > 0
            ? target.hiresQtd / target.targetQtd
            : null,
        employment:
          employmentByRecruiter[h.recruiter] ?? UNKNOWN_EMPLOYMENT,
      };
    })
    .sort((a, b) => b.hiresLast12m - a.hiresLast12m);
}

/**
 * Raw HR row going into the employment index. `status` is pre-classified by
 * the caller because different Mode queries express it differently — e.g.
 * headcount SSoT has a first-class `lifecycle_status` column, while the
 * attrition `employees` query relies on the termination date. Names to
 * match against include the primary display plus any aliases (preferred
 * name vs. Greenhouse full name, etc.).
 */
export interface HrEmploymentRecord {
  displayName: string;
  aliases?: string[];
  status: "active" | "departed";
  terminationDate: string | null;
  department: string | null;
}

/**
 * Build a `recruiter → EmploymentRecord` map from pre-classified HR rows.
 * Matches on the display name, any caller-supplied aliases, and a
 * `first last` fallback so minor variations (middle names, "Senior"
 * suffixes) still resolve.
 *
 * When two HR rows share a matching name, active records win over
 * departed ones — that handles re-hires (same person's old termination
 * record plus a new active one).
 */
export function buildEmploymentIndex(
  records: HrEmploymentRecord[],
  recruiterNames: Iterable<string>,
): Record<string, EmploymentRecord> {
  const byVariant = new Map<string, HrEmploymentRecord>();

  for (const rec of records) {
    const keys = new Set<string>();
    for (const name of [rec.displayName, ...(rec.aliases ?? [])]) {
      for (const v of nameVariants(name ?? "")) keys.add(v);
    }
    for (const key of keys) {
      const existing = byVariant.get(key);
      if (!existing || (existing.status === "departed" && rec.status === "active")) {
        byVariant.set(key, rec);
      }
    }
  }

  const result: Record<string, EmploymentRecord> = {};
  for (const recruiter of recruiterNames) {
    const trimmed = recruiter.trim();
    if (!trimmed) continue;

    let match: HrEmploymentRecord | undefined;
    for (const variant of nameVariants(trimmed)) {
      match = byVariant.get(variant);
      if (match) break;
    }

    if (!match) {
      result[recruiter] = UNKNOWN_EMPLOYMENT;
      continue;
    }

    result[recruiter] = {
      status: match.status,
      terminationDate: match.terminationDate
        ? match.terminationDate.slice(0, 10)
        : null,
      matchedName: match.displayName,
      department: match.department,
    };
  }
  return result;
}

function nameVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const variants = new Set<string>();
  variants.add(trimmed);
  variants.add(trimmed.toLowerCase());
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    variants.add(`${first} ${last}`);
    variants.add(`${first} ${last}`.toLowerCase());
  }
  return [...variants];
}
