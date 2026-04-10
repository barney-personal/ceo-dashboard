import { db } from "@/lib/db";
import { pageViews } from "@/lib/db/schema";
import { sql, gte, countDistinct } from "drizzle-orm";

/**
 * Dashboard DAU — distinct users per day, last 90 days.
 */
export async function getDashboardDAU(): Promise<
  { date: string; value: number }[]
> {
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
}

/**
 * Dashboard WAU — distinct users per ISO week, last 26 weeks.
 */
export async function getDashboardWAU(): Promise<
  { date: string; value: number }[]
> {
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
}

/**
 * Dashboard MAU — distinct users per month, last 12 months.
 */
export async function getDashboardMAU(): Promise<
  { date: string; value: number }[]
> {
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
}

/**
 * Weekly retention cohorts — groups users by the week of their first page view,
 * then checks which subsequent weeks they returned.
 * Returns retention rates as fractions (0–1).
 */
export async function getDashboardRetention(): Promise<
  { cohort: string; periods: (number | null)[] }[]
> {
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
        EXTRACT(DAYS FROM (a.active_week - f.cohort_week))::int / 7 AS week_number,
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
}
