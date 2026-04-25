import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { engineerTournamentRuns } from "@/lib/db/schema";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import { runTournament } from "@/lib/tournament/runner";

// maxDuration only bounds the HTTP response (which resolves in ≤15s once the
// run row is inserted via onStart). The tournament itself executes on the
// long-lived Render web process via fire-and-forget — this fits the current
// hosting model. On a serverless host this pattern wouldn't work; the
// background job would die at 30s.
export const maxDuration = 30;

const DEFAULT_MATCH_TARGET = 20;
const MAX_MATCH_TARGET = 2000;
const DEFAULT_WINDOW_DAYS = 90;

export async function POST(request: NextRequest) {
  try {
    const access = await authorizeSyncRequest(request, "engineering.tournament");
    const accessError = syncRequestAccessErrorResponse(access);
    if (accessError) return accessError;

    const body = await request.json().catch(() => ({}));
    const matchTarget = clampInt(
      body?.matchTarget,
      DEFAULT_MATCH_TARGET,
      1,
      MAX_MATCH_TARGET,
    );
    const windowDays = clampInt(body?.windowDays, DEFAULT_WINDOW_DAYS, 7, 365);
    const notes = typeof body?.notes === "string" ? body.notes : undefined;

    const [active] = await db
      .select({ id: engineerTournamentRuns.id })
      .from(engineerTournamentRuns)
      .where(
        and(
          inArray(engineerTournamentRuns.status, ["queued", "running"]),
          sql`${engineerTournamentRuns.startedAt} > now() - interval '6 hours'`,
        ),
      )
      .limit(1);
    if (active) {
      return NextResponse.json(
        {
          error: "Another tournament run is already active",
          activeRunId: active.id,
        },
        { status: 409 },
      );
    }

    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - windowDays * 86_400_000);

    const runIdReady = new Promise<number>((resolve, reject) => {
      runTournament({
        matchTarget,
        windowStart,
        windowEnd,
        triggeredBy: access === "cron" ? "cron" : "manual",
        notes,
        onStart: (id) => resolve(id),
      })
        .catch((error) => {
          Sentry.captureException(error, { tags: { feature: "tournament" } });
          reject(error);
        });
    });

    const runId = await Promise.race([
      runIdReady,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Timed out waiting for run row to be created")),
          15_000,
        ),
      ),
    ]);

    return NextResponse.json(
      {
        ok: true,
        runId,
        matchTarget,
        windowDays,
      },
      { status: 202 },
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: "tournament" } });
    return NextResponse.json(
      {
        error: "Tournament trigger failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await authorizeSyncRequest(request, "engineering.tournament");
    const accessError = syncRequestAccessErrorResponse(access);
    if (accessError) return accessError;

    const url = new URL(request.url);
    const runIdRaw = url.searchParams.get("runId");
    const runId = runIdRaw ? parseInt(runIdRaw, 10) : NaN;
    if (!Number.isFinite(runId)) {
      return NextResponse.json(
        { error: "runId query param required" },
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(engineerTournamentRuns)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        errorMessage: "Cancelled by user",
      })
      .where(
        and(
          eq(engineerTournamentRuns.id, runId),
          inArray(engineerTournamentRuns.status, ["queued", "running"]),
        ),
      )
      .returning({ id: engineerTournamentRuns.id });

    if (!updated) {
      return NextResponse.json(
        { error: "Run not found or already finished" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, runId: updated.id });
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: "tournament" } });
    return NextResponse.json(
      {
        error: "Tournament cancel failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
