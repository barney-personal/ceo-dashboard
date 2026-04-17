import { getReportData, parseRows, rowStr, rowNumOrNull } from "./mode";
import type { ZodType } from "zod";
import {
  type ConversionCohortRow,
  ltvMonthlySchema,
  kpiSpendQuerySchema,
  activeUsersSchema,
  monthlyRetentionSchema,
  weeklyRetentionSchema,
  subscriptionRetentionSchema,
  conversionCohortSchema,
  currentFteSchema,
  headcountSchema,
  userAcquisitionSchema,
} from "@/lib/validation/mode-rows";
import {
  CHART_HISTORY_FIRST_FULL_WEEK,
  CHART_HISTORY_START_TS,
} from "@/lib/config/charts";
import type { BarChartData } from "@/components/charts/bar-chart";
import type { ColumnChartData } from "@/components/charts/column-chart";
import type { RetentionTier } from "@/components/charts/retention-triangle";

type ChartSeries = {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  dashed?: boolean;
};

/**
 * Returns true only if `str` is non-empty and parses to a finite timestamp.
 * Guards against invalid date strings that would cause RangeError on toISOString()
 * or NaN propagation in arithmetic.
 */
function isValidDateStr(str: string): boolean {
  return str.length > 0 && Number.isFinite(new Date(str).getTime());
}

function getValidatedRows<T>(
  data: Awaited<ReturnType<typeof getReportData>>,
  queryName: string,
  schema: ZodType<T>,
): T[] | null {
  const query = data.find((entry) => entry.queryName === queryName);
  if (!query || query.rows.length === 0) return null;
  const { valid } = parseRows(schema, query.rows, {
    reportName: query.reportName,
    queryName: query.queryName,
  });
  return valid.length > 0 ? valid : null;
}

export function getWeekStart(date: string | Date): string {
  const value =
    date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (!Number.isFinite(value.getTime())) return "";
  const day = value.getDay();
  const monday = new Date(
    value.getTime() - (day === 0 ? 6 : day - 1) * 86400000,
  );
  return monday.toISOString().slice(0, 10);
}

export function groupByWeek<T extends Record<string, unknown>>(
  rows: T[],
  dateField: keyof T,
): Map<string, T[]> {
  const weekMap = new Map<string, T[]>();

  for (const row of rows) {
    const date = row[dateField];
    if (typeof date !== "string" && !(date instanceof Date)) continue;

    const key = getWeekStart(date);
    if (!key) continue;
    const bucket = weekMap.get(key) ?? [];
    bucket.push(row);
    weekMap.set(key, bucket);
  }

  return weekMap;
}

function getCurrentWeekStart(): string {
  return getWeekStart(new Date());
}

