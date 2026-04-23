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
}

export interface TalentData {
  hireRows: TalentHireRow[];
  targets: TalentTargetRow[];
  syncedAt: Date | null;
}

const HIRES_ACTION = "hires";

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
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
 * starting the month after the last actual month. If history is empty,
 * returns an empty projection.
 */
export function predictHiresPerRecruiter(
  histories: RecruiterHistory[],
  horizonMonths: number,
): RecruiterHistory[] {
  return histories.map((h) => {
    const avg = trailing3mAvg(h.monthly);
    const last = h.monthly[h.monthly.length - 1]?.month;
    if (!last) return { recruiter: h.recruiter, monthly: [] };
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

/**
 * Per-recruiter summary row for the talent table — trailing average, last
 * 12-month volume, QTD attainment vs target, projected next 3 months.
 */
export function buildRecruiterSummaries(
  histories: RecruiterHistory[],
  targets: TalentTargetRow[],
): RecruiterSummary[] {
  const targetByRecruiter = new Map(targets.map((t) => [t.recruiter, t]));

  return histories
    .map((h) => {
      const last12 = h.monthly.slice(-12);
      const last3 = h.monthly.slice(-3);
      const avg = trailing3mAvg(h.monthly);
      const target = targetByRecruiter.get(h.recruiter);

      return {
        recruiter: h.recruiter,
        tech: target?.tech ?? null,
        hiresLast12m: last12.reduce((s, m) => s + m.hires, 0),
        hiresLast3m: last3.reduce((s, m) => s + m.hires, 0),
        trailing3mAvg: avg,
        projectedNext3m: avg * 3,
        hiresQtd: target ? target.hiresQtd : null,
        targetQtd: target ? target.targetQtd : null,
        attainmentQtd:
          target && target.targetQtd > 0
            ? target.hiresQtd / target.targetQtd
            : null,
      };
    })
    .sort((a, b) => b.hiresLast12m - a.hiresLast12m);
}
