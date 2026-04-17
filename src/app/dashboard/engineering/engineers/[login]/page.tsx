import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { EngineerProfileCharts } from "@/components/dashboard/engineer-profile-charts";
import { EngineerOkrCard } from "@/components/dashboard/engineer-okr-card";
import { EngineerPerformanceCard } from "@/components/dashboard/engineer-performance-card";
import { EditMappingDialog } from "@/components/dashboard/edit-mapping-dialog";
import {
  getEngineerProfile,
  getEngineerTimeSeries,
  getSquadOkrs,
  getEngineerPerformanceRatings,
  getEmployeeOptions,
} from "@/lib/data/engineer-profile";
import { PERIOD_OPTIONS, type PeriodDays } from "@/lib/data/engineering";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";

function formatTenure(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}m`;
  if (m === 0) return `${y}y`;
  return `${y}y ${m}m`;
}

export default async function EngineerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ login: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { login } = await params;
  const sp = await searchParams;

  const validPeriods = PERIOD_OPTIONS.map((p) => p.value);
  const periodDays = validPeriods.includes(Number(sp.period) as PeriodDays)
    ? (Number(sp.period) as PeriodDays)
    : 30;

  const profile = await getEngineerProfile(login);
  if (!profile) notFound();

  // CEO role check is non-critical for rendering. Other pages
  // (e.g. /dashboard/people/performance) `redirect()` on auth failure
  // because the entire page is role-gated — there's nothing to show
  // without a role. Here the role only controls one supplementary
  // section, so on a Clerk hiccup we prefer degrading to "no
  // Performance section" over a broken profile for the whole team.
  let isCeo = false;
  try {
    const role = await getCurrentUserRole();
    isCeo = hasAccess(role, "ceo");
  } catch (err) {
    console.error("[engineer profile] role lookup failed", err);
  }

  const [timeSeries, squadOkrs, performance, employeeOptions] =
    await Promise.all([
      getEngineerTimeSeries(login, periodDays).catch((err) => {
        console.error("[engineer profile] time series failed", err);
        return {
          prSeries: [],
          commitSeries: [],
          additionsSeries: [],
          deletionsSeries: [],
        };
      }),
      profile.squad
        ? getSquadOkrs(profile.squad).catch((err) => {
            console.error("[engineer profile] squad OKRs failed", err);
            return [];
          })
        : Promise.resolve([]),
      isCeo
        ? getEngineerPerformanceRatings(profile.employeeEmail).catch((err) => {
            console.error(
              "[engineer profile] performance ratings failed",
              err
            );
            return null;
          })
        : Promise.resolve(null),
      isCeo
        ? getEmployeeOptions().catch((err) => {
            console.error("[engineer profile] employee options failed", err);
            return [];
          })
        : Promise.resolve([]),
    ]);

  const displayName = profile.employeeName ?? login;

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href={`/dashboard/engineering/engineers?period=${periodDays}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Engineers
      </Link>

      {/* Profile header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {profile.avatarUrl && (
            <img
              src={profile.avatarUrl}
              alt={displayName}
              className="h-14 w-14 rounded-full"
            />
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl italic text-foreground">
                {displayName}
              </h2>
              {profile.level && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {profile.level}
                </span>
              )}
              {!profile.employeeName && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Unmapped
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <a
                href={`https://github.com/${login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-primary transition-colors"
              >
                @{login}
                <ExternalLink className="h-3 w-3" />
              </a>
              {profile.jobTitle && <span>{profile.jobTitle}</span>}
              {profile.squad && <span>{profile.squad}</span>}
              {profile.pillar && (
                <span className="text-muted-foreground/60">
                  {profile.pillar}
                </span>
              )}
              {profile.tenureMonths != null && (
                <span className="text-muted-foreground/60">
                  {formatTenure(profile.tenureMonths)} tenure
                </span>
              )}
            </div>
          </div>
        </div>

        {isCeo && (
          <EditMappingDialog
            login={login}
            currentEmployeeEmail={profile.employeeEmail}
            currentEmployeeName={profile.employeeName}
            employees={employeeOptions}
          />
        )}
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <Link
            key={opt.value}
            href={`/dashboard/engineering/engineers/${login}?period=${opt.value}`}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              periodDays === opt.value
                ? "bg-foreground text-background"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {/* Activity charts */}
      <section className="space-y-4">
        <SectionDivider
          title="Activity"
          subtitle={`Weekly contribution metrics — last ${periodDays} days`}
        />
        <EngineerProfileCharts
          prSeries={timeSeries.prSeries}
          commitSeries={timeSeries.commitSeries}
          additionsSeries={timeSeries.additionsSeries}
          deletionsSeries={timeSeries.deletionsSeries}
        />
      </section>

      {/* Performance ratings — CEO only */}
      {isCeo && performance && (
        <section className="space-y-4">
          <SectionDivider
            title="Performance"
            subtitle="Historical performance ratings across review cycles"
          />
          <EngineerPerformanceCard
            ratings={performance.ratings}
            reviewCycles={performance.reviewCycles}
          />
        </section>
      )}

      {/* Squad OKRs */}
      {profile.squad && (
        <section className="space-y-4">
          <SectionDivider
            title={`${profile.squad} OKRs`}
            subtitle="Latest OKR updates for this engineer's squad"
          />
          <EngineerOkrCard squadName={profile.squad} okrs={squadOkrs} />
        </section>
      )}
    </div>
  );
}
