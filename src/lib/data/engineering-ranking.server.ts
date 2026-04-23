/**
 * Server-side loader for the engineer ranking page.
 *
 * Fetches the spine inputs (Mode Headcount SSoT + `githubEmployeeMap` + the
 * committed impact model) and delegates to the pure `buildRankingSnapshot`
 * helper. Fetch failures degrade to the stub `getEngineeringRanking()`
 * snapshot so the page still renders with an explicit coverage-unavailable
 * state instead of crashing.
 */

import { db } from "@/lib/db";
import { githubEmployeeMap, squads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getReportData } from "@/lib/data/mode";
import { getImpactModel } from "@/lib/data/impact-model";
import {
  buildRankingSnapshot,
  getEngineeringRanking,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilitySquadsRegistryRow,
  type EngineeringRankingSnapshot,
} from "@/lib/data/engineering-ranking";

async function fetchHeadcountRows(): Promise<EligibilityHeadcountRow[]> {
  const headcountData = await getReportData("people", "headcount", [
    "headcount",
  ]);
  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");
  if (!headcountQuery) return [];
  return headcountQuery.rows as EligibilityHeadcountRow[];
}

async function fetchGithubMap(): Promise<EligibilityGithubMapRow[]> {
  const rows = await db
    .select({
      githubLogin: githubEmployeeMap.githubLogin,
      employeeEmail: githubEmployeeMap.employeeEmail,
      isBot: githubEmployeeMap.isBot,
    })
    .from(githubEmployeeMap)
    .where(eq(githubEmployeeMap.isBot, false));

  return rows.map((r) => ({
    githubLogin: r.githubLogin,
    employeeEmail: r.employeeEmail,
    isBot: r.isBot,
  }));
}

async function fetchSquadsRegistry(): Promise<EligibilitySquadsRegistryRow[]> {
  const rows = await db
    .select({
      name: squads.name,
      pillar: squads.pillar,
      pmName: squads.pmName,
      isActive: squads.isActive,
    })
    .from(squads)
    .where(eq(squads.isActive, true));

  return rows.map((r) => ({
    name: r.name,
    pillar: r.pillar,
    pmName: r.pmName,
    isActive: r.isActive,
  }));
}

/**
 * Build a real ranking snapshot from live data. If any fetch fails, fall
 * back to the empty-eligibility stub — the page still renders and the
 * coverage section makes the degraded state visible.
 */
export async function getEngineeringRankingSnapshot(): Promise<EngineeringRankingSnapshot> {
  try {
    const [headcountRows, githubMap, squadsRegistry] = await Promise.all([
      fetchHeadcountRows(),
      fetchGithubMap(),
      fetchSquadsRegistry(),
    ]);

    return buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: getImpactModel(),
      squads: squadsRegistry,
      now: new Date(),
    });
  } catch (err) {
    console.warn(
      "[engineering-ranking] preflight fetch failed, serving stub:",
      err,
    );
    return getEngineeringRanking();
  }
}
