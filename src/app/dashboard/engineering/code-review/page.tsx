import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getCodeReviewView } from "@/lib/data/code-review";
import { CodeReviewReport } from "./_components/code-review-report";

export const metadata = {
  title: "Code review · Engineering",
};

// Don't let Next cache a snapshot of this page across deploys — the analysis
// is refreshed on demand by the CEO and we want the latest on every load.
export const dynamic = "force-dynamic";

export default async function CodeReviewPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard/engineering");
  }

  const view = await getCodeReviewView({ includePrevious: true });
  return <CodeReviewReport view={view} />;
}
