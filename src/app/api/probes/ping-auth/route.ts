/**
 * GET /api/probes/ping-auth
 *
 * Health payload for the cloud probe to hit every 15 minutes. Intentionally
 * **unauthenticated** — the cloud probe has no way to carry secrets through
 * GitHub Actions scheduled workflows without exposing them in logs, and the
 * Playwright journey needs a public landing check anyway. The response
 * exposes only non-sensitive diagnostic fields (git SHA, db-ok, Mode sync
 * freshness, deploy status) so the probe can decide red/green without auth.
 *
 * If you're tempted to add auth here: don't. Add a separate authed endpoint
 * if you need one. Breaking this path breaks the cloud probe silently.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

const DEPLOY_WINDOW_MS = 5 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const version = process.env.RENDER_GIT_COMMIT || null;
  const ts = new Date().toISOString();
  // Render injects RENDER_IS_DEPLOYING during a deploy; we also honour a
  // DEPLOYED_AT epoch-ms env var for self-managed signals (set it at the
  // end of a migration/deploy script). Probe handlers treat deploying=true
  // as degraded-ok and don't fire red alerts during the window.
  const deploying = (() => {
    if (process.env.RENDER_IS_DEPLOYING === "true") return true;
    const deployedAt = Number(process.env.DEPLOYED_AT);
    if (Number.isFinite(deployedAt) && Date.now() - deployedAt < DEPLOY_WINDOW_MS) {
      return true;
    }
    return false;
  })();

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
