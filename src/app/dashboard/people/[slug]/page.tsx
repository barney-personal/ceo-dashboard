import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionDivider } from "@/components/dashboard/section-divider";
import { ImpactRankCharts } from "@/components/dashboard/impact-rank-charts";
import { EngineerOkrCard } from "@/components/dashboard/engineer-okr-card";
import { EngineerPerformanceCard } from "@/components/dashboard/engineer-performance-card";
import { getPersonProfile } from "@/lib/data/person-profile";

function formatTenure(months: number | null): string {
  if (months === null) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}mo`;
  if (m === 0) return `${y}y`;
  return `${y}y ${m}mo`;
}

function formatDate(value: string | Date | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-GB", opts ?? { day: "numeric", month: "short", year: "numeric" });
}

export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }
  const { slug } = await params;
  const profile = await getPersonProfile(decodeURIComponent(slug));
  if (!profile) notFound();

  const {
    identity,
    slackEngagement,
    okrUpdatesByThem,
    squadOkrs,
    squadOkrsName,
    performance,
    engineering,
  } = profile;

  return (
    <div className="mx-auto min-w-0 max-w-none space-y-8">
      <Link
        href="/dashboard/slack"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Slack
      </Link>

      <PageHeader
        title={identity.name}
        description={[identity.jobTitle, identity.squad, identity.pillar]
          .filter(Boolean)
          .join(" · ")}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {identity.slackHandle && (
            <span className="rounded-full bg-muted px-2 py-0.5">@{identity.slackHandle}</span>
          )}
          {identity.githubLogin && (
            <a
              href={`https://github.com/${identity.githubLogin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono hover:text-primary"
            >
              {identity.githubLogin}
            </a>
          )}
          <a
            href={`mailto:${identity.email}`}
            className="rounded-full bg-muted px-2 py-0.5 hover:text-primary"
          >
            {identity.email}
          </a>
        </div>
      </PageHeader>

      {/* Identity strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <InfoTile label="Function" value={identity.function ?? "—"} />
        <InfoTile label="Manager" value={identity.manager ?? "—"} />
        <InfoTile label="Level" value={identity.level ?? "—"} />
        <InfoTile
          label="Started"
          value={identity.startDate ? formatDate(identity.startDate) : "—"}
          hint={identity.tenureMonths !== null ? `${formatTenure(identity.tenureMonths)} ago` : undefined}
        />
        <InfoTile
          label="Pillar"
          value={identity.pillar ?? "—"}
          hint={identity.squad ?? undefined}
        />
        <InfoTile
          label="Engineer"
          value={identity.isEngineer ? "Yes" : "No"}
          hint={
            identity.githubLogin
              ? `@${identity.githubLogin}`
              : identity.isEngineer
                ? "no GitHub linked"
                : undefined
          }
        />
      </div>

      {/* Slack engagement */}
      {slackEngagement && (
        <section className="space-y-4">
          <SectionDivider
            title="Slack engagement"
            subtitle="Tenure-normalised activity over the latest snapshot window"
          />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <InfoTile
              label="Engagement score"
              value={`${slackEngagement.engagementScore}/100`}
              hint="percentile composite"
            />
            <InfoTile
              label="Active days"
              value={`${Math.round(slackEngagement.activeDayRate * 100)}%`}
              hint={`${slackEngagement.daysActive} of ${slackEngagement.normalizationDays} normalised`}
            />
            <InfoTile
              label="Messages"
              value={slackEngagement.messagesPosted.toLocaleString()}
              hint={
                slackEngagement.channelShare !== null
                  ? `${Math.round(slackEngagement.channelShare * 100)}% in channels`
                  : undefined
              }
            />
            <InfoTile
              label="Msgs / active day"
              value={
                slackEngagement.daysActive === 0
                  ? "—"
                  : slackEngagement.msgsPerActiveDay.toFixed(1)
              }
            />
            <InfoTile
              label="Reactions"
              value={slackEngagement.reactionsAdded.toLocaleString()}
            />
            <InfoTile
              label="Last active"
              value={
                slackEngagement.daysSinceLastActive === null
                  ? "never"
                  : slackEngagement.daysSinceLastActive === 0
                    ? "today"
                    : `${slackEngagement.daysSinceLastActive}d ago`
              }
              hint={
                slackEngagement.lastActiveAt
                  ? formatDate(slackEngagement.lastActiveAt)
                  : undefined
              }
            />
          </div>
        </section>
      )}

      {/* Squad OKR performance */}
      {identity.squad && (
        <section className="space-y-4">
          <SectionDivider
            title="OKR performance"
            subtitle={
              squadOkrsName && squadOkrsName !== identity.squad
                ? `${squadOkrsName} — HiBob squad "${identity.squad}" maps to OKR squad "${squadOkrsName}"`
                : squadOkrsName ?? identity.squad
            }
          />
          {squadOkrs.length > 0 && (
            <OkrStatusStrip
              okrs={squadOkrs}
              authoredByThem={okrUpdatesByThem.length}
              authorName={identity.name}
            />
          )}
          <EngineerOkrCard
            squadName={squadOkrsName ?? identity.squad}
            okrs={squadOkrs}
          />
        </section>
      )}


      {/* Performance ratings */}
      {performance && (
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

      {/* Engineering impact — show a hint if they're an engineer without GitHub mapping */}
      {!engineering && identity.isEngineer && (
        <section className="space-y-4">
          <SectionDivider
            title="Engineering impact"
            subtitle="No GitHub activity available"
          />
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 px-6 text-center">
            <p className="text-xs text-muted-foreground">
              {identity.name} is an engineer per HiBob but has no GitHub mapping
              in <code className="rounded bg-muted px-1">github_employee_map</code>.
              Link a GitHub login to see PRs, commits, and weekly impact.
            </p>
          </div>
        </section>
      )}

      {/* Engineering impact — focused on the Impact score and monthly rank */}
      {engineering && (
        <section className="space-y-4">
          <SectionDivider
            title="Engineering impact"
            subtitle={`PRs × log₂(1 + lines/PR), ranked monthly across all engineers · ${formatDate(engineering.windowStart)} → ${formatDate(engineering.windowEnd)}`}
          />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InfoTile
              label="Impact score"
              value={engineering.impactScoreTotal.toLocaleString()}
              hint={`${engineering.prsCount.toLocaleString()} PRs · ${engineering.commitsCount.toLocaleString()} commits`}
            />
            <InfoTile
              label="Best rank"
              value={engineering.bestRank !== null ? `#${engineering.bestRank}` : "—"}
              hint={
                engineering.monthly.length > 0
                  ? `of ${Math.max(
                      ...engineering.monthly.map((m) => m.totalEngineers),
                    )} engineers`
                  : undefined
              }
            />
            <InfoTile
              label="Avg rank"
              value={engineering.averageRank !== null ? `#${engineering.averageRank}` : "—"}
              hint={
                engineering.monthly.filter((m) => m.rank !== null).length > 0
                  ? `over ${engineering.monthly.filter((m) => m.rank !== null).length} active months`
                  : undefined
              }
            />
            <InfoTile
              label="Lines changed"
              value={(engineering.additions + engineering.deletions).toLocaleString()}
              hint={`+${engineering.additions.toLocaleString()} / −${engineering.deletions.toLocaleString()}`}
            />
          </div>
          <ImpactRankCharts monthly={engineering.monthly} />
        </section>
      )}
    </div>
  );
}