export function aggregateCohortRows(
  rows: Record<string, unknown>[],
): Map<string, Map<number, number>> {
  const byCohort = new Map<string, Map<number, number>>();

  for (const row of rows) {
    if (row.cohort_month == null || row.activity_month == null) continue;

    const cohortStr = rowStr(row, "cohort_month");
    if (!isValidDateStr(cohortStr)) continue;
    const cohortDate = new Date(cohortStr);
    const cohort = `${cohortDate.getUTCFullYear()}-${String(
      cohortDate.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    const period = rowNumOrNull(row, "activity_month");
    const maus = rowNumOrNull(row, "maus");
    if (period == null || maus == null) continue;

    let periods = byCohort.get(cohort);
    if (!periods) {
      periods = new Map();
      byCohort.set(cohort, periods);
    }

    periods.set(period, (periods.get(period) ?? 0) + maus);
  }

  return byCohort;
}

/**
 * Normalise stored weekly retention rows into `cohort → period → WAU`.
 *
 * The sync layer (see `weeklyRetentionAggregator`) has already collapsed the
 * raw segment-broken-down rows into one row per `(cohort_week,
 * relative_moving_week)`, so this function only needs to:
 *  - parse `cohort_week` into a YYYY-MM-DD UTC key
 *  - drop rows with invalid dates / missing numerics
 *  - bucket by cohort + period
 *
 * If multiple rows for the same cohort/period are ever encountered (e.g. a
 * legacy un-aggregated payload), they are still summed for safety.
 */
export function aggregateWeeklyCohortRows(
  rows: Record<string, unknown>[],
): Map<string, Map<number, number>> {
  const byCohort = new Map<string, Map<number, number>>();

  for (const row of rows) {
    if (row.cohort_week == null || row.relative_moving_week == null) continue;

    const cohortStr = rowStr(row, "cohort_week");
    if (!isValidDateStr(cohortStr)) continue;
    const cohortDate = new Date(cohortStr);
    // Format as YYYY-MM-DD using UTC to avoid timezone shifts.
    const cohort = cohortDate.toISOString().slice(0, 10);
    const period = rowNumOrNull(row, "relative_moving_week");
    const wau = rowNumOrNull(row, "active_users_weekly");
    if (period == null || wau == null) continue;

    let periods = byCohort.get(cohort);
    if (!periods) {
      periods = new Map();
      byCohort.set(cohort, periods);
    }

    const existing = periods.get(period);
    periods.set(period, existing == null ? wau : existing + wau);
  }

  return byCohort;
}

/**
 * 36-month LTV estimate over time — monthly bar chart.
 * Uses "Query 4" from Strategic Finance KPIs which has ~78 monthly rows
 * with columns: month, user_ltv_36m_actual.
 */
export async function getLtvTimeSeries(): Promise<ColumnChartData[]> {
  const data = await getReportData("unit-economics", "kpis", ["Query 4"]);
  const rows = getValidatedRows(data, "Query 4", ltvMonthlySchema);
  if (!rows) return [];

  return rows
    .filter((r) => isValidDateStr(r.month) && r.user_ltv_36m_actual != null)
    .map((r) => ({
      date: r.month,
      value: r.user_ltv_36m_actual ?? 0,
    }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * LTV:Paid CAC ratio over time (weekly).
 * Computed from two queries in the Strategic Finance KPIs report:
 *   - Query 4: monthly LTV (user_ltv_36m_actual)
 *   - Query 3: daily spend / new_bank_connected_users (actuals only)
 * Weekly CAC = weekly spend / weekly new users; ratio = LTV / CAC.
 */
export async function getLtvCacRatioSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("unit-economics", "kpis", [
    "Query 4",
    "Query 3",
  ]);

  // 1. Build monthly LTV lookup from Query 4
  const ltvRows = getValidatedRows(data, "Query 4", ltvMonthlySchema);
  if (!ltvRows) return [];

  const ltvByMonth = new Map<string, number>();
  for (const row of ltvRows) {
    const ltv = row.user_ltv_36m_actual;
    if (!isValidDateStr(row.month) || ltv == null) continue;
    const d = new Date(row.month);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    ltvByMonth.set(key, ltv);
  }

  // Sort months to find the latest available LTV
  const sortedMonths = [...ltvByMonth.keys()].sort();
  const latestLtvMonth = sortedMonths[sortedMonths.length - 1];
  const latestLtv = latestLtvMonth ? ltvByMonth.get(latestLtvMonth)! : 0;

  // Helper: get LTV for a month, falling back to previous month if not available
  function getLtvForMonth(monthKey: string): number {
    if (ltvByMonth.has(monthKey)) return ltvByMonth.get(monthKey)!;
    // Find the closest previous month that has data
    const prev = sortedMonths.filter((m) => m < monthKey);
    if (prev.length > 0) return ltvByMonth.get(prev[prev.length - 1])!;
    return latestLtv;
  }

  // 2. Aggregate Query 3 "actual" rows into weekly buckets
  const q3Rows = getValidatedRows(data, "Query 3", kpiSpendQuerySchema);
  if (!q3Rows) return [];

  const CHARTS_START = new Date("2023-01-01").getTime();

  const weekMap = new Map<
    string,
    { spend: number; users: number; days: number }
  >();
  for (const r of q3Rows) {
    if (!isValidDateStr(r.day)) continue;
    if (r.actual_or_target !== "actual") continue;
    const d = new Date(r.day);
    if (d.getTime() < CHARTS_START) continue;

    const key = getWeekStart(d);
    if (!key) continue;

    const spend = r.spend;
    const users = r.new_bank_connected_users;
    if (spend == null || users == null) continue;

    const b = weekMap.get(key) ?? { spend: 0, users: 0, days: 0 };
    b.spend += spend;
    b.users += users;
    b.days += 1;
    weekMap.set(key, b);
  }

  // 3. Compute weekly LTV:CAC ratio
  const weeks = [...weekMap.entries()]
    .filter(([date]) => date >= "2023-01-02")
    .sort((a, b) => a[0].localeCompare(b[0]));

  const ratioData = weeks
    .filter(([, v]) => v.users > 0)
    .map(([date, v]) => {
      const d = new Date(date);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const ltv = getLtvForMonth(monthKey);
      const paidCpa = v.spend / v.users;
      return { date, value: paidCpa > 0 ? ltv / paidCpa : 0 };
    });

  // Exclude current incomplete week
  const now = new Date();
  const currentMonday = new Date(
    now.getTime() - ((now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000),
  );
  const currentWeekKey = currentMonday.toISOString().slice(0, 10);
  const completeWeeks = ratioData.filter((d) => d.date < currentWeekKey);

  return [
    {
      label: "LTV:CAC",
      color: "#3b3bba",
      data: completeWeeks,
    },
    {
      label: "3x guardrail",
      color: "#c44",
      dashed: true,
      data: completeWeeks.map((d) => ({ date: d.date, value: 3 })),
    },
  ];
}

/**
 * Latest LTV:Paid CAC ratio (the most recent weekly data point).
 */
export async function getLatestLtvCacRatio(): Promise<number | null> {
  const series = await getLtvCacRatioSeries();
  const ltvCac = series.find((s) => s.label === "LTV:CAC");
  if (!ltvCac || ltvCac.data.length === 0) return null;
  return ltvCac.data[ltvCac.data.length - 1].value;
}

/**
 * Latest WAU/MAU ratio from the engagement series (last complete month).
 */
export async function getLatestWauMau(): Promise<number | null> {
  const series = await getEngagementSeries();
  const wauMau = series.find((s) => s.label === "WAU / MAU");
  if (!wauMau || wauMau.data.length === 0) return null;
  return wauMau.data[wauMau.data.length - 1].value;
}

/**
 * Latest M11 retention from the cohort triangle.
 * Finds the most recent cohort that has an M11 data point.
 */
export async function getLatestM11Retention(): Promise<number | null> {
  const cohorts = await getMauRetentionCohorts();
  // Walk backwards through cohorts to find one with an M11 value.
  // periods[0] = M1 (M0 is dropped), so M11 is at index 10.
  for (let i = cohorts.length - 1; i >= 0; i--) {
    const periods = cohorts[i].periods;
    if (periods.length > 10 && periods[10] != null) {
      return periods[10];
    }
  }
  return null;
}

/**
 * Spend, new users, and CPA from "Query 3" (Strategic Finance KPIs).
 * Weekly aggregates, split by actual vs target, from Jan 2023.
 */
export async function getQuery3Series(): Promise<{
  spend: ChartSeries[];
  users: ChartSeries[];
  cpa: ChartSeries[];
}> {
  const data = await getReportData("unit-economics", "kpis", ["Query 3"]);
  const validRows = getValidatedRows(data, "Query 3", kpiSpendQuerySchema);
  if (!validRows)
    return { spend: [], users: [], cpa: [] };

  const colors: Record<string, string> = {
    actual: "#3b3bba",
    target_base: "#888",
    target_management: "#2d8a6e",
  };

  const byType = new Map<
    string,
    { date: string; spend: number; users: number }[]
  >();
  for (const r of validRows) {
    if (!isValidDateStr(r.day)) continue;
    if (new Date(r.day).getTime() < CHART_HISTORY_START_TS) continue;
    const spend = r.spend;
    const users = r.new_bank_connected_users;
    if (spend == null || users == null) continue;
    const type = r.actual_or_target;
    let arr = byType.get(type);
    if (!arr) {
      arr = [];
      byType.set(type, arr);
    }
    arr.push({
      date: r.day,
      spend,
      users,
    });
  }

  // Aggregate all types to weekly buckets (week starting Monday)
  const weeklyByType = new Map<
    string,
    Map<string, { date: string; spend: number; users: number }[]>
  >();
  for (const [type, rows] of byType) {
    weeklyByType.set(type, groupByWeek(rows, "date"));
  }

  const currentWeekStart = getCurrentWeekStart();
  const makeSeries = (field: "spend" | "users" | "cpa"): ChartSeries[] =>
    [...weeklyByType.entries()].map(([type, weekMap]) => ({
      label: type,
      color: colors[type] ?? "#999",
      dashed: type !== "actual",
      data: [...weekMap.entries()]
        .filter(
          ([date]) =>
            date >= CHART_HISTORY_FIRST_FULL_WEEK && date < currentWeekStart,
        )
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, weekRows]) => {
          const totals = weekRows.reduce(
            (acc, row) => {
              acc.spend += row.spend;
              acc.users += row.users;
              return acc;
            },
            { spend: 0, users: 0 },
          );

          if (field === "cpa") {
            if (totals.users <= 0) return null;
            return { date, value: totals.spend / totals.users };
          }

          return { date, value: totals[field] };
        })
        .filter(
          (point): point is { date: string; value: number } => point !== null,
        ),
    }));

  return {
    spend: makeSeries("spend"),
    users: makeSeries("users"),
    cpa: makeSeries("cpa"),
  };
}

/**
 * Latest MAU from the App Active Users report (most recent daily data point).
 */
export async function getLatestMAU(): Promise<number | null> {
  const data = await getReportData("product", "active-users");
  const rows = getValidatedRows(data, "dau-wau-mau query all time", activeUsersSchema);
  if (!rows) return null;

  const sorted = rows
    .filter((r) => isValidDateStr(r.date) && r.maus != null)
    .sort(
      (a, b) =>
        new Date(b.date).getTime() -
        new Date(a.date).getTime(),
    );

  return sorted[0]?.maus ?? null;
}

// --- Product ---

/**
 * Active users at their natural cadence:
 * - MAU: monthly averages (last 18 months)
 * - WAU: weekly averages (last 26 weeks)
 * - DAU: daily values (last 90 days)
 */
export async function getActiveUsersSeries(): Promise<{
  dau: { date: string; value: number }[];
  wau: { date: string; value: number }[];
  mau: { date: string; value: number }[];
}> {
  const data = await getReportData("product", "active-users", [
    "dau-wau-mau query all time",
  ]);
  const validRows = getValidatedRows(
    data,
    "dau-wau-mau query all time",
    activeUsersSchema,
  );
  if (!validRows) return { dau: [], wau: [], mau: [] };

  const rows = validRows
    .filter((r) => isValidDateStr(r.date))
    .map((r) => ({
      date: new Date(r.date),
      daus: r.daus ?? null,
      waus: r.waus ?? null,
      maus: r.maus ?? null,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // MAU: group by month, average
  const byMonth = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
    let arr = byMonth.get(key);
    if (!arr) {
      arr = [];
      byMonth.set(key, arr);
    }
    if (r.maus != null) arr.push(r.maus);
  }
  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const months = [...byMonth.keys()]
    .filter((m) => byMonth.get(m)!.length > 0)
    .sort()
    .slice(-18);
  const mau = months.map((m) => ({
    date: `${m}-01`,
    value: avg(byMonth.get(m)!),
  }));

  // WAU: group by ISO week, average
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const d = r.date;
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(
      ((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7,
    );
    const key = `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    let arr = byWeek.get(key);
    if (!arr) {
      arr = [];
      byWeek.set(key, arr);
    }
    if (r.waus != null) arr.push(r.waus);
  }
  const weeks = [...byWeek.keys()]
    .filter((w) => byWeek.get(w)!.length > 0)
    .sort()
    .slice(-26);
  // Use the Monday of each week as the date label
  const wau = weeks.map((w) => {
    const [yr, wk] = w.split("-W").map(Number);
    const jan1 = new Date(yr, 0, 1);
    const dayOffset = (jan1.getDay() + 6) % 7; // days until Monday
    const monday = new Date(
      jan1.getTime() + ((wk - 1) * 7 - dayOffset) * 86400000,
    );
    return {
      date: monday.toISOString().slice(0, 10),
      value: avg(byWeek.get(w)!),
    };
  });

  // DAU: daily, last 90 days
  const dailyRows = rows.slice(-90);
  const dau = dailyRows
    .filter((r): r is typeof r & { daus: number } => r.daus != null)
    .map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      value: r.daus,
    }));

  return { dau, wau, mau };
}

