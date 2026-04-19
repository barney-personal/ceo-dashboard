import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  githubCommits,
  githubEmployeeMap,
  githubPrs,
  modeReportData,
  modeReports,
  okrUpdates,
  slackEmployeeMap,
  slackMemberSnapshots,
} from "@/lib/db/schema";
import { getLatestSlackMembersSnapshot, type SlackMemberRow } from "./slack-members";
import { groupLatestOkrRows, type OkrSummary } from "./okrs";
import { getEngineerPerformanceRatings, type EngineerPerformance } from "./engineer-profile";

export interface PersonIdentity {
  slug: string;
  email: string;
  name: string;
  jobTitle: string | null;
  level: string | null;
  function: string | null;
  pillar: string | null;
  squad: string | null;
  manager: string | null;
  managerEmail: string | null;
  startDate: string | null;
  tenureMonths: number | null;
  slackUserId: string | null;
  slackHandle: string | null;
  slackName: string | null;
  githubLogin: string | null;
  isEngineer: boolean;
}

export interface OkrUpdateEntry {
  id: number;
  postedAt: Date;
  channelId: string;
  channelName: string | null;
  slackTs: string;
  squadName: string;
  pillar: string | null;
  objectiveName: string;
  krName: string;
  status: string;
  actual: string | null;
  target: string | null;
  tldr: string | null;
}

export interface PersonEngineering {
  prsCount: number;
  commitsCount: number;
  additions: number;
  deletions: number;
  windowStart: Date;
  windowEnd: Date;
  /** Total impact score across the window (same formula as the engineering table). */
  impactScoreTotal: number;
  /** Best rank achieved in any month. */
  bestRank: number | null;
  /** Average rank across months with PR activity. */
  averageRank: number | null;
  /** Months with at least 1 engineer active (the ranking denominator varies). */
  monthly: Array<{
    /** ISO date string, first day of the month. */
    month: string;
    prs: number;
    lines: number;
    /** PRs × log2(1 + lines/PR). Same formula as the ranking table. 0 if no PRs. */
    impact: number;
    /** Rank within all engineers active that month (1 = top). Null if no PRs merged. */
    rank: number | null;
    totalEngineers: number;
  }>;
}

export interface PersonProfile {
  identity: PersonIdentity;
  slackEngagement: SlackMemberRow | null;
  okrUpdatesByThem: OkrUpdateEntry[];
  squadOkrs: OkrSummary[];
  /** Actual squad name the squadOkrs are under (may differ from identity.squad). */
  squadOkrsName: string | null;
  performance: EngineerPerformance | null;
  engineering: PersonEngineering | null;
}

const DAY_MS = 86_400_000;

function monthsBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (DAY_MS * 30.4375)));
}

