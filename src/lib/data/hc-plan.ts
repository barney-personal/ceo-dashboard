import hcPlanData from "@/data/hc-plan.json";

export interface HcPlanTeam {
  department: string;
  team: string;
  type: string;
  currentEmployees: number;
  hiredOfferOut: number;
  inPipeline: number;
  t2Hire: number;
  totalHc: number;
  pctTotalHc: number;
  decisions: string | null;
}

export interface HcPlanSnapshot {
  snapshotDate: string;
  source: string;
  sourceTab: string;
  note: string;
  teams: HcPlanTeam[];
}

export interface HcPlanDepartment {
  department: string;
  teams: HcPlanTeam[];
  currentEmployees: number;
  hiredOfferOut: number;
  inPipeline: number;
  t2Hire: number;
  totalHc: number;
}

export interface HcPlanTotals {
  currentEmployees: number;
  hiredOfferOut: number;
  inPipeline: number;
  t2Hire: number;
  totalHc: number;
}

const snapshot = hcPlanData as HcPlanSnapshot;

// Excluded so totals are comparable to Mode SSoT, which strips part-time
// Customer Champions. Engineering (Temp) is intentionally NOT excluded —
// it's a temporary landing squad for new engineers awaiting permanent
// assignment, so its planned hires represent real net-new headcount.
const EXCLUDED_DEPARTMENTS = new Set<string>(["Customer Success"]);

function getIncludedTeams(): HcPlanTeam[] {
  return snapshot.teams.filter((t) => !EXCLUDED_DEPARTMENTS.has(t.department));
}

export function getHcPlan(): HcPlanSnapshot {
  return { ...snapshot, teams: getIncludedTeams() };
}

export function getHcPlanTotals(): HcPlanTotals {
  return getIncludedTeams().reduce<HcPlanTotals>(
    (acc, t) => ({
      currentEmployees: acc.currentEmployees + t.currentEmployees,
      hiredOfferOut: acc.hiredOfferOut + t.hiredOfferOut,
      inPipeline: acc.inPipeline + t.inPipeline,
      t2Hire: acc.t2Hire + t.t2Hire,
      totalHc: acc.totalHc + t.totalHc,
    }),
    { currentEmployees: 0, hiredOfferOut: 0, inPipeline: 0, t2Hire: 0, totalHc: 0 }
  );
}

export interface ModePillarSummary {
  name: string;
  count: number;
}

export interface ReconciledPillar {
  pillar: string;
  /** Live current count from Mode SSoT (the "Today" baseline). */
  currentEmployees: number;
  /** Sheet-derived deltas, joined to this pillar by normalized name. */
  hiredOfferOut: number;
  inPipeline: number;
  t2Hire: number;
  /** currentEmployees + all sheet deltas. */
  totalHc: number;
  /** Sheet team rows that contributed to this pillar's deltas. */
  teams: HcPlanTeam[];
  /** True if a sheet department was matched to this Mode pillar. */
  matchedSheet: boolean;
}

export interface ReconciledPillarBreakdown {
  pillars: ReconciledPillar[];
  /** Sheet departments with planned hires that didn't match any Mode pillar. */
  unmatchedSheetDepartments: HcPlanDepartment[];
  totals: HcPlanTotals;
}

function normalizePillarKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Build the planned-view per-pillar breakdown by joining live Mode SSoT
 * pillar counts (the "Today" baseline) with sheet-derived planned deltas
 * (hired/offer + pipeline + T2). Match is by normalized pillar name.
 *
 * Mode pillars with no matching sheet department appear with zero deltas
 * (no planned hires). Sheet departments with no matching Mode pillar are
 * surfaced separately so we don't silently lose hires.
 */