/**
 * Engagement ratios (WAU/MAU, DAU/MAU) over time.
 */
export async function getEngagementSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("product", "active-users", [
    "dau-wau-mau query all time",
  ]);
  const validRows = getValidatedRows(
    data,
    "dau-wau-mau query all time",
    activeUsersSchema,
  );
  if (!validRows) return [];

  // Group by month, compute ratio of averages
  const byMonth = new Map<
    string,
    { daus: number[]; waus: number[]; maus: number[] }
  >();

  for (const row of validRows) {
    if (!isValidDateStr(row.date)) continue;
    const d = new Date(row.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let bucket = byMonth.get(key);
    if (!bucket) {
      bucket = { daus: [], waus: [], maus: [] };
      byMonth.set(key, bucket);
    }
    const daus = row.daus ?? null;
    const waus = row.waus ?? null;
    const maus = row.maus ?? null;
    if (daus != null) bucket.daus.push(daus);
    if (waus != null) bucket.waus.push(waus);
    if (maus != null) bucket.maus.push(maus);
  }

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Exclude current calendar month entirely (always incomplete)
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const months = [...byMonth.keys()].filter((m) => m < currentMonth).sort();

  return [
    {
      label: "WAU / MAU",
      color: "#3b3bba",
      data: months.map((m) => {
        const b = byMonth.get(m)!;
        const mau = avg(b.maus);
        return {
          date: `${m}-01`,
          value: mau > 0 ? (avg(b.waus) / mau) * 100 : 0,
        };
      }),
    },
  ];
}

