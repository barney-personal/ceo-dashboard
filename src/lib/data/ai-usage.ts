import { getReportData, rowNum, rowStr } from "./mode";

export const AI_USAGE_CATEGORIES = ["claude", "cursor"] as const;
export type AiUsageCategory = (typeof AI_USAGE_CATEGORIES)[number];

export interface WeeklyCategoryRow {
  weekStart: string;
  category: string;
  distinctUsers: number;
  totalCost: number;
  totalTokens: number;
}

export interface WeeklyModelRow extends WeeklyCategoryRow {
  modelName: string;
}

export interface MonthlyModelRow {
  monthStart: string;
  category: string;
  modelName: string;
  distinctUsers: number;
  nDays: number;
  totalCost: number;
  totalTokens: number;
}

export interface MonthlyUserRow {
  monthStart: string;
  category: string;
  userEmail: string;
  nDays: number;
  nModelsUsed: number;
  totalCost: number;
  totalTokens: number;
  medianTokensPerPerson: number;
  avgTokensPerPerson: number;
  avgCostPerPerson: number;
  medianCost: number;
}

export interface AiUsageData {
  weeklyByCategory: WeeklyCategoryRow[];
  weeklyByModel: WeeklyModelRow[];
  monthlyByModel: MonthlyModelRow[];
  monthlyByUser: MonthlyUserRow[];
  syncedAt: Date | null;
  /** Tracks presence of each expected query for empty-state reporting. */
  missing: string[];
}

const EXPECTED_QUERIES = [
  "Query 1",
  "Query 3",
  "MoM Usage",
  "Overall Data",
] as const;

function parseDate(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Mode ships timestamps like "2026-04-01T00:00:00.000Z". Trim to YYYY-MM-DD.
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : raw;
}

function parseOverallRow(row: Record<string, unknown>): WeeklyCategoryRow {
  return {
    weekStart: parseDate(row.week_),
    category: rowStr(row, "category"),
    distinctUsers: rowNum(row, "distinct_users"),
    totalCost: rowNum(row, "total_cost"),
    totalTokens: rowNum(row, "total_tokens"),
  };
}

function parseWeeklyModelRow(row: Record<string, unknown>): WeeklyModelRow {
  return {
    weekStart: parseDate(row.week_),
    category: rowStr(row, "category"),
    modelName: rowStr(row, "model_name"),
    distinctUsers: rowNum(row, "distinct_users"),
    totalCost: rowNum(row, "total_cost"),
    totalTokens: rowNum(row, "total_tokens"),
  };
}

function parseMonthlyModelRow(row: Record<string, unknown>): MonthlyModelRow {
  return {
    monthStart: parseDate(row.month_),
    category: rowStr(row, "category"),
    modelName: rowStr(row, "model_name"),
    distinctUsers: rowNum(row, "distinct_users"),
    nDays: rowNum(row, "n_days"),
    totalCost: rowNum(row, "total_cost"),
    totalTokens: rowNum(row, "total_tokens"),
  };
}

function parseMonthlyUserRow(row: Record<string, unknown>): MonthlyUserRow {
  return {
    monthStart: parseDate(row.month_),
    category: rowStr(row, "category"),
    userEmail: rowStr(row, "user_email").toLowerCase(),
    nDays: rowNum(row, "n_days"),
    nModelsUsed: rowNum(row, "n_models_used"),
    totalCost: rowNum(row, "total_cost"),
    totalTokens: rowNum(row, "total_tokens"),
    medianTokensPerPerson: rowNum(row, "median_tokens_used_per_person"),
    avgTokensPerPerson: rowNum(row, "avg_tokens_used_per_person"),
    avgCostPerPerson: rowNum(row, "avg_cost_used_per_person"),
    medianCost: rowNum(row, "median_cost"),
  };
}

export async function getAiUsageData(): Promise<AiUsageData> {
  const reportData = await getReportData(
    "people",
    "ai-usage",
    EXPECTED_QUERIES,
  );

  const byName = new Map(reportData.map((entry) => [entry.queryName, entry]));

  const weeklyByCategory = (byName.get("Overall Data")?.rows ?? []).map(
    parseOverallRow,
  );
  const weeklyByModel = (byName.get("Query 1")?.rows ?? []).map(
    parseWeeklyModelRow,
  );
  const monthlyByModel = (byName.get("MoM Usage")?.rows ?? []).map(
    parseMonthlyModelRow,
  );
  const monthlyByUser = (byName.get("Query 3")?.rows ?? []).map(
    parseMonthlyUserRow,
  );

  // Keep the most recent sync across the 4 queries so "last synced" is honest.
  const syncedAt = reportData.reduce<Date | null>((latest, entry) => {
    if (!latest) return entry.syncedAt;
    return entry.syncedAt.getTime() > latest.getTime() ? entry.syncedAt : latest;
  }, null);

  const missing = EXPECTED_QUERIES.filter((name) => !byName.has(name));

  return {
    weeklyByCategory,
    weeklyByModel,
    monthlyByModel,
    monthlyByUser,
    syncedAt,
    missing,
  };
}

