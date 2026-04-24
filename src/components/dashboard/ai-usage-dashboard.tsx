"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StackedAreaChart } from "@/components/charts/stacked-area-chart";
import { SmallMultiplesTimeSeries } from "@/components/charts/small-multiples-time-series";
import { Sparkline } from "@/components/charts/sparkline";

interface WeeklyCategoryRow {
  weekStart: string;
  category: string;
  distinctUsers: number;
  totalCost: number;
  totalTokens: number;
}

interface MonthlyModelRow {
  monthStart: string;
  category: string;
  modelName: string;
  distinctUsers: number;
  nDays: number;
  totalCost: number;
  totalTokens: number;
}

interface MonthlyUserRow {
  monthStart: string;
  category: string;
  userEmail: string;
  nDays: number;
  nModelsUsed: number;
  totalCost: number;
  totalTokens: number;
}

interface UserMonthlyTrendEntry {
  monthStart: string;
  cost: number;
  tokens: number;
}

interface ModelTrendPanel {
  modelName: string;
  category: string;
  trend: Array<{ monthStart: string; cost: number; tokens: number }>;
  latestCost: number;
  priorCost: number;
}

interface MonthlyModelMix {
  months: string[];
  models: Array<{ modelName: string; category: string; totalCost: number }>;
  rows: Array<{ monthStart: string; [modelName: string]: string | number }>;
}

interface PersonLookup {
  email: string;
  name: string;
  jobTitle: string | null;
  squad: string | null;
  pillar: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  claude: "#c87f5a",
  cursor: "#4f46e5",
};

