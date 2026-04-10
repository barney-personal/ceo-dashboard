import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCurrentUserRole, getImpersonation } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getUserGoogleAccessToken } from "@/lib/auth/google-token.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { MeetingsView } from "@/components/dashboard/meetings-view";
import {
  getMeetingsForRange,
  getWeekStart,
  getWeekEnd,
} from "@/lib/data/meetings";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "everyone")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const baseDate = params.week ? new Date(params.week + "T12:00:00") : new Date();
  const weekStart = getWeekStart(baseDate);
  const weekEnd = getWeekEnd(weekStart);

  const { userId: realUserId } = await auth();
  const impersonation = await getImpersonation();

  // Use the impersonated user's ID when active, otherwise the real user
  const effectiveUserId = impersonation?.userId ?? realUserId;

  const accessToken = effectiveUserId
    ? await getUserGoogleAccessToken(effectiveUserId)
    : null;

  const granolaConnected = effectiveUserId
    ? (
        await db
          .select({ id: userIntegrations.id })
          .from(userIntegrations)
          .where(
            and(
              eq(userIntegrations.clerkUserId, effectiveUserId),
              eq(userIntegrations.provider, "granola")
            )
          )
          .limit(1)
      ).length > 0
    : false;

  const days = await getMeetingsForRange(weekStart, weekEnd, {
    accessToken: accessToken ?? undefined,
    userId: effectiveUserId ?? undefined,
  });

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
        granolaConnected={granolaConnected}
      />
    </div>
  );
}
