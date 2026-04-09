import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sync/request-auth";
import {
  getMeetingsForRange,
  getWeekStart,
  getWeekEnd,
} from "@/lib/data/meetings";

export async function GET(request: NextRequest) {
  const auth = await requireRole("leadership");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const weekParam = request.nextUrl.searchParams.get("week");
  const baseDate = weekParam
    ? new Date(weekParam + "T12:00:00")
    : new Date();
  const weekStart = getWeekStart(baseDate);
  const weekEnd = getWeekEnd(weekStart);
  const days = await getMeetingsForRange(weekStart, weekEnd);

  return NextResponse.json({
    days,
    weekStart: weekStart.toISOString().slice(0, 10),
  });
}
