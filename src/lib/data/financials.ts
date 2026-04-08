import { db } from "@/lib/db";
import { financialPeriods } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export interface FinancialPeriod {
  period: string;
  periodLabel: string;
  revenue: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  contributionProfit: number | null;
  contributionMargin: number | null;
  ebitda: number | null;
  ebitdaMargin: number | null;
  netIncome: number | null;
  cashPosition: number | null;
  cashBurn: number | null;
  opex: number | null;
  headcountCost: number | null;
  marketingCost: number | null;
  slackSummary: string | null;
  postedAt: Date | null;
}

function toNum(val: string | null): number | null {
  if (val === null) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function mapRow(row: typeof financialPeriods.$inferSelect): FinancialPeriod {
  return {
    period: row.period,
    periodLabel: row.periodLabel,
    revenue: toNum(row.revenue),
    grossProfit: toNum(row.grossProfit),
    grossMargin: toNum(row.grossMargin),
    contributionProfit: toNum(row.contributionProfit),
    contributionMargin: toNum(row.contributionMargin),
    ebitda: toNum(row.ebitda),
    ebitdaMargin: toNum(row.ebitdaMargin),
    netIncome: toNum(row.netIncome),
    cashPosition: toNum(row.cashPosition),
    cashBurn: toNum(row.cashBurn),
    opex: toNum(row.opex),
    headcountCost: toNum(row.headcountCost),
    marketingCost: toNum(row.marketingCost),
    slackSummary: row.slackSummary,
    postedAt: row.postedAt,
  };
}

/**
 * Get all financial periods, ordered newest first.
 */
export async function getFinancialPeriods(): Promise<FinancialPeriod[]> {
  const rows = await db
    .select()
    .from(financialPeriods)
    .orderBy(desc(financialPeriods.period));

  return rows.map(mapRow);
}

/**
 * Get the latest financial period.
 */
export async function getLatestFinancialPeriod(): Promise<FinancialPeriod | null> {
  const rows = await db
    .select()
    .from(financialPeriods)
    .orderBy(desc(financialPeriods.period))
    .limit(1);

  return rows.length > 0 ? mapRow(rows[0]) : null;
}
