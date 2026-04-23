import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
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
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard/engineering");
  }
  const params = await searchParams;

  // Hydrates anonymised snapshot with real employee names via DB join.
  // Safe at this point: leadership+ is already verified above.
  const model = await getImpactModelHydrated();

  const userResult = await getCurrentUserWithTimeout();
  const viewerEmail =
    userResult.status === "authenticated"
      ? await resolveViewerEmail(
          (userResult.user.emailAddresses ?? []).map((e) => e.emailAddress),
        )
      : null;

  // All leadership+ viewers get a picker. Default target: the viewer's own
  // team if they run one; otherwise the first available manager.
  const allManagers: ManagerInfo[] = await getAllManagers();
  let targetEmail: string | null = null;
  let targetName: string | null = null;
  if (params.manager) {
    const candidate = params.manager.toLowerCase();
    const matched = allManagers.find((m) => m.email === candidate);
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
  if (!targetEmail && allManagers[0]) {
    targetEmail = allManagers[0].email;
    targetName = allManagers[0].name;
  }

  let teamView: TeamView | null = null;
  if (targetEmail) {
    teamView = await buildTeamView(model, targetEmail, targetName);
  }

  const isViewerOwnTeam =
    !!viewerEmail && !!targetEmail && viewerEmail === targetEmail;

  return (
    <ImpactModelReport
      model={model}
      teamView={teamView}
      allManagers={allManagers.map((m) => ({
        email: m.email,
        name: m.name,
        directReports: m.directReports.length,
        jobTitle: m.jobTitle,
      }))}
      isViewerOwnTeam={isViewerOwnTeam}
    />
  );
}
