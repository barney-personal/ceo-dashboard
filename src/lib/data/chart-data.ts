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
