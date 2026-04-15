import { UserButton } from "@clerk/nextjs";
import { getCurrentUserRole, getRealUserRole, getImpersonation } from "@/lib/auth/roles.server";
import { Sidebar } from "@/components/dashboard/sidebar";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { ProbeCanary } from "@/components/dashboard/probe-canary";
import { Bell } from "lucide-react";
import { PageViewTracker } from "@/components/dashboard/page-view-tracker";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [role, realRole, impersonation] = await Promise.all([
    getCurrentUserRole(),
    getRealUserRole(),
    getImpersonation(),
  ]);

  return (
    <div className="flex flex-1">
      <Sidebar role={role} isCeo={realRole === "ceo"} impersonation={impersonation} />
      <div className="flex flex-1 flex-col">
        {impersonation && (
          <ImpersonationBanner name={impersonation.name} role={impersonation.role} />
        )}
        <header className="flex h-14 items-center justify-between border-b border-border/50 px-6">
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground" suppressHydrationWarning>
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
        <PageViewTracker />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
        <ProbeCanary />
      </div>
    </div>
  );
}
