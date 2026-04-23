import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import { runCodeReviewAnalysis } from "@/lib/sync/code-review";

/**
 * Trigger a code-review analysis run over the last 30d of merged PRs.
 *
 * Access:
 *   - CEO manual trigger (Clerk session)
 *   - Cron (Bearer CRON_SECRET)
 *
 * Behaviour: idempotent. Only PRs without a current-rubric analysis get
 * sent to Claude; cached analyses are counted and returned so a re-run
 * with no new PRs is cheap.
 */
export async function POST(request: NextRequest) {
  try {
    const access = await authorizeSyncRequest(request);
    const accessError = syncRequestAccessErrorResponse(access);
    if (accessError) return accessError;

    const force = request.nextUrl.searchParams.get("force") === "1";
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "500");

    const result = await runCodeReviewAnalysis({
      force,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 500,
    });

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
