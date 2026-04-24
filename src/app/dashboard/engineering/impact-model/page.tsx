import { hasAccess } from "@/lib/auth/roles";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { getCurrentUserWithTimeout } from "@/lib/auth/current-user.server";
import {
  buildTeamView,
  getImpactModelHydrated,
  type TeamView,
} from "@/lib/data/impact-model.server";
import {
  getAllManagers,
  isManagerByEmail,
  resolveViewerEmail,
  type ManagerInfo,
} from "@/lib/data/managers";
import { ImpactModelReport } from "./_components/model-report";

export const metadata = {
  title: "Impact Model · Engineering",
};

export default async function ImpactModelPage({
  searchParams,
}: {
  searchParams: Promise<{ manager?: string }>;
}) {
  const role = await requireDashboardPermission("engineering.impactModel");
  const canPickAnyManager = hasAccess(role, "leadership");
  const params = await searchParams;

  // Hydrates anonymised snapshot with real employee names via DB join.
  // Safe at this point: manager+ is verified above.
  const model = await getImpactModelHydrated();

  const userResult = await getCurrentUserWithTimeout();
  const viewerEmail =
    userResult.status === "authenticated"
      ? await resolveViewerEmail(
          (userResult.user.emailAddresses ?? []).map((e) => e.emailAddress),
        )
      : null;

  // Only leadership+ get a manager picker and a list of all managers.
  // Plain managers see only their own team — the `?manager=` query param
  // is ignored for them to prevent cross-team inspection.
  const allManagers: ManagerInfo[] = canPickAnyManager
    ? await getAllManagers()
    : [];

  let targetEmail: string | null = null;
  let targetName: string | null = null;
  if (canPickAnyManager && params.manager) {
    const candidate = params.manager.toLowerCase();
    // getAllManagers already lowercases emails, but compare case-insensitively
    // here too — belt-and-braces in case that normalisation ever regresses.
    const matched = allManagers.find(
      (m) => m.email.toLowerCase() === candidate,
    );
    if (matched) {
      targetEmail = matched.email;
      targetName = matched.name;
    }
  }
  if (!targetEmail && viewerEmail && (await isManagerByEmail(viewerEmail))) {
    targetEmail = viewerEmail;
    targetName =
      allManagers.find((m) => m.email === viewerEmail)?.name ?? null;
  }
  // Intentionally NO fallback auto-pick for leadership+ viewers who don't
  // manage a team. A CEO / non-manager VP opening this page should see the
  // full-company model, not "first alphabetical manager's team" by default.
  // The picker is still rendered so they can drill into any team on demand.

  let teamView: TeamView | null = null;
  if (targetEmail) {
    teamView = await buildTeamView(model, targetEmail, targetName);
  }

  // For plain managers (no leadership access): scope the per-engineer
  // sections (SHAP waterfall picker, outlier table, actual-vs-predicted
  // scatter) to their team. Company-wide aggregates (feature importance,
  // grouped importance, PDPs, headline metrics) remain visible since
  // they don't identify individuals.
  let visibleModel = model;
  if (!canPickAnyManager && teamView) {
    const teamHashes = new Set(
      teamView.entries.map((e) => e.engineer.email_hash),
    );
    visibleModel = {
      ...model,
      engineers: model.engineers.filter((e) => teamHashes.has(e.email_hash)),
    };
  }

  const isViewerOwnTeam =
    !!viewerEmail && !!targetEmail && viewerEmail === targetEmail;

  return (
    <ImpactModelReport
      model={visibleModel}
      teamView={teamView}
      allManagers={allManagers.map((m) => ({
        email: m.email,
        name: m.name,
        directReports: m.directReports.length,
        jobTitle: m.jobTitle,
      }))}
      isViewerOwnTeam={isViewerOwnTeam}
      restrictedToTeam={!canPickAnyManager}
    />
  );
}
