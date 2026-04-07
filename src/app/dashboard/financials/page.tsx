import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserRole, hasAccess } from "@/lib/auth/roles";

export default async function FinancialsPage() {
  const { sessionClaims } = await auth();
  const role = getUserRole(
    (sessionClaims?.publicMetadata as Record<string, unknown>) ?? {}
  );

  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Financials</h2>
      <p className="text-muted-foreground">
        Revenue, P&L, management accounts, and Mode reports will appear here.
      </p>
    </div>
  );
}
