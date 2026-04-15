import { getReportData, rowStr, rowNum, rowNumOrNull } from "./mode";
import { getActiveEmployees, type Person } from "./people";

export interface PerformanceRating {
  reviewCycle: string;
  rating: number | null;
  reviewerName: string;
  flagged: boolean;
  missed: boolean;
}

export interface PersonPerformance {
  email: string;
  name: string;
  jobTitle: string;
  level: string;
  squad: string;
  pillar: string;
  function: string;
  ratings: PerformanceRating[];
}

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  missed: number;
  flagged: number;
  total: number;
}

export interface PerformancePillarGroup {
  name: string;
  count: number;
  squads: { name: string; people: PersonPerformance[] }[];
}

export interface PerformanceFunctionGroup {
  name: string;
  people: PersonPerformance[];
}

export function getRatingDistribution(
  ratings: PerformanceRating[],
  cycle?: string,
): RatingDistribution {
  const filtered = cycle
    ? ratings.filter((r) => r.reviewCycle === cycle)
    : ratings;

  const dist: RatingDistribution = {
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
    missed: 0, flagged: 0, total: filtered.length,
  };

  for (const r of filtered) {
    if (r.rating !== null && r.rating >= 1 && r.rating <= 5) {
      dist[r.rating as 1 | 2 | 3 | 4 | 5]++;
    }
    if (r.missed) dist.missed++;
    if (r.flagged) dist.flagged++;
  }

  return dist;
}

export function transformPerformanceData(
  modeRows: Record<string, unknown>[],
  employees: Person[],
): { people: PersonPerformance[]; reviewCycles: string[] } {
  const employeeByEmail = new Map<string, Person>();
  for (const emp of employees) {
    employeeByEmail.set(emp.email.toLowerCase(), emp);
  }

  const byEmail = new Map<string, Record<string, unknown>[]>();
  const cycleSet = new Set<string>();

  for (const row of modeRows) {
    const email = rowStr(row, "employee_email").toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(row);
    const cycle = rowStr(row, "review_cycle_name");
    if (cycle) cycleSet.add(cycle);
  }

  // Lexicographic sort works because cycle names follow "YYYY H{1,2}-{A,B} ..."
  const reviewCycles = [...cycleSet].sort();
  const people: PersonPerformance[] = [];

  for (const [email, rows] of byEmail) {
    const emp = employeeByEmail.get(email);
    const func = rowStr(rows[0], "function");

    const ratings: PerformanceRating[] = rows
      .map((row) => ({
        reviewCycle: rowStr(row, "review_cycle_name"),
        rating: rowNumOrNull(row, "performance_rating"),
        reviewerName: rowStr(row, "reviewer_name"),
        flagged: rowNum(row, "flagged_review") === 1,
        missed: rowNum(row, "missed_review") === 1,
      }))
      .sort((a, b) => a.reviewCycle.localeCompare(b.reviewCycle));

    people.push({
      email: emp?.email ?? email,
      name: emp?.name ?? email,
      jobTitle: emp?.jobTitle ?? "",
      level: emp?.level ?? "",
      squad: emp?.squad ?? "",
      pillar: emp?.pillar ?? func,
      function: emp?.function ?? func,
      ratings,
    });
  }

  people.sort((a, b) => a.name.localeCompare(b.name));
  return { people, reviewCycles };
}

export function groupPerformanceByPillar(
  people: PersonPerformance[],
): PerformancePillarGroup[] {
  const withSquad = people.filter((p) => p.squad !== "");
  const byPillar = new Map<string, Map<string, PersonPerformance[]>>();

  for (const person of withSquad) {
    if (!byPillar.has(person.pillar)) byPillar.set(person.pillar, new Map());
    const squads = byPillar.get(person.pillar)!;
    if (!squads.has(person.squad)) squads.set(person.squad, []);
    squads.get(person.squad)!.push(person);
  }

  return [...byPillar.entries()]
    .map(([pillarName, squads]) => {
      const squadList = [...squads.entries()]
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([squadName, people]) => ({ name: squadName, people }));
      return {
        name: pillarName,
        count: squadList.reduce((s, sq) => s + sq.people.length, 0),
        squads: squadList,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function groupPerformanceByFunction(
  people: PersonPerformance[],
): PerformanceFunctionGroup[] {
  const byFunc = new Map<string, PersonPerformance[]>();

  for (const person of people) {
    const func = person.function || "Unknown";
    if (!byFunc.has(func)) byFunc.set(func, []);
    byFunc.get(func)!.push(person);
  }

  return [...byFunc.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([name, people]) => ({ name, people }));
}

export async function getPerformanceData(): Promise<{
  people: PersonPerformance[];
  reviewCycles: string[];
}> {
  const [reportData, { employees }] = await Promise.all([
    getReportData("people", "performance", [
      "manager_distributions_individual_ratings",
    ]),
    getActiveEmployees(),
  ]);

  const query = reportData.find(
    (d) => d.queryName === "manager_distributions_individual_ratings",
  );

  if (!query || query.rows.length === 0) {
    return { people: [], reviewCycles: [] };
  }

  return transformPerformanceData(query.rows, employees);
}
