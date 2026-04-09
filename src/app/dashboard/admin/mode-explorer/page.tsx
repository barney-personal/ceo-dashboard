import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { modeReports, modeReportData } from "@/lib/db/schema";
import {
  isSchemaCompatibilityError,
  getSchemaCompatibilityMessage,
} from "@/lib/db/errors";
import { ModeExplorer } from "./mode-explorer";

interface QuerySummary {
  id: number;
  reportId: number;
  queryToken: string;
  queryName: string;
  rowCount: number;
  sourceRowCount: number;
  storedRowCount: number;
  truncated: boolean;
  storageWindow: unknown;
  columns: Array<{ name: string; type: string }>;
  syncedAt: string;
}

interface ReportSummary {
  id: number;
  reportToken: string;
  name: string;
  section: string;
  category: string | null;
  isActive: boolean;
}

export default async function ModeExplorerPage() {
  const role = await getCurrentUserRole();

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  let reports: ReportSummary[] = [];
  let queries: QuerySummary[] = [];
  let warning: string | null = null;

  try {
    const [reportRows, queryRows] = await Promise.all([
      db.select().from(modeReports).orderBy(modeReports.section, modeReports.name),
      db
        .select({
          id: modeReportData.id,
          reportId: modeReportData.reportId,
          queryToken: modeReportData.queryToken,
          queryName: modeReportData.queryName,
          rowCount: modeReportData.rowCount,
          sourceRowCount: modeReportData.sourceRowCount,
          storedRowCount: modeReportData.storedRowCount,
          truncated: modeReportData.truncated,
          storageWindow: modeReportData.storageWindow,
          columns: modeReportData.columns,
          syncedAt: modeReportData.syncedAt,
        })
        .from(modeReportData),
    ]);

    reports = reportRows.map((r) => ({
      id: r.id,
      reportToken: r.reportToken,
      name: r.name,
      section: r.section,
      category: r.category,
      isActive: r.isActive,
    }));

    queries = queryRows.map((q) => ({
      id: q.id,
      reportId: q.reportId,
      queryToken: q.queryToken,
      queryName: q.queryName,
      rowCount: q.rowCount,
      sourceRowCount: q.sourceRowCount,
      storedRowCount: q.storedRowCount,
      truncated: q.truncated,
      storageWindow: q.storageWindow,
      columns: q.columns as Array<{ name: string; type: string }>,
      syncedAt: q.syncedAt.toISOString(),
    }));
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }
    warning = getSchemaCompatibilityMessage(error);
  }

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="Mode Explorer"
        description="Browse synced Mode report data stored in Postgres"
      />

      {warning && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          {warning}
        </div>
      )}

      <ModeExplorer reports={reports} queries={queries} />
    </div>
  );
}
