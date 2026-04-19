import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { SlackTabs } from "@/components/dashboard/slack-tabs";
import { getLatestSlackMembersSnapshot } from "@/lib/data/slack-members";

function fmtWindow(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function SlackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  // Layout-level header — fetch just the window metadata to keep the
  // description accurate. The full snapshot is re-fetched in each page;
  // the loader is cached inside a single request by React, so this is cheap.
  const snap = await getLatestSlackMembersSnapshot();
  const description = snap
    ? `Workspace engagement, tenure-normalised · ${fmtWindow(snap.windowStart)} → ${fmtWindow(snap.windowEnd)}`
    : "Workspace engagement, tenure-normalised";

  return (
    <div className="mx-auto min-w-0 max-w-none space-y-6">
      <PageHeader title="Slack" description={description} />
      <SlackTabs />
      <div className="pt-2">{children}</div>
    </div>
  );
}
