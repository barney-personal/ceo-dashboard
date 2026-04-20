import { db } from "@/lib/db";
import { enpsPrompts, enpsResponses } from "@/lib/db/schema";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  DatabaseUnavailableError,
  isSchemaCompatibilityError,
  normalizeDatabaseError,
} from "@/lib/db/errors";

// Maximum times the prompt is shown in a single month before giving up.
export const ENPS_MAX_SHOWS_PER_MONTH = 4;
// Minimum time between re-shows (24h).
export const ENPS_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Current month in "YYYY-MM" form in UTC. */
export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

async function safeQuery<T>(
  context: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isSchemaCompatibilityError(err)) return fallback;
    if (err instanceof DatabaseUnavailableError) throw err;
    throw normalizeDatabaseError(context, err);
  }
}

/**
 * Decide whether to show the eNPS takeover for `clerkUserId` right now.
 * Shows when: no completed response this month, show count under cap,
 * and 24h cooldown since the last show has elapsed.
 */
export async function shouldShowEnpsPrompt(
  clerkUserId: string,
  now: Date = new Date()
): Promise<boolean> {
  const month = currentMonth(now);

  return safeQuery(
    "shouldShowEnpsPrompt",
    async () => {
      const [prompt] = await db
        .select()
        .from(enpsPrompts)
        .where(
          and(
            eq(enpsPrompts.clerkUserId, clerkUserId),
            eq(enpsPrompts.month, month)
          )
        )
        .limit(1);

      if (!prompt) return true;
      if (prompt.completedAt) return false;
      if (prompt.skipCount >= ENPS_MAX_SHOWS_PER_MONTH) return false;

      const elapsed = now.getTime() - prompt.lastShownAt.getTime();
      return elapsed >= ENPS_PROMPT_COOLDOWN_MS;
    },
    false
  );
}

/**
 * Record that the prompt was shown to the user. Increments show count and
 * refreshes `lastShownAt` so cooldown starts again.
 */
export async function recordEnpsPromptShown(
  clerkUserId: string,
  now: Date = new Date()
): Promise<void> {
  const month = currentMonth(now);

  await safeQuery(
    "recordEnpsPromptShown",
    async () => {
      await db
        .insert(enpsPrompts)
        .values({
          clerkUserId,
          month,
          skipCount: 1,
          lastShownAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [enpsPrompts.clerkUserId, enpsPrompts.month],
          set: {
            skipCount: sql`${enpsPrompts.skipCount} + 1`,
            lastShownAt: now,
            updatedAt: now,
          },
        });
    },
    undefined
  );
}

/**
 * Submit an eNPS response. Score must be 0-10. Reason is optional free text.
 * Returns true if a new response was inserted, false if one already existed.
 */
export async function submitEnpsResponse(
  clerkUserId: string,
  score: number,
  reason: string | null,
  now: Date = new Date()
): Promise<boolean> {
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new Error(`Invalid eNPS score: ${score}`);
  }
  const trimmedReason =
    reason && reason.trim().length > 0 ? reason.trim().slice(0, 2000) : null;
  const month = currentMonth(now);

  return safeQuery(
    "submitEnpsResponse",
    async () => {
      const inserted = await db
        .insert(enpsResponses)
        .values({
          clerkUserId,
          month,
          score,
          reason: trimmedReason,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [enpsResponses.clerkUserId, enpsResponses.month],
        })
        .returning({ id: enpsResponses.id });

      await db
        .insert(enpsPrompts)
        .values({
          clerkUserId,
          month,
          skipCount: 0,
          lastShownAt: now,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [enpsPrompts.clerkUserId, enpsPrompts.month],
          set: { completedAt: now, updatedAt: now },
        });

      return inserted.length > 0;
    },
    false
  );
}

// ---------------------------------------------------------------------------
// Analytics (CEO only)
// ---------------------------------------------------------------------------

export interface EnpsMonthlyAggregate {
  month: string;
  responseCount: number;
  average: number | null;
  promoters: number; // score 9-10
  passives: number; // score 7-8
  detractors: number; // score 0-6
  enps: number | null; // %promoters - %detractors, -100 to 100
}

export interface EnpsDistributionBucket {
  score: number;
  count: number;
}

export interface EnpsReasonExcerpt {
  id: number;
  clerkUserId: string;
  month: string;
  score: number;
  reason: string;
  createdAt: string;
}

export interface EnpsMonthlyResponse {
  id: number;
  clerkUserId: string;
  score: number;
  reason: string | null;
  createdAt: string;
}

