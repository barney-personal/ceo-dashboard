import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  modeReportData,
  modeReports,
  slackEmployeeMap,
  slackMemberSnapshots,
} from "@/lib/db/schema";

const DAY_MS = 86_400_000;
const WINDOW_CAP_DAYS = 365;

/**
 * Engagement composite design.
 *
 * The score blends two percentile-ranked signals, each computed across the
 * ranking population (non-guest, non-deactivated, non-service).
 *
 * - Messages per calendar day (tenure-normalised) — Spearman 0.60 with impact
 * - Reactions per calendar day (tenure-normalised) — Spearman 0.58 with impact
 *
 * Earlier iterations weighted desktop-active days higher than mobile-only
 * days on the intuition that "real work happens on desktop". Empirically,
 * desktop share correlates NEGATIVELY with shipping impact (-0.28) for
 * engineers — heads-down shippers use Slack on mobile for quick checks.
 * Active-day rate is essentially uncorrelated with impact (-0.05). Both
 * have been removed from the composite. `activeDayRate` is retained as a
 * display-only column (no capping, no weighting).
 */

export interface SlackMemberRow {
  slackUserId: string;
  name: string;
  username: string | null;
  title: string | null;
  accountType: string;
  isGuest: boolean;
  isDeactivated: boolean;
  isServiceAccount: boolean;

  accountCreatedAt: Date | null;
  lastActiveAt: Date | null;
  deactivatedAt: Date | null;

  tenureDays: number | null;
  normalizationDays: number;
  daysActive: number;
  /** Share of days that included desktop usage (display-only; not in composite). */
  desktopShare: number | null;
  /** daysActive / normalizationDays, capped at 1. Display-only, not in composite. */
  activeDayRate: number;

  messagesPosted: number;
  messagesPostedInChannels: number;
  channelShare: number | null;
  reactionsAdded: number;
  msgsPerCalendarDay: number;
  msgsPerActiveDay: number;
  reactionsPerCalendarDay: number;

  daysSinceLastActive: number | null;

  primaryPlatform: "desktop" | "android" | "ios" | "none";
  daysActiveDesktop: number;
  daysActiveAndroid: number;
  daysActiveIos: number;

  /** Percentile rank of messages/calendar-day within the ranking population. */
  msgsPerDayPercentile: number;
  /** Percentile rank of reactions/calendar-day within the ranking population. */
  reactionsPerDayPercentile: number;
  /** Avg of the two percentiles, scaled to 0–100. */
  engagementScore: number;

  /** Resolution of Slack → SSoT (null when not reconciled yet). */
  matchMethod:
    | "auto_username"
    | "auto_name"
    | "manual"
    | "external"
    | "unmatched"
    | null;
  employeeEmail: string | null;
  /** Preferred name from SSoT (falls back to Slack name). */
  employeeName: string | null;
  jobTitle: string | null;
  pillar: string | null;
  squad: string | null;
  function: string | null;
  manager: string | null;
  department: string | null;
  startDate: string | null;
}

export interface SlackMembersSnapshot {
  windowStart: Date;
  windowEnd: Date;
  importedAt: Date;
  rows: SlackMemberRow[];
}

export interface SlackGroupSummary {
  /** Pillar or squad name. */
  key: string;
  /** When grouping by squad, the parent pillar (nullable). */
  pillar: string | null;
  memberCount: number;
  activeLast30dCount: number;
  /** 0–1 — share active in last 30d. */
  activeShare: number;
  /** 0–100 — median percentile composite across members. */
  medianEngagement: number;
  /** 0–100 — mean engagement across members. */
  avgEngagement: number;
  /** Mean of activeDayRate (0–1). */
  avgActiveDayRate: number;
  totalMessages: number;
  totalReactions: number;
  /** Messages per member per calendar day (window-normalised). */
  msgsPerMemberPerDay: number;
  /** Member with the lowest engagement score in the group (slug + name + score). */
  leastEngaged: {
    slug: string | null;
    name: string;
    engagementScore: number;
  } | null;
  /** Member with the highest engagement score in the group. */
  mostEngaged: {
    slug: string | null;
    name: string;
    engagementScore: number;
  } | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Aggregate rankable members by pillar or squad. Rows without a group
 * assignment are bucketed as "Unassigned". Deactivated / guests / service
 * accounts are excluded from aggregation (same ranking population as the
 * individual view).
 */
export function aggregateMembers(
  rows: SlackMemberRow[],
  by: "pillar" | "squad",
): SlackGroupSummary[] {
  const rankable = rows.filter(
    (r) => !r.isGuest && !r.isDeactivated && !r.isServiceAccount,
  );

  const groups = new Map<string, { pillar: string | null; members: SlackMemberRow[] }>();
  for (const r of rankable) {
    const key = (by === "pillar" ? r.pillar : r.squad) ?? "Unassigned";
    const pillarForSquad = by === "squad" ? r.pillar : null;
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(r);
    } else {
      groups.set(key, { pillar: pillarForSquad, members: [r] });
    }
  }

