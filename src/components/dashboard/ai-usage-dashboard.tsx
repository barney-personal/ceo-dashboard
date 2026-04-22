"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/line-chart";
import { ColumnChart } from "@/components/charts/column-chart";

interface WeeklyCategoryRow {
  weekStart: string;
  category: string;
  distinctUsers: number;
  totalCost: number;
  totalTokens: number;
}

interface WeeklyModelRow extends WeeklyCategoryRow {
  modelName: string;
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

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
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

export function AiUsageDashboard({
  weeklyByCategory,
  monthlyByModel,
  monthlyByUser,
  people,
}: {
  weeklyByCategory: WeeklyCategoryRow[];
  weeklyByModel?: WeeklyModelRow[];
  monthlyByModel: MonthlyModelRow[];
  monthlyByUser: MonthlyUserRow[];
  people: PersonLookup[];
}) {
  const peopleByEmail = useMemo(
    () => new Map(people.map((p) => [p.email, p])),
    [people],
  );

  const weeklyChart = useMemo(() => {
    const weeks = [
      ...new Set(weeklyByCategory.map((r) => r.weekStart)),
    ].sort();
    const categories = [
      ...new Set(weeklyByCategory.map((r) => r.category)),
    ].sort();

    const series = categories.map((category) => {
      const byWeek = new Map<string, number>();
      for (const row of weeklyByCategory) {
        if (row.category !== category) continue;
        byWeek.set(row.weekStart, row.totalCost);
      }
      return {
        label: category === "claude" ? "Claude" : "Cursor",
        color: CATEGORY_COLORS[category] ?? "#6b7280",
        data: weeks.map((w) => ({ date: w, value: byWeek.get(w) ?? 0 })),
      };
    });

    return { weeks, series };
  }, [weeklyByCategory]);

  const weeklyTotalsColumn = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of weeklyByCategory) {
      map.set(row.weekStart, (map.get(row.weekStart) ?? 0) + row.totalCost);
    }
    return [...map.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [weeklyByCategory]);

  const modelBreakdown = useMemo(() => {
    const months = [
      ...new Set(monthlyByModel.map((r) => r.monthStart)),
    ].sort();
    const latest = months.at(-1);
    if (!latest) return [];

    return monthlyByModel
      .filter((r) => r.monthStart === latest && r.category !== "ALL MODELS")
      .filter((r) => r.modelName !== "ALL MODELS")
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [monthlyByModel]);

  const totalLatestMonth = useMemo(
    () => modelBreakdown.reduce((sum, m) => sum + m.totalCost, 0),
    [modelBreakdown],
  );

  // Stacked monthly cost per model for a small-multiples-style breakdown
  const monthlyModelSeries = useMemo(() => {
    const months = [
      ...new Set(monthlyByModel.map((r) => r.monthStart)),
    ].sort();
    const topModels = [...modelBreakdown]
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 6)
      .map((m) => m.modelName);

    return topModels.map((modelName, index) => {
      const byMonth = new Map<string, number>();
      for (const row of monthlyByModel) {
        if (row.modelName !== modelName) continue;
        if (row.category === "ALL MODELS") continue;
        byMonth.set(
          row.monthStart,
          (byMonth.get(row.monthStart) ?? 0) + row.totalCost,
        );
      }
      const palette = [
        "#4f46e5",
        "#c87f5a",
        "#0ea5e9",
        "#ea580c",
        "#16a34a",
        "#db2777",
      ];
      return {
        label: modelName,
        color: palette[index % palette.length],
        data: months.map((m) => ({
          date: m,
          value: byMonth.get(m) ?? 0,
        })),
      };
    });
  }, [modelBreakdown, monthlyByModel]);

  const userLeaderboard = useMemo(() => {
    const months = [
      ...new Set(monthlyByUser.map((r) => r.monthStart)),
    ].sort();
    const latestMonth = months.at(-1);
    if (!latestMonth) return [];

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

    return [...aggregated.values()]
      .sort((a, b) => b.cost - a.cost)
      .map((entry) => {
        const person = peopleByEmail.get(entry.email);
        return {
          ...entry,
          name: person?.name ?? entry.email,
          jobTitle: person?.jobTitle ?? null,
          squad: person?.squad ?? null,
          pillar: person?.pillar ?? null,
          slug: slugifyEmail(entry.email),
        };
      });
  }, [monthlyByUser, peopleByEmail]);

