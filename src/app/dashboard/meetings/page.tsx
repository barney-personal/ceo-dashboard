import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { MeetingsView } from "@/components/dashboard/meetings-view";
import {
  getMeetingsForRange,
  getWeekStart,
  getWeekEnd,
} from "@/lib/data/meetings";

export default async function MeetingsPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);
  const days = await getMeetingsForRange(weekStart, weekEnd);

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Meetings"
        description="Calendar events, meeting notes, and pre-reads"
      />

      <MeetingsView
        initialDays={days}
        initialWeekStart={weekStart.toISOString().slice(0, 10)}
      />
    </div>
  );
}
