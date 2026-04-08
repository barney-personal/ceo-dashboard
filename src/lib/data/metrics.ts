import { getReportData } from "./mode";
import { isActiveCleoEmployeeRow } from "./people";

/**
 * Format a number as currency (USD).
 */
export function formatCurrency(value: number, decimals = 2): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/**
 * Format a number as a percentage.
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a large number with K/M suffix.
 */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

/**
 * Get a row from a named query.
 * Pass `match` to pick a specific row (e.g. a time period); otherwise returns the first row.
 */
function getQueryRow(
  data: Awaited<ReturnType<typeof getReportData>>,
  queryName: string,
  match?: Record<string, unknown>
): Record<string, unknown> | null {
  const query = data.find((d) => d.queryName === queryName);
  if (!query || query.rows.length === 0) return null;
  if (!match) return query.rows[0];
  return (
    query.rows.find((row) =>
      Object.entries(match).every(([k, v]) => row[k] === v)
    ) ?? null
  );
}

// --- Unit Economics Metrics ---

export async function getUnitEconomicsMetrics() {
  const kpis = await getReportData("unit-economics", "kpis");

  const ltv = getQueryRow(kpis, "36M LTV");
  const arpu = getQueryRow(kpis, "ARPU Annualized");
  const cpa = getQueryRow(kpis, "CPA", { time_period: "Previous 365 days" });
  const cvr = getQueryRow(kpis, "M11 Plus CVR, past 7 days");
  const subscribers = getQueryRow(kpis, "Subscribers at end of period: Growth accounting");

  const ltvValue = ltv?.user_pnl_36m as number | undefined;
  const arpuValue = arpu?.arpmau as number | undefined;
  const grossMargin = arpu?.gross_margin as number | undefined;
  const contributionMargin = arpu?.contribution_margin as number | undefined;
  const cpaValue = cpa?.avg_cpa as number | undefined;
  const cvrValue = cvr?.average_7d_plus_m11_cvr as number | undefined;
  const mau = arpu?.mau as number | undefined;
  const revenue = arpu?.monthly_revenue as number | undefined;

  const ltvCac =
    ltvValue != null && cpaValue != null ? (ltvValue / cpaValue).toFixed(1) : null;

  return {
    ltv: ltvValue != null ? formatCurrency(ltvValue) : null,
    arpu: arpuValue != null ? formatCurrency(arpuValue) : null,
    grossMargin: grossMargin != null ? formatPercent(grossMargin) : null,
    contributionMargin: contributionMargin != null ? formatPercent(contributionMargin) : null,
    cpa: cpaValue != null ? formatCurrency(cpaValue) : null,
    cvr: cvrValue != null ? formatPercent(cvrValue) : null,
    mau: mau != null ? formatCompact(mau) : null,
    revenue: revenue != null ? formatCurrency(revenue, 0) : null,
    ltvCac: ltvCac != null ? `${ltvCac}x` : null,
    subscribers: subscribers,
  };
}

// --- Headcount Metrics ---

export async function getHeadcountMetrics() {
  const data = await getReportData("people", "headcount");
  const headcountData = data.find((d) => d.queryName === "headcount");

  if (!headcountData) return { total: null, lastSync: null };

  const activeEmployees = headcountData.rows.filter(isActiveCleoEmployeeRow);

  return {
    total: activeEmployees.length,
    lastSync: headcountData.syncedAt,
  };
}

// --- OKR Metrics ---

export async function getOkrMetrics() {
  const data = await getReportData("okrs", "company");
  const okrData = data.find((d) => d.queryName === "OKR Reporting");

  if (!okrData) return { rows: [], lastSync: null };

  return {
    rows: okrData.rows,
    lastSync: okrData.syncedAt,
  };
}
