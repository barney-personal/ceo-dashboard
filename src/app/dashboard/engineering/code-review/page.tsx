import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { getCodeReviewPageData } from "@/lib/data/code-review";
import { CodeReviewReport } from "./_components/code-review-report";

export const metadata = {
  title: "Code review · Engineering",
};

// Don't let Next cache a snapshot of this page across deploys — the analysis
// is refreshed on demand by the CEO and we want the latest on every load.
export const dynamic = "force-dynamic";

export default async function CodeReviewPage() {
  await requireDashboardPermission("engineering.codeReview");

  const { view, squadView } = await getCodeReviewPageData({
    includePrevious: true,
  });
  return <CodeReviewReport view={view} squadView={squadView} />;
}
