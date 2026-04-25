import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { GithubMappingAdmin } from "@/components/dashboard/github-mapping-admin";
import { getMappingAdminData } from "@/lib/data/github-mapping-admin";

export const dynamic = "force-dynamic";

export default async function GithubMappingAdminPage() {
  await requireDashboardPermission("admin.githubMapping");

  const data = await getMappingAdminData();

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-8 2xl:max-w-[96rem]">
      <PageHeader
        title="GitHub Mapping"
        description="Match unmapped engineers to their GitHub accounts. Candidates are ranked by name similarity, commit-history overlap with tenure, and PR volume."
      />
      <GithubMappingAdmin
        unmappedEmployees={data.unmappedEmployees}
        mappedEmployees={data.mappedEmployees}
        recentCandidatePool={data.recentCandidatePool}
        totalActive={data.totalActive}
        totalMapped={data.totalMapped}
      />
    </div>
  );
}
