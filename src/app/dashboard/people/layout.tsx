import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { PeopleTabs } from "@/components/dashboard/people-tabs";

export default async function PeopleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <PageHeader
          title="People"
          description="Headcount, team structure, and workforce metrics"
        />
        <PeopleTabs />
      </div>
      {children}
    </div>
  );
}
