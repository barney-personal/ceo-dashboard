import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { dashboardPermissionErrorResponse } from "@/lib/auth/dashboard-permissions.api";
import { syncSlackAvatars } from "@/lib/sync/slack-avatars";

/**
 * Refresh Slack profile pictures for all mapped Slack users. Surfaces them
 * on the GitHub-mapping admin page next to each unmapped engineer row.
 *
 * Called manually from the admin page — no cron behind this. Pass `?force=1`
 * to ignore the staleness check and re-fetch every row.
 */
export async function POST(request: NextRequest) {
  try {
    const authError = await dashboardPermissionErrorResponse(
      "admin.githubMapping",
    );
    if (authError) return authError;

    const force = request.nextUrl.searchParams.get("force") === "1";
    const result = await syncSlackAvatars({ force });
    return NextResponse.json(result);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
