import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getImpactAnalysis } from "@/lib/data/engineering-impact";
import { ImpactReport } from "./_components/impact-report";

export const metadata = {
  title: "Impact · Engineering",
};

export default async function ImpactPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard/engineering");
  }

  const analysis = await getImpactAnalysis();

  return <ImpactReport analysis={analysis} />;
}
