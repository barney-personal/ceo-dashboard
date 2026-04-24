import { clerkClient } from "@clerk/nextjs/server";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { UserAdmin } from "@/components/dashboard/user-admin";

export default async function UsersAdminPage() {
  await requireDashboardPermission("admin.users");

  const client = await clerkClient();

  // Clerk caps each getUserList call at 100, so page through until exhausted.
  const PAGE_SIZE = 100;
  const users: Awaited<ReturnType<typeof client.users.getUserList>>["data"] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, totalCount } = await client.users.getUserList({
      limit: PAGE_SIZE,
      offset,
      orderBy: "-created_at",
    });
    users.push(...data);
    if (data.length < PAGE_SIZE || users.length >= totalCount) break;
  }

  // Fetch session counts in bounded-concurrency batches to avoid hammering
  // Clerk's per-user endpoint with hundreds of simultaneous requests.
  const SESSION_FETCH_CONCURRENCY = 20;
  const sessionCountMap = new Map<string, number>();
  for (let i = 0; i < users.length; i += SESSION_FETCH_CONCURRENCY) {
    const batch = users.slice(i, i + SESSION_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (u) => {
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
    for (const { userId, count } of results) sessionCountMap.set(userId, count);
  }

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
