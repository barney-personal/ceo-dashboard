import { db } from "@/lib/db";
import { pageViews } from "@/lib/db/schema";
import { sql, gte, desc, count, countDistinct } from "drizzle-orm";
import { isSchemaCompatibilityError } from "@/lib/db/errors";

/** Return fallback value if the page_views table doesn't exist yet. */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isSchemaCompatibilityError(err)) return fallback;
    throw err;
  }
}

/**
 * Dashboard DAU — distinct users per day, last 90 days.
 */
export function getDashboardDAU(): Promise<{ date: string; value: number }[]> {
  return safeQuery(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const rows = await db
      .select({
        date: sql<string>`date_trunc('day', ${pageViews.viewedAt})::date::text`.as(
          "date"
        ),
        value: countDistinct(pageViews.clerkUserId).as("value"),
      })
      .from(pageViews)
      .where(gte(pageViews.viewedAt, since))
      .groupBy(sql`date_trunc('day', ${pageViews.viewedAt})`)
      .orderBy(sql`date_trunc('day', ${pageViews.viewedAt})`);

    return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
  }, []);
}

/**
 * Dashboard WAU — distinct users per ISO week, last 26 weeks.
 */
export function getDashboardWAU(): Promise<{ date: string; value: number }[]> {
  return safeQuery(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 26 * 7);

    const rows = await db
      .select({
        date: sql<string>`date_trunc('week', ${pageViews.viewedAt})::date::text`.as(
          "date"
        ),
        value: countDistinct(pageViews.clerkUserId).as("value"),
      })
      .from(pageViews)
      .where(gte(pageViews.viewedAt, since))
      .groupBy(sql`date_trunc('week', ${pageViews.viewedAt})`)
      .orderBy(sql`date_trunc('week', ${pageViews.viewedAt})`);

    return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
  }, []);
}

/**
 * Dashboard MAU — distinct users per month, last 12 months.
 */
export function getDashboardMAU(): Promise<{ date: string; value: number }[]> {
  return safeQuery(async () => {
    const since = new Date();
    since.setMonth(since.getMonth() - 12);

    const rows = await db
      .select({
        date: sql<string>`date_trunc('month', ${pageViews.viewedAt})::date::text`.as(
          "date"
        ),
        value: countDistinct(pageViews.clerkUserId).as("value"),
      })
      .from(pageViews)
      .where(gte(pageViews.viewedAt, since))
      .groupBy(sql`date_trunc('month', ${pageViews.viewedAt})`)
      .orderBy(sql`date_trunc('month', ${pageViews.viewedAt})`);

    return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
  }, []);
}

/**
 * Weekly retention cohorts — groups users by the week of their first page view,
 * then checks which subsequent weeks they returned.
 * Returns retention rates as fractions (0–1).
 */
export function getDashboardRetention(): Promise<
  { cohort: string; periods: (number | null)[] }[]
> {
  return safeQuery(async () => {
  const result = await db.execute(sql`
    WITH user_first_week AS (
      SELECT
        clerk_user_id,
        date_trunc('week', MIN(viewed_at))::date AS cohort_week
      FROM page_views
      GROUP BY clerk_user_id
    ),
    user_active_weeks AS (
      SELECT DISTINCT
        clerk_user_id,
        date_trunc('week', viewed_at)::date AS active_week
      FROM page_views
    ),
    retention AS (
      SELECT
        f.cohort_week,
        (a.active_week - f.cohort_week) / 7 AS week_number,
        COUNT(DISTINCT a.clerk_user_id) AS active_users
      FROM user_first_week f
      JOIN user_active_weeks a ON a.clerk_user_id = f.clerk_user_id
      WHERE a.active_week >= f.cohort_week
      GROUP BY f.cohort_week, week_number
    )
    SELECT
      cohort_week::text AS cohort,
      week_number,
      active_users
    FROM retention
    ORDER BY cohort_week, week_number
  `);

  const byCohort = new Map<string, Map<number, number>>();
  for (const row of result) {
    const cohort = row.cohort as string;
    const weekNum = Number(row.week_number);
    const users = Number(row.active_users);

    if (!byCohort.has(cohort)) byCohort.set(cohort, new Map());
    byCohort.get(cohort)!.set(weekNum, users);
  }

  return [...byCohort.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, periods]) => {
      const base = periods.get(0) ?? 1;
      const maxWeek = Math.max(...periods.keys());
      return {
        cohort,
        periods: Array.from({ length: maxWeek + 1 }, (_, i) =>
          periods.has(i) ? periods.get(i)! / base : null
        ),
      };
    });
  }, []);
}