/**
 * App retention cohort triangle from the App Retention report (Query 1).
 * Aggregates across all user segments, using M0 MAUs as the base.
 */
export async function getMauRetentionCohorts(): Promise<
  { cohort: string; periods: (number | null)[] }[]
> {
  const data = await getReportData("product", "retention", ["Query 1"]);
  const rows = getValidatedRows(data, "Query 1", monthlyRetentionSchema);
  if (!rows) return [];

  const byCohort = aggregateCohortRows(rows);

  const cohorts = [...byCohort.keys()].sort();

  // Use M0 MAUs as the base for each cohort.
  // Drop the last period (always incomplete) and M0 (always ~100%).
  return cohorts
    .filter((c) => byCohort.get(c)!.has(0) && byCohort.get(c)!.get(0)! > 0)
    .map((cohort) => {
      const periods = byCohort.get(cohort)!;
      const base = periods.get(0)!;
      const maxPeriod = Math.max(...periods.keys()) - 1;
      if (maxPeriod < 1) return { cohort, periods: [] as (number | null)[] };
      return {
        cohort,
        // Start from period 1, skipping M0
        periods: Array.from({ length: maxPeriod }, (_, i) =>
          periods.has(i + 1) ? periods.get(i + 1)! / base : null,
        ),
      };
    })
    .filter((c) => c.periods.length > 0);
}

