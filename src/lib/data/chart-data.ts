import { getReportData } from "./mode";
import type { BarChartData } from "@/components/charts/bar-chart";
import type { ColumnChartData } from "@/components/charts/column-chart";

type ChartSeries = {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  dashed?: boolean;
};

const CHARTS_START = new Date("2023-01-01").getTime();

function toMondayKey(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const monday = new Date(date.getTime() - ((day === 0 ? 6 : day - 1) * 86400000));
  return monday.toISOString().slice(0, 10);
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
      date: r.month as string,
      value: r.user_ltv_36m_actual as number,
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
    .filter((r) => r.period && new Date(r.period as string).getTime() >= CHARTS_START)
    .map((r) => ({
      date: r.period as string,
      ltv: (r.ltv_36m as number) ?? 0,
      paidSpend: (r.paid_spend_excl_test as number) ?? 0,
      paidUsers: (r.paid_users_excl_test as number) ?? 0,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Aggregate to weekly
  const weekMap = new Map<string, { ltv: number; paidSpend: number; paidUsers: number; days: number }>();
  for (const r of rows) {
    const key = toMondayKey(r.date);
    const b = weekMap.get(key) ?? { ltv: 0, paidSpend: 0, paidUsers: 0, days: 0 };
    b.ltv += r.ltv;
    b.paidSpend += r.paidSpend;
    b.paidUsers += r.paidUsers;
    b.days += 1;
    weekMap.set(key, b);
  }

  const weeks = [...weekMap.entries()]
    .filter(([date]) => date >= "2023-01-02")
    .sort((a, b) => a[0].localeCompare(b[0]));

  const ratioData = weeks
    .filter(([, v]) => v.paidUsers > 0)
    .map(([date, v]) => {
      const avgLtv = v.ltv / v.days;
      const paidCpa = v.paidSpend / v.paidUsers;
      return { date, value: paidCpa > 0 ? avgLtv / paidCpa : 0 };
    });

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

  const byType = new Map<string, { date: string; spend: number; users: number; cpa: number }[]>();
  for (const r of query.rows) {
    if (!r.day) continue;
    if (new Date(r.day as string).getTime() < CHARTS_START) continue;
    const type = r.actual_or_target as string;
    let arr = byType.get(type);
    if (!arr) { arr = []; byType.set(type, arr); }
    arr.push({
      date: r.day as string,
      spend: (r.spend as number) ?? 0,
      users: (r.new_bank_connected_users as number) ?? 0,
      cpa: (r.cpa as number) ?? 0,
    });
  }

  // Aggregate all types to weekly buckets (week starting Monday)
  const weeklyByType = new Map<string, Map<string, { spend: number; users: number; cpa: number; days: number }>>();
  for (const [type, rows] of byType) {
    const weekMap = new Map<string, { spend: number; users: number; cpa: number; days: number }>();
    for (const r of rows) {
      const key = toMondayKey(r.date);
      const bucket = weekMap.get(key) ?? { spend: 0, users: 0, cpa: 0, days: 0 };
      bucket.spend += r.spend;
      bucket.users += r.users;
      bucket.cpa += r.cpa;
      bucket.days += 1;
      weekMap.set(key, bucket);
    }
    weeklyByType.set(type, weekMap);
  }

  const startKey = "2023-01-02"; // First Monday of 2023

  const makeSeries = (field: "spend" | "users" | "cpa"): ChartSeries[] =>
    [...weeklyByType.entries()].map(([type, weekMap]) => ({
      label: type,
      color: colors[type] ?? "#999",
      dashed: type !== "actual",
      data: [...weekMap.entries()]
        .filter(([date]) => date >= startKey)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({
          date,
          value: field === "cpa" ? v.cpa / v.days : v[field],
        })),
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
        new Date(b.date as string).getTime() -
        new Date(a.date as string).getTime()
    );

  return (sorted[0]?.maus as number) ?? null;
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
    .map((r) => ({ date: new Date(r.date as string), daus: r.daus as number, waus: r.waus as number, maus: r.maus as number }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // MAU: group by month, average
  const byMonth = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
    let arr = byMonth.get(key);
    if (!arr) { arr = []; byMonth.set(key, arr); }
    if (r.maus != null) arr.push(r.maus);
  }
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const months = [...byMonth.keys()].sort().slice(-18);
  const mau = months.map((m) => ({ date: `${m}-01`, value: avg(byMonth.get(m)!) }));

  // WAU: group by ISO week, average
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const d = r.date;
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    const key = `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    let arr = byWeek.get(key);
    if (!arr) { arr = []; byWeek.set(key, arr); }
    if (r.waus != null) arr.push(r.waus);
  }
  const weeks = [...byWeek.keys()].sort().slice(-26);
  // Use the Monday of each week as the date label
  const wau = weeks.map((w) => {
    const [yr, wk] = w.split("-W").map(Number);
    const jan1 = new Date(yr, 0, 1);
    const dayOffset = (jan1.getDay() + 6) % 7; // days until Monday
    const monday = new Date(jan1.getTime() + ((wk - 1) * 7 - dayOffset) * 86400000);
    return { date: monday.toISOString().slice(0, 10), value: avg(byWeek.get(w)!) };
  });

  // DAU: daily, last 90 days
  const dailyRows = rows.slice(-90);
  const dau = dailyRows.map((r) => ({
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
    const d = new Date(row.date as string);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let bucket = byMonth.get(key);
    if (!bucket) {
      bucket = { daus: [], waus: [], maus: [] };
      byMonth.set(key, bucket);
    }
    if (row.daus != null) bucket.daus.push(row.daus as number);
    if (row.waus != null) bucket.waus.push(row.waus as number);
    if (row.maus != null) bucket.maus.push(row.maus as number);
  }

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Exclude current calendar month entirely (always incomplete)
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const months = [...byMonth.keys()]
    .filter((m) => m < currentMonth)
    .sort();

  return [
    {
      label: "WAU / MAU",
      color: "#3b3bba",
      data: months.map((m) => {
        const b = byMonth.get(m)!;
        const mau = avg(b.maus);
        return { date: `${m}-01`, value: mau > 0 ? (avg(b.waus) / mau) * 100 : 0 };
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

  // Aggregate: sum maus per (cohort_month, activity_month) across all segments
  const byCohort = new Map<string, Map<number, number>>();
  for (const row of query.rows) {
    if (row.cohort_month == null || row.activity_month == null) continue;
    const cohortDate = new Date(row.cohort_month as string);
    const cohort = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, "0")}`;
    const period = row.activity_month as number;
    const maus = (row.maus as number) ?? 0;

    let periods = byCohort.get(cohort);
    if (!periods) {
      periods = new Map();
      byCohort.set(cohort, periods);
    }
    periods.set(period, (periods.get(period) ?? 0) + maus);
  }

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
          periods.has(i) ? periods.get(i)! / base : null
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
    (r) => String(r.lifecycle_status).toLowerCase() === "employed" && r.is_cleo_headcount === 1
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
        new Date(a.month as string).getTime() -
        new Date(b.month as string).getTime()
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
        date: r.month as string,
        value: r.new_bank_connected_users as number,
      })),
    });
  }

  return series;
}