export function reconcileHcPlanByPillar(
  modePillars: ModePillarSummary[]
): ReconciledPillarBreakdown {
  const teamsByDeptKey = new Map<string, HcPlanTeam[]>();
  const departmentByKey = new Map<string, string>();
  for (const team of getIncludedTeams()) {
    const key = normalizePillarKey(team.department);
    const existing = teamsByDeptKey.get(key) ?? [];
    existing.push(team);
    teamsByDeptKey.set(key, existing);
    departmentByKey.set(key, team.department);
  }

  const matchedKeys = new Set<string>();
  const pillars: ReconciledPillar[] = modePillars.map((mp) => {
    const key = normalizePillarKey(mp.name);
    const teams = teamsByDeptKey.get(key) ?? [];
    if (teams.length > 0) matchedKeys.add(key);
    const deltas = teams.reduce(
      (acc, t) => ({
        hiredOfferOut: acc.hiredOfferOut + t.hiredOfferOut,
        inPipeline: acc.inPipeline + t.inPipeline,
        t2Hire: acc.t2Hire + t.t2Hire,
      }),
      { hiredOfferOut: 0, inPipeline: 0, t2Hire: 0 }
    );
    const totalHc =
      mp.count + deltas.hiredOfferOut + deltas.inPipeline + deltas.t2Hire;
    return {
      pillar: mp.name,
      currentEmployees: mp.count,
      ...deltas,
      totalHc,
      teams: teams.sort((a, b) => b.totalHc - a.totalHc),
      matchedSheet: teams.length > 0,
    };
  });

  const unmatchedSheetDepartments: HcPlanDepartment[] = [];
  for (const [key, teams] of teamsByDeptKey.entries()) {
    if (matchedKeys.has(key)) continue;
    const deltas = teams.reduce(
      (acc, t) => ({
        currentEmployees: acc.currentEmployees + t.currentEmployees,
        hiredOfferOut: acc.hiredOfferOut + t.hiredOfferOut,
        inPipeline: acc.inPipeline + t.inPipeline,
        t2Hire: acc.t2Hire + t.t2Hire,
        totalHc: acc.totalHc + t.totalHc,
      }),
      { currentEmployees: 0, hiredOfferOut: 0, inPipeline: 0, t2Hire: 0, totalHc: 0 }
    );
    if (deltas.hiredOfferOut + deltas.inPipeline + deltas.t2Hire === 0) continue;
    unmatchedSheetDepartments.push({
      department: departmentByKey.get(key) ?? key,
      teams: teams.sort((a, b) => b.totalHc - a.totalHc),
      ...deltas,
    });
  }
  unmatchedSheetDepartments.sort((a, b) => b.totalHc - a.totalHc);

  pillars.sort((a, b) => b.totalHc - a.totalHc);

  const totals = pillars.reduce<HcPlanTotals>(
    (acc, p) => ({
      currentEmployees: acc.currentEmployees + p.currentEmployees,
      hiredOfferOut: acc.hiredOfferOut + p.hiredOfferOut,
      inPipeline: acc.inPipeline + p.inPipeline,
      t2Hire: acc.t2Hire + p.t2Hire,
      totalHc: acc.totalHc + p.totalHc,
    }),
    { currentEmployees: 0, hiredOfferOut: 0, inPipeline: 0, t2Hire: 0, totalHc: 0 }
  );
  // Add unmatched sheet deltas to totals so headline numbers don't lose hires.
  for (const u of unmatchedSheetDepartments) {
    totals.hiredOfferOut += u.hiredOfferOut;
    totals.inPipeline += u.inPipeline;
    totals.t2Hire += u.t2Hire;
    totals.totalHc += u.hiredOfferOut + u.inPipeline + u.t2Hire;
  }

  return { pillars, unmatchedSheetDepartments, totals };
}

export function groupHcPlanByDepartment(): HcPlanDepartment[] {
  const byDept = new Map<string, HcPlanTeam[]>();
  for (const team of getIncludedTeams()) {
    const existing = byDept.get(team.department) ?? [];
    existing.push(team);
    byDept.set(team.department, existing);
  }

  const departments: HcPlanDepartment[] = [];
  for (const [department, teams] of byDept.entries()) {
    const totals = teams.reduce(
      (acc, t) => ({
        currentEmployees: acc.currentEmployees + t.currentEmployees,
        hiredOfferOut: acc.hiredOfferOut + t.hiredOfferOut,
        inPipeline: acc.inPipeline + t.inPipeline,
        t2Hire: acc.t2Hire + t.t2Hire,
        totalHc: acc.totalHc + t.totalHc,
      }),
      { currentEmployees: 0, hiredOfferOut: 0, inPipeline: 0, t2Hire: 0, totalHc: 0 }
    );
    departments.push({
      department,
      teams: teams.sort((a, b) => b.totalHc - a.totalHc),
      ...totals,
    });
  }

  return departments.sort((a, b) => b.totalHc - a.totalHc);
}