/**
 * Minimum number of weekly periods (after the W0 base) we require for a
 * cohort to appear in the WAU retention triangle. A cohort needs at least
 * one non-partial retention point (W1 onward) to be plotted; this keeps
 * the triangle naturally short at the bottom while still surfacing the
 * newest cohorts as soon as they have any retention signal.
 */
const WAU_RETENTION_MIN_PERIODS = 1;

/**
 * Maximum number of cohorts to render in the WAU retention triangle.
 * 52 weeks = one year of history.
 */
const WAU_RETENTION_MAX_COHORTS = 52;

/**
 * Monday 00:00 UTC of the current (incomplete) ISO week. Any retention
 * observation whose week starts at or after this cutoff still has days
 * left for users to be counted as active, so its retention % is
 * misleadingly low. Matches Redshift's `DATE_TRUNC('week', ...)` which
 * is Monday-aligned.
 */
function currentIncompleteWeekStart(now: Date = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const offsetToMonday = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - offsetToMonday);
  return d;
}

/**
 * Weekly WAU retention cohort triangle from the App Retention Weekly
 * dataset (4e4ed264ed7a, Query 1). Aggregates `active_users_weekly`
 * across segment dimensions, then expresses each cohort as a retention
 * rate relative to its W0 starting WAU.
 *
 * Returns at most {@link WAU_RETENTION_MAX_COHORTS} cohorts, newest last,
 * dropping W0 (always 100%) and any per-cohort observation that falls in
 * the current (incomplete) ISO week — the "unmatured diagonal". An
 * observation at `cohort_week + relative_moving_week * 7 days` that lands
 * on or after the current Monday still has days left for users to be
 * counted as active, so its retention % would be misleadingly low.
 * Filtering per observation (rather than a single global `max - 1` drop)
 * correctly trims only the diagonal that touches the current week.
 */
export async function getWauRetentionCohorts(): Promise<
  { cohort: string; periods: (number | null)[] }[]
> {
  const data = await getReportData("product", "retention-weekly", ["Query 1"]);
  const validRows = getValidatedRows(
    data,
    "Query 1",
    weeklyRetentionSchema,
  );
  if (!validRows) return [];

  // Drop any (cohort, period) observation whose observation date lands in
  // the current incomplete week — the "unmatured diagonal". This is
  // applied per row so every cohort loses exactly the cell that maps to
  // the current week, not a fixed global tail.
  const cutoff = currentIncompleteWeekStart().getTime();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const maturedRows = validRows.filter((row) => {
    if (!isValidDateStr(row.cohort_week)) return true;
    const cohortMs = new Date(row.cohort_week).getTime();
    if (!Number.isFinite(cohortMs)) return true;
    const observationMs = cohortMs + row.relative_moving_week * WEEK_MS;
    return observationMs < cutoff;
  });

  const byCohort = aggregateWeeklyCohortRows(maturedRows);

  const cohorts = [...byCohort.keys()].sort();

  const triangle = cohorts
    .filter((c) => byCohort.get(c)!.has(0) && byCohort.get(c)!.get(0)! > 0)
    .map((cohort) => {
      const periods = byCohort.get(cohort)!;
      const base = periods.get(0)!;
      // Keep every period after W0 (W0 itself is always 100% so it's
      // skipped as the base row). Unmatured observations were already
      // filtered above, so every remaining period is a complete week.
      const maxPeriod = Math.max(...periods.keys());
      if (maxPeriod < 1) return { cohort, periods: [] as (number | null)[] };
      return {
        cohort,
        periods: Array.from({ length: maxPeriod }, (_, i) =>
          periods.has(i + 1) ? periods.get(i + 1)! / base : null,
        ),
      };
    })
    .filter((c) => c.periods.length >= WAU_RETENTION_MIN_PERIODS);

  // Keep the most recent N cohorts so the UI stays compact.
  return triangle.slice(-WAU_RETENTION_MAX_COHORTS);
}

