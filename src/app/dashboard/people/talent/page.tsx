import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { TalentPageClient } from "@/components/dashboard/talent-page-client";
import { getTalentData } from "@/lib/data/talent";
import {
  getLatestTerminalSyncRun,
  resolveModeStaleReason,
} from "@/lib/data/mode";
import { getModeReportLink } from "@/lib/integrations/mode-config";

export default async function TalentPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  const [data, latestSyncRun] = await Promise.all([
    getTalentData(),
    getLatestTerminalSyncRun("mode"),
  ]);

  const isEmpty = data.hireRows.length === 0 && data.targets.length === 0;
  const emptyReason = resolveModeStaleReason(
    isEmpty,
    latestSyncRun,
    "No data — sync Mode 'Talent' report",
  );
  const modeUrl = getModeReportLink("people", "talent");

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Talent"
        description="Recruiter hiring output — monthly actuals and per-recruiter 3-month projection"
      />

      <TalentPageClient
        hireRows={data.hireRows}
        targets={data.targets}
        employmentByRecruiter={data.employmentByRecruiter}
        modeUrl={modeUrl}
        emptyReason={isEmpty ? emptyReason : null}
      />
    </div>
  );
}
