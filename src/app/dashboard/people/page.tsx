import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserRole, hasAccess } from "@/lib/auth/roles";

export default async function PeoplePage() {
  const { sessionClaims } = await auth();
  const role = getUserRole(
    (sessionClaims?.publicMetadata as Record<string, unknown>) ?? {}
  );

  if (!hasAccess(role, "leadership")) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">People</h2>
      <p className="text-muted-foreground">
        Headcount, attrition, engagement scores, and team metrics will appear
        here.
      </p>
    </div>
  );
}