  const summaries: SlackGroupSummary[] = [];
  for (const [key, { pillar, members }] of groups) {
    const active = members.filter(
      (r) => r.daysSinceLastActive !== null && r.daysSinceLastActive <= 30,
    );
    const scores = members.map((r) => r.engagementScore);
    const avgEngagement =
      scores.length > 0
        ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
        : 0;
    const avgActiveDayRate =
      members.length > 0
        ? members.reduce((s, r) => s + r.activeDayRate, 0) / members.length
        : 0;
    const totalMessages = members.reduce((s, r) => s + r.messagesPosted, 0);
    const totalReactions = members.reduce((s, r) => s + r.reactionsAdded, 0);
    const avgNormDays =
      members.length > 0
        ? members.reduce((s, r) => s + r.normalizationDays, 0) / members.length
        : 1;
    const msgsPerMemberPerDay =
      members.length > 0 ? totalMessages / members.length / avgNormDays : 0;

    // Bottom / top of the group (only counts non-zero scores; skip 0s which
    // mean "outside ranking population" — shouldn't happen after filtering)
    const sortedByScore = [...members].sort(
      (a, b) => a.engagementScore - b.engagementScore,
    );
    const leastEngagedRow = sortedByScore[0] ?? null;
    const mostEngagedRow = sortedByScore[sortedByScore.length - 1] ?? null;

    summaries.push({
      key,
      pillar,
      memberCount: members.length,
      activeLast30dCount: active.length,
      activeShare: members.length > 0 ? active.length / members.length : 0,
      medianEngagement: Math.round(median(scores)),
      avgEngagement,
      avgActiveDayRate,
      totalMessages,
      totalReactions,
      msgsPerMemberPerDay,
      leastEngaged: leastEngagedRow
        ? {
            slug:
              leastEngagedRow.employeeEmail?.split("@")[0] ?? null,
            name: leastEngagedRow.employeeName ?? leastEngagedRow.name,
            engagementScore: leastEngagedRow.engagementScore,
          }
        : null,
      mostEngaged: mostEngagedRow
        ? {
            slug:
              mostEngagedRow.employeeEmail?.split("@")[0] ?? null,
            name: mostEngagedRow.employeeName ?? mostEngagedRow.name,
            engagementScore: mostEngagedRow.engagementScore,
          }
        : null,
    });
  }

  return summaries;
}

function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

function isServiceAccountName(name: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("service account") || n.includes("integration account");
}

