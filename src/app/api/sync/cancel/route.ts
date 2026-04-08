import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/sync/request-auth";
import { cancelSyncRun } from "@/lib/sync/coordinator";

function parseSyncLogId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("ceo");
  const authError = authErrorResponse(auth);
  if (authError) {
    return authError;
  }

  const body = (await request.json().catch(() => null)) as
    | { syncLogId?: unknown }
    | null;
  const syncLogId = parseSyncLogId(body?.syncLogId);

  if (!syncLogId) {
    return NextResponse.json(
      { error: "syncLogId must be a positive integer" },
      { status: 400 }
    );
  }

  const result = await cancelSyncRun(syncLogId);
  if (!result.cancelled) {
    return NextResponse.json(
      { error: result.reason ?? "Cannot cancel" },
      { status: 404 }
    );
  }

  return NextResponse.json({ cancelled: true, status: "cancelled" });
}
