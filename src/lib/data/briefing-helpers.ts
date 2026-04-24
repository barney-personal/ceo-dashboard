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

export interface BriefingShip {
  repo: string;
  title: string;
  authorName: string;
  mergedAtIso: string;
}

export interface BriefingShipsBlock {
  windowDays: number;
  squadName: string;
  prCount: number;
  authorCount: number;
  /** Most recent ships first, capped. May be empty when the squad shipped
   * nothing in the window. */
  top: BriefingShip[];
}

/** Candidate flag row — direct report, ranking position, confidence bound. */
export interface BriefingManagerFlag {
  name: string;
  rank: number | null;
  /** `adjustedPercentile` from the persisted ranking snapshot (0–100). */
  percentile: number | null;
  /** Upper bound of the 80% CI in composite-percentile space (0–100). */
  confidenceHigh: number | null;
  squad: string | null;
  snapshotDate: string;
}

export interface BriefingManagerFlagsBlock {
  snapshotDate: string;
  /** How many direct reports had a row in the latest snapshot slice. */
  totalReportsChecked: number;
  /** Reports worth investigating. Empty means "none cleared the threshold." */
  flagged: BriefingManagerFlag[];
}

/**
 * Percentile ceiling for the "worth a look" flag. Confidence-bound <= this
 * value means even the upper band of the CI still sits in the bottom third —
 * a noisy bottom-decile engineer with a CI reaching mid-cohort won't fire.
 */
export const MANAGER_FLAG_PERCENTILE_CEILING = 20;
export const MANAGER_FLAG_CI_HIGH_CEILING = 35;
const MAX_MANAGER_FLAGS = 3;

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

/**
 * Reduce a list of squad ships to the most recent N, preferring one PR per
 * author so a single prolific committer doesn't crowd out other contributors.
 * When fewer than `limit` unique authors exist in the window, remaining slots
 * fill with additional recent ships by already-represented authors.
 */
export function pickTopShips(
  ships: BriefingShip[],
  limit: number,
): BriefingShip[] {
  const sorted = [...ships].sort(
    (a, b) => new Date(b.mergedAtIso).getTime() - new Date(a.mergedAtIso).getTime(),
  );
  const seenAuthors = new Set<string>();
  const primary: BriefingShip[] = [];
  const secondary: BriefingShip[] = [];
  for (const s of sorted) {
    if (seenAuthors.has(s.authorName)) {
      secondary.push(s);
    } else {
      seenAuthors.add(s.authorName);
      primary.push(s);
    }
  }
  return [...primary, ...secondary].slice(0, limit);
}

/**
 * Apply the confidence-aware threshold to manager-flag candidates and return
 * the top N sorted by severity (lowest percentile first). Pure so the test
 * suite can exercise it without a DB fixture.
 */
export function applyManagerFlagThreshold(
  candidates: BriefingManagerFlag[],
): BriefingManagerFlag[] {
  return candidates
    .filter(
      (c) =>
        c.percentile !== null &&
        c.percentile <= MANAGER_FLAG_PERCENTILE_CEILING &&
        c.confidenceHigh !== null &&
        c.confidenceHigh <= MANAGER_FLAG_CI_HIGH_CEILING,
    )
    .sort((a, b) => (a.percentile ?? 0) - (b.percentile ?? 0))
    .slice(0, MAX_MANAGER_FLAGS);
}
