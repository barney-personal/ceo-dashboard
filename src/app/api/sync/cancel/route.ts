import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getUserRole, hasAccess } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { syncLog, syncPhases } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(request: NextRequest) {
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

  const { syncLogId } = await request.json();
  if (!syncLogId) {
    return NextResponse.json({ error: "syncLogId required" }, { status: 400 });
  }

  // Mark any running phases as interrupted
  await db
    .update(syncPhases)
    .set({
      status: "error",
      completedAt: new Date(),
      errorMessage: "Cancelled by user",
    })
    .where(
      and(
        eq(syncPhases.syncLogId, syncLogId),
        eq(syncPhases.status, "running")
      )
    );

  // Mark the sync log as cancelled
  await db
    .update(syncLog)
    .set({
      status: "error",
      completedAt: new Date(),
      errorMessage: "Cancelled by user",
    })
    .where(
      and(eq(syncLog.id, syncLogId), eq(syncLog.status, "running"))
    );

  return NextResponse.json({ cancelled: true });
}
