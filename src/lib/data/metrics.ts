import {
  DatabaseUnavailableError,
  isSchemaCompatibilityError,
  normalizeDatabaseError,
} from "@/lib/db/errors";
import { getReportData, validateModeColumns } from "./mode";
import { selectModeFteActive } from "./people";
import {
  formatCompact,
  formatCurrency,
  formatPercent,
} from "@/lib/format/number";

/**
 * Get a row from a named query.
 * Pass `match` to pick a specific row (e.g. a time period); otherwise returns the first row.
 */
export function getQueryRow(
  data: Awaited<ReturnType<typeof getReportData>>,
  queryName: string,
  match?: Record<string, unknown>,
): Record<string, unknown> | null {
  const query = data.find((d) => d.queryName === queryName);
  if (!query || query.rows.length === 0) return null;
  if (!match) return query.rows[0];
  return (
    query.rows.find((row) =>
      Object.entries(match).every(([k, v]) => row[k] === v),
    ) ?? null
  );
}

function getValidatedQueryRow<TColumn extends string>(
  data: Awaited<ReturnType<typeof getReportData>>,
  queryName: string,
  expectedColumns: readonly TColumn[],
  match?: Record<string, unknown>,
): Record<string, unknown> | null {
  const query = data.find((entry) => entry.queryName === queryName);
  if (!query) {
    return null;
  }

  const row = getQueryRow(data, queryName, match);
  if (!row) {
    return null;
  }

  const validation = validateModeColumns({
    row,
    expectedColumns,
    reportName: query.reportName,
    queryName: query.queryName,
  });

  return validation.isValid ? row : null;
}

async function withMetricsFallback<T>(
  context: string,
  fallback: T,
  compute: () => Promise<T>
): Promise<T> {
  try {
    return await compute();
  } catch (error) {
    const normalized = normalizeDatabaseError(context, error);
    if (
      normalized instanceof DatabaseUnavailableError ||
      isSchemaCompatibilityError(error)
    ) {
      console.error(`[metrics] ${context} degraded to fallback`, normalized);
      return fallback;
    }

    throw normalized;
  }
}

// --- Unit Economics Metrics ---

export async function getUnitEconomicsMetrics() {
  const fallback = {
    ltv: null,
    arpu: null,
    grossMargin: null,
    contributionMargin: null,
    cpa: null,
    cvr: null,
    mau: null,
    revenue: null,
    ltvCac: null,
    subscribers: null as Record<string, unknown> | null,
  };

  return withMetricsFallback(
    "load unit economics metrics",
    fallback,
    async () => {
      const kpis = await getReportData("unit-economics", "kpis", [
        "36M LTV",
        "ARPU Annualized",
        "CPA",
        "M11 Plus CVR, past 7 days",
        "Subscribers at end of period: Growth accounting",
      ]);

      const ltv = getValidatedQueryRow(kpis, "36M LTV", ["user_pnl_36m"]);
      const arpu = getValidatedQueryRow(kpis, "ARPU Annualized", [
        "arpmau",
        "gross_margin",
        "contribution_margin",
        "mau",
        "monthly_revenue",
      ]);
      const cpa = getValidatedQueryRow(
        kpis,
        "CPA",
        ["time_period", "avg_cpa"],
        { time_period: "Previous 365 days" },
      );
      const cvr = getValidatedQueryRow(kpis, "M11 Plus CVR, past 7 days", [
        "average_7d_plus_m11_cvr",
      ]);
      const subscribers = getQueryRow(
        kpis,
        "Subscribers at end of period: Growth accounting",
      );

      if (!ltv || !arpu || !cpa || !cvr) {
        return fallback;
      }

      const ltvValue = ltv?.user_pnl_36m as number | undefined;
      const arpuValue = arpu?.arpmau as number | undefined;
      const grossMargin = arpu?.gross_margin as number | undefined;
      const contributionMargin = arpu?.contribution_margin as number | undefined;
      const cpaValue = cpa?.avg_cpa as number | undefined;
      const cvrValue = cvr?.average_7d_plus_m11_cvr as number | undefined;
      const mau = arpu?.mau as number | undefined;
      const revenue = arpu?.monthly_revenue as number | undefined;

      const ltvCac =
        ltvValue != null && cpaValue != null
          ? (ltvValue / cpaValue).toFixed(1)
          : null;

      return {
        ltv: ltvValue != null ? formatCurrency(ltvValue) : null,
        arpu: arpuValue != null ? formatCurrency(arpuValue) : null,
        grossMargin: grossMargin != null ? formatPercent(grossMargin) : null,
        contributionMargin:
          contributionMargin != null ? formatPercent(contributionMargin) : null,
        cpa: cpaValue != null ? formatCurrency(cpaValue) : null,
        cvr: cvrValue != null ? formatPercent(cvrValue) : null,
        mau: mau != null ? formatCompact(mau) : null,
        revenue: revenue != null ? formatCurrency(revenue, 0) : null,
        ltvCac: ltvCac != null ? `${ltvCac}x` : null,
        subscribers,
      };
    },
  );
}

// --- Headcount Metrics ---

export async function getHeadcountMetrics() {
  const fallback = { total: null as number | null, lastSync: null as Date | null };

  return withMetricsFallback(
    "load headcount metrics",
    fallback,
    async () => {
      const data = await getReportData("people", "headcount", ["headcount"]);
      const headcountData = data.find((d) => d.queryName === "headcount");

      if (!headcountData || headcountData.rows.length === 0) {
        return fallback;
      }

      const validation = validateModeColumns({
        row: headcountData.rows[0],
        expectedColumns: ["start_date", "termination_date", "headcount_label"],
        reportName: headcountData.reportName,
        queryName: headcountData.queryName,
      });

      if (!validation.isValid) {
        return fallback;
      }

      // Match the Mode SSoT report's `headcount_monthly` definition exactly:
      // FTE-labelled rows whose start date has passed and who haven't been terminated.
      return {
        total: selectModeFteActive(headcountData.rows).length,
        lastSync: headcountData.syncedAt,
      };
    },
  );
}

// --- OKR Metrics ---

export async function getOkrMetrics() {
  return withMetricsFallback(
    "load OKR metrics",
    { rows: [] as Record<string, unknown>[], lastSync: null as Date | null },
    async () => {
      const data = await getReportData("okrs", "company");
      const okrData = data.find((d) => d.queryName === "OKR Reporting");

      if (!okrData) return { rows: [], lastSync: null };

      return {
        rows: okrData.rows,
        lastSync: okrData.syncedAt,
      };
    },
  );
}
