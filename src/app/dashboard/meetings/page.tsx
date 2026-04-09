import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getUserGoogleAccessToken } from "@/lib/auth/google-token.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { MeetingsView } from "@/components/dashboard/meetings-view";
import {
  getMeetingsForRange,
  getWeekStart,
  getWeekEnd,
} from "@/lib/data/meetings";

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const baseDate = params.week ? new Date(params.week + "T12:00:00") : new Date();
  const weekStart = getWeekStart(baseDate);
  const weekEnd = getWeekEnd(weekStart);

  // Get per-user Google Calendar token from Clerk
  const { userId } = await auth();
  const accessToken = userId
    ? await getUserGoogleAccessToken(userId)
    : null;

  const days = await getMeetingsForRange(weekStart, weekEnd, { accessToken: accessToken ?? undefined });

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Meetings"
        description="Calendar events, meeting notes, and pre-reads"
      />

      <MeetingsView
        initialDays={days}
        initialWeekStart={`${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`}
        calendarConnected={!!accessToken}
      />
    </div>
  );
}
