import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { getUserRole } from "@/lib/auth/roles";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Bell } from "lucide-react";

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
        <header className="flex h-14 items-center justify-between border-b border-border/50 px-6">
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Bell className="h-4 w-4" />
            </button>
            <div className="h-5 w-px bg-border" />
            <UserButton />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
