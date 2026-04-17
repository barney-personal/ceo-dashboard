import { withDbErrorContext } from "@/lib/db/errors";
import { getReportData, parseRows } from "./mode";
import {
  formatCompact,
  formatCurrency,
  formatPercent,
} from "@/lib/format/number";
import {
  headcountSchema,
  unitEcon36mLtvSchema,
  unitEconArpuSchema,
  unitEconCpaSchema,
  unitEconCvrSchema,
} from "@/lib/validation/mode-rows";

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

// --- Unit Economics Metrics ---

export async function getUnitEconomicsMetrics() {
  const emptyResult = {
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

  return withDbErrorContext(
    "load unit economics metrics",
    async () => {
      const kpis = await getReportData("unit-economics", "kpis", [
        "36M LTV",
        "ARPU Annualized",
        "CPA",
        "M11 Plus CVR, past 7 days",
        "Subscribers at end of period: Growth accounting",
      ]);

      const ltvRow = parseSingleRow(kpis, "36M LTV", unitEcon36mLtvSchema);
      const arpuRow = parseSingleRow(
        kpis,
        "ARPU Annualized",
        unitEconArpuSchema,
      );
      const cpaRow = parseSingleRow(
        kpis,
        "CPA",
        unitEconCpaSchema,
        (r) => r.time_period === "Previous 365 days",
      );
      const cvrRow = parseSingleRow(
        kpis,
        "M11 Plus CVR, past 7 days",
        unitEconCvrSchema,
      );
      const subscribers = getQueryRow(
        kpis,
        "Subscribers at end of period: Growth accounting",
      );

      if (!ltvRow || !arpuRow || !cpaRow || !cvrRow) {
        return emptyResult;
      }

      const ltvCac =
        cpaRow.avg_cpa !== 0
          ? (ltvRow.user_pnl_36m / cpaRow.avg_cpa).toFixed(1)
          : null;

      return {
        ltv: formatCurrency(ltvRow.user_pnl_36m),
        arpu: formatCurrency(arpuRow.arpmau),
        grossMargin: formatPercent(arpuRow.gross_margin),
        contributionMargin: formatPercent(arpuRow.contribution_margin),
        cpa: formatCurrency(cpaRow.avg_cpa),
        cvr: formatPercent(cvrRow.average_7d_plus_m11_cvr),
        mau: formatCompact(arpuRow.mau),
        revenue: formatCurrency(arpuRow.monthly_revenue, 0),
        ltvCac: ltvCac != null ? `${ltvCac}x` : null,
        subscribers,
      };
    },
  );
}

/**
 * Pick a named query from a report-data payload, run it through the given
 * zod schema, and optionally filter to a single matching row. Returns the
 * parsed row or null when the query is missing / no row matched / the row
 * fails validation. Uses `parseRows` so validation failures are logged
 * once per batch.
 */
function parseSingleRow<T>(
  data: Awaited<ReturnType<typeof getReportData>>,
  queryName: string,
  schema: Parameters<typeof parseRows<T>>[0],
  predicate?: (row: T) => boolean,
): T | null {
  const query = data.find((entry) => entry.queryName === queryName);
  if (!query || query.rows.length === 0) return null;

  const { valid } = parseRows(schema, query.rows, {
    reportName: query.reportName,
    queryName: query.queryName,
  });
  if (valid.length === 0) return null;

  if (predicate) {
    return valid.find(predicate) ?? null;
  }
  return valid[0];
}

// --- Headcount Metrics ---

export async function getHeadcountMetrics() {
  const emptyResult = {
    total: null as number | null,
    lastSync: null as Date | null,
  };

  return withDbErrorContext("load headcount metrics", async () => {
    const data = await getReportData("people", "headcount", ["headcount"]);
    const headcountData = data.find((d) => d.queryName === "headcount");

    if (!headcountData || headcountData.rows.length === 0) {
      return emptyResult;
    }

    const { valid } = parseRows(headcountSchema, headcountData.rows, {
      reportName: headcountData.reportName,
      queryName: headcountData.queryName,
    });

    if (valid.length === 0) {
      return emptyResult;
    }

    const activeEmployees = valid.filter(
      (r) =>
        (r.lifecycle_status ?? "").toLowerCase() === "employed" &&
        r.is_cleo_headcount === 1,
    );

    return {
      total: activeEmployees.length,
      lastSync: headcountData.syncedAt,
    };
  });
}

// --- OKR Metrics ---

export async function getOkrMetrics() {
  return withDbErrorContext("load OKR metrics", async () => {
    const data = await getReportData("okrs", "company");
    const okrData = data.find((d) => d.queryName === "OKR Reporting");

    if (!okrData) {
      return {
        rows: [] as Record<string, unknown>[],
        lastSync: null as Date | null,
      };
    }

    return {
      rows: okrData.rows,
      lastSync: okrData.syncedAt,
    };
  });
}
