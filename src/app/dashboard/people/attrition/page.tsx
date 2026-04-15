import { PageHeader } from "@/components/dashboard/page-header";
import { AttritionPageClient } from "@/components/dashboard/attrition-page-client";
import {
  getAttritionData,
  getDepartments,
  getTenureBuckets,
  buildEmployeeRetentionCohorts,
} from "@/lib/data/attrition";
import {
  getLatestTerminalSyncRun,
  resolveModeStaleReason,
} from "@/lib/data/mode";
import { getModeReportLink } from "@/lib/integrations/mode-config";

export default async function AttritionPage() {
  const [attritionData, latestSyncRun] = await Promise.all([
    getAttritionData(),
    getLatestTerminalSyncRun("mode"),
  ]);

  const { rollingAttrition, y1Attrition, recentLeavers, employees } = attritionData;

  const isEmpty =
    rollingAttrition.length === 0 &&
    y1Attrition.length === 0 &&
    recentLeavers.length === 0;
  const emptyReason = resolveModeStaleReason(
    isEmpty,
    latestSyncRun,
    "No data — sync Mode 'Attrition Tracker' report",
  );

  const modeUrl = getModeReportLink("people", "attrition");
  const departments = getDepartments(rollingAttrition);
  const tenureBuckets = getTenureBuckets(rollingAttrition);
  const retentionCohorts = buildEmployeeRetentionCohorts(employees);

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Attrition"
        description="Employee attrition rates and trends — rolling 12-month and first-year"
      />

      <AttritionPageClient
        rollingAttrition={rollingAttrition}
        y1Attrition={y1Attrition}
        recentLeavers={recentLeavers}
        departments={departments}
        tenureBuckets={tenureBuckets}
        retentionCohorts={retentionCohorts}
        modeUrl={modeUrl}
        emptyReason={isEmpty ? emptyReason : null}
      />
    </div>
  );
}
