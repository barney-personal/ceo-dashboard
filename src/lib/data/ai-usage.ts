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
  /** All-time spend across every weekly Overall row. */
  totalCost: number;
  /** All-time token count across every weekly Overall row. */
  totalTokens: number;
  /**
   * Distinct user emails that have *ever* appeared in the Query 3 data —
   * cumulative since data collection began. Use `latestMonthUsers` for the
   * "active this month" headline.
   */
  totalUsers: number;
  /** Latest complete week/month totals for headline cards. */
  latestWeekStart: string | null;
  latestWeekCost: number;
  latestMonthStart: string | null;
  latestMonthCost: number;
  priorMonthCost: number;
  /** Sum of weekly spend over the trailing 4 weeks (≈ 30-day spend). */
  trailing30DayCost: number;
  /** Prior 30 days (weeks 5-8 back) for the trailing-30-day MoM delta. */
  prior30DayCost: number;
  /** Active users in the current month. */
  latestMonthUsers: number;
  /** Active users in the prior month. */
  priorMonthUsers: number;
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

  // Trailing-30-day sums derived from the 4 most-recent weeks. Prior window
  // = weeks 5-8. Gives a more decision-relevant "how much are we spending
  // right now" than an all-time total.
  const sortedWeekCosts = sortedWeeks.map((w) => weekTotals.get(w) ?? 0);
  const trailing30DayCost = sortedWeekCosts.slice(-4).reduce((a, b) => a + b, 0);
  const prior30DayCost = sortedWeekCosts.slice(-8, -4).reduce((a, b) => a + b, 0);

  const latestMonthUsers = new Set<string>();
  const priorMonthUsers = new Set<string>();
  const sortedUserMonths = [
    ...new Set(data.monthlyByUser.map((r) => r.monthStart)),
  ].sort();
  const latestUserMonth = sortedUserMonths.at(-1);
  const priorUserMonth = sortedUserMonths.at(-2);
  for (const row of data.monthlyByUser) {
    if (!row.userEmail) continue;
    if (row.monthStart === latestUserMonth) latestMonthUsers.add(row.userEmail);
    if (row.monthStart === priorUserMonth) priorMonthUsers.add(row.userEmail);
  }

  return {
    totalCost,
    totalTokens,
    totalUsers: uniqueUsers.size,
    latestWeekStart,
    latestWeekCost,
    latestMonthStart,
    latestMonthCost,
    priorMonthCost,
    trailing30DayCost,
    prior30DayCost,
    latestMonthUsers: latestMonthUsers.size,
    priorMonthUsers: priorMonthUsers.size,
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

export interface UserMonthlyTrend {
  monthStart: string;
  cost: number;
  tokens: number;
}

/**
 * Build a per-user monthly spend trend indexed by email so the leaderboard
 * can render sparklines without a second pass through the data.
 *
 * `months` bounds the trend to the last N months so sparklines fit in a
 * ~72px width. Earlier months fall off the left.
 */
export function buildUserMonthlyTrends(
  data: AiUsageData,
  months = 6,
): Map<string, UserMonthlyTrend[]> {
  const allMonths = [
    ...new Set(data.monthlyByUser.map((r) => r.monthStart)),
  ].sort();
  const windowMonths = allMonths.slice(-months);
  const windowSet = new Set(windowMonths);

  const per = new Map<string, Map<string, { cost: number; tokens: number }>>();
  for (const row of data.monthlyByUser) {
    if (!windowSet.has(row.monthStart)) continue;
    if (!row.userEmail) continue;
    const inner =
      per.get(row.userEmail) ??
      new Map<string, { cost: number; tokens: number }>();
    const existing = inner.get(row.monthStart) ?? { cost: 0, tokens: 0 };
    inner.set(row.monthStart, {
      cost: existing.cost + row.totalCost,
      tokens: existing.tokens + row.totalTokens,
    });
    per.set(row.userEmail, inner);
  }

  const result = new Map<string, UserMonthlyTrend[]>();
  for (const [email, monthMap] of per) {
    result.set(
      email,
      windowMonths.map((m) => {
        const v = monthMap.get(m);
        return {
          monthStart: m,
          cost: v?.cost ?? 0,
          tokens: v?.tokens ?? 0,
        };
      }),
    );
  }
  return result;
}

export interface ModelMonthlyTrend {
  monthStart: string;
  cost: number;
  tokens: number;
}

/**
 * Build a per-model monthly trend for small-multiples panels. Returns the
 * top-N models by latest-month spend, each padded with zero-values for any
 * month they didn't appear in so the x-axes line up.
 */
export function buildTopModelTrends(
  data: AiUsageData,
  topN = 9,
): Array<{
  modelName: string;
  category: string;
  trend: ModelMonthlyTrend[];
  latestCost: number;
  priorCost: number;
}> {
  const allMonths = [
    ...new Set(data.monthlyByModel.map((r) => r.monthStart)),
  ].sort();
  const latestMonth = allMonths.at(-1);
  const priorMonth = allMonths.at(-2);
  if (!latestMonth) return [];

  // Sort models by latest-month cost (only non-ALL-MODELS rows).
  const latestRows = data.monthlyByModel
    .filter(
      (r) =>
        r.monthStart === latestMonth &&
        r.category !== "ALL MODELS" &&
        r.modelName !== "ALL MODELS",
    )
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, topN);

  return latestRows.map((latestRow) => {
    const byMonth = new Map<string, { cost: number; tokens: number }>();
    for (const row of data.monthlyByModel) {
      if (row.modelName !== latestRow.modelName) continue;
      if (row.category !== latestRow.category) continue;
      const existing = byMonth.get(row.monthStart) ?? { cost: 0, tokens: 0 };
      byMonth.set(row.monthStart, {
        cost: existing.cost + row.totalCost,
        tokens: existing.tokens + row.totalTokens,
      });
    }

    const trend = allMonths.map((m) => {
      const v = byMonth.get(m) ?? { cost: 0, tokens: 0 };
      return { monthStart: m, cost: v.cost, tokens: v.tokens };
    });

    const priorCost = priorMonth ? (byMonth.get(priorMonth)?.cost ?? 0) : 0;

    return {
      modelName: latestRow.modelName,
      category: latestRow.category,
      trend,
      latestCost: latestRow.totalCost,
      priorCost,
    };
  });
}