async function resolveEmployeeBySlug(
  slug: string,
): Promise<{ email: string; row: Record<string, unknown>; fte: Record<string, unknown> | null } | null> {
  const [ssotRows, fteRows] = await Promise.all([
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

  const ssot = (ssotRows[0]?.data ?? []) as Array<Record<string, unknown>>;
  const needle = slug.toLowerCase();
  // Accept either full email or email local part as slug; prefer @meetcleo.com when collisions.
  const candidates = ssot.filter((r) => {
    const email = String(r.email ?? "").toLowerCase();
    if (!email) return false;
    const local = email.split("@")[0]!;
    return local === needle || email === needle;
  });
  if (candidates.length === 0) return null;
  const row =
    candidates.find((r) => String(r.email).toLowerCase().endsWith("@meetcleo.com")) ??
    candidates[0]!;
  const email = String(row.email).toLowerCase();
  const fteData = (fteRows[0]?.data ?? []) as Array<Record<string, unknown>>;
  const fte = fteData.find(
    (r) => String(r.employee_email ?? "").toLowerCase() === email,
  ) ?? null;
  return { email, row, fte };
}

export async function getPersonProfile(slug: string): Promise<PersonProfile | null> {
  const resolved = await resolveEmployeeBySlug(slug);
  if (!resolved) return null;
  const { email, row: ssot, fte } = resolved;

  const startDateStr = (ssot.start_date as string) || null;
  const startDate = startDateStr ? new Date(startDateStr) : null;
  const name =
    (ssot.preferred_name as string) || (ssot.rp_full_name as string) || email;

  const identityBase: Omit<
    PersonIdentity,
    "slackUserId" | "slackHandle" | "slackName" | "githubLogin" | "isEngineer"
  > = {
    slug: email.split("@")[0]!,
    email,
    name,
    jobTitle: (ssot.job_title as string) ?? null,
    level: (ssot.hb_level as string) ?? null,
    function: (fte?.function_name as string) ?? (ssot.hb_function as string) ?? null,
    pillar: (fte?.pillar_name as string) ?? null,
    squad: (fte?.squad_name as string) ?? null,
    manager: (ssot.manager as string) ?? null,
    managerEmail: (ssot.manager_email as string) ?? null,
    startDate: startDateStr,
    tenureMonths: startDate ? monthsBetween(startDate, new Date()) : null,
  };

  // Slack identity (via map)
  const [slackMap, githubMap] = await Promise.all([
    db
      .select()
      .from(slackEmployeeMap)
      .where(eq(slackEmployeeMap.employeeEmail, email))
      .limit(1),
    db
      .select()
      .from(githubEmployeeMap)
      .where(eq(githubEmployeeMap.employeeEmail, email))
      .limit(1),
  ]);
  const slackUserId = slackMap[0]?.slackUserId ?? null;
  const slackHandle = slackMap[0]?.slackUsername ?? null;
  const slackName = slackMap[0]?.slackName ?? null;
  const githubLogin = githubMap[0]?.githubLogin ?? null;

  const identity: PersonIdentity = {
    ...identityBase,
    slackUserId,
    slackHandle,
    slackName,
    githubLogin,
    // An engineer by function per HiBob — independent of whether we have a
    // GitHub mapping. "Senior Backend Engineer" without github_employee_map
    // still counts as an engineer; the engineering panel below requires the
    // GitHub mapping to actually render metrics.
    isEngineer:
      identityBase.function === "Engineering" ||
      (identityBase.jobTitle?.toLowerCase().includes("engineer") ?? false) ||
      Boolean(githubLogin),
  };

  // Slack engagement — pick this person's row from the latest snapshot.
  let slackEngagement: SlackMemberRow | null = null;
  if (slackUserId) {
    const snap = await getLatestSlackMembersSnapshot();
    slackEngagement =
      snap?.rows.find((r) => r.slackUserId === slackUserId) ?? null;
  }

  // OKR updates posted by this person (match by Slack user_id primarily)
  const okrRows = slackUserId
    ? await db
        .select()
        .from(okrUpdates)
        .where(
          or(
            eq(okrUpdates.userId, slackUserId),
            eq(okrUpdates.userName, name),
          ),
        )
        .orderBy(desc(okrUpdates.postedAt))
        .limit(200)
    : [];
  const okrUpdatesByThem: OkrUpdateEntry[] = okrRows.map((r) => ({
    id: r.id,
    postedAt: r.postedAt,
    channelId: r.channelId,
    channelName: r.channelName,
    slackTs: r.slackTs,
    squadName: r.squadName,
    pillar: r.pillar,
    objectiveName: r.objectiveName,
    krName: r.krName,
    status: r.status,
    actual: r.actual,
    target: r.target,
    tldr: r.tldr,
  }));

  // Squad OKRs. FTE `squad_name` sometimes uses a "Pillar - Squad" format
  // (e.g. "Chat - Autopilot Adoption") while the OKR pipeline uses the
  // unprefixed canonical squad name ("Autopilot Adoption"). Try the exact
  // string first, then a stripped variant, then a fuzzy ILIKE fallback.
  let squadOkrs: OkrSummary[] = [];
  let squadOkrsCanonicalName: string | null = null;
  if (identity.squad) {
    const candidates = new Set<string>([identity.squad]);
    const dashIndex = identity.squad.indexOf(" - ");
    if (dashIndex !== -1) {
      candidates.add(identity.squad.slice(dashIndex + 3).trim());
    }
    const exactRows = await db
      .select()
      .from(okrUpdates)
      .where(inArray(okrUpdates.squadName, Array.from(candidates)))
      .orderBy(desc(okrUpdates.postedAt));
    if (exactRows.length === 0) {
      // Last resort: case-insensitive LIKE on the stripped/original candidate.
      const fuzzy = await db
        .select()
        .from(okrUpdates)
        .where(sql`${okrUpdates.squadName} ILIKE ${"%" + (Array.from(candidates).pop() ?? identity.squad) + "%"}`)
        .orderBy(desc(okrUpdates.postedAt));
      if (fuzzy.length > 0) {
        squadOkrsCanonicalName = fuzzy[0]!.squadName;
        squadOkrs = [...groupLatestOkrRows(fuzzy).values()].flat();
      }
    } else {
      squadOkrsCanonicalName = exactRows[0]!.squadName;
      squadOkrs = [...groupLatestOkrRows(exactRows).values()].flat();
    }
  }

  // Performance ratings (CEO-gated at page level)
  const performance = await getEngineerPerformanceRatings(email);

  // Engineering metrics — scoped to the Slack snapshot window so "over the
  // time period they've been active" matches the same window the ranking is
  // built from. Fallback to all-time window if no snapshot exists.
  let engineering: PersonEngineering | null = null;
  if (githubLogin) {
    const [latest] = await db
      .select({
        windowStart: slackMemberSnapshots.windowStart,
        windowEnd: slackMemberSnapshots.windowEnd,
      })
      .from(slackMemberSnapshots)
      .orderBy(
        desc(slackMemberSnapshots.windowEnd),
        desc(slackMemberSnapshots.windowStart),
      )
      .limit(1);
    const windowStart = latest?.windowStart ?? new Date("2020-01-01");
    const windowEnd = latest?.windowEnd ?? new Date();

    // Monthly impact + rank across all humans. The rank denominator varies
    // month-to-month (only engineers who merged >=1 PR that month are ranked).
    // Bots are excluded from the ranking population.
    const rankedRows = await db.execute<{
      month: string;
      prs: number;
      lines: number;
      impact: number;
      rank: number;
      total_engineers: number;
    }>(sql`
      WITH monthly AS (
        SELECT
          date_trunc('month', ${githubPrs.mergedAt})::date AS month,
          ${githubPrs.authorLogin} AS author_login,
          COUNT(*)::int AS prs,
          COALESCE(SUM(${githubPrs.additions} + ${githubPrs.deletions}), 0)::bigint AS lines
        FROM ${githubPrs}
        LEFT JOIN ${githubEmployeeMap} ON ${githubEmployeeMap.githubLogin} = ${githubPrs.authorLogin}
        WHERE ${githubPrs.mergedAt} >= ${windowStart.toISOString()}
          AND ${githubPrs.mergedAt} < ${windowEnd.toISOString()}
          AND COALESCE(${githubEmployeeMap.isBot}, false) = false
        GROUP BY 1, 2
      ),
      scored AS (
        SELECT
          month,
          author_login,
          prs,
          lines,
          ROUND(prs * LOG(2.0, 1.0 + lines::numeric / prs))::int AS impact
        FROM monthly
      ),
      ranked AS (
        SELECT
          month,
          author_login,
          prs,
          lines,
          impact,
          RANK() OVER (PARTITION BY month ORDER BY impact DESC) AS rank,
          COUNT(*) OVER (PARTITION BY month) AS total_engineers
        FROM scored
      )
      SELECT month::text AS month, prs, lines, impact, rank::int, total_engineers::int
      FROM ranked
      WHERE author_login = ${githubLogin}
      ORDER BY month
    `);

    const monthly = (rankedRows.map((r) => ({
      month: r.month,
      prs: Number(r.prs) || 0,
      lines: Number(r.lines) || 0,
      impact: Number(r.impact) || 0,
      rank: r.rank !== null ? Number(r.rank) : null,
      totalEngineers: Number(r.total_engineers) || 0,
    })));

    // Commit count for the window
    const [commitAgg] = await db
      .select({ count: sql<number>`COUNT(*)`.as("count") })
      .from(githubCommits)
      .where(
        and(
          eq(githubCommits.authorLogin, githubLogin),
          gte(githubCommits.committedAt, windowStart),
        ),
      );

    const prsCount = monthly.reduce((s, m) => s + m.prs, 0);
    const lines = monthly.reduce((s, m) => s + m.lines, 0);
    const impactScoreTotal = monthly.reduce((s, m) => s + m.impact, 0);
    const ranksPresent = monthly
      .map((m) => m.rank)
      .filter((r): r is number => r !== null);
    const bestRank = ranksPresent.length ? Math.min(...ranksPresent) : null;
    const averageRank = ranksPresent.length
      ? Math.round(ranksPresent.reduce((a, b) => a + b, 0) / ranksPresent.length)
      : null;

    // Aggregate additions/deletions for the summary tiles
    const [linesAgg] = await db
      .select({
        additions: sql<number>`COALESCE(SUM(${githubPrs.additions}), 0)`.as("additions"),
        deletions: sql<number>`COALESCE(SUM(${githubPrs.deletions}), 0)`.as("deletions"),
      })
      .from(githubPrs)
      .where(
        and(
          eq(githubPrs.authorLogin, githubLogin),
          gte(githubPrs.mergedAt, windowStart),
        ),
      );

    engineering = {
      prsCount,
      commitsCount: Number(commitAgg?.count ?? 0),
      additions: Number(linesAgg?.additions ?? 0),
      deletions: Number(linesAgg?.deletions ?? 0),
      windowStart,
      windowEnd,
      impactScoreTotal,
      bestRank,
      averageRank,
      monthly,
    };
    // Keep `lines` out of the response signature but reference it so the
    // linter doesn't flag it — aggregation check only, not displayed directly.
    void lines;
  }

  return {
    identity,
    slackEngagement,
    okrUpdatesByThem,
    squadOkrs,
    squadOkrsName: squadOkrsCanonicalName,
    performance,
    engineering,
  };
}
