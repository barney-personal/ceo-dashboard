import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { getCurrentUserWithTimeout } from "@/lib/auth/current-user.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { TeamPerformanceTable } from "@/components/dashboard/team-performance-table";
import {
  getAllManagers,
  getDirectReports,
  isManagerByEmail,
} from "@/lib/data/managers";
import { getTeamPerformance } from "@/lib/data/team-performance";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ManagersPage({
  searchParams,
}: {
  searchParams: Promise<{ manager?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "manager")) {
    redirect("/dashboard");
  }
  const params = await searchParams;

  const userResult = await getCurrentUserWithTimeout();
  const viewerEmail =
    userResult.status === "authenticated"
      ? userResult.user.emailAddresses?.[0]?.emailAddress?.toLowerCase() ?? null
      : null;

  // Leadership/CEO can inspect any manager via ?manager=email. Managers see
  // only their own team.
  const canPickAnyManager = hasAccess(role, "leadership");
  const allManagers = canPickAnyManager ? await getAllManagers() : [];

  let targetEmail: string | null = null;
  if (canPickAnyManager && params.manager) {
    targetEmail = params.manager.toLowerCase();
  } else if (viewerEmail && (await isManagerByEmail(viewerEmail))) {
    targetEmail = viewerEmail;
  } else if (canPickAnyManager && allManagers[0]) {
    targetEmail = allManagers[0].email;
  }

  if (!targetEmail) {
    return (
      <div className="mx-auto min-w-0 max-w-7xl space-y-6 2xl:max-w-[96rem]">
        <PageHeader
          title="My Team"
          description="Performance signals across your direct reports"
        />
        <SectionCard title="No team found">
          <p className="py-8 text-sm text-muted-foreground">
            We couldn&apos;t find any direct reports for your account in the
            Headcount SSoT. If you think this is wrong, check with People Ops
            that your reporting line is up to date in HiBob.
          </p>
        </SectionCard>
      </div>
    );
  }

  const reports = await getDirectReports(targetEmail);
  const team = await getTeamPerformance(targetEmail, reports);

  const targetManager = canPickAnyManager
    ? allManagers.find((m) => m.email === targetEmail)
    : null;
  const headerName = targetManager?.name ?? (targetEmail === viewerEmail ? "Your team" : targetEmail);

  const bottomQuartileCount = team.rows.filter((r) =>
    r.alerts.some(
      (a) =>
        a.kind === "engagement_bottom_quartile" ||
        a.kind === "rating_bottom_quartile",
    ),
  ).length;
  const trendingDownCount = team.rows.filter((r) =>
    r.alerts.some(
      (a) => a.kind === "impact_trending_down" || a.kind === "rating_dropped",
    ),
  ).length;

  return (
    <div className="mx-auto min-w-0 max-w-none space-y-8">
      <PageHeader
        title={targetEmail === viewerEmail ? "My Team" : headerName}
        description={
          team.windowStart && team.windowEnd
            ? `Performance signals across ${reports.length} direct report${reports.length === 1 ? "" : "s"} · ${fmtDate(team.windowStart)} → ${fmtDate(team.windowEnd)}`
            : `Performance signals across ${reports.length} direct reports`
        }
      />

      {canPickAnyManager && allManagers.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor="mgr-picker" className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
            Viewing
          </label>
          <ManagerPicker
            current={targetEmail}
            managers={allManagers.map((m) => ({
              email: m.email,
              label: `${m.name} · ${m.directReports.length} reports`,
            }))}
          />
        </div>
      )}

      {/* Alert summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:max-w-[96rem]">
        <StatTile
          label="Reports"
          value={reports.length.toLocaleString()}
          hint={`team size`}
        />
        <StatTile
          label="Raising alerts"
          value={`${team.alertingCount}`}
          hint={
            team.alertingCount === 0
              ? "nothing to act on"
              : `${team.alertingCount} of ${team.rows.length} flagged`
          }
          tone={team.alertingCount > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Bottom quartile"
          value={`${bottomQuartileCount}`}
          hint="engagement or rating"
          tone={bottomQuartileCount > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Trending down"
          value={`${trendingDownCount}`}
          hint="impact or rating"
          tone={trendingDownCount > 0 ? "warning" : undefined}
        />
      </div>

      {/* Alerts callout */}
      {team.alertingCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div>
            <p className="font-medium text-foreground">
              {team.alertingCount} report{team.alertingCount === 1 ? "" : "s"} worth a look
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A report is flagged when they&apos;re in the bottom quartile of their
              function, their rating dropped from the prior cycle, or their
              90-day impact score dropped ≥25% vs the prior 90 days.
            </p>
          </div>
        </div>
      )}

      <SectionCard
        title="Team performance"
        description="Click any row to open that person's full profile."
      >
        <TeamPerformanceTable rows={team.rows} />
      </SectionCard>

      <p className="text-[11px] text-muted-foreground/60">
        Cohorts: {team.cohortSizes.impactCompany.toLocaleString()} engineers
        (company-wide impact ranking), {Object.keys(team.cohortSizes.slackByFunction).length} functions (Slack engagement percentile).
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warning";
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-4 shadow-warm ${
        tone === "warning" ? "border-amber-500/30" : "border-border/60"
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-2xl tracking-tight ${
          tone === "warning" ? "text-amber-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ManagerPicker({
  current,
  managers,
}: {
  current: string;
  managers: { email: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {managers.slice(0, 12).map((m) => (
        <Link
          key={m.email}
          href={`/dashboard/managers?manager=${encodeURIComponent(m.email)}`}
          className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
            m.email === current
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/50 bg-card text-muted-foreground hover:border-border hover:text-foreground"
          }`}
        >
          {m.label}
        </Link>
      ))}
      {managers.length > 12 && (
        <span className="px-2 py-1 text-[11px] text-muted-foreground/60">
          + {managers.length - 12} more
        </span>
      )}
    </div>
  );
}