export const SECTION_LABELS: Record<string, string> = {
  "": "Overview",
  "unit-economics": "Unit Economics",
  financial: "Financial",
  product: "Product",
  okrs: "OKRs",
  people: "People",
  "people/performance": "Performance",
  "people/engagement": "Engagement",
  meetings: "Meetings",
  "admin/status": "Data Status",
  "admin/squads": "Squads",
  "admin/users": "Users",
  "admin/mode-explorer": "Mode Explorer",
  "admin/analytics": "Analytics",
  settings: "Settings",
};

/**
 * Page views grouped by dashboard section, last 30 days.
 * Returns { section, label, views } sorted by views descending.
 */
export function getPageViewsBySection(): Promise<
  { section: string; label: string; views: number }[]
> {
  return safeQuery(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const rows = await db
      .select({
        path: pageViews.path,
        views: count().as("views"),
      })
      .from(pageViews)
      .where(gte(pageViews.viewedAt, since))
      .groupBy(pageViews.path)
      .orderBy(sql`count(*) desc`);

    return rows.map((r) => {
      const section = r.path.replace(/^\/dashboard\/?/, "");
      return {
        section: section || "overview",
        label: SECTION_LABELS[section] ?? section,
        views: Number(r.views),
      };
    });
  }, []);
}

/**
 * Daily retention cohorts — groups users by the day of their first page view,
 * then checks which subsequent days they returned.
 * Returns retention rates as fractions (0–1), same shape as weekly retention.
 * Limited to last 30 days of cohorts to keep the triangle readable.
 */
export function getDailyRetention(): Promise<
  { cohort: string; periods: (number | null)[] }[]
> {
  return safeQuery(async () => {
    const result = await db.execute(sql`
      WITH user_first_day AS (
        SELECT
          clerk_user_id,
          date_trunc('day', MIN(viewed_at))::date AS cohort_day
        FROM page_views
        GROUP BY clerk_user_id
      ),
      user_active_days AS (
        SELECT DISTINCT
          clerk_user_id,
          date_trunc('day', viewed_at)::date AS active_day
        FROM page_views
      ),
      retention AS (
        SELECT
          f.cohort_day,
          (a.active_day - f.cohort_day) AS day_number,
          COUNT(DISTINCT a.clerk_user_id) AS active_users
        FROM user_first_day f
        JOIN user_active_days a ON a.clerk_user_id = f.clerk_user_id
        WHERE a.active_day >= f.cohort_day
          AND f.cohort_day >= CURRENT_DATE - interval '30 days'
        GROUP BY f.cohort_day, day_number
      )
      SELECT
        cohort_day::text AS cohort,
        day_number,
        active_users
      FROM retention
      ORDER BY cohort_day, day_number
    `);

    const byCohort = new Map<string, Map<number, number>>();
    for (const row of result) {
      const cohort = row.cohort as string;
      const dayNum = Number(row.day_number);
      const users = Number(row.active_users);

      if (!byCohort.has(cohort)) byCohort.set(cohort, new Map());
      byCohort.get(cohort)!.set(dayNum, users);
    }

    return [...byCohort.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, periods]) => {
        const base = periods.get(0) ?? 1;
        const maxDay = Math.max(...periods.keys());
        return {
          cohort,
          periods: Array.from({ length: maxDay + 1 }, (_, i) =>
            periods.has(i) ? periods.get(i)! / base : null
          ),
        };
      });
  }, []);
}

/**
 * Recent page views with pagination, ordered by most recent first.
 */
export function getRecentPageViews(
  page: number,
  pageSize: number
): Promise<{
  rows: {
    id: number;
    clerkUserId: string;
    path: string;
    viewedAt: string;
  }[];
  total: number;
}> {
  return safeQuery(async () => {
    const offset = (page - 1) * pageSize;

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id: pageViews.id,
          clerkUserId: pageViews.clerkUserId,
          path: pageViews.path,
          viewedAt: pageViews.viewedAt,
        })
        .from(pageViews)
        .orderBy(desc(pageViews.viewedAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(pageViews),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        clerkUserId: r.clerkUserId,
        path: r.path,
        viewedAt: r.viewedAt.toISOString(),
      })),
      total: Number(totalResult[0]?.total ?? 0),
    };
  }, { rows: [], total: 0 });
}