const STATUS_META: Record<
  string,
  { label: string; dot: string; text: string; bg: string }
> = {
  on_track: {
    label: "On track",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    bg: "bg-emerald-500/10",
  },
  at_risk: {
    label: "At risk",
    dot: "bg-amber-500",
    text: "text-amber-700",
    bg: "bg-amber-500/10",
  },
  behind: {
    label: "Behind",
    dot: "bg-rose-500",
    text: "text-rose-700",
    bg: "bg-rose-500/10",
  },
  completed: {
    label: "Completed",
    dot: "bg-primary",
    text: "text-primary",
    bg: "bg-primary/10",
  },
  not_started: {
    label: "Not started",
    dot: "bg-slate-400",
    text: "text-slate-600",
    bg: "bg-slate-500/10",
  },
};

function OkrStatusStrip({
  okrs,
  authoredByThem,
  authorName,
}: {
  okrs: Array<{ status: string }>;
  authoredByThem: number;
  authorName: string;
}) {
  const counts = new Map<string, number>();
  for (const o of okrs) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
  const total = okrs.length;
  const order = ["on_track", "at_risk", "behind", "completed", "not_started"];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card px-5 py-3 shadow-warm">
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
        {total} KR{total === 1 ? "" : "s"}
      </span>
      {order.map((k) => {
        const n = counts.get(k) ?? 0;
        if (n === 0) return null;
        const meta = STATUS_META[k];
        if (!meta) return null;
        return (
          <span
            key={k}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${meta.bg} ${meta.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {n} {meta.label.toLowerCase()}
          </span>
        );
      })}
      {authoredByThem > 0 && (
        <span className="ml-auto text-[11px] text-muted-foreground">
          {authorName} authored {authoredByThem} update{authoredByThem === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

function InfoTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 shadow-warm">
      <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
        {label}
      </p>
      <p
        className="mt-1 truncate font-medium text-foreground"
        title={value}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={hint}>{hint}</p>}
    </div>
  );
}
