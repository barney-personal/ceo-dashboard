import type { OkrSummary } from "@/lib/data/okrs";
import type { Role } from "@/lib/auth/roles";

/**
 * Pure helpers for briefing-context.ts. Extracted into a leaf module with no
 * Anthropic/DB/Slack dependencies so the unit tests can import them without
 * dragging in the LLM SDKs that error under vitest's browser-like environment.
 */

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

const OKR_WINDOW_DAYS = 14;
const MAX_PILLAR_OKR_ENTRIES = 8;
const MAX_SQUAD_OKR_ENTRIES = 10;

export function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || fullName;
}

/**
 * Normalise a pillar name for matching. Headcount uses "Growth Pillar",
 * OKRs use "Growth". Also OKRs sometimes combine pillars into one key like
 * "Access, Trust & Money, Risk & Payments".
 */
export function normalisePillar(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bpillar\b/g, "")
    .replace(/\bdecisioning\b/g, "")
    .replace(/\bproducts?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function okrKeyMatchesPersonPillar(
  okrKey: string,
  personPillar: string,
): boolean {
  const target = normalisePillar(personPillar);
  if (!target) return false;
  const okrNorm = normalisePillar(okrKey);
  if (okrNorm === target) return true;
  return new RegExp(`(^|\\s)${target}($|\\s)`).test(okrNorm);
}

export function collectOkrsForPillar(
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

function severityRank(status: string): number {
  return status === "behind"
    ? 0
    : status === "at_risk"
      ? 1
      : status === "not_started"
        ? 2
        : 3;
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

export function summarisePillarOkrs(
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

export function summariseSquadOkrs(
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
 * Role/function → dashboard section labels the LLM is allowed to reference
 * in its closing paragraph. Labels must match the sidebar exactly so anchors
 * are meaningful to the reader.
 */
export function relevantSectionsFor(
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

  if (
    pillar.includes("growth") ||
    fn.includes("marketing") ||
    fn.includes("commercial")
  ) {
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

  if (
    fn.includes("engineering") ||
    fn.includes("machine learning") ||
    fn.includes("data")
  ) {
    sections.add("Engineering");
  }

  if (
    fn.includes("people") ||
    fn.includes("talent") ||
    pillar.includes("people")
  ) {
    sections.add("Org");
    sections.add("Talent");
  }

  sections.add("OKRs");
  return [...sections];
}