export function classify(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/** Monthly aggregates for last N months, oldest first. */
export async function getEnpsMonthlyTrend(
  months = 12,
  now: Date = new Date()
): Promise<EnpsMonthlyAggregate[]> {
  return safeQuery(
    "getEnpsMonthlyTrend",
    async () => {
      const since = new Date(now);
      since.setDate(1); // pin to 1st before stepping back to avoid month overflow
      since.setMonth(since.getMonth() - months);
      const sinceMonth = currentMonth(since);

      const rows = await db
        .select({
          month: enpsResponses.month,
          score: enpsResponses.score,
        })
        .from(enpsResponses)
        .where(gte(enpsResponses.month, sinceMonth))
        .orderBy(asc(enpsResponses.month));

      const buckets = new Map<string, number[]>();
      for (const r of rows) {
        if (!buckets.has(r.month)) buckets.set(r.month, []);
        buckets.get(r.month)!.push(r.score);
      }

      return [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, scores]) => {
          const responseCount = scores.length;
          const average =
            responseCount > 0
              ? scores.reduce((a, b) => a + b, 0) / responseCount
              : null;
          let promoters = 0;
          let passives = 0;
          let detractors = 0;
          for (const s of scores) {
            const c = classify(s);
            if (c === "promoter") promoters++;
            else if (c === "passive") passives++;
            else detractors++;
          }
          const enps =
            responseCount > 0
              ? ((promoters - detractors) / responseCount) * 100
              : null;
          return {
            month,
            responseCount,
            average,
            promoters,
            passives,
            detractors,
            enps,
          };
        });
    },
    []
  );
}

/** Score distribution (0-10) for a specific month. */
export async function getEnpsDistribution(
  month: string
): Promise<EnpsDistributionBucket[]> {
  return safeQuery(
    "getEnpsDistribution",
    async () => {
      const rows = await db
        .select({
          score: enpsResponses.score,
          count: count().as("count"),
        })
        .from(enpsResponses)
        .where(eq(enpsResponses.month, month))
        .groupBy(enpsResponses.score)
        .orderBy(asc(enpsResponses.score));

      const byScore = new Map<number, number>();
      for (const r of rows) byScore.set(r.score, Number(r.count));
      return Array.from({ length: 11 }, (_, score) => ({
        score,
        count: byScore.get(score) ?? 0,
      }));
    },
    Array.from({ length: 11 }, (_, score) => ({ score, count: 0 }))
  );
}

/** Response rate — responders / prompted users for a month. */
export async function getEnpsResponseRate(
  month: string
): Promise<{ responded: number; prompted: number; rate: number | null }> {
  return safeQuery(
    "getEnpsResponseRate",
    async () => {
      const [respondedRow] = await db
        .select({ n: count() })
        .from(enpsResponses)
        .where(eq(enpsResponses.month, month));
      const [promptedRow] = await db
        .select({ n: count() })
        .from(enpsPrompts)
        .where(eq(enpsPrompts.month, month));

      const responded = Number(respondedRow?.n ?? 0);
      const prompted = Number(promptedRow?.n ?? 0);
      const rate = prompted > 0 ? responded / prompted : null;
      return { responded, prompted, rate };
    },
    { responded: 0, prompted: 0, rate: null }
  );
}

/** Recent reasons (free-text), newest first. */
export async function getEnpsReasonExcerpts(
  limit = 50
): Promise<EnpsReasonExcerpt[]> {
  return safeQuery(
    "getEnpsReasonExcerpts",
    async () => {
      const rows = await db
        .select({
          id: enpsResponses.id,
          clerkUserId: enpsResponses.clerkUserId,
          month: enpsResponses.month,
          score: enpsResponses.score,
          reason: enpsResponses.reason,
          createdAt: enpsResponses.createdAt,
        })
        .from(enpsResponses)
        .where(
          sql`${enpsResponses.reason} is not null and length(trim(${enpsResponses.reason})) > 0`
        )
        .orderBy(desc(enpsResponses.createdAt))
        .limit(limit);

      return rows.map((r) => ({
        id: r.id,
        clerkUserId: r.clerkUserId,
        month: r.month,
        score: r.score,
        reason: r.reason ?? "",
        createdAt: r.createdAt.toISOString(),
      }));
    },
    []
  );
}

/** All responses (score + optional reason) for a given month, newest first. */
export async function getEnpsResponsesForMonth(
  month: string
): Promise<EnpsMonthlyResponse[]> {
  return safeQuery(
    "getEnpsResponsesForMonth",
    async () => {
      const rows = await db
        .select({
          id: enpsResponses.id,
          clerkUserId: enpsResponses.clerkUserId,
          score: enpsResponses.score,
          reason: enpsResponses.reason,
          createdAt: enpsResponses.createdAt,
        })
        .from(enpsResponses)
        .where(eq(enpsResponses.month, month))
        .orderBy(desc(enpsResponses.createdAt));

      return rows.map((r) => ({
        id: r.id,
        clerkUserId: r.clerkUserId,
        score: r.score,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }));
    },
    []
  );
}