// Percent-rank with ties taking the midpoint rank — matches spreadsheet PERCENTRANK.INC semantics
// closely enough for a ranking visual. Returns 0–1.
function percentileRanks(values: number[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const cache = new Map<number, number>();
  for (const v of values) {
    if (cache.has(v)) continue;
    const first = sorted.indexOf(v);
    let last = first;
    while (last + 1 < sorted.length && sorted[last + 1] === v) last++;
    const avgRank = (first + last) / 2;
    cache.set(v, sorted.length > 1 ? avgRank / (sorted.length - 1) : 0);
  }
  return cache;
}

export async function getLatestSlackMembersSnapshot(): Promise<SlackMembersSnapshot | null> {
  const [latest] = await db
    .select({ windowStart: slackMemberSnapshots.windowStart, windowEnd: slackMemberSnapshots.windowEnd })
    .from(slackMemberSnapshots)
    .orderBy(desc(slackMemberSnapshots.windowEnd), desc(slackMemberSnapshots.windowStart))
    .limit(1);

  if (!latest) return null;

  const [windowRows, mapRows, ssotRows, fteRows] = await Promise.all([
    db
      .select()
      .from(slackMemberSnapshots)
      .where(
        and(
          eq(slackMemberSnapshots.windowStart, latest.windowStart),
          eq(slackMemberSnapshots.windowEnd, latest.windowEnd),
        ),
      ),
    db
      .select({
        slackUserId: slackEmployeeMap.slackUserId,
        employeeEmail: slackEmployeeMap.employeeEmail,
        matchMethod: slackEmployeeMap.matchMethod,
      })
      .from(slackEmployeeMap),
    db
      .select({ data: modeReportData.data })
      .from(modeReportData)
      .innerJoin(modeReports, eq(modeReports.id, modeReportData.reportId))
      .where(
        and(
          eq(modeReports.name, "Headcount SSoT Dashboard"),
          eq(modeReportData.queryName, "headcount"),
        ),
      )
      .orderBy(desc(modeReportData.syncedAt))
      .limit(1),
    db
      .select({ data: modeReportData.data })
      .from(modeReportData)
      .innerJoin(modeReports, eq(modeReports.id, modeReportData.reportId))
      .where(
        and(
          eq(modeReports.name, "Current FTEs"),
          eq(modeReportData.queryName, "current_employees"),
        ),
      )
      .orderBy(desc(modeReportData.syncedAt))
      .limit(1),
  ]);

  // email → SSoT headcount (for job_title, manager, preferred_name, start_date)
  const ssotByEmail = new Map<string, Record<string, unknown>>();
  const ssotData = (ssotRows[0]?.data ?? []) as Array<Record<string, unknown>>;
  for (const row of ssotData) {
    if (row.termination_date) continue;
    const email = String(row.email ?? "").toLowerCase().trim();
    if (email && !ssotByEmail.has(email)) ssotByEmail.set(email, row);
  }
  // email → Current FTEs (for pillar / squad / function)
  const fteByEmail = new Map<string, Record<string, unknown>>();
  const fteData = (fteRows[0]?.data ?? []) as Array<Record<string, unknown>>;
  for (const row of fteData) {
    const email = String(row.employee_email ?? "").toLowerCase().trim();
    if (email && !fteByEmail.has(email)) fteByEmail.set(email, row);
  }
  const mapBySlackId = new Map(mapRows.map((m) => [m.slackUserId, m]));

  const windowEnd = latest.windowEnd;
  const now = new Date();
  const windowSpanDays = Math.min(
    WINDOW_CAP_DAYS,
    diffDays(latest.windowEnd, latest.windowStart),
  );

  const base = windowRows.map((r) => {
    const tenureDays = r.accountCreatedAt
      ? diffDays(windowEnd, r.accountCreatedAt)
      : null;
    const normalizationDays = Math.max(
      1,
      Math.min(
        windowSpanDays,
        tenureDays !== null ? tenureDays : windowSpanDays,
      ),
    );
    const isGuest = r.accountType?.toLowerCase().includes("guest") ?? false;
    const isDeactivated = Boolean(r.deactivatedAt);
    const isServiceAccount = isServiceAccountName(r.name);
    const daysActive = r.daysActive;
    const desktopShare =
      daysActive > 0 ? r.daysActiveDesktop / daysActive : null;
    const activeDayRate = Math.min(1, daysActive / normalizationDays);
    const messages = r.messagesPosted;
    const channelShare =
      messages > 0 ? r.messagesPostedInChannels / messages : null;
    const msgsPerCalendarDay = messages / normalizationDays;
    const msgsPerActiveDay = messages / Math.max(1, daysActive);
    const reactionsPerCalendarDay = r.reactionsAdded / normalizationDays;

    const platforms: Array<["desktop" | "android" | "ios", number]> = [
      ["desktop", r.daysActiveDesktop],
      ["android", r.daysActiveAndroid],
      ["ios", r.daysActiveIos],
    ];
    platforms.sort((a, b) => b[1] - a[1]);
    const primaryPlatform: "desktop" | "android" | "ios" | "none" =
      platforms[0]![1] > 0 ? platforms[0]![0] : "none";

    // Use current date for "last seen" — answers "how stale is their
    // activity *today*?" from the viewer's perspective. Measuring relative
    // to windowEnd would be misleading: if the snapshot was pulled two days
    // ago, someone last active on windowEnd would render as "today" when
    // they actually haven't shown up in two days.
    const daysSinceLastActive = r.lastActiveAt
      ? Math.max(0, diffDays(now, r.lastActiveAt))
      : null;

    return {
      slackUserId: r.slackUserId,
      name: r.name ?? r.username ?? r.slackUserId,
      username: r.username,
      title: r.title,
      accountType: r.accountType ?? "Unknown",
      isGuest,
      isDeactivated,
      isServiceAccount,
      accountCreatedAt: r.accountCreatedAt,
      lastActiveAt: r.lastActiveAt,
      deactivatedAt: r.deactivatedAt,
      tenureDays,
      normalizationDays,
      daysActive,
      desktopShare,
      activeDayRate,
      messagesPosted: messages,
      messagesPostedInChannels: r.messagesPostedInChannels,
      channelShare,
      reactionsAdded: r.reactionsAdded,
      msgsPerCalendarDay,
      msgsPerActiveDay,
      reactionsPerCalendarDay,
      daysSinceLastActive,
      primaryPlatform,
      daysActiveDesktop: r.daysActiveDesktop,
      daysActiveAndroid: r.daysActiveAndroid,
      daysActiveIos: r.daysActiveIos,
    };
  });

  // Build percentile ranks only across the "ranking population": non-guest,
  // non-deactivated, non-service accounts. People outside that set still
  // appear in the table but show no engagement score.
  const rankable = base.filter(
    (r) => !r.isGuest && !r.isDeactivated && !r.isServiceAccount,
  );
  const mpdRanks = percentileRanks(rankable.map((r) => r.msgsPerCalendarDay));
  const rpdRanks = percentileRanks(
    rankable.map((r) => r.reactionsPerCalendarDay),
  );
  const rankableIds = new Set(rankable.map((r) => r.slackUserId));

  const rows: SlackMemberRow[] = base.map((r) => {
    const inRanking = rankableIds.has(r.slackUserId);
    const mpd = inRanking ? mpdRanks.get(r.msgsPerCalendarDay) ?? 0 : 0;
    const rpd = inRanking ? rpdRanks.get(r.reactionsPerCalendarDay) ?? 0 : 0;
    const score = inRanking ? Math.round(((mpd + rpd) / 2) * 100) : 0;

    const mapping = mapBySlackId.get(r.slackUserId);
    const employeeEmail = mapping?.employeeEmail ?? null;
    const ssot = employeeEmail ? ssotByEmail.get(employeeEmail) ?? null : null;
    const fte = employeeEmail ? fteByEmail.get(employeeEmail) ?? null : null;

    return {
      ...r,
      msgsPerDayPercentile: mpd,
      reactionsPerDayPercentile: rpd,
      engagementScore: score,
      matchMethod: (mapping?.matchMethod as SlackMemberRow["matchMethod"]) ?? null,
      employeeEmail,
      employeeName: (ssot?.preferred_name as string) ?? null,
      jobTitle: (ssot?.job_title as string) ?? null,
      pillar: (fte?.pillar_name as string) ?? null,
      squad: (fte?.squad_name as string) ?? null,
      function: (fte?.function_name as string) ?? (ssot?.hb_function as string) ?? null,
      manager: (ssot?.manager as string) ?? null,
      department: (ssot?.rp_department_name as string) ?? null,
      startDate: (ssot?.start_date as string) ?? null,
    };
  });

  return {
    windowStart: latest.windowStart,
    windowEnd: latest.windowEnd,
    importedAt: windowRows[0]?.importedAt ?? new Date(),
    rows,
  };
}
