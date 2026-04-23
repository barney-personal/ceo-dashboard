import * as Sentry from "@sentry/nextjs";
import { getActiveEmployees, type Person } from "@/lib/data/people";
import { getHeadcountMetrics } from "@/lib/data/metrics";
import { getLatestLtvCacRatio, getLatestMAU } from "@/lib/data/chart-data";
import { getLatestARR } from "@/lib/data/management-accounts";
import { getLatestOkrUpdates, type OkrSummary } from "@/lib/data/okrs";
import { getMeetingsForRange } from "@/lib/data/meetings";
import { getUserGoogleAccessToken } from "@/lib/auth/google-token.server";
import type { Role } from "@/lib/auth/roles";

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

export interface BriefingPerson {
  firstName: string;
  fullName: string;
  email: string;
  jobTitle: string;
  squad: string;
  pillar: string;
  function: string;
  tenureMonths: number;
  role: Role;
  directReportCount: number;
}

export interface BriefingCompanyMetrics {
  ltvPaidCacRatio: number | null;
  mau: number | null;
  headcount: number | null;
  arrUsd: number | null;
}

export interface BriefingOkrEntry {
  squad: string;
  objective: string;
  kr: string;
  status: string;
  actual: string | null;
  target: string | null;
  postedAtIso: string;
  isSameSquad: boolean;
}

export interface BriefingOkrBlock {
  total: number;
  onTrack: number;
  atRisk: number;
  behind: number;
  notStarted: number;
  recent: BriefingOkrEntry[];
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

const OKR_WINDOW_DAYS = 14;
const MAX_PILLAR_OKR_ENTRIES = 8;
const MAX_SQUAD_OKR_ENTRIES = 10;

function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || fullName;
}

function countDirectReports(employees: Person[], managerEmail: string): number {
  const lower = managerEmail.toLowerCase();
  return employees.filter((p) => p.manager.toLowerCase() === lower).length;
}

/**
 * Normalise a pillar name for matching. Headcount uses "Growth Pillar",
 * OKRs use "Growth". Also OKRs sometimes combine pillars into one key like
 * "Access, Trust & Money, Risk & Payments".
 */
function normalisePillar(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bpillar\b/g, "")
    .replace(/\bdecisioning\b/g, "")
    .replace(/\bproducts?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function okrKeyMatchesPersonPillar(okrKey: string, personPillar: string): boolean {
  const target = normalisePillar(personPillar);
  if (!target) return false;
  const okrNorm = normalisePillar(okrKey);
  if (okrNorm === target) return true;
  return new RegExp(`(^|\\s)${target}($|\\s)`).test(okrNorm);
}

function collectOkrsForPillar(
  okrsByPillar: Map<string, OkrSummary[]>,
  personPillar: string,
): OkrSummary[] {
  const matched: OkrSummary[] = [];
  for (const [key, okrs] of okrsByPillar.entries()) {
    if (okrKeyMatchesPersonPillar(key, personPillar)) {
      matched.push(...okrs);
    }
  }
  return matched;
}

function okrToEntry(okr: OkrSummary, personSquad: string): BriefingOkrEntry {
  return {
    squad: okr.squadName,
    objective: okr.objectiveName,
    kr: okr.krName,
    status: okr.status,
    actual: okr.actual,
    target: okr.target,
    postedAtIso: okr.postedAt.toISOString(),
    isSameSquad: okr.squadName.toLowerCase() === personSquad.toLowerCase(),
  };
}

function severityRank(status: string): number {
  return status === "behind" ? 0 : status === "at_risk" ? 1 : status === "not_started" ? 2 : 3;
}

function countsFor(okrs: OkrSummary[]): Omit<BriefingOkrBlock, "recent"> {
  return {
    total: okrs.length,
    onTrack: okrs.filter((o) => o.status === "on_track").length,
    atRisk: okrs.filter((o) => o.status === "at_risk").length,
    behind: okrs.filter((o) => o.status === "behind").length,
    notStarted: okrs.filter((o) => o.status === "not_started").length,
  };
}

function summarisePillarOkrs(
  okrs: OkrSummary[],
  personSquad: string,
): BriefingOkrBlock {
  const cutoff = Date.now() - OKR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Pillar block excludes the reader's own squad — squadOkrs covers those
  // separately so the LLM can speak about "your squad" vs "your pillar"
  // without double-mentioning the same KRs.
  const siblings = okrs.filter(
    (o) => o.squadName.toLowerCase() !== personSquad.toLowerCase(),
  );
  const recent = siblings
    .filter((o) => o.postedAt.getTime() >= cutoff)
    .sort((a, b) => {
      const sev = severityRank(a.status) - severityRank(b.status);
      if (sev !== 0) return sev;
      return b.postedAt.getTime() - a.postedAt.getTime();
    })
    .slice(0, MAX_PILLAR_OKR_ENTRIES)
    .map((o) => okrToEntry(o, personSquad));
  return { ...countsFor(siblings), recent };
}

function summariseSquadOkrs(
  allPillarOkrs: OkrSummary[],
  personSquad: string,
): BriefingOkrBlock {
  const lowered = personSquad.toLowerCase();
  const squadOkrs = allPillarOkrs.filter(
    (o) => o.squadName.toLowerCase() === lowered,
  );
  const recent = squadOkrs
    .sort((a, b) => {
      const sev = severityRank(a.status) - severityRank(b.status);
      if (sev !== 0) return sev;
      return b.postedAt.getTime() - a.postedAt.getTime();
    })
    .slice(0, MAX_SQUAD_OKR_ENTRIES)
    .map((o) => okrToEntry(o, personSquad));
  return { ...countsFor(squadOkrs), recent };
}

/**
 * Lightweight role/function → dashboard sections map. The LLM uses these
 * names when suggesting what to look at. Keep the labels as they appear in
 * the sidebar so anchors are meaningful to the reader.
 */
function relevantSectionsFor(
  role: Role,
  person: BriefingPerson | null,
): string[] {
  const base = ["Overview"];
  if (!person) return base;

  const fn = person.function.toLowerCase();
  const pillar = person.pillar.toLowerCase();

  const sections = new Set<string>(base);

  if (role === "ceo" || role === "leadership") {
    sections.add("Financial");
  }

  // Growth / commercial-adjacent
  if (pillar.includes("growth") || fn.includes("marketing") || fn.includes("commercial")) {
    sections.add("Unit Economics");
  }

  if (
    pillar.includes("chat") ||
    pillar.includes("wealth") ||
    pillar.includes("credit") ||
    pillar.includes("new bets") ||
    fn.includes("product")
  ) {
    sections.add("Product");
    sections.add("OKRs");
  }

  if (fn.includes("engineering") || fn.includes("machine learning") || fn.includes("data")) {
    sections.add("Engineering");
  }

  if (fn.includes("people") || fn.includes("talent") || pillar.includes("people")) {
    sections.add("Org");
    sections.add("Talent");
  }

  sections.add("OKRs");
  return [...sections];
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
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
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
        directReportCount: countDirectReports(allEmployees, me.email),
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
