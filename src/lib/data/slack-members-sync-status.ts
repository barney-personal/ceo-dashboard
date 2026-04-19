import { count, desc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { slackMemberSnapshots } from "@/lib/db/schema";

export type SlackSyncFreshness = "fresh" | "due" | "stale" | "none";

export interface SlackSyncStatus {
  hasSnapshot: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  importedAt: Date | null;
  memberCount: number;
  /** Days since the snapshot window ended (not since import — import could be old).  */
  daysSinceWindowEnd: number | null;
  freshness: SlackSyncFreshness;
}

const FRESH_DAYS = 14;
const DUE_DAYS = 21;

export async function getSlackSyncStatus(): Promise<SlackSyncStatus> {
  const [latest] = await db
    .select({
      windowStart: slackMemberSnapshots.windowStart,
      windowEnd: slackMemberSnapshots.windowEnd,
      importedAt: slackMemberSnapshots.importedAt,
    })
    .from(slackMemberSnapshots)
    .orderBy(
      desc(slackMemberSnapshots.windowEnd),
      desc(slackMemberSnapshots.windowStart),
      desc(slackMemberSnapshots.importedAt),
    )
    .limit(1);

  if (!latest) {
    return {
      hasSnapshot: false,
      windowStart: null,
      windowEnd: null,
      importedAt: null,
      memberCount: 0,
      daysSinceWindowEnd: null,
      freshness: "none",
    };
  }

  const [countRow] = await db
    .select({ n: count() })
    .from(slackMemberSnapshots)
    .where(
      and(
        eq(slackMemberSnapshots.windowStart, latest.windowStart),
        eq(slackMemberSnapshots.windowEnd, latest.windowEnd),
      ),
    );

  const daysSinceWindowEnd = Math.floor(
    (Date.now() - latest.windowEnd.getTime()) / 86_400_000,
  );
  const freshness: SlackSyncFreshness =
    daysSinceWindowEnd < FRESH_DAYS
      ? "fresh"
      : daysSinceWindowEnd < DUE_DAYS
        ? "due"
        : "stale";

  return {
    hasSnapshot: true,
    windowStart: latest.windowStart,
    windowEnd: latest.windowEnd,
    importedAt: latest.importedAt,
    memberCount: Number(countRow?.n ?? 0),
    daysSinceWindowEnd,
    freshness,
  };
}
