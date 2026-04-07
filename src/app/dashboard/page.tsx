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
            label="Revenue"
            value="—"
            subtitle="awaiting data"
            delay={0}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="ceo">
          <MetricCard
            label="Burn Rate"
            value="—"
            subtitle="awaiting data"
            delay={50}
          />
        </PermissionGate>
        <PermissionGate role={role} requiredRole="leadership">
          <MetricCard
            label="Headcount"
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
            title="Financials"
            description="Revenue, P&L, and management accounts"
            action={
              <Link
                href="/dashboard/financials"
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
                Connect Mode Analytics or upload financials to populate this
                view.
              </p>
            </div>
          </SectionCard>
        </PermissionGate>

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
                Connect HiBob to see headcount, attrition, and team metrics.
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

        <SectionCard title="Recent Activity" description="Latest updates">
          <div className="space-y-3">
            {[
              {
                text: "Dashboard created",
                time: "Just now",
                dot: "bg-primary",
              },
              {
                text: "Awaiting data source connections",
                time: "Set up pending",
                dot: "bg-warning",
              },
            ].map((activity) => (
              <div key={activity.text} className="flex items-start gap-3">
                <div
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${activity.dot}`}
                />
                <div className="flex-1">
                  <p className="text-sm text-foreground">{activity.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {activity.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