/**
 * Subscription retention cohort triangles from the Retention Dashboard.
 *
 * Sources from "Query 1" in Mode report 9c02ab407985 which has columns:
 *   subscription_type, subscriber_cohort, relative_month, base, retained, pct_retained
 *
 * Subscription types: Any (overall), Plus, Ai, Grow, Nitro.
 *
 * Returns one RetentionTier per subscription type, with "Any" (overall) first.
 */
export async function getSubscriptionRetentionCohorts(): Promise<
  RetentionTier[]
> {
  const data = await getReportData("unit-economics", "retention", ["Query 1"]);
  const validRows = getValidatedRows(
    data,
    "Query 1",
    subscriptionRetentionSchema,
  );
  if (!validRows) return [];

  // Group rows by subscription_type → cohort → period
  const byType = new Map<
    string,
    Map<string, Map<number, { pctRetained: number; base: number }>>
  >();

  for (const row of validRows) {
    const type = row.subscription_type;
    const cohortRaw = row.subscriber_cohort;
    const period = row.relative_month;
    const pctRetained = row.pct_retained;
    const base = row.base ?? null;

    if (!isValidDateStr(cohortRaw)) continue;

    const cohortDate = new Date(cohortRaw);
    const cohort = `${cohortDate.getUTCFullYear()}-${String(
      cohortDate.getUTCMonth() + 1,
    ).padStart(2, "0")}`;

    let typeCohorts = byType.get(type);
    if (!typeCohorts) {
      typeCohorts = new Map();
      byType.set(type, typeCohorts);
    }

    let periods = typeCohorts.get(cohort);
    if (!periods) {
      periods = new Map();
      typeCohorts.set(cohort, periods);
    }

    periods.set(period, { pctRetained, base: base ?? 0 });
  }

  // Convert to RetentionTier[], dropping the last period per cohort (incomplete)
  const tierOrder: [string, string][] = [
    ["Any", "All Subscribers"],
    ["Plus", "Plus"],
    ["Ai", "Ai"],
    ["Grow", "Grow"],
    ["Nitro", "Nitro"],
  ];

  const tiers: RetentionTier[] = [];

  for (const [typeKey, label] of tierOrder) {
    const typeCohorts = byType.get(typeKey);
    if (!typeCohorts) continue;

    const cohorts = [...typeCohorts.keys()].sort();
    const cohortRows = cohorts
      .map((cohort) => {
        const periods = typeCohorts.get(cohort)!;
        const maxPeriod = Math.max(...periods.keys()) - 1; // drop incomplete last
        if (maxPeriod < 0) return null;
        const baseEntry = periods.get(0);
        return {
          cohort,
          cohortSize: baseEntry ? Math.round(baseEntry.base) : undefined,
          periods: Array.from({ length: maxPeriod + 1 }, (_, i) => {
            const entry = periods.get(i);
            return entry != null ? entry.pctRetained : null;
          }),
        };
      })
      .filter(
        (c): c is NonNullable<typeof c> =>
          c != null && c.periods.length > 0,
      );

    if (cohortRows.length > 0) {
      tiers.push({
        key: typeKey.toLowerCase(),
        label,
        data: cohortRows,
      });
    }
  }

  return tiers;
}

/**
 * Headcount by department for bar chart.
 * Primary: Current FTEs report (function_name). Fallback: Headcount SSoT (hb_function).
 */
export async function getHeadcountByDepartment(): Promise<BarChartData[]> {
  // Try Current FTEs first
  const fteData = await getReportData("people", "org", ["current_employees"]);
  const fteRows = getValidatedRows(fteData, "current_employees", currentFteSchema);

  if (fteRows) {
    const byDept = new Map<string, number>();
    for (const emp of fteRows) {
      if (emp.pillar_name === "no pillar" || emp.squad_name === "no squad") continue;
      const dept = emp.function_name || "Unknown";
      byDept.set(dept, (byDept.get(dept) ?? 0) + 1);
    }
    return [...byDept.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: "#3b3bba" }));
  }

  // Fallback to old report
  const data = await getReportData("people", "headcount", ["headcount"]);
  const hcRows = getValidatedRows(data, "headcount", headcountSchema);
  if (!hcRows) return [];

  const active = hcRows.filter(
    (r) =>
      (r.lifecycle_status ?? "").toLowerCase() === "employed" &&
      r.is_cleo_headcount === 1,
  );

  const byDept = new Map<string, number>();
  for (const emp of active) {
    const dept = emp.hb_function || "Unknown";
    byDept.set(dept, (byDept.get(dept) ?? 0) + 1);
  }

  return [...byDept.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: "#3b3bba" }));
}

/**
 * User acquisition trend from OKR Company Dashboard.
 */
