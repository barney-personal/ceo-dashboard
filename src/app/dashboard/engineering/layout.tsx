import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getDashboardPermissionRoleMap } from "@/lib/auth/dashboard-permissions.server";
import { getEngineeringViewResolution } from "@/lib/auth/engineering-view.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { EngineeringTabs } from "@/components/dashboard/engineering-tabs";
import { EngineeringViewToggle } from "@/components/dashboard/engineering-view-toggle";
import { EngineeringBRoot } from "@/components/dashboard/engineering-b/root";

export default async function EngineeringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [role, permissionRoles, engineeringView] = await Promise.all([
    getCurrentUserRole(),
    getDashboardPermissionRoleMap(),
    getEngineeringViewResolution(),
  ]);

  const isBSide = engineeringView.surface === "b-side";

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-6 2xl:max-w-[96rem]">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Engineering"
          description={
            isBSide
              ? "Single composite score, two personas — methodology visible on page."
              : "Delivery health, team velocity, and individual activity."
          }
        />
        <div className="flex flex-col items-end gap-2">
          {engineeringView.actualCeo && (
            <EngineeringViewToggle
              initialToggleOn={engineeringView.toggleOn}
            />
          )}
          {!isBSide && (
            <a
              href="https://app.swarmia.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-warm transition-colors hover:text-primary"
            >
              Open in Swarmia
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {!isBSide && (
        /* Suspense boundary — EngineeringTabs uses useSearchParams(), which
            Next.js requires to sit under Suspense to avoid bailout warnings
            and to survive any future static rendering of children. */
        <Suspense fallback={<div className="h-9" />}>
          <EngineeringTabs
            showImpact={hasAccess(role, permissionRoles["engineering.impact"])}
            showImpactModel={hasAccess(
              role,
              permissionRoles["engineering.impactModel"],
            )}
            showCodeReview={hasAccess(
              role,
              permissionRoles["engineering.codeReview"],
            )}
            showRanking={hasAccess(
              role,
              permissionRoles["engineering.ranking"],
            )}
          />
        </Suspense>
      )}

      <div className="pt-2">
        {isBSide ? (
          <EngineeringBRoot
            effectiveRole={engineeringView.effectiveRole}
            isCeoPreview={engineeringView.actualCeo}
            impersonatedEmail={engineeringView.impersonatedEmail}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
