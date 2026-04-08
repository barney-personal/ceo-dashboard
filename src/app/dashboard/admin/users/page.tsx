import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { UserAdmin } from "@/components/dashboard/user-admin";

export default async function UsersAdminPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  const client = await clerkClient();
  const { data: users } = await client.users.getUserList({ limit: 100 });

  const serialized = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.emailAddresses[0]?.emailAddress ?? null,
    imageUrl: u.imageUrl,
    role:
      ((u.publicMetadata as Record<string, unknown>)?.role as string) ??
      "everyone",
    lastSignInAt: u.lastSignInAt
      ? new Date(u.lastSignInAt).toISOString()
      : null,
  }));

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="User Management"
        description="Manage user roles and permissions"
      />
      <UserAdmin initialUsers={serialized} />
    </div>
  );
}