export async function getUserAcquisitionSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("okrs", "company");
  const validRows = getValidatedRows(data, "User Acquisition", userAcquisitionSchema);
  if (!validRows) return [];

  const rows = validRows
    .filter((r) => isValidDateStr(r.month))
    .sort(
      (a, b) =>
        new Date(a.month).getTime() -
        new Date(b.month).getTime(),
    );

  if (rows.length === 0) return [];

  const series: ChartSeries[] = [];

  series.push({
    label: "New Users",
    color: "#3b3bba",
    data: rows
      .map((r) => {
        const value = r.new_bank_connected_users;
        return value != null ? { date: r.month, value } : null;
      })
      .filter((p): p is { date: string; value: number } => p !== null),
  });

  return series;
}

// --- Premium Conversion ---

/**
 * Parse cohort conversion data, filtering to cohorts with meaningful user volume.
 * Returns rows grouped by metric_window for the given windows.
 */
function loadCohortConversionRows(
  data: Awaited<ReturnType<typeof getReportData>>,
) {
  const rows = getValidatedRows(
    data,
    "agg_cohort_conversion_rate_by_window",
    conversionCohortSchema,
  );
  if (!rows) return [];

  return rows.filter((r) => {
    return isValidDateStr(r.cohort) && r.total_users != null && r.total_users > 1000;
  });
}

/**
 * Premium conversion rates at key measurement windows over time.
 * Returns series for W1, M1, M3, M6, M11 showing how the cohort-level
 * conversion rate has changed month-by-month.
 */
export async function getConversionByWindowSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("unit-economics", "conversion", [
    "agg_cohort_conversion_rate_by_window",
  ]);
  const rows = loadCohortConversionRows(data);
  if (rows.length === 0) return [];

  const WINDOWS: { window: string; label: string; color: string }[] = [
    { window: "W1", label: "Week 1", color: "#94a3b8" },
    { window: "M1", label: "Month 1", color: "#6366f1" },
    { window: "M3", label: "Month 3", color: "#3b3bba" },
    { window: "M6", label: "Month 6", color: "#7c3aed" },
    { window: "M11", label: "Month 11", color: "#c026d3" },
  ];

  const MIN_COHORT = "2020-01-01";

  return WINDOWS.map(({ window, label, color }) => ({
    label,
    color,
    data: rows
      .filter(
        (r) =>
          r.metric_window === window &&
          r.cohort >= MIN_COHORT,
      )
      .map((r) => {
        const cohort = new Date(r.cohort);
        return {
          date: cohort.toISOString().slice(0, 10),
          value: (r.pct_premium ?? 0) * 100,
        };
      })
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.date.localeCompare(b.date)),
  })).filter((s) => s.data.length > 0);
}

export type ConversionHeatmapData = {
  [product: string]: { cohort: string; periods: (number | null)[] }[];
};

type ConversionPctField = "pct_premium" | "pct_plus" | "pct_ai" | "pct_nitro";

const HEATMAP_PRODUCTS: { key: string; field: ConversionPctField }[] = [
  { key: "All", field: "pct_premium" },
  { key: "Plus", field: "pct_plus" },
  { key: "AI Pro", field: "pct_ai" },
  { key: "Builder", field: "pct_nitro" },
];

function getConversionPct(
  row: ConversionCohortRow,
  field: ConversionPctField,
): number | null {
  switch (field) {
    case "pct_ai":
      return row.pct_ai ?? null;
    case "pct_nitro":
      return row.pct_nitro ?? null;
    case "pct_plus":
      return row.pct_plus ?? null;
    case "pct_premium":
      return row.pct_premium ?? null;
  }
}

/**
 * Conversion cohort triangle for heatmap display.
 * Returns one heatmap per product (All, Plus, AI Pro, Builder).
 * Each row is a monthly cohort, each period is a measurement window (M0–M23).
 * Values are conversion rates as decimals (0–1).
 */
export async function getConversionCohortHeatmap(): Promise<ConversionHeatmapData> {
  const data = await getReportData("unit-economics", "conversion", [
    "agg_cohort_conversion_rate_by_window",
  ]);
  const rows = loadCohortConversionRows(data);
  if (rows.length === 0) return {};

  const result: ConversionHeatmapData = {};

  for (const { key, field } of HEATMAP_PRODUCTS) {
    const byCohort = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const cohort = new Date(r.cohort).toISOString().slice(0, 7);
      if (!MONTH_WINDOWS.includes(r.metric_window)) continue;
      const pct = getConversionPct(r, field);
      if (pct == null || !Number.isFinite(pct)) continue;

      if (!byCohort.has(cohort)) byCohort.set(cohort, new Map());
      byCohort.get(cohort)!.set(r.metric_window, pct);
    }

    const cohorts = [...byCohort.keys()].sort().slice(-24);
    const heatmapRows = cohorts.map((cohort) => {
      const windowMap = byCohort.get(cohort)!;
      return {
        cohort,
        periods: MONTH_WINDOWS.map((w) => windowMap.get(w) ?? null),
      };
    });

    if (heatmapRows.length > 0) {
      result[key] = heatmapRows;
    }
  }

  return result;
}