const MODEL_PALETTE = [
  "#4f46e5",
  "#c87f5a",
  "#0ea5e9",
  "#16a34a",
  "#db2777",
  "#ea580c",
  "#7c3aed",
  "#0d9488",
  "#b45309",
];

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function formatCurrencyCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1000)}K`;
  return `$${Math.round(value)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatMonth(iso: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function slugifyEmail(email: string): string {
  return email.split("@")[0]?.toLowerCase() ?? email;
}

function deltaBadge(value: number, prior: number): {
  label: string;
  tone: "up" | "down" | "flat" | "new";
} {
  if (prior === 0 && value === 0) return { label: "–", tone: "flat" };
  if (prior === 0) return { label: "new", tone: "new" };
  const delta = ((value - prior) / prior) * 100;
  const tone: "up" | "down" | "flat" =
    Math.abs(delta) < 3 ? "flat" : delta > 0 ? "up" : "down";
  const sign = delta > 0 ? "+" : "";
  return { label: `${sign}${delta.toFixed(0)}%`, tone };
}

export function AiUsageDashboard({
  weeklyByCategory,
  monthlyByModel,
  monthlyByUser,
  userTrends,
  modelTrends,
  monthlyModelMix,
  people,
  claudeDataStart,
  canViewProfiles = false,
}: {
  weeklyByCategory: WeeklyCategoryRow[];
  monthlyByModel: MonthlyModelRow[];
  monthlyByUser: MonthlyUserRow[];
  userTrends: Record<string, UserMonthlyTrendEntry[]>;
  modelTrends: ModelTrendPanel[];
  monthlyModelMix?: MonthlyModelMix;
  people: PersonLookup[];
  /** ISO date for the vertical annotation on the weekly area chart. */
  claudeDataStart?: string;
  /** When true, render user names as links to `/dashboard/people/${slug}`.
   *  That route is manager-gated, so non-managers see plain names and no
   *  dead-end link. */
  canViewProfiles?: boolean;
}) {
  const [weeklyMetric, setWeeklyMetric] = useState<"cost" | "tokens">("cost");
  const peopleByEmail = useMemo(
    () => new Map(people.map((p) => [p.email, p])),
    [people],
  );

  // Build the stacked-area data shape: one row per week with one column
  // per category. Weeks with no data for a category get 0. The `metric`
  // toggle swaps the measured field — cost ($) or tokens (count).
  const stackedWeekly = useMemo(() => {
    const weeks = [
      ...new Set(weeklyByCategory.map((r) => r.weekStart)),
    ].sort();
    const categories = [
      ...new Set(weeklyByCategory.map((r) => r.category)),
    ].sort();
    const rows: Array<{ date: string; [key: string]: string | number }> =
      weeks.map((week) => {
        const row: { date: string; [key: string]: string | number } = {
          date: week,
        };
        for (const c of categories) row[c] = 0;
        return row;
      });
    const rowByWeek = new Map(rows.map((r) => [r.date, r]));
    for (const row of weeklyByCategory) {
      const target = rowByWeek.get(row.weekStart);
      if (!target) continue;
      target[row.category] =
        weeklyMetric === "cost" ? row.totalCost : row.totalTokens;
    }
    return {
      rows,
      series: categories.map((c) => ({
        key: c,
        label: c === "claude" ? "Claude" : c === "cursor" ? "Cursor" : c,
        color: CATEGORY_COLORS[c] ?? "#6b7280",
      })),
    };
  }, [weeklyByCategory, weeklyMetric]);

  // Latest month model breakdown with MoM delta + top-10 cap + "other" row.
  const modelBreakdown = useMemo(() => {
    const months = [
      ...new Set(monthlyByModel.map((r) => r.monthStart)),
    ].sort();
    const latest = months.at(-1);
    const prior = months.at(-2);
    if (!latest) return { rows: [], total: 0, latest: "" };

    const latestRows = monthlyByModel
      .filter(
        (r) =>
          r.monthStart === latest &&
          r.category !== "ALL MODELS" &&
          r.modelName !== "ALL MODELS",
      )
      .sort((a, b) => b.totalCost - a.totalCost);

    const priorRows = monthlyByModel.filter(
      (r) =>
        r.monthStart === prior &&
        r.category !== "ALL MODELS" &&
        r.modelName !== "ALL MODELS",
    );
    const priorByKey = new Map(
      priorRows.map((r) => [`${r.category}::${r.modelName}`, r.totalCost]),
    );

    const topN = 10;
    const top = latestRows.slice(0, topN);
    const rest = latestRows.slice(topN);
    const otherLatest = rest.reduce((s, r) => s + r.totalCost, 0);
    const otherPrior = rest.reduce(
      (s, r) =>
        s + (priorByKey.get(`${r.category}::${r.modelName}`) ?? 0),
      0,
    );
    const otherUsers = new Set<number>(); // we don't have cross-model users, just use count
    for (const r of rest) otherUsers.add(r.distinctUsers);

    const rows = top.map((r) => ({
      modelName: r.modelName,
      category: r.category,
      latestCost: r.totalCost,
      priorCost: priorByKey.get(`${r.category}::${r.modelName}`) ?? 0,
      distinctUsers: r.distinctUsers,
      isOther: false,
    }));
    if (rest.length > 0) {
      rows.push({
        modelName: `${rest.length} other model${rest.length === 1 ? "" : "s"}`,
        category: "other",
        latestCost: otherLatest,
        priorCost: otherPrior,
        distinctUsers: 0,
        isOther: true,
      });
    }

    const total = rows.reduce((s, r) => s + r.latestCost, 0);
    return { rows, total, latest };
  }, [monthlyByModel]);

  // Per-model small-multiples panels — sort to put biggest first so the
  // grid reads top-left to bottom-right by importance (Few: meaningful
  // ordering is its own encoding).
  const modelPanels = useMemo(() => {
    return modelTrends.map((m, i) => ({
      label: m.modelName,
      category: m.category,
      color: MODEL_PALETTE[i % MODEL_PALETTE.length],
      data: m.trend.map((t) => ({ date: t.monthStart, value: t.cost })),
    }));
  }, [modelTrends]);

  const userLeaderboard = useMemo(() => {
    const months = [
      ...new Set(monthlyByUser.map((r) => r.monthStart)),
    ].sort();
    const latestMonth = months.at(-1);
    const priorMonth = months.at(-2);
    if (!latestMonth) return { rows: [], latestMonth: "", medianCost: 0 };

    const aggregated = new Map<
      string,
      {
        email: string;
        cost: number;
        tokens: number;
        claudeCost: number;
        cursorCost: number;
        nDays: number;
        nModels: number;
      }
    >();

    for (const row of monthlyByUser) {
      if (row.monthStart !== latestMonth) continue;
      const existing = aggregated.get(row.userEmail) ?? {
        email: row.userEmail,
        cost: 0,
        tokens: 0,
        claudeCost: 0,
        cursorCost: 0,
        nDays: 0,
        nModels: 0,
      };
      existing.cost += row.totalCost;
      existing.tokens += row.totalTokens;
      if (row.category === "claude") existing.claudeCost += row.totalCost;
      if (row.category === "cursor") existing.cursorCost += row.totalCost;
      existing.nDays = Math.max(existing.nDays, row.nDays);
      existing.nModels = Math.max(existing.nModels, row.nModelsUsed);
      aggregated.set(row.userEmail, existing);
    }

    const priorCostByUser = new Map<string, number>();
    for (const row of monthlyByUser) {
      if (row.monthStart !== priorMonth) continue;
      priorCostByUser.set(
        row.userEmail,
        (priorCostByUser.get(row.userEmail) ?? 0) + row.totalCost,
      );
    }

    const costs = [...aggregated.values()]
      .map((u) => u.cost)
      .sort((a, b) => a - b);
    const medianCost =
      costs.length === 0
        ? 0
        : costs.length % 2 === 1
          ? costs[Math.floor(costs.length / 2)]
          : (costs[costs.length / 2 - 1] + costs[costs.length / 2]) / 2;

    const rows = [...aggregated.values()]
      .sort((a, b) => b.cost - a.cost)
      .map((entry) => {
        const person = peopleByEmail.get(entry.email);
        const trend = userTrends[entry.email] ?? [];
        const priorCost = priorCostByUser.get(entry.email) ?? 0;
        return {
          ...entry,
          name: person?.name ?? entry.email,
          jobTitle: person?.jobTitle ?? null,
          squad: person?.squad ?? null,
          pillar: person?.pillar ?? null,
          slug: slugifyEmail(entry.email),
          trendValues: trend.map((t) => t.cost),
          priorCost,
          costPerDay: entry.nDays > 0 ? entry.cost / entry.nDays : 0,
        };
      });

    return { rows, latestMonth, medianCost };
  }, [monthlyByUser, peopleByEmail, userTrends]);

  const [leaderboardLimit, setLeaderboardLimit] = useState(15);
  const [pillarFilter, setPillarFilter] = useState<string>("all");
  const pillarOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of userLeaderboard.rows) {
      if (u.pillar) set.add(u.pillar);
    }
    return ["all", ...[...set].sort()];
  }, [userLeaderboard.rows]);

  const filteredUsers =
    pillarFilter === "all"
      ? userLeaderboard.rows.slice(0, leaderboardLimit)
      : userLeaderboard.rows
          .filter((u) => u.pillar === pillarFilter)
          .slice(0, leaderboardLimit);

  const maxUserCost = userLeaderboard.rows[0]?.cost ?? 0;
  const medianSharePct = maxUserCost
    ? (userLeaderboard.medianCost / maxUserCost) * 100
    : 0;

  return (
    <div className="space-y-8">
      {stackedWeekly.rows.length > 1 && (
        <div className="relative">
          <StackedAreaChart
            title={
              weeklyMetric === "cost" ? "Weekly AI spend" : "Weekly AI tokens"
            }
            subtitle={
              weeklyMetric === "cost"
                ? "Claude + Cursor, stacked so the top line is the company total"
                : "Total tokens consumed per week, stacked by tool"
            }
            data={stackedWeekly.rows}
            series={stackedWeekly.series}
            yFormatType={weeklyMetric === "cost" ? "currency" : "tokens"}
            annotations={
              claudeDataStart
                ? [{ date: claudeDataStart, label: "Claude data begins" }]
                : []
            }
          />
          <div
            className="absolute right-5 top-3 inline-flex rounded-md border border-border/60 bg-background p-0.5 text-[11px]"
            role="tablist"
            aria-label="Weekly chart metric"
          >
            {(["cost", "tokens"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={weeklyMetric === m}
                onClick={() => setWeeklyMetric(m)}
                className={`rounded px-2 py-0.5 capitalize transition-colors ${
                  weeklyMetric === m
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "cost" ? "$ cost" : "Tokens"}
              </button>
            ))}
          </div>
        </div>
      )}

      {monthlyModelMix && monthlyModelMix.rows.length > 1 && (
        <MonthlyModelMixChart mix={monthlyModelMix} />
      )}

      {modelBreakdown.rows.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Latest month by model
              </p>
              <h3 className="font-display text-lg italic text-foreground">
                {formatMonth(modelBreakdown.latest)}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(modelBreakdown.total)} across{" "}
              {modelBreakdown.rows.filter((r) => !r.isOther).length +
                (modelBreakdown.rows.some((r) => r.isOther)
                  ? Number(modelBreakdown.rows.at(-1)?.modelName.split(" ")[0])
                  : 0)}{" "}
              models
            </p>
          </div>

          <ul className="mt-5 space-y-2">
            {modelBreakdown.rows.map((model) => {
              const share = modelBreakdown.total
                ? (model.latestCost / modelBreakdown.total) * 100
                : 0;
              const delta = deltaBadge(model.latestCost, model.priorCost);
              return (
                <li
                  key={`${model.category}-${model.modelName}`}
                  className="flex items-center gap-3 text-xs"
                >
                  <div className="w-40 shrink-0 truncate">
                    <span
                      className={`font-medium ${model.isOther ? "italic text-muted-foreground" : "text-foreground"}`}
                    >
                      {model.modelName}
                    </span>
                    {!model.isOther && (
                      <span className="ml-1 rounded-full bg-muted/60 px-1.5 py-px text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                        {model.category}
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-muted/40">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(share, 0.5)}%`,
                          backgroundColor: model.isOther
                            ? "#9ca3af"
                            : (CATEGORY_COLORS[model.category] ?? "#6b7280"),
                        }}
                      />
                    </div>
                  </div>
                  <div className="w-20 shrink-0 text-right tabular-nums font-medium text-foreground">
                    {formatCurrency(model.latestCost)}
                  </div>
                  <div className="w-12 shrink-0 text-right tabular-nums text-muted-foreground/70">
                    {share.toFixed(0)}%
                  </div>
                  <div
                    className={`w-16 shrink-0 text-right text-[10px] font-medium tabular-nums ${
                      delta.tone === "up"
                        ? "text-amber-700"
                        : delta.tone === "down"
                          ? "text-positive"
                          : delta.tone === "new"
                            ? "text-primary"
                            : "text-muted-foreground/60"
                    }`}
                    title={`Prior month: ${formatCurrency(model.priorCost)}`}
                  >
                    {delta.label}
                  </div>
                  <div className="w-16 shrink-0 text-right tabular-nums text-muted-foreground/60">
                    {model.isOther ? "—" : `${model.distinctUsers}u`}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {modelPanels.length > 0 && (
        <SmallMultiplesTimeSeries
          title="Monthly spend by top models"
          subtitle="One panel per model — shared y-axis so magnitudes compare honestly"
          panels={modelPanels}
          yFormatType="currency"
          sharedY={true}
          columns={3}
        />
      )}

      {userLeaderboard.rows.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card shadow-warm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Top users — {formatMonth(userLeaderboard.latestMonth)}
              </p>
              <h3 className="font-display text-lg italic text-foreground">
                Who&apos;s spending the most
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Median peer: {formatCurrency(userLeaderboard.medianCost)} · grey
                marker on share bars
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              {pillarOptions.length > 2 && (
                <select
                  value={pillarFilter}
                  onChange={(e) => setPillarFilter(e.target.value)}
                  className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground"
                >
                  {pillarOptions.map((p) => (
                    <option key={p} value={p}>
                      {p === "all" ? "All pillars" : p}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={leaderboardLimit}
                onChange={(e) => setLeaderboardLimit(Number(e.target.value))}
                className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value={10}>Top 10</option>
                <option value={15}>Top 15</option>
                <option value={25}>Top 25</option>
                <option value={50}>Top 50</option>
                <option value={1000}>All</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-5 py-2.5 text-left">#</th>
                  <th className="px-5 py-2.5 text-left">User</th>
                  <th className="px-5 py-2.5 text-left hidden lg:table-cell">
                    Squad
                  </th>
                  <th className="px-5 py-2.5 text-right">Spend</th>
                  <th className="px-5 py-2.5 text-right">MoM</th>
                  <th className="px-5 py-2.5 text-center hidden md:table-cell">
                    6mo trend
                  </th>
                  <th className="px-5 py-2.5 text-right hidden md:table-cell">
                    Claude
                  </th>
                  <th className="px-5 py-2.5 text-right hidden md:table-cell">
                    Cursor
                  </th>
                  <th className="px-5 py-2.5 text-right hidden lg:table-cell">
                    $/day
                  </th>
                  <th className="px-5 py-2.5 text-right">Tokens</th>
                  <th className="px-5 py-2.5 text-left w-48 hidden xl:table-cell">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user, i) => {
                  const share = maxUserCost
                    ? (user.cost / maxUserCost) * 100
                    : 0;
                  const delta = deltaBadge(user.cost, user.priorCost);
                  return (
                    <tr
                      key={user.email}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-5 py-2.5 text-muted-foreground font-medium tabular-nums">
                        {i + 1}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex flex-col">
                          {canViewProfiles && user.name !== user.email ? (
                            <Link
                              href={`/dashboard/people/${user.slug}`}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {user.name}
                            </Link>
                          ) : (
                            <span className="font-medium text-foreground">
                              {user.name}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {user.jobTitle ?? user.email}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                        {user.squad ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-medium text-foreground">
                        {formatCurrency(user.cost)}
                      </td>
                      <td
                        className={`px-5 py-2.5 text-right tabular-nums text-[11px] font-medium ${
                          delta.tone === "up"
                            ? "text-amber-700"
                            : delta.tone === "down"
                              ? "text-positive"
                              : delta.tone === "new"
                                ? "text-primary"
                                : "text-muted-foreground/60"
                        }`}
                      >
                        {delta.label}
                      </td>
                      <td className="px-5 py-2.5 hidden md:table-cell">
                        <div className="flex items-center justify-center text-muted-foreground/70">
                          <Sparkline values={user.trendValues} width={80} height={22} />
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                        {user.claudeCost > 0
                          ? formatCurrency(user.claudeCost)
                          : "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                        {user.cursorCost > 0
                          ? formatCurrency(user.cursorCost)
                          : "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground/70 hidden lg:table-cell">
                        {formatCurrencyCompact(user.costPerDay)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatTokens(user.tokens)}
                      </td>
                      <td className="px-5 py-2.5 hidden xl:table-cell">
                        <div className="relative h-1.5 w-40 rounded-full bg-muted/40">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-primary/70"
                            style={{ width: `${Math.max(share, 1)}%` }}
                          />
                          {medianSharePct > 0 && (
                            <div
                              className="absolute top-[-3px] h-3.5 w-px bg-foreground/50"
                              style={{ left: `${medianSharePct}%` }}
                              title={`Median peer: ${formatCurrency(userLeaderboard.medianCost)}`}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-5 py-8 text-center text-xs text-muted-foreground"
                    >
                      No users match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Monthly model mix — one stacked column per month, segments sized by model
 * spend. Lets you see which models are taking share over time AND the total
 * growing, in one figure (vs. the `SmallMultiplesTimeSeries` which shows
 * each model in isolation).
 */
function MonthlyModelMixChart({ mix }: { mix: MonthlyModelMix }) {
  const [mode, setMode] = useState<"absolute" | "share">("absolute");

  const totals = useMemo(() => {
    return mix.rows.map((row) => {
      let total = 0;
      for (const m of mix.models) {
        total += Number(row[m.modelName] ?? 0);
      }
      return total;
    });
  }, [mix]);

  const maxTotal = Math.max(1, ...totals);

  return (
    <section className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Monthly model mix
          </p>
          <h3 className="font-display text-lg italic text-foreground">
            How spend is split by model, over time
          </h3>
        </div>
        <div
          className="inline-flex rounded-md border border-border/60 bg-background p-0.5 text-[11px]"
          role="tablist"
          aria-label="Model mix scale"
        >
          {(["absolute", "share"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 capitalize transition-colors ${
                mode === m
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "absolute" ? "Absolute $" : "Share %"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto px-5 py-4">
        <div
          className="flex items-end gap-2"
          style={{ minWidth: `${Math.max(mix.rows.length * 48, 320)}px` }}
        >
          {mix.rows.map((row, i) => {
            const total = totals[i] ?? 0;
            const barHeightPx = 220;
            const scale = mode === "share" ? 1 : total / maxTotal;
            return (
              <div
                key={row.monthStart}
                className="flex flex-1 min-w-[32px] flex-col items-center gap-1"
              >
                <div className="text-[10px] tabular-nums text-muted-foreground/80">
                  {formatCurrencyCompact(total)}
                </div>
                <div
                  className="relative flex w-full flex-col overflow-hidden rounded-sm border border-border/40 bg-muted/10"
                  style={{ height: `${barHeightPx}px` }}
                  title={`${formatMonth(row.monthStart)} · ${formatCurrency(total)}`}
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 flex flex-col-reverse"
                    style={{
                      height: `${Math.max(scale * 100, 1)}%`,
                    }}
                  >
                    {mix.models.map((model, mi) => {
                      const value = Number(row[model.modelName] ?? 0);
                      if (value <= 0) return null;
                      const pct = total > 0 ? (value / total) * 100 : 0;
                      const color =
                        model.modelName === "Other"
                          ? "#9ca3af"
                          : MODEL_PALETTE[mi % MODEL_PALETTE.length];
                      return (
                        <div
                          key={model.modelName}
                          style={{
                            height: `${pct}%`,
                            backgroundColor: color,
                            opacity: 0.9,
                          }}
                          title={`${model.modelName}: ${formatCurrency(value)} (${pct.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="whitespace-nowrap text-[10px] text-muted-foreground">
                  {formatMonth(row.monthStart)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/40 px-5 py-3 text-[11px]">
        {mix.models.map((m, i) => (
          <li key={m.modelName} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{
                backgroundColor:
                  m.modelName === "Other"
                    ? "#9ca3af"
                    : MODEL_PALETTE[i % MODEL_PALETTE.length],
              }}
            />
            <span className="text-foreground">{m.modelName}</span>
            {m.category !== "other" && (
              <span className="text-muted-foreground/70">
                · {m.category}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
