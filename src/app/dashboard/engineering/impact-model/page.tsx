import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getImpactModelHydrated } from "@/lib/data/impact-model.server";
import { ImpactModelReport } from "./_components/model-report";

export const metadata = {
  title: "Impact Model · Engineering",
};

export default async function ImpactModelPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard/engineering");
  }

  // Hydrates anonymised snapshot with real employee names via DB join.
  // Safe at this point: leadership+ is already verified above.
  const model = await getImpactModelHydrated();

  return <ImpactModelReport model={model} />;
}
