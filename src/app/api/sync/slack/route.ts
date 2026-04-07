import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getUserRole, hasAccess } from "@/lib/auth/roles";
import { syncAllSlackOkrs } from "@/lib/sync/slack";

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("authorization");
  const isCron =
    cronSecret === `Bearer ${process.env.CRON_SECRET}` &&
    process.env.CRON_SECRET;

  if (!isCron) {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = getUserRole(
      (user.publicMetadata as Record<string, unknown>) ?? {}
    );
    if (!hasAccess(role, "ceo")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await syncAllSlackOkrs();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Sync failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