/**
 * Get peer spend for the latest month (one entry per user). Used for the
 * distribution strip on an engineer's profile.
 */
export function getLatestMonthPeerSpend(data: AiUsageData): number[] {
  const perUser = aggregateLatestMonthByUser(data);
  return [...perUser.values()].map((u) => u.totalCost);
}

/**
 * Summed daily spend for the trailing N days, derived from the weekly
 * totals query. Used for metric-card sparklines.
 */
export function getTrailingWeeklyTotals(
  data: AiUsageData,
  weeks = 12,
): Array<{ weekStart: string; cost: number }> {
  const byWeek = new Map<string, number>();
  for (const row of data.weeklyByCategory) {
    byWeek.set(row.weekStart, (byWeek.get(row.weekStart) ?? 0) + row.totalCost);
  }
  return [...byWeek.entries()]
    .map(([weekStart, cost]) => ({ weekStart, cost }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-weeks);
}

/**
 * Build the "Monthly model mix" data — one row per month, one column per
 * model, with `cost` values that sum to that month's grand total. Excludes
 * Mode's `ALL MODELS` rollup rows. Caller renders this as a stacked bar so
 * readers can see (a) how the mix shifts (new models taking share) and
 * (b) the total growing over time, in one figure.
 *
 * `topN` bounds the distinct columns to the biggest models by all-time
 * cost; everything else gets rolled into an "Other" bucket so the legend
 * doesn't explode as new models are added.
 */
export function buildMonthlyModelMix(
  data: AiUsageData,
  topN = 9,
): {
  months: string[];
  models: Array<{ modelName: string; category: string; totalCost: number }>;
  rows: Array<{ monthStart: string; [modelName: string]: string | number }>;
} {
  const byMonthModel = new Map<string, Map<string, number>>();
  const totalByModel = new Map<
    string,
    { cost: number; category: string }
  >();
  const months = new Set<string>();

  for (const row of data.monthlyByModel) {
    if (row.category === "ALL MODELS" || row.modelName === "ALL MODELS") {
      continue;
    }
    months.add(row.monthStart);
    const perMonth =
      byMonthModel.get(row.monthStart) ?? new Map<string, number>();
    perMonth.set(
      row.modelName,
      (perMonth.get(row.modelName) ?? 0) + row.totalCost,
    );
    byMonthModel.set(row.monthStart, perMonth);

    const existing = totalByModel.get(row.modelName);
    totalByModel.set(row.modelName, {
      cost: (existing?.cost ?? 0) + row.totalCost,
      category: row.category,
    });
  }

  const sortedModels = [...totalByModel.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([modelName, { cost, category }]) => ({
      modelName,
      category,
      totalCost: cost,
    }));
  const topModels = sortedModels.slice(0, topN);
  const restNames = new Set(sortedModels.slice(topN).map((m) => m.modelName));

  const sortedMonths = [...months].sort();
  const rows = sortedMonths.map((monthStart) => {
    const perMonth = byMonthModel.get(monthStart) ?? new Map();
    const row: { monthStart: string; [modelName: string]: string | number } = {
      monthStart,
    };
    for (const model of topModels) {
      row[model.modelName] = perMonth.get(model.modelName) ?? 0;
    }
    let otherCost = 0;
    for (const name of restNames) {
      otherCost += perMonth.get(name) ?? 0;
    }
    if (restNames.size > 0) {
      row.Other = otherCost;
    }
    return row;
  });

  const models = [...topModels];
  if (restNames.size > 0) {
    models.push({
      modelName: "Other",
      category: "other",
      totalCost: [...sortedModels.slice(topN)].reduce(
        (s, m) => s + m.totalCost,
        0,
      ),
    });
  }

  return { months: sortedMonths, models, rows };
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
