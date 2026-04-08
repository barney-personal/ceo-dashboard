import { getReportData, rowStr, rowNum, rowNumOrNull } from "./mode";
import {
  CHART_HISTORY_FIRST_FULL_WEEK,
  CHART_HISTORY_START_TS,
} from "@/lib/config/charts";
import type { BarChartData } from "@/components/charts/bar-chart";
import type { ColumnChartData } from "@/components/charts/column-chart";

type ChartSeries = {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  dashed?: boolean;
};

export function getWeekStart(date: string | Date): string {
  const value =
    date instanceof Date ? new Date(date.getTime()) : new Date(date);
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
    if (!date) continue;

    const key = getWeekStart(date as string | Date);
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

    const cohortDate = new Date(rowStr(row, "cohort_month"));
    const cohort = `${cohortDate.getFullYear()}-${String(
      cohortDate.getMonth() + 1,
    ).padStart(2, "0")}`;
    const period = rowNum(row, "activity_month");
    const maus = rowNum(row, "maus");

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
 * 36-month LTV estimate over time — monthly bar chart.
 * Uses "Query 4" from Strategic Finance KPIs which has ~78 monthly rows
 * with columns: month, user_ltv_36m_actual.
 */
export async function getLtvTimeSeries(): Promise<ColumnChartData[]> {
  const data = await getReportData("unit-economics", "kpis");
  const query = data.find((d) => d.queryName === "Query 4");
  if (!query || query.rows.length === 0) return [];

  return query.rows
    .filter((r) => r.month && r.user_ltv_36m_actual != null)
    .map((r) => ({
      date: rowStr(r, "month"),
      value: rowNum(r, "user_ltv_36m_actual"),
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * LTV:Paid CAC ratio over time (weekly).
 * Computed as avg_ltv / (paid_spend_excl_test / paid_users_excl_test).
 */
export async function getLtvCacRatioSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("unit-economics", "cac");
  const query = data.find((d) => d.queryName === "LTV:Paid CAC");
  if (!query || query.rows.length === 0) return [];

  const rows = query.rows
    .filter(
      (r) =>
        r.period &&
        new Date(rowStr(r, "period")).getTime() >= CHART_HISTORY_START_TS,
    )
    .map((r) => ({
      date: rowStr(r, "period"),
      ltv: rowNum(r, "ltv_36m"),
      paidSpend: rowNum(r, "paid_spend_excl_test"),
      paidUsers: rowNum(r, "paid_users_excl_test"),
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const currentWeekStart = getCurrentWeekStart();
  const weeks = [...groupByWeek(rows, "date").entries()]
    .filter(
      ([date]) =>
        date >= CHART_HISTORY_FIRST_FULL_WEEK && date < currentWeekStart,
    )
    .sort((a, b) => a[0].localeCompare(b[0]));

  const ratioData = weeks
    .map(([date, weekRows]) => {
      const totals = weekRows.reduce(
        (acc, row) => {
          acc.ltv += row.ltv;
          acc.paidSpend += row.paidSpend;
          acc.paidUsers += row.paidUsers;
          acc.days += 1;
          return acc;
        },
        { ltv: 0, paidSpend: 0, paidUsers: 0, days: 0 },
      );

      if (totals.paidUsers <= 0) {
        return null;
      }

      const avgLtv = totals.ltv / totals.days;
      const paidCpa = totals.paidSpend / totals.paidUsers;
      return { date, value: paidCpa > 0 ? avgLtv / paidCpa : 0 };
    })
    .filter(
      (point): point is { date: string; value: number } => point !== null,
    );

  return [
    {
      label: "LTV:CAC",
      color: "#3b3bba",
      data: ratioData,
    },
    {
      label: "3x guardrail",
      color: "#c44",
      dashed: true,
      data: ratioData.map((d) => ({ date: d.date, value: 3 })),
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
  // Walk backwards through cohorts to find one with an M11 value
  for (let i = cohorts.length - 1; i >= 0; i--) {
    const periods = cohorts[i].periods;
    if (periods.length > 11 && periods[11] != null) {
      return periods[11];
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
  const data = await getReportData("unit-economics", "kpis");
  const query = data.find((d) => d.queryName === "Query 3");
  if (!query || query.rows.length === 0)
    return { spend: [], users: [], cpa: [] };

  const colors: Record<string, string> = {
    actual: "#3b3bba",
    target_base: "#888",
    target_management: "#2d8a6e",
  };

  const byType = new Map<
    string,
    { date: string; spend: number; users: number; cpa: number }[]
  >();
  for (const r of query.rows) {
    if (!r.day) continue;
    if (new Date(rowStr(r, "day")).getTime() < CHART_HISTORY_START_TS) continue;
    const type = rowStr(r, "actual_or_target");
    let arr = byType.get(type);
    if (!arr) {
      arr = [];
      byType.set(type, arr);
    }
    arr.push({
      date: rowStr(r, "day"),
      spend: rowNum(r, "spend"),
      users: rowNum(r, "new_bank_connected_users"),
      cpa: rowNum(r, "cpa"),
    });
  }

  // Aggregate all types to weekly buckets (week starting Monday)
  const weeklyByType = new Map<
    string,
    Map<string, { date: string; spend: number; users: number; cpa: number }[]>
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
  const query = data.find((d) => d.queryName === "dau-wau-mau query all time");
  if (!query || query.rows.length === 0) return null;

  const sorted = query.rows
    .filter((r) => r.date && r.maus != null)
    .sort(
      (a, b) =>
        new Date(rowStr(b, "date")).getTime() -
        new Date(rowStr(a, "date")).getTime(),
    );

  return sorted[0] ? rowNumOrNull(sorted[0], "maus") : null;
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
  const data = await getReportData("product", "active-users");
  const query = data.find((d) => d.queryName === "dau-wau-mau query all time");
  if (!query) return { dau: [], wau: [], mau: [] };

  const rows = query.rows
    .filter((r) => r.date)
    .map((r) => ({
      date: new Date(rowStr(r, "date")),
      daus: rowNumOrNull(r, "daus"),
      waus: rowNumOrNull(r, "waus"),
      maus: rowNumOrNull(r, "maus"),
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
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const months = [...byMonth.keys()].sort().slice(-18);
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
  const weeks = [...byWeek.keys()].sort().slice(-26);
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
  const data = await getReportData("product", "active-users");
  const query = data.find((d) => d.queryName === "dau-wau-mau query all time");
  if (!query) return [];

  // Group by month, compute ratio of averages
  const byMonth = new Map<
    string,
    { daus: number[]; waus: number[]; maus: number[] }
  >();

  for (const row of query.rows) {
    if (!row.date) continue;
    const d = new Date(rowStr(row, "date"));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let bucket = byMonth.get(key);
    if (!bucket) {
      bucket = { daus: [], waus: [], maus: [] };
      byMonth.set(key, bucket);
    }
    if (row.daus != null) bucket.daus.push(rowNum(row, "daus"));
    if (row.waus != null) bucket.waus.push(rowNum(row, "waus"));
    if (row.maus != null) bucket.maus.push(rowNum(row, "maus"));
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
  const data = await getReportData("product", "retention");
  const query = data.find((d) => d.queryName === "Query 1");
  if (!query) return [];

  const byCohort = aggregateCohortRows(query.rows);

  const cohorts = [...byCohort.keys()].sort();

  // Use M0 MAUs as the base for each cohort.
  // Drop the last period per cohort — it's always the current incomplete month.
  return cohorts
    .filter((c) => byCohort.get(c)!.has(0) && byCohort.get(c)!.get(0)! > 0)
    .map((cohort) => {
      const periods = byCohort.get(cohort)!;
      const base = periods.get(0)!;
      const maxPeriod = Math.max(...periods.keys()) - 1;
      if (maxPeriod < 0) return { cohort, periods: [] as (number | null)[] };
      return {
        cohort,
        periods: Array.from({ length: maxPeriod + 1 }, (_, i) =>
          periods.has(i) ? periods.get(i)! / base : null,
        ),
      };
    })
    .filter((c) => c.periods.length > 0);
}

/**
 * Headcount by department for bar chart.
 */
export async function getHeadcountByDepartment(): Promise<BarChartData[]> {
  const data = await getReportData("people", "headcount");
  const query = data.find((d) => d.queryName === "headcount");
  if (!query) return [];

  const active = query.rows.filter(
    (r) =>
      String(r.lifecycle_status).toLowerCase() === "employed" &&
      rowNum(r, "is_cleo_headcount") === 1,
  );

  const byDept = new Map<string, number>();
  for (const emp of active) {
    const dept = (emp.hb_function as string) || "Unknown";
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
  const query = data.find((d) => d.queryName === "User Acquisition");
  if (!query) return [];

  const rows = query.rows
    .filter((r) => r.month)
    .sort(
      (a, b) =>
        new Date(rowStr(a, "month")).getTime() -
        new Date(rowStr(b, "month")).getTime(),
    );

  // Check what columns exist
  const firstRow = rows[0];
  if (!firstRow) return [];

  const series: ChartSeries[] = [];

  if ("new_bank_connected_users" in firstRow) {
    series.push({
      label: "New Users",
      color: "#3b3bba",
      data: rows.map((r) => ({
        date: rowStr(r, "month"),
        value: rowNum(r, "new_bank_connected_users"),
      })),
    });
  }

  return series;
}
