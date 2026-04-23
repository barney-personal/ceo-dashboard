import { safeLoad } from "@/lib/data/data-state";
import { getActiveEmployees, type Person } from "@/lib/data/people";
import { getHeadcountMetrics } from "@/lib/data/metrics";
import { getLatestLtvCacRatio, getLatestMAU } from "@/lib/data/chart-data";
import { getLatestARR } from "@/lib/data/management-accounts";
import { getLatestOkrUpdates, type OkrSummary } from "@/lib/data/okrs";
import type { Role } from "@/lib/auth/roles";

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
}

export interface BriefingOkrBlock {
  total: number;
  onTrack: number;
  atRisk: number;
  behind: number;
  notStarted: number;
  recent: BriefingOkrEntry[];
}

export interface BriefingContext {
  person: BriefingPerson | null;
  company: BriefingCompanyMetrics;
  pillarOkrs: BriefingOkrBlock;
  squadOkrs: BriefingOkrEntry[];
  generatedAtIso: string;
}

const OKR_WINDOW_DAYS = 14;
const MAX_PILLAR_OKR_ENTRIES = 10;
const MAX_SQUAD_OKR_ENTRIES = 6;

function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || fullName;
}

function countDirectReports(employees: Person[], managerEmail: string): number {
  const lower = managerEmail.toLowerCase();
  return employees.filter((p) => p.manager.toLowerCase() === lower).length;
}

function okrToEntry(okr: OkrSummary): BriefingOkrEntry {
  return {
    squad: okr.squadName,
    objective: okr.objectiveName,
    kr: okr.krName,
    status: okr.status,
    actual: okr.actual,
    target: okr.target,
    postedAtIso: okr.postedAt.toISOString(),
  };
}

function summarisePillarOkrs(okrs: OkrSummary[]): BriefingOkrBlock {
  const cutoff = Date.now() - OKR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = okrs
    .filter((o) => o.postedAt.getTime() >= cutoff)
    .sort((a, b) => {
      // Prioritise at-risk / behind first, then most recent.
      const severity = (s: string) =>
        s === "behind" ? 0 : s === "at_risk" ? 1 : s === "not_started" ? 2 : 3;
      const sev = severity(a.status) - severity(b.status);
      if (sev !== 0) return sev;
      return b.postedAt.getTime() - a.postedAt.getTime();
    })
    .slice(0, MAX_PILLAR_OKR_ENTRIES)
    .map(okrToEntry);

  return {
    total: okrs.length,
    onTrack: okrs.filter((o) => o.status === "on_track").length,
    atRisk: okrs.filter((o) => o.status === "at_risk").length,
    behind: okrs.filter((o) => o.status === "behind").length,
    notStarted: okrs.filter((o) => o.status === "not_started").length,
    recent,
  };
}

function summariseSquadOkrs(
  allPillarOkrs: OkrSummary[],
  squad: string,
): BriefingOkrEntry[] {
  const lowered = squad.toLowerCase();
  return allPillarOkrs
    .filter((o) => o.squadName.toLowerCase() === lowered)
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
    .slice(0, MAX_SQUAD_OKR_ENTRIES)
    .map(okrToEntry);
}

/**
 * Gather the personalised context for a user's daily briefing.
 *
 * Reads are all tolerated failures: if any source is offline, the briefing
 * still generates — the LLM is prompted to acknowledge what it doesn't have.
 */
export async function getBriefingContext({
  email,
  role,
}: {
  email: string;
  role: Role;
}): Promise<BriefingContext> {
  const lowerEmail = email.toLowerCase();

  const [
    employeesResult,
    headcountResult,
    ltvCacResult,
    mauResult,
    arrResult,
    okrsResult,
  ] = await Promise.all([
    safeLoad(() => getActiveEmployees(), null),
    safeLoad(() => getHeadcountMetrics(), null),
    safeLoad(() => getLatestLtvCacRatio(), null),
    safeLoad(() => getLatestMAU(), null),
    safeLoad(() => getLatestARR(), null),
    safeLoad(() => getLatestOkrUpdates(), new Map<string, OkrSummary[]>()),
  ]);

  const allEmployees = employeesResult.data?.employees ?? [];
  const me =
    allEmployees.find((p) => p.email.toLowerCase() === lowerEmail) ??
    employeesResult.data?.unassigned.find(
      (p) => p.email.toLowerCase() === lowerEmail,
    ) ??
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

  const okrsByPillar = okrsResult.data ?? new Map<string, OkrSummary[]>();
  const pillarKey = person?.pillar ?? "";
  const pillarOkrs = okrsByPillar.get(pillarKey) ?? [];

  const company: BriefingCompanyMetrics = {
    ltvPaidCacRatio: ltvCacResult.data ?? null,
    mau: mauResult.data ?? null,
    headcount: headcountResult.data?.total ?? null,
    arrUsd: arrResult.data?.value ?? null,
  };

  return {
    person,
    company,
    pillarOkrs: summarisePillarOkrs(pillarOkrs),
    squadOkrs: person ? summariseSquadOkrs(pillarOkrs, person.squad) : [],
    generatedAtIso: new Date().toISOString(),
  };
}
