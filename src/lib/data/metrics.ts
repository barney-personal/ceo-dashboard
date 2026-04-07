import { getReportData } from "./mode";

/**
 * Format a number as currency (GBP).
 */
export function formatCurrency(value: number, decimals = 2): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
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
 * Get the latest row from a query (typically the most recent period).
 */
function latestRow(
  data: Awaited<ReturnType<typeof getReportData>>,
  queryName: string
): Record<string, unknown> | null {
  const match = data.find((d) => d.queryName === queryName);
  if (!match || match.rows.length === 0) return null;
  return match.rows[match.rows.length - 1];
}

/**
 * Get the first row from a query (for single-value queries).
 */
function firstRow(
  data: Awaited<ReturnType<typeof getReportData>>,
  queryName: string
): Record<string, unknown> | null {
  const match = data.find((d) => d.queryName === queryName);
  if (!match || match.rows.length === 0) return null;
  return match.rows[0];
}

// --- Unit Economics Metrics ---

export async function getUnitEconomicsMetrics() {
  const kpis = await getReportData("unit-economics", "kpis");

  const ltv = firstRow(kpis, "36M LTV");
  const arpu = firstRow(kpis, "ARPU Annualized");
  const margins = firstRow(kpis, "Margins");
  const cpa = firstRow(kpis, "CPA");
  const cvr = firstRow(kpis, "M11 Plus CVR, past 7 days");
  const subscribers = firstRow(kpis, "Subscribers at end of period: Growth accounting");

  const ltvValue = ltv?.user_pnl_36m as number | undefined;
  const arpuValue = arpu?.arpmau as number | undefined;
  const grossMargin = arpu?.gross_margin as number | undefined;
  const contributionMargin = arpu?.contribution_margin as number | undefined;
  const cpaValue = cpa?.avg_cpa as number | undefined;
  const cvrValue = cvr?.average_7d_plus_m11_cvr as number | undefined;
  const mau = arpu?.mau as number | undefined;
  const revenue = arpu?.monthly_revenue as number | undefined;

  const ltvCac =
    ltvValue && cpaValue ? (ltvValue / cpaValue).toFixed(1) : null;

  return {
    ltv: ltvValue ? formatCurrency(ltvValue) : null,
    arpu: arpuValue ? formatCurrency(arpuValue) : null,
    grossMargin: grossMargin ? formatPercent(grossMargin) : null,
    contributionMargin: contributionMargin ? formatPercent(contributionMargin) : null,
    cpa: cpaValue ? formatCurrency(cpaValue) : null,
    cvr: cvrValue ? formatPercent(cvrValue) : null,
    mau: mau ? formatCompact(mau) : null,
    revenue: revenue ? formatCurrency(revenue, 0) : null,
    ltvCac: ltvCac ? `${ltvCac}x` : null,
    subscribers: subscribers,
  };
}

// --- Headcount Metrics ---

export async function getHeadcountMetrics() {
  const data = await getReportData("people", "headcount");
  const headcountData = data.find((d) => d.queryName === "headcount");

  if (!headcountData) return { total: null, lastSync: null };

  const activeEmployees = headcountData.rows.filter(
    (r) =>
      r.lifecycle_status === "Employed" && r.is_cleo_headcount === 1
  );

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