  const [leaderboardLimit, setLeaderboardLimit] = useState(15);
  const visibleUsers = userLeaderboard.slice(0, leaderboardLimit);
  const maxUserCost = userLeaderboard[0]?.cost ?? 0;

  const [pillarFilter, setPillarFilter] = useState<string>("all");
  const pillarOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of userLeaderboard) {
      if (u.pillar) set.add(u.pillar);
    }
    return ["all", ...[...set].sort()];
  }, [userLeaderboard]);

  const filteredUsers =
    pillarFilter === "all"
      ? visibleUsers
      : userLeaderboard
          .filter((u) => u.pillar === pillarFilter)
          .slice(0, leaderboardLimit);

  return (
    <div className="space-y-8">
      {weeklyChart.series.length > 0 && weeklyChart.weeks.length > 1 && (
        <LineChart
          title="Weekly spend by tool"
          subtitle="Claude (Bedrock) vs Cursor — USD per week"
          yFormatType="currency"
          series={weeklyChart.series}
        />
      )}

      {weeklyTotalsColumn.length > 1 && (
        <ColumnChart
          title="Weekly spend — all tools"
          subtitle="Combined Claude + Cursor spend"
          data={weeklyTotalsColumn}
          color="#7c3aed"
          yFormatType="currency"
        />
      )}

      {modelBreakdown.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Latest month by model
              </p>
              <h3 className="font-display text-lg italic text-foreground">
                {formatMonth(modelBreakdown[0]?.monthStart ?? "")}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(totalLatestMonth)} across{" "}
              {modelBreakdown.length} model
              {modelBreakdown.length === 1 ? "" : "s"}
            </p>
          </div>

          <ul className="mt-5 space-y-2">
            {modelBreakdown.map((model) => {
              const share = totalLatestMonth
                ? (model.totalCost / totalLatestMonth) * 100
                : 0;
              return (
                <li
                  key={`${model.category}-${model.modelName}`}
                  className="flex items-center gap-3 text-xs"
                >
                  <div className="w-40 shrink-0 truncate">
                    <span className="font-medium text-foreground">
                      {model.modelName}
                    </span>
                    <span className="ml-1 rounded-full bg-muted/60 px-1.5 py-px text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      {model.category}
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-muted/40">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(share, 1)}%`,
                          backgroundColor:
                            CATEGORY_COLORS[model.category] ?? "#6b7280",
                        }}
                      />
                    </div>
                  </div>
                  <div className="w-20 shrink-0 text-right tabular-nums font-medium text-foreground">
                    {formatCurrency(model.totalCost)}
                  </div>
                  <div className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                    {share.toFixed(0)}%
                  </div>
                  <div className="w-20 shrink-0 text-right tabular-nums text-muted-foreground/70">
                    {model.distinctUsers}u
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {monthlyModelSeries.length > 0 && monthlyModelSeries[0]?.data.length > 1 && (
        <LineChart
          title="Monthly spend by top models"
          subtitle="Tracks how the model mix shifts month over month"
          yFormatType="currency"
          series={monthlyModelSeries}
        />
      )}

      {userLeaderboard.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card shadow-warm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Top users —{" "}
                {formatMonth(userLeaderboard[0]?.email ? monthlyByUser.at(-1)?.monthStart ?? "" : "")}
              </p>
              <h3 className="font-display text-lg italic text-foreground">
                Who&apos;s spending the most
              </h3>
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
                  <th className="px-5 py-2.5 text-right hidden md:table-cell">
                    Claude
                  </th>
                  <th className="px-5 py-2.5 text-right hidden md:table-cell">
                    Cursor
                  </th>
                  <th className="px-5 py-2.5 text-right">Tokens</th>
                  <th className="px-5 py-2.5 text-right hidden lg:table-cell">
                    Active days
                  </th>
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
                          {user.name !== user.email ? (
                            <Link
                              href={`/dashboard/people/${user.slug}`}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {user.name}
                            </Link>
                          ) : (
                            <span className="text-foreground">{user.name}</span>
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
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatTokens(user.tokens)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground/70 hidden lg:table-cell">
                        {user.nDays}
                      </td>
                      <td className="px-5 py-2.5 hidden xl:table-cell">
                        <div className="h-1.5 w-40 rounded-full bg-muted/40">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.max(share, 1)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
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
