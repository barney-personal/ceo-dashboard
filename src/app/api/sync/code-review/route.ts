import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import { runCodeReviewAnalysis } from "@/lib/sync/code-review";

/**
 * Trigger a code-review analysis run over the last 90d of merged PRs.
 *
 * Access:
 *   - CEO manual trigger (Clerk session)
 *   - Cron (Bearer CRON_SECRET)
 *
 * Behaviour: idempotent. Only PRs without a current-rubric analysis get
 * sent to Claude; cached analyses are counted and returned so a re-run
 * with no new PRs is cheap.
 */

// Opus per-PR latency is ~4–5s. The Render default Next.js route timeout
// (and Vercel's hobby tier) is 60s, so any single manual trigger has to
// fit within that; cron can run longer because we use Render's drain
// pattern. Bumping to 300s so a manual click can process up to ~60 PRs.
export const maxDuration = 300;

/** Hard cap on `limit=` — shared between manual and cron paths so a cron
 * call can still crunch the full backlog when the cooldown fires. */
const LIMIT_HARD_CAP = 500;
/** Default limit for a CEO's "Re-run analysis" button. Kept small so the
 * click completes well within `maxDuration`; the user can re-click to
 * process the next batch, and the cron covers the long tail. */
const MANUAL_DEFAULT_LIMIT = 50;

export async function POST(request: NextRequest) {
  try {
    const access = await authorizeSyncRequest(request, "engineering.codeReview");
    const accessError = syncRequestAccessErrorResponse(access);
    if (accessError) return accessError;

    const force = request.nextUrl.searchParams.get("force") === "1";
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const defaultLimit =
      access === "manual" ? MANUAL_DEFAULT_LIMIT : LIMIT_HARD_CAP;
    const parsed = rawLimit !== null ? Number(rawLimit) : defaultLimit;
    const limit = Number.isFinite(parsed)
      ? Math.max(1, Math.min(LIMIT_HARD_CAP, parsed))
      : defaultLimit;

    const result = await runCodeReviewAnalysis({ force, limit });

    return NextResponse.json({
      ok: true,
      trigger: access,
      ...result,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: "code-review" } });
    return NextResponse.json(
      {
        error: "Code review analysis failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