export interface AiUsageTotals {
  totalCost: number;
  totalTokens: number;
  totalUsers: number;
  /** Latest complete week/month totals for headline cards. */
  latestWeekStart: string | null;
  latestWeekCost: number;
  latestMonthStart: string | null;
  latestMonthCost: number;
  priorMonthCost: number;
}

export function summariseTotals(data: AiUsageData): AiUsageTotals {
  let totalCost = 0;
  let totalTokens = 0;
  for (const row of data.weeklyByCategory) {
    totalCost += row.totalCost;
    totalTokens += row.totalTokens;
  }

  const uniqueUsers = new Set<string>();
  for (const row of data.monthlyByUser) {
    if (row.userEmail) uniqueUsers.add(row.userEmail);
  }

  const weekTotals = new Map<string, number>();
  for (const row of data.weeklyByCategory) {
    weekTotals.set(
      row.weekStart,
      (weekTotals.get(row.weekStart) ?? 0) + row.totalCost,
    );
  }
  const sortedWeeks = [...weekTotals.keys()].sort();
  const latestWeekStart = sortedWeeks.at(-1) ?? null;
  const latestWeekCost = latestWeekStart
    ? (weekTotals.get(latestWeekStart) ?? 0)
    : 0;

  // Use MoM rollup ("ALL MODELS") for monthly total so cost matches the
  // source dashboard exactly.
  const monthTotals = new Map<string, number>();
  for (const row of data.monthlyByModel) {
    if (row.category !== "ALL MODELS") continue;
    monthTotals.set(
      row.monthStart,
      (monthTotals.get(row.monthStart) ?? 0) + row.totalCost,
    );
  }
  const sortedMonths = [...monthTotals.keys()].sort();
  const latestMonthStart = sortedMonths.at(-1) ?? null;
  const latestMonthCost = latestMonthStart
    ? (monthTotals.get(latestMonthStart) ?? 0)
    : 0;
  const priorMonthStart = sortedMonths.at(-2) ?? null;
  const priorMonthCost = priorMonthStart
    ? (monthTotals.get(priorMonthStart) ?? 0)
    : 0;

  return {
    totalCost,
    totalTokens,
    totalUsers: uniqueUsers.size,
    latestWeekStart,
    latestWeekCost,
    latestMonthStart,
    latestMonthCost,
    priorMonthCost,
  };
}

export interface AiUsageUserSummary {
  userEmail: string;
  totalCost: number;
  totalTokens: number;
  nDays: number;
  byCategory: Array<{
    category: string;
    cost: number;
    tokens: number;
    nDays: number;
  }>;
  latestMonthStart: string;
}

/**
 * Aggregate the latest month's per-user rows so each engineer has a single
 * combined row (Claude + Cursor). Callers render this on the leaderboard and
 * engineer deep-dive.
 */
export function aggregateLatestMonthByUser(
  data: AiUsageData,
): Map<string, AiUsageUserSummary> {
  const sortedMonths = [
    ...new Set(data.monthlyByUser.map((r) => r.monthStart)),
  ].sort();
  const latestMonthStart = sortedMonths.at(-1);
  if (!latestMonthStart) return new Map();

  const perUser = new Map<string, AiUsageUserSummary>();
  for (const row of data.monthlyByUser) {
    if (row.monthStart !== latestMonthStart) continue;
    if (!row.userEmail) continue;

    const existing = perUser.get(row.userEmail);
    if (existing) {
      existing.totalCost += row.totalCost;
      existing.totalTokens += row.totalTokens;
      existing.nDays = Math.max(existing.nDays, row.nDays);
      existing.byCategory.push({
        category: row.category,
        cost: row.totalCost,
        tokens: row.totalTokens,
        nDays: row.nDays,
      });
    } else {
      perUser.set(row.userEmail, {
        userEmail: row.userEmail,
        totalCost: row.totalCost,
        totalTokens: row.totalTokens,
        nDays: row.nDays,
        byCategory: [
          {
            category: row.category,
            cost: row.totalCost,
            tokens: row.totalTokens,
            nDays: row.nDays,
          },
        ],
        latestMonthStart,
      });
    }
  }

  return perUser;
}

export function getUserTrend(
  data: AiUsageData,
  email: string,
): {
  monthStart: string;
  totalCost: number;
  totalTokens: number;
  byCategory: Array<{ category: string; cost: number; tokens: number }>;
}[] {
  const normalizedEmail = email.toLowerCase();
  const rows = data.monthlyByUser.filter(
    (r) => r.userEmail === normalizedEmail,
  );
  const byMonth = new Map<
    string,
    {
      monthStart: string;
      totalCost: number;
      totalTokens: number;
      byCategory: Array<{ category: string; cost: number; tokens: number }>;
    }
  >();

  for (const row of rows) {
    const entry = byMonth.get(row.monthStart) ?? {
      monthStart: row.monthStart,
      totalCost: 0,
      totalTokens: 0,
      byCategory: [],
    };
    entry.totalCost += row.totalCost;
    entry.totalTokens += row.totalTokens;
    entry.byCategory.push({
      category: row.category,
      cost: row.totalCost,
      tokens: row.totalTokens,
    });
    byMonth.set(row.monthStart, entry);
  }

  return [...byMonth.values()].sort((a, b) =>
    a.monthStart.localeCompare(b.monthStart),
  );
}
