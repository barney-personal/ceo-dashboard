import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getImpactModel } from "@/lib/data/impact-model";
import { ImpactModelReport } from "./_components/model-report";

export const metadata = {
  title: "Impact Model · Engineering",
};

export default async function ImpactModelPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard/engineering");
  }

  const model = getImpactModel();

  return <ImpactModelReport model={model} />;
}