export type ConversionCurveData = {
  label: string;
  color: string;
  data: { step: string; value: number }[];
};

/**
 * Pick ~5 semi-annual cohort keys (Jan + Jul) from the available data,
 * taking the most recent ones. This keeps the curve charts evergreen
 * without needing manual updates when new cohorts appear.
 */
function pickCohorts(rows: ConversionCohortRow[], maxCount = 5): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const key = new Date(r.cohort).toISOString().slice(0, 7);
    seen.add(key);
  }
  // Keep only Jan + Jul cohorts, sorted chronologically, take the latest N
  return [...seen]
    .filter((k) => k.endsWith("-01") || k.endsWith("-07"))
    .sort()
    .slice(-maxCount);
}

const MONTH_WINDOWS = [
  "M0", "M1", "M2", "M3", "M4", "M5", "M6",
  "M7", "M8", "M9", "M10", "M11", "M12",
  "M13", "M14", "M15", "M16", "M17", "M18",
  "M19", "M20", "M21", "M22", "M23",
];

/**
 * Build conversion curves for a specific product field.
 * Extracts the given pct field for each cohort pick across M0–M11.
 */
function buildProductCurves(
  rows: ConversionCohortRow[],
  pctField: ConversionPctField,
  cohorts: string[],
): ConversionCurveData[] {
  return cohorts.map((cohortPrefix) => {
    const cohortRows = rows.filter((r) => {
      const key = new Date(r.cohort).toISOString().slice(0, 7);
      return key === cohortPrefix;
    });

    return {
      label: cohortPrefix,
      color: "", // assigned by the chart component via sequential ramp
      data: MONTH_WINDOWS.map((w) => {
        const row = cohortRows.find((r) => r.metric_window === w);
        if (!row) return null;
        const value = (getConversionPct(row, pctField) ?? 0) * 100;
        if (!Number.isFinite(value) || value === 0) return null;
        return { step: w, value };
      }).filter((p): p is { step: string; value: number } => p !== null),
    };
  }).filter((s) => s.data.length > 2);
}

export type ProductConversionPanel = {
  product: string;
  curves: ConversionCurveData[];
};

/**
 * Conversion curves broken out by product (Plus, Builder, AI Pro).
 * Returns one panel per product, each containing cohort curves M0–M11.
 * Designed for small-multiples display.
 */
export async function getProductConversionCurves(): Promise<ProductConversionPanel[]> {
  const data = await getReportData("unit-economics", "conversion", [
    "agg_cohort_conversion_rate_by_window",
  ]);
  const rows = loadCohortConversionRows(data);
  if (rows.length === 0) return [];

  const cohorts = pickCohorts(rows);

  const PRODUCTS: { product: string; field: ConversionPctField }[] = [
    { product: "Plus", field: "pct_plus" },
    { product: "Builder", field: "pct_nitro" },
    { product: "AI Pro", field: "pct_ai" },
  ];

  return PRODUCTS
    .map(({ product, field }) => ({
      product,
      curves: buildProductCurves(rows, field, cohorts),
    }))
    .filter((p) => p.curves.length > 0);
}

/**
 * Conversion curves for total premium (all products combined).
 */
export async function getConversionCurveSeries(): Promise<ConversionCurveData[]> {
  const data = await getReportData("unit-economics", "conversion", [
    "agg_cohort_conversion_rate_by_window",
  ]);
  const rows = loadCohortConversionRows(data);
  if (rows.length === 0) return [];
  return buildProductCurves(rows, "pct_premium", pickCohorts(rows));
}

/**
 * Latest M6 premium conversion rate for the metric card.
 */
export async function getLatestM6ConversionRate(): Promise<{
  current: number;
  previous: number;
} | null> {
  const data = await getReportData("unit-economics", "conversion", [
    "agg_cohort_conversion_rate_by_window",
  ]);
  const rows = loadCohortConversionRows(data);
  if (rows.length === 0) return null;

  const m6Rows = rows
    .filter((r) => r.metric_window === "M6")
    .map((r) => ({
      date: new Date(r.cohort),
      pct: (r.pct_premium ?? 0) * 100,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (m6Rows.length < 2) return null;

  const current = m6Rows[m6Rows.length - 1];
  // Find same month from prior year, or fall back to 12 months earlier
  const targetDate = new Date(current.date);
  targetDate.setFullYear(targetDate.getFullYear() - 1);
  const targetKey = targetDate.toISOString().slice(0, 7);

  const previous = m6Rows.find(
    (r) => r.date.toISOString().slice(0, 7) === targetKey,
  ) ?? m6Rows[Math.max(0, m6Rows.length - 13)];

  return { current: current.pct, previous: previous.pct };
}
