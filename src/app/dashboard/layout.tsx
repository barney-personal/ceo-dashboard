import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { getUserRole } from "@/lib/auth/roles";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sessionClaims } = await auth();
  const role = getUserRole(
    (sessionClaims?.publicMetadata as Record<string, unknown>) ?? {}
  );

  return (
    <div className="flex flex-1">
      <Sidebar role={role} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <h1 className="text-sm font-medium text-muted-foreground">
            CEO Dashboard
          </h1>
          <UserButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
