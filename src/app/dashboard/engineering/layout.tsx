import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { EngineeringTabs } from "@/components/dashboard/engineering-tabs";

export default async function EngineeringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // All engineering sub-pages are open to everyone.
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "everyone")) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-6 2xl:max-w-[96rem]">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Engineering"
          description="Delivery health, team velocity, and individual activity."
        />
        <a
          href="https://app.swarmia.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-warm transition-colors hover:text-primary"
        >
          Open in Swarmia
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Suspense boundary — EngineeringTabs uses useSearchParams(), which
          Next.js requires to sit under Suspense to avoid bailout warnings
          and to survive any future static rendering of children. */}
      <Suspense fallback={<div className="h-9" />}>
        <EngineeringTabs />
      </Suspense>

      <div className="pt-2">{children}</div>
    </div>
  );
}
