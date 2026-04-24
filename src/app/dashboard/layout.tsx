import { UserButton } from "@clerk/nextjs";
import { getCurrentUserRole, getRealUserRole, getImpersonation } from "@/lib/auth/roles.server";
import { Sidebar, MobileSidebar } from "@/components/dashboard/sidebar";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { Bell } from "lucide-react";
import { PageViewTracker } from "@/components/dashboard/page-view-tracker";
import { EnpsTakeover } from "@/components/dashboard/enps-takeover";
import { GOOGLE_CALENDAR_READONLY_SCOPE } from "@/lib/auth/google-token.server";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

function ImpersonatedAvatar({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string | null;
}) {
  return (
    <div
      title={`Viewing as ${name}`}
      className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-amber-500/40 bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-amber-500/30"
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={name}
          className="h-full w-full object-cover"
        />
      ) : (
        getInitials(name)
      )}
    </div>
  );
}

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
      <div className="flex min-w-0 flex-1 flex-col">
        {impersonation && (
          <ImpersonationBanner name={impersonation.name} role={impersonation.role} />
        )}
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border/50 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MobileSidebar role={role} isCeo={realRole === "ceo"} impersonation={impersonation} />
            <div className="hidden h-px w-8 bg-border md:block" />
            <span
              className="truncate text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground"
              suppressHydrationWarning
            >
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Bell className="h-4 w-4" />
            </button>
            <div className="h-5 w-px bg-border" />
            {impersonation ? (
              <ImpersonatedAvatar
                name={impersonation.name}
                imageUrl={impersonation.imageUrl}
              />
            ) : (
              <UserButton
                userProfileProps={{
                  additionalOAuthScopes: {
                    google: [GOOGLE_CALENDAR_READONLY_SCOPE],
                  },
                }}
              />
            )}
          </div>
        </header>
        <PageViewTracker />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
      <EnpsTakeover />
    </div>
  );
}
