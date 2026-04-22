import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/sync/request-auth";
import { getUserGoogleAccessToken } from "@/lib/auth/google-token.server";
import {
  getMeetingsForRange,
  getWeekStart,
  getWeekEnd,
} from "@/lib/data/meetings";

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole("everyone");
  if (!roleCheck.ok) {
    return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
  }

  const weekParam = request.nextUrl.searchParams.get("week");
  const baseDate = weekParam
    ? new Date(weekParam + "T12:00:00")
    : new Date();
  const weekStart = getWeekStart(baseDate);
  const weekEnd = getWeekEnd(weekStart);

  // Get per-user Google Calendar token from Clerk
  const { userId } = await auth();
  const accessToken = userId
    ? await getUserGoogleAccessToken(userId)
    : null;

  const { days, calendarAuthExpired } = await getMeetingsForRange(
    weekStart,
    weekEnd,
    {
      accessToken: accessToken ?? undefined,
      userId: userId ?? undefined,
    }
  );

  return NextResponse.json({
    days,
    weekStart: `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`,
    calendarConnected: !!accessToken && !calendarAuthExpired,
  });
}
