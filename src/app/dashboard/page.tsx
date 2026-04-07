import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { PermissionGate } from "@/components/dashboard/permission-gate";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default async function DashboardOverview() {
  const role = await getCurrentUserRole();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Overview"
        description="Key metrics across the business"
      />

      {/* Top-level metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PermissionGate role={role} requiredRole="ceo">
          <MetricCard
            label="LTV:CAC"
            value="—"
            subtitle="awaiting data"
            delay={0}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="ceo">
          <MetricCard
            label="Revenue"
            value="—"
            subtitle="awaiting data"
            delay={50}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="leadership">
          <MetricCard
            label="DAU"
            value="—"
            subtitle="awaiting data"
            delay={100}
          />
        </PermissionGate>
        <MetricCard
          label="OKR Progress"
          value="—"
          subtitle="awaiting data"
          delay={150}
        />
      </div>

      {/* Section cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PermissionGate role={role} requiredRole="ceo">
          <SectionCard
            title="Unit Economics"
            description="LTV, CAC, and acquisition efficiency"
            action={
              <Link
                href="/dashboard/unit-economics"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                View all
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          >
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <span className="text-lg text-muted-foreground">📊</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Connect Mode Analytics to populate unit economics.
              </p>
            </div>
          </SectionCard>
        </PermissionGate>

        <PermissionGate role={role} requiredRole="ceo">
          <SectionCard
            title="Financial"
            description="Management accounts and FP&A"
            action={
              <Link
                href="/dashboard/financial"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                View all
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          >
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <span className="text-lg text-muted-foreground">£</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Upload financials or connect Mode to populate this view.
              </p>
            </div>
          </SectionCard>
        </PermissionGate>

        <PermissionGate role={role} requiredRole="leadership">
          <SectionCard
            title="Product"
            description="Usage, activation, and retention"
            action={
              <Link
                href="/dashboard/product"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                View all
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          >
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <span className="text-lg text-muted-foreground">📈</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Connect Mode Analytics to view product metrics.
              </p>
            </div>
          </SectionCard>
        </PermissionGate>

        <SectionCard
          title="OKRs"
          description="Company objectives and key results"
          action={
            <Link
              href="/dashboard/okrs"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          }
        >
          <div className="space-y-3">
            {[
              { name: "Ship CEO Dashboard v1", status: "on_track" as const },
              { name: "Q2 revenue target", status: "at_risk" as const },
              { name: "Reduce customer churn", status: "on_track" as const },
            ].map((okr) => (
              <div
                key={okr.name}
                className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
              >
                <span className="text-sm text-foreground">{okr.name}</span>
                <StatusBadge status={okr.status} />
              </div>
            ))}
          </div>
        </SectionCard>

        <PermissionGate role={role} requiredRole="leadership">
          <SectionCard
            title="People"
            description="Team metrics and engagement"
            action={
              <Link
                href="/dashboard/people"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                View all
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          >
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <span className="text-lg text-muted-foreground">👥</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Connect HiBob and Culture Amp to view people metrics.
              </p>
            </div>
          </SectionCard>
        </PermissionGate>
      </div>
    </div>
  );
}
