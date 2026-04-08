import { getReportData } from "./mode";
import type { BarChartData } from "@/components/charts/bar-chart";

export interface Person {
  name: string;
  email: string;
  jobTitle: string;
  level: string;
  squad: string;
  function: string;
  manager: string;
  startDate: string;
  location: string;
  tenureMonths: number;
}

export interface PeopleMetrics {
  total: number;
  departments: number;
  newHiresThisMonth: number;
  newHiresLastMonth: number;
  averageTenureMonths: number;
  attritionLast90Days: number;
}

/**
 * Transform raw Mode headcount rows into typed Person objects.
 */
export function transformToPersons(rows: Record<string, unknown>[]): Person[] {
  const now = Date.now();
  return rows
    .map((r) => {
      const startDate = (r.start_date as string) || "";
      const startMs = startDate ? new Date(startDate).getTime() : now;
      const tenureMonths = Math.max(
        0,
        Math.floor((now - startMs) / (30.44 * 24 * 60 * 60 * 1000))
      );
      return {
        name: (r.preferred_name as string) || "Unknown",
        email: (r.email as string) || "",
        jobTitle: (r.job_title as string) || "",
        level: (r.hb_level as string) || "",
        squad: (r.hb_squad as string) || (r.hb_function as string) || "Unassigned",
        function: (r.hb_function as string) || "Unassigned",
        manager: (r.manager as string) || "",
        startDate,
        location: (r.work_location as string) || "",
        tenureMonths,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compute aggregate people metrics from active employees and the full dataset.
 */
export function getPeopleMetrics(
  active: Person[],
  allRows: Record<string, unknown>[]
): PeopleMetrics {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const newHiresThisMonth = active.filter((p) => {
    if (!p.startDate) return false;
    const d = new Date(p.startDate);
    return d >= thisMonthStart;
  }).length;

  const newHiresLastMonth = active.filter((p) => {
    if (!p.startDate) return false;
    const d = new Date(p.startDate);
    return d >= lastMonthStart && d < thisMonthStart;
  }).length;

  const totalTenure = active.reduce((sum, p) => sum + p.tenureMonths, 0);
  const averageTenureMonths = active.length > 0 ? Math.round(totalTenure / active.length) : 0;

  const departments = new Set(active.map((p) => p.function)).size;

  const attritionLast90Days = allRows.filter((r) => {
    if (r.lifecycle_status !== "Terminated" && r.lifecycle_status !== "terminated") return false;
    if (r.is_cleo_headcount !== 1) return false;
    const termDate = r.termination_date as string | null;
    if (!termDate) return false;
    return new Date(termDate) >= ninetyDaysAgo;
  }).length;

  return {
    total: active.length,
    departments,
    newHiresThisMonth,
    newHiresLastMonth,
    averageTenureMonths,
    attritionLast90Days,
  };
}

/**
 * Map hb_squad values to product pillars.
 * Squads not matching a product pillar go under their business ops group.
 */
const SQUAD_PILLAR_MAP: Record<string, string> = {
  // Growth
  "Growth Pillar": "Growth",
  "Growth Conversion": "Growth",
  "Growth Marketing": "Growth",
  "Growth Personalisation": "Growth",
  "Growth Engagement (Sea Otters)": "Growth",
  "Growth Activation (Shire)": "Growth",
  "Virality": "Growth",
  "Notifications & Prompts": "Growth",
  "Prompts & Upsells": "Growth",
  // EWA & Credit Products
  "EWA Pillar": "EWA & Credit Products",
  "EWA & Credit Products Pillar": "EWA & Credit Products",
  "EWA Core Squad": "EWA & Credit Products",
  "EWA Modelling": "EWA & Credit Products",
  "Geo Expansion": "EWA & Credit Products",
  "BNPL": "EWA & Credit Products",
  "Instalment Loan": "EWA & Credit Products",
  "Debt": "EWA & Credit Products",
  "Pricing & Lending": "EWA & Credit Products",
  "Credit": "EWA & Credit Products",
  // Chat
  "Chat Pillar": "Chat",
  "Chat 1: Chat Evaluations": "Chat",
  "Chat 2: AI Money Pro": "Chat",
  "Chat 3: Recommender": "Chat",
  "Chat 4: Experience": "Chat",
  "Chat 5: AI Core": "Chat",
  "Chat 5: AI Core Squad": "Chat",
  "Chat System": "Chat",
  "Chat tools": "Chat",
  "Chat Insights": "Chat",
  "Chat: Daily Plans": "Chat",
  // New Bets
  "New Bets Pillar": "New Bets",
  "New Bets Pillar Leads & Shared Resources": "New Bets",
  "New Bets - Gamification": "New Bets",
  "Discovery": "New Bets",
  "Mobile": "New Bets",
  "Bundles": "New Bets",
  // Card
  "Card Pillar": "Card",
  "Card 1": "Card",
  "Card 2": "Card",
  "Builder Pillar": "Card",
  // Access, Trust & Money, Risk & Payments
  "Payments Infrastructure": "Access, Trust & Money, Risk & Payments",
  "Fraud & Security": "Access, Trust & Money, Risk & Payments",
  "Fraud Infrastructure": "Access, Trust & Money, Risk & Payments",
  "Identity & Access": "Access, Trust & Money, Risk & Payments",
  "Access Trust and Money": "Access, Trust & Money, Risk & Payments",
  "Risk Analystics": "Access, Trust & Money, Risk & Payments",
  "Pricing & Packaging": "Access, Trust & Money, Risk & Payments",
  // Platform
  "Front End Platform": "Platform",
  "Site Reliability & Data Platform": "Platform",
  "Platform (Backend & MLOps)": "Platform",
  "Platform": "Platform",
  "Data Enablement": "Platform",
  // Business Operations
  "Talent": "Talent & People",
  "People": "Talent & People",
  "People Team": "Talent & People",
  "Marketing": "Marketing",
  "Champs": "Customer Operations",
  "Operations": "Customer Operations",
  "Customer Operations": "Customer Operations",
  "Finance": "Finance",
  "Commercial": "Commercial",
  "Legal & Compliance": "Legal & Compliance",
  "Compliance": "Legal & Compliance",
  "Exec": "Exec",
  "CEO": "Exec",
  "Management": "Exec",
  "IT": "Business Operations",
  "Experience": "Experience",
  "Voice": "Experience",
  "User Research": "Experience",
};

/** Pillars that are product/engineering — shown in the main grid. */
const PRODUCT_PILLARS = new Set([
  "Growth",
  "EWA & Credit Products",
  "Chat",
  "New Bets",
  "Card",
  "Access, Trust & Money, Risk & Payments",
  "Platform",
]);

function getPillarForSquad(squad: string): string {
  if (SQUAD_PILLAR_MAP[squad]) return SQUAD_PILLAR_MAP[squad];
  for (const part of squad.split(",")) {
    const pillar = SQUAD_PILLAR_MAP[part.trim()];
    if (pillar) return pillar;
  }
  return "Business Operations";
}

export interface PillarGroup {
  name: string;
  count: number;
  isProduct: boolean;
  squads: { name: string; people: Person[] }[];
}

/**
 * Group employees by pillar → squad for drill-down navigation.
 */
export function groupByPillarAndSquad(employees: Person[]): PillarGroup[] {
  const byPillar = new Map<string, Map<string, Person[]>>();

  for (const person of employees) {
    const pillar = getPillarForSquad(person.squad);
    if (!byPillar.has(pillar)) {
      byPillar.set(pillar, new Map());
    }
    const squads = byPillar.get(pillar)!;
    if (!squads.has(person.squad)) {
      squads.set(person.squad, []);
    }
    squads.get(person.squad)!.push(person);
  }

  return [...byPillar.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pillarName, squads]) => {
      const squadList = [...squads.entries()]
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([squadName, people]) => ({ name: squadName, people }));
      return {
        name: pillarName,
        count: squadList.reduce((s, sq) => s + sq.people.length, 0),
        isProduct: PRODUCT_PILLARS.has(pillarName),
        squads: squadList,
      };
    });
}

/**
 * Tenure distribution for bar chart.
 */
export function getTenureDistribution(employees: Person[]): BarChartData[] {
  const buckets = [
    { label: "< 6 months", min: 0, max: 6 },
    { label: "6–12 months", min: 6, max: 12 },
    { label: "1–2 years", min: 12, max: 24 },
    { label: "2–3 years", min: 24, max: 36 },
    { label: "3–5 years", min: 36, max: 60 },
    { label: "5+ years", min: 60, max: Infinity },
  ];

  return buckets.map((bucket) => ({
    label: bucket.label,
    value: employees.filter(
      (p) => p.tenureMonths >= bucket.min && p.tenureMonths < bucket.max
    ).length,
    color: "#3b3bba",
  }));
}

/**
 * Monthly joiners and departures for the last N months.
 */
export function getMonthlyJoinersAndDepartures(
  activeEmployees: Person[],
  allRows: Record<string, unknown>[],
  months: number = 36
): { joiners: { date: string; value: number }[]; departures: { date: string; value: number }[] } {
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  // Build month buckets
  const buckets: { key: string; date: string }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      date: d.toISOString().slice(0, 10),
    });
  }

  // Count joiners from active employees by start_date month
  const joinerCounts = new Map<string, number>();
  for (const p of activeEmployees) {
    if (!p.startDate) continue;
    const d = new Date(p.startDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    joinerCounts.set(key, (joinerCounts.get(key) ?? 0) + 1);
  }

  // Also count joiners from terminated employees (they joined then left)
  for (const r of allRows) {
    if (r.lifecycle_status !== "Terminated" && r.lifecycle_status !== "terminated") continue;
    if (r.is_cleo_headcount !== 1) continue;
    const startDate = r.start_date as string | null;
    if (!startDate) continue;
    const d = new Date(startDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    joinerCounts.set(key, (joinerCounts.get(key) ?? 0) + 1);
  }

  // Count departures by termination_date month
  const departureCounts = new Map<string, number>();
  for (const r of allRows) {
    if (r.lifecycle_status !== "Terminated" && r.lifecycle_status !== "terminated") continue;
    if (r.is_cleo_headcount !== 1) continue;
    const termDate = r.termination_date as string | null;
    if (!termDate) continue;
    const d = new Date(termDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    departureCounts.set(key, (departureCounts.get(key) ?? 0) + 1);
  }

  return {
    joiners: buckets.map((b) => ({ date: b.date, value: joinerCounts.get(b.key) ?? 0 })),
    departures: buckets.map((b) => ({ date: b.date, value: departureCounts.get(b.key) ?? 0 })),
  };
}

/**
 * Fetch and transform active employees from Mode headcount data.
 */
export async function getActiveEmployees(): Promise<{
  employees: Person[];
  allRows: Record<string, unknown>[];
  lastSync: Date | null;
}> {
  const data = await getReportData("people", "headcount");
  const query = data.find((d) => d.queryName === "headcount");
  if (!query) return { employees: [], allRows: [], lastSync: null };

  const allRows = query.rows;
  const activeRows = allRows.filter(
    (r) => r.lifecycle_status === "Employed" && r.is_cleo_headcount === 1
  );

  return {
    employees: transformToPersons(activeRows),
    allRows,
    lastSync: query.syncedAt,
  };
}
