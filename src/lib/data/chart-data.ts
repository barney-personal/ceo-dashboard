import { getReportData } from "./mode";
type ChartSeries = {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  dashed?: boolean;
};
import type { BarChartData } from "@/components/charts/bar-chart";

/**
 * ARPU + Margin monthly time series from the OKR Company Dashboard.
 */
export async function getArpuMarginSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("okrs", "company");
  const query = data.find((d) => d.queryName === "ARPU + Margin");
  if (!query) return [];

  const rows = query.rows
    .filter((r) => r.month)
    .sort(
      (a, b) =>
        new Date(a.month as string).getTime() -
        new Date(b.month as string).getTime()
    );

  return [
    {
      label: "Revenue / User",
      color: "#3b3bba",
      data: rows.map((r) => ({
        date: r.month as string,
        value: r.total_revenue as number,
      })),
    },
    {
      label: "Profit / User",
      color: "#2d8a6e",
      data: rows.map((r) => ({
        date: r.month as string,
        value: r.total_profit as number,
      })),
    },
    {
      label: "Margin Target",
      color: "#888",
      dashed: true,
      data: rows
        .filter((r) => r.margin_term_target)
        .map((r) => ({
          date: r.month as string,
          value: (r.margin_term_target as number) * 100,
        })),
    },
  ];
}

/**
 * Margin trend from ARPU + Margin data.
 */
export async function getMarginSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("okrs", "company");
  const query = data.find((d) => d.queryName === "ARPU + Margin");
  if (!query) return [];

  const rows = query.rows
    .filter((r) => r.month)
    .sort(
      (a, b) =>
        new Date(a.month as string).getTime() -
        new Date(b.month as string).getTime()
    );

  return [
    {
      label: "Margin",
      color: "#3b3bba",
      data: rows.map((r) => ({
        date: r.month as string,
        value: (r.margin as number) * 100,
      })),
    },
    {
      label: "Baseline",
      color: "#888",
      dashed: true,
      data: rows
        .filter((r) => r.margin_baseline)
        .map((r) => ({
          date: r.month as string,
          value: (r.margin_baseline as number) * 100,
        })),
    },
  ];
}

/**
 * Payback period data from Growth Marketing Performance.
 */
export async function getPaybackSeries(): Promise<ChartSeries[]> {
  const data = await getReportData("unit-economics", "cac");
  const query = data.find((d) => d.queryName === "Payback");
  if (!query) return [];

  const rows = query.rows
    .filter((r) => r.cohort && r.payback_month != null)
    .sort(
      (a, b) =>
        new Date(a.cohort as string).getTime() -
        new Date(b.cohort as string).getTime()
    )
    .slice(-24); // Last 24 cohorts

  return [
    {
      label: "Payback Month",
      color: "#3b3bba",
      data: rows.map((r) => ({
        date: r.cohort as string,
        value: r.payback_month as number,
      })),
    },
  ];
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

  const months = [...byMonth.keys()]
    .sort()
    .slice(-18);

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
    {
      label: "DAU / MAU",
      color: "#2d8a6e",
      data: months.map((m) => {
        const b = byMonth.get(m)!;
        const mau = avg(b.maus);
        return { date: `${m}-01`, value: mau > 0 ? (avg(b.daus) / mau) * 100 : 0 };
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

  const cohorts = [...byCohort.keys()].sort().slice(-18);

  // Use M0 MAUs as the base for each cohort
  return cohorts
    .filter((c) => byCohort.get(c)!.has(0) && byCohort.get(c)!.get(0)! > 0)
    .map((cohort) => {
      const periods = byCohort.get(cohort)!;
      const base = periods.get(0)!;
      const maxPeriod = Math.max(...periods.keys());
      return {
        cohort,
        periods: Array.from({ length: maxPeriod + 1 }, (_, i) =>
          periods.has(i) ? periods.get(i)! / base : null
        ),
      };
    });
}

/**
 * Headcount by department for bar chart.
 */
export async function getHeadcountByDepartment(): Promise<BarChartData[]> {
  const data = await getReportData("people", "headcount");
  const query = data.find((d) => d.queryName === "headcount");
  if (!query) return [];

  const active = query.rows.filter(
    (r) => r.lifecycle_status === "Employed" && r.is_cleo_headcount === 1
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
