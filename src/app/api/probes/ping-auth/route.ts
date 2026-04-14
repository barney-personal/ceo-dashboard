import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

export async function GET(): Promise<NextResponse> {
  const version = process.env.RENDER_GIT_COMMIT || null;
  const ts = new Date().toISOString();
  const deploying = false;

  let dbOk = false;
  let modeSyncAgeHours: number | null = null;

  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;

    const [latestSync] = await db
      .select({ completedAt: syncLog.completedAt })
      .from(syncLog)
      .where(
        and(
          eq(syncLog.source, "mode"),
          eq(syncLog.status, "success"),
          isNotNull(syncLog.completedAt)
        )
      )
      .orderBy(desc(syncLog.completedAt))
      .limit(1);

    if (latestSync?.completedAt) {
      const ageMs = Date.now() - latestSync.completedAt.getTime();
      modeSyncAgeHours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;
    }
  } catch {
    dbOk = false;
    modeSyncAgeHours = null;
  }

  return NextResponse.json({
    db_ok: dbOk,
    version,
    mode_sync_age_hours: modeSyncAgeHours,
    deploying,
    ts,
  });
}
