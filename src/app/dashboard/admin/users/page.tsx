import { clerkClient } from "@clerk/nextjs/server";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { UserAdmin } from "@/components/dashboard/user-admin";

export default async function UsersAdminPage() {
  await requireDashboardPermission("admin.users");

  const client = await clerkClient();
  const { data: users } = await client.users.getUserList({ limit: 100 });

  // Fetch session counts for all users in parallel
  const sessionCounts = await Promise.all(
    users.map(async (u) => {
      try {
        const { data: sessions } = await client.sessions.getSessionList({
          userId: u.id,
          limit: 100,
        });
        return { userId: u.id, count: sessions.length };
      } catch {
        return { userId: u.id, count: 0 };
      }
    })
  );
  const sessionCountMap = new Map(
    sessionCounts.map((s) => [s.userId, s.count])
  );

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
    lastActiveAt: u.lastActiveAt
      ? new Date(u.lastActiveAt).toISOString()
      : null,
    sessionCount: sessionCountMap.get(u.id) ?? 0,
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
