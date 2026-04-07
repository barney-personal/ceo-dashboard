import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/auth/roles";
import { PermissionGate } from "@/components/dashboard/permission-gate";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardOverview() {
  const { sessionClaims } = await auth();
  const role = getUserRole(
    (sessionClaims?.publicMetadata as Record<string, unknown>) ?? {}
  );

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <PermissionGate role={role} requiredRole="ceo">
          <Card>
            <CardHeader>
              <CardTitle>Financials</CardTitle>
              <CardDescription>
                Revenue, P&L, and management accounts
              </CardDescription>
            </CardHeader>
          </Card>
        </PermissionGate>

        <PermissionGate role={role} requiredRole="leadership">
          <Card>
            <CardHeader>
              <CardTitle>People</CardTitle>
              <CardDescription>
                Headcount, engagement, and team metrics
              </CardDescription>
            </CardHeader>
          </Card>
        </PermissionGate>

        <Card>
          <CardHeader>
            <CardTitle>OKRs</CardTitle>
            <CardDescription>
              Company objectives and key results
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
