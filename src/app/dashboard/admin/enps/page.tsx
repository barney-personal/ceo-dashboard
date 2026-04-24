import Link from "next/link";
import { clerkClient } from "@clerk/nextjs/server";
import { requireDashboardPermission } from "@/lib/auth/dashboard-permissions.server";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { ColumnChart } from "@/components/charts/column-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  classify,
  currentMonth,
  getEnpsDistribution,
  getEnpsMonthlyTrend,
  getEnpsResponseRate,
  getEnpsResponsesForMonth,
  type EnpsMonthlyAggregate,
  type EnpsMonthlyResponse,
} from "@/lib/data/enps";
import {
  getEmployeeSummariesByEmail,
  type EmployeeSummary,
} from "@/lib/data/managers";
import { Heart } from "lucide-react";

export default async function EnpsAdminPage() {
  await requireDashboardPermission("dashboard.admin.enps");

  const month = currentMonth();

  const [trend, distribution, responseRate, monthResponses] = await Promise.all([
    getEnpsMonthlyTrend(12),
    getEnpsDistribution(month),
    getEnpsResponseRate(month),
    getEnpsResponsesForMonth(month),
  ]);

  // Resolve each respondent's Clerk user → SSoT employee so we can link each
  // card to the person profile and show their title + department inline.
  // Clerk's `getUserList` caps `userId` at 100 entries per request, so batch.
  const uniqueClerkIds = [...new Set(monthResponses.map((r) => r.clerkUserId))];
  const employeeByClerkId = new Map<string, EmployeeSummary>();
  if (uniqueClerkIds.length > 0) {
    const client = await clerkClient();
    const CLERK_USER_ID_BATCH = 100;
    const clerkIdToEmails = new Map<string, string[]>();
    const allEmails: string[] = [];
    for (let i = 0; i < uniqueClerkIds.length; i += CLERK_USER_ID_BATCH) {
      const batch = uniqueClerkIds.slice(i, i + CLERK_USER_ID_BATCH);
      const { data: users } = await client.users.getUserList({
        userId: batch,
        limit: batch.length,
      });
      for (const u of users) {
        const emails = (u.emailAddresses ?? []).map((e) =>
          e.emailAddress.toLowerCase(),
        );
        clerkIdToEmails.set(u.id, emails);
        allEmails.push(...emails);
      }
    }
    const summaries = await getEmployeeSummariesByEmail(allEmails);
    for (const [clerkId, emails] of clerkIdToEmails) {
      const match = emails.find((e) => summaries.has(e));
      if (match) {
        employeeByClerkId.set(clerkId, summaries.get(match)!);
      }
    }
  }

  const latest = trend[trend.length - 1] as EnpsMonthlyAggregate | undefined;
  const hasAnyData = trend.length > 0;

  const averageTrend = trend.map((t) => ({
    date: `${t.month}-01`,
    value: t.average ?? 0,
  }));

  const enpsTrend = trend
    .filter((t) => t.enps !== null)
    .map((t) => ({
      date: `${t.month}-01`,
      value: t.enps ?? 0,
    }));

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 2xl:max-w-[96rem]">
      <PageHeader
        title="Employee Happiness"
        description="Monthly eNPS pulse — anonymous to the team, CEO-only view"
      />

      {!hasAnyData && (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/50 bg-card/50">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Heart className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              No responses yet
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              The takeover shows on next login — responses will appear here as
              the team answers.
            </p>
          </div>
        </div>
      )}

      {hasAnyData && (
        <>
          {/* Current month summary */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Current eNPS"
              value={formatEnps(latest?.enps ?? null)}
              subtitle={latest ? formatMonthLabel(latest.month) : "—"}
            />
            <MetricCard
              label="Avg score"
              value={
                latest?.average != null ? latest.average.toFixed(1) : "—"
              }
              subtitle={
                latest?.responseCount
                  ? `${latest.responseCount} responses`
                  : "No responses"
              }
            />
            <MetricCard
              label="Response rate"
              value={
                responseRate.rate != null
                  ? `${Math.round(responseRate.rate * 100)}%`
                  : "—"
              }
              subtitle={`${responseRate.responded} of ${responseRate.prompted} prompted`}
            />
            <MetricCard
              label="Breakdown"
              value={
                latest
                  ? `${latest.promoters}·${latest.passives}·${latest.detractors}`
                  : "—"
              }
              subtitle="Promoters · Passives · Detractors"
            />
          </section>

          {/* eNPS trend */}
          <section className="space-y-6">
            <SectionDivider
              title="eNPS Trend"
              subtitle="Monthly score: % promoters (9–10) minus % detractors (0–6)"
            />
            {enpsTrend.length > 0 ? (
              <ColumnChart
                data={enpsTrend}
                title="eNPS by Month"
                subtitle="Range −100 to 100"
                yLabel="eNPS"
                yFormatType="number"
                color="#3b3bba"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Not enough responses yet for a trend.
              </p>
            )}
          </section>

          {/* Average score */}
          <section className="space-y-6">
            <SectionDivider
              title="Average Score"
              subtitle="Monthly average (0–10)"
            />
            <ColumnChart
              data={averageTrend}
              title="Average happiness"
              subtitle="Out of 10"
              yLabel="Score"
              yFormatType="number"
              color="oklch(0.6 0.15 25)"
            />
          </section>

          {/* Distribution for the current month */}
          <section className="space-y-6">
            <SectionDivider
              title="This Month's Distribution"
              subtitle={`Score counts for ${formatMonthLabel(month)}`}
            />
            <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
              <div className="mb-6 flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-foreground">
                  Responses by score
                </h3>
                <span className="text-xs text-muted-foreground">
                  0 = not happy, 10 = love it here
                </span>
              </div>
              <DistributionBars buckets={distribution} />
            </div>
          </section>

          {/* All respondents this month, grouped by band */}
          <section className="space-y-6">
            <SectionDivider
              title="This Month's Respondents"
              subtitle={`Every score for ${formatMonthLabel(month)}, grouped by band. Click a card to open the person's profile.`}
            />
            {monthResponses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No responses yet this month.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <RespondentColumn
                  title="Detractors"
                  subtitle="Score 0–6"
                  band="detractor"
                  responses={monthResponses}
                  employeeByClerkId={employeeByClerkId}
                />
                <RespondentColumn
                  title="Passives"
                  subtitle="Score 7–8"
                  band="passive"
                  responses={monthResponses}
                  employeeByClerkId={employeeByClerkId}
                />
                <RespondentColumn
                  title="Promoters"
                  subtitle="Score 9–10"
                  band="promoter"
                  responses={monthResponses}
                  employeeByClerkId={employeeByClerkId}
                />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function formatEnps(enps: number | null): string {
  if (enps == null) return "—";
  return (enps >= 0 ? "+" : "") + enps.toFixed(0);
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function DistributionBars({
  buckets,
}: {
  buckets: { score: number; count: number }[];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const BAR_AREA_HEIGHT = 180;
  return (
    <div className="flex items-end gap-2">
      {buckets.map((b) => {
        const barHeight =
          b.count > 0 ? Math.max((b.count / max) * BAR_AREA_HEIGHT, 6) : 0;
        return (
          <div key={b.score} className="flex flex-1 flex-col items-center gap-2">
            <div
              className="flex w-full items-end justify-center"
              style={{ height: BAR_AREA_HEIGHT }}
            >
              <div
                className={`w-full rounded-t-md transition-all ${barTone(b.score)}`}
                style={{ height: barHeight }}
                title={`${b.count} response${b.count === 1 ? "" : "s"} at ${b.score}`}
              />
            </div>
            <div className="text-center">
              <div className="text-xs font-medium text-foreground">{b.score}</div>
              <div className="text-[10px] text-muted-foreground">{b.count}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function barTone(score: number): string {
  if (score >= 9) return "bg-positive/70";
  if (score >= 7) return "bg-primary/50";
  return "bg-destructive/60";
}

function toneFor(score: number): string {
  if (score >= 9) return "bg-positive/15 text-positive";
  if (score >= 7) return "bg-muted text-foreground";
  return "bg-destructive/10 text-destructive";
}

type Band = "promoter" | "passive" | "detractor";

function RespondentColumn({
  title,
  subtitle,
  band,
  responses,
  employeeByClerkId,
}: {
  title: string;
  subtitle: string;
  band: Band;
  responses: EnpsMonthlyResponse[];
  employeeByClerkId: Map<string, EmployeeSummary>;
}) {
  // For detractors we surface the lowest scores first (most alarming); for
  // promoters and passives we surface the highest first. Ties break by most
  // recent response.
  const sorted = responses
    .filter((r) => classify(r.score) === band)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return band === "detractor" ? a.score - b.score : b.score - a.score;
      }
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });

  return (
    <div className="flex min-h-32 flex-col gap-3 rounded-xl bg-card/50 p-4 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <span className="text-sm font-semibold text-foreground">
          {sorted.length}
        </span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">No responses in this band.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((r) => (
            <RespondentCard
              key={r.id}
              response={r}
              employee={employeeByClerkId.get(r.clerkUserId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RespondentCard({
  response,
  employee,
}: {
  response: EnpsMonthlyResponse;
  employee: EmployeeSummary | undefined;
}) {
  const header = (
    <div className="flex items-start gap-2.5">
      <span
        className={`inline-flex h-6 min-w-6 flex-shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-semibold ${toneFor(response.score)}`}
      >
        {response.score}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {employee?.name ?? "Unknown respondent"}
        </div>
        {employee ? (
          <div className="truncate text-[11px] text-muted-foreground">
            {[employee.jobTitle, employee.function].filter(Boolean).join(" · ") ||
              employee.email}
          </div>
        ) : (
          <div className="truncate text-[11px] text-muted-foreground">
            Not found in SSoT
          </div>
        )}
      </div>
      <time className="flex-shrink-0 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/80">
        {new Date(response.createdAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        })}
      </time>
    </div>
  );

  const body = response.reason ? (
    <p className="mt-2 whitespace-pre-wrap border-l-2 border-foreground/10 pl-2.5 text-xs text-muted-foreground">
      {response.reason}
    </p>
  ) : null;

  const cardClass =
    "block rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/5 transition-colors";

  if (employee) {
    return (
      <li>
        <Link
          href={`/dashboard/people/${employee.slug}`}
          className={`${cardClass} hover:bg-muted/60 hover:ring-foreground/20`}
        >
          {header}
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li className={cardClass}>
      {header}
      {body}
    </li>
  );
}
