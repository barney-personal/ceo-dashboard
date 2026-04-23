import * as Sentry from "@sentry/nextjs";
import { getActiveEmployees } from "@/lib/data/people";
import { getHeadcountMetrics } from "@/lib/data/metrics";
import { getLatestLtvCacRatio, getLatestMAU } from "@/lib/data/chart-data";
import { getLatestARR } from "@/lib/data/management-accounts";
import { getLatestOkrUpdates, type OkrSummary } from "@/lib/data/okrs";
import { getMeetingsForRange } from "@/lib/data/meetings";
import { getDirectReportCountByAnyEmail } from "@/lib/data/managers";
import { getUserGoogleAccessToken } from "@/lib/auth/google-token.server";
import type { Role } from "@/lib/auth/roles";
import {
  collectOkrsForPillar,
  firstNameOf,
  relevantSectionsFor,
  summarisePillarOkrs,
  summariseSquadOkrs,
  type BriefingOkrBlock,
  type BriefingOkrEntry,
  type BriefingPerson,
} from "@/lib/data/briefing-helpers";

export type { BriefingOkrBlock, BriefingOkrEntry, BriefingPerson };

export interface BriefingCompanyMetrics {
  ltvPaidCacRatio: number | null;
  mau: number | null;
  headcount: number | null;
  arrUsd: number | null;
}

export interface BriefingMeetings {
  todayCount: number;
  firstTitle: string | null;
  firstStartTimeIso: string | null;
}

export interface BriefingContext {
  person: BriefingPerson | null;
  company: BriefingCompanyMetrics;
  pillarOkrs: BriefingOkrBlock;
  squadOkrs: BriefingOkrBlock;
  meetings: BriefingMeetings | null;
  relevantDashboardSections: string[];
  generatedAtIso: string;
}

/**
 * Like `safeLoad` but swallows any error, not just `DatabaseUnavailableError`.
 * The briefing pipeline intentionally degrades on any failure — a Slack or
 * management-accounts outage shouldn't kill the whole briefing for every
 * user. Errors still go to Sentry so they're not silently lost.
 */
async function tolerantLoad<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    Sentry.captureException(error, {
      tags: { integration: "llm-briefing" },
      extra: { step: "tolerantLoad", loader: label },
      level: "warning",
    });
    return fallback;
  }
}

async function loadTodayMeetings({
  userId,
}: {
  userId: string | null;
}): Promise<BriefingMeetings | null> {
  if (!userId) return null;

  let accessToken: string | null;
  try {
    accessToken = await getUserGoogleAccessToken(userId);
  } catch {
    return null;
  }
  if (!accessToken) return null;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  try {
    const result = await getMeetingsForRange(todayStart, todayEnd, {
      accessToken,
      userId,
    });
    if (result.calendarAuthExpired) return null;
    const day = result.days[0];
    if (!day) return { todayCount: 0, firstTitle: null, firstStartTimeIso: null };

    const upcoming = day.meetings
      .filter((m) => new Date(m.startTime).getTime() >= now.getTime() - 5 * 60_000)
      .sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );
    const first = upcoming[0] ?? null;
    return {
      todayCount: day.meetings.length,
      firstTitle: first?.title ?? null,
      firstStartTimeIso: first?.startTime ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Gather the personalised context for a user's daily briefing.
 *
 * Reads are all tolerated failures: if any source is offline, the briefing
 * still generates — the LLM is prompted to acknowledge what it doesn't have.
 */
export async function getBriefingContext({
  emails,
  role,
  userId,
}: {
  /**
   * Candidate emails to match against the Headcount SSoT. Pass the user's
   * full email set from Clerk so a secondary company email still resolves
   * to their SSoT row. Order is preference-for-cache-key only — matching
   * iterates all of them.
   */
  emails: string[];
  role: Role;
  userId?: string | null;
}): Promise<BriefingContext> {
  const candidateEmails = emails.map((e) => e.toLowerCase());
  const candidateSet = new Set(candidateEmails);

  const [
    employees,
    headcount,
    ltvCac,
    mau,
    arr,
    okrsByPillar,
    meetings,
    directReportCount,
  ] = await Promise.all([
    tolerantLoad("getActiveEmployees", () => getActiveEmployees(), null),
    tolerantLoad("getHeadcountMetrics", () => getHeadcountMetrics(), null),
    tolerantLoad("getLatestLtvCacRatio", () => getLatestLtvCacRatio(), null),
    tolerantLoad("getLatestMAU", () => getLatestMAU(), null),
    tolerantLoad("getLatestARR", () => getLatestARR(), null),
    tolerantLoad(
      "getLatestOkrUpdates",
      () => getLatestOkrUpdates(),
      new Map<string, OkrSummary[]>(),
    ),
    loadTodayMeetings({ userId: userId ?? null }),
    tolerantLoad(
      "getDirectReportCountByAnyEmail",
      () => getDirectReportCountByAnyEmail(candidateEmails),
      0,
    ),
  ]);

  const allEmployees = employees?.employees ?? [];
  const me =
    allEmployees.find((p) => candidateSet.has(p.email.toLowerCase())) ??
    employees?.unassigned.find((p) => candidateSet.has(p.email.toLowerCase())) ??
    null;

  const person: BriefingPerson | null = me
    ? {
        firstName: firstNameOf(me.name),
        fullName: me.name,
        email: me.email,
        jobTitle: me.jobTitle,
        squad: me.squad,
        pillar: me.pillar,
        function: me.function,
        tenureMonths: me.tenureMonths,
        role,
        directReportCount,
      }
    : null;

  const pillarLevelOkrs = person
    ? collectOkrsForPillar(okrsByPillar, person.pillar)
    : [];

  const company: BriefingCompanyMetrics = {
    ltvPaidCacRatio: ltvCac ?? null,
    mau: mau ?? null,
    headcount: headcount?.total ?? null,
    arrUsd: arr?.value ?? null,
  };

  const personSquad = person?.squad ?? "";
  return {
    person,
    company,
    pillarOkrs: summarisePillarOkrs(pillarLevelOkrs, personSquad),
    squadOkrs: summariseSquadOkrs(pillarLevelOkrs, personSquad),
    meetings,
    relevantDashboardSections: relevantSectionsFor(role, person),
    generatedAtIso: new Date().toISOString(),
  };
}
