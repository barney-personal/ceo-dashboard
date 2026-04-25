/**
 * Server-side loader for the B-side engineering composite.
 *
 * Fetches Mode Headcount SSoT + githubEmployeeMap + githubPrs +
 * prReviewAnalyses, joins them into `EngineerCompositeInput` rows, and
 * delegates to the pure `buildComposite`. Per the M3 audit this module
 * MUST NOT import `src/data/impact-model.json`, `src/lib/data/impact-model.ts`,
 * or `src/lib/data/impact-model.server.ts`.
 *
 * Any fetch failure degrades to an empty bundle rather than crashing the
 * page — the coverage counts make the degraded state honest.
 */

import { and, count, eq, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { githubEmployeeMap, githubPrs, prReviewAnalyses } from "@/lib/db/schema";
import { getReportData } from "@/lib/data/mode";
import {
  classifyDiscipline,
  isRankableDiscipline,
} from "@/lib/data/disciplines";
import {
  buildComposite,
  COMPOSITE_MIN_ANALYSED_PRS,
  COMPOSITE_SIGNAL_WINDOW_DAYS,
  type BuildCompositeInputs,
  type CompositeBundle,
  type EngineerCompositeInput,
} from "@/lib/data/engineering-composite";
import {
  hashEmailForRanking,
  type EligibilityHeadcountRow,
  type EligibilityGithubMapRow,
} from "@/lib/data/engineering-ranking";
import { RUBRIC_VERSION } from "@/lib/integrations/code-review-rubric";

interface PerLoginActivity {
  prCount: number;
}

interface PerAuthorRubricRollup {
  analysedPrCount: number;
  executionQualityWeighted: number;
  testAdequacyWeighted: number;
  riskHandlingWeighted: number;
  reviewabilityWeighted: number;
  weightTotal: number;
  executionQualityWeight: number;
  testAdequacyWeight: number;
  riskHandlingWeight: number;
  reviewabilityWeight: number;
  difficultySum: number;
  difficultyWeight: number;
  revertCount: number;
  reviewedCount: number;
  timeToMergeMinutes: number[];
}

async function fetchHeadcountRows(): Promise<EligibilityHeadcountRow[]> {
  try {
    const headcountData = await getReportData("people", "headcount", [
      "headcount",
    ]);
    const headcountQuery = headcountData.find((d) => d.queryName === "headcount");
    if (!headcountQuery) return [];
    return headcountQuery.rows as EligibilityHeadcountRow[];
  } catch (err) {
    console.warn("[engineering-composite] headcount fetch failed:", err);
    return [];
  }
}

async function fetchGithubMap(): Promise<EligibilityGithubMapRow[]> {
  try {
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
  } catch (err) {
    console.warn("[engineering-composite] github map fetch failed:", err);
    return [];
  }
}

async function fetchPrCountByLogin(
  windowStart: Date,
): Promise<Map<string, PerLoginActivity>> {
  try {
    const rows = await db
      .select({
        login: githubPrs.authorLogin,
        prCount: count().as("pr_count"),
      })
      .from(githubPrs)
      .where(gte(githubPrs.mergedAt, windowStart))
      .groupBy(githubPrs.authorLogin);
    const map = new Map<string, PerLoginActivity>();
    for (const r of rows) {
      map.set(r.login, { prCount: Number(r.prCount) || 0 });
    }
    return map;
  } catch (err) {
    console.warn("[engineering-composite] pr fetch failed:", err);
    return new Map();
  }
}

async function fetchRubricRollupsByLogin(
  windowStart: Date,
  rubricVersion: string,
): Promise<Map<string, PerAuthorRubricRollup>> {
  try {
    const rows = await db
      .select({
        authorLogin: prReviewAnalyses.authorLogin,
        technicalDifficulty: prReviewAnalyses.technicalDifficulty,
        executionQuality: prReviewAnalyses.executionQuality,
        testAdequacy: prReviewAnalyses.testAdequacy,
        riskHandling: prReviewAnalyses.riskHandling,
        reviewability: prReviewAnalyses.reviewability,
        analysisConfidencePct: prReviewAnalyses.analysisConfidencePct,
        revertWithin14d: prReviewAnalyses.revertWithin14d,
        reviewRounds: prReviewAnalyses.reviewRounds,
        timeToMergeMinutes: prReviewAnalyses.timeToMergeMinutes,
      })
      .from(prReviewAnalyses)
      .where(
        and(
          eq(prReviewAnalyses.rubricVersion, rubricVersion),
          gte(prReviewAnalyses.mergedAt, windowStart),
        ),
      );

    const byLogin = new Map<string, PerAuthorRubricRollup>();
    for (const row of rows) {
      const bucket: PerAuthorRubricRollup = byLogin.get(row.authorLogin) ?? {
        analysedPrCount: 0,
        executionQualityWeighted: 0,
        testAdequacyWeighted: 0,
        riskHandlingWeighted: 0,
        reviewabilityWeighted: 0,
        weightTotal: 0,
        executionQualityWeight: 0,
        testAdequacyWeight: 0,
        riskHandlingWeight: 0,
        reviewabilityWeight: 0,
        difficultySum: 0,
        difficultyWeight: 0,
        revertCount: 0,
        reviewedCount: 0,
        timeToMergeMinutes: [],
      };
      const confidence = Math.max(1, row.analysisConfidencePct ?? 50);
      const difficulty = Math.max(1, row.technicalDifficulty ?? 3);
      const weight = confidence * difficulty;

      bucket.analysedPrCount += 1;
      bucket.weightTotal += weight;

      const accumulate = (
        axisWeighted: "executionQualityWeighted" | "testAdequacyWeighted" | "riskHandlingWeighted" | "reviewabilityWeighted",
        axisWeight: "executionQualityWeight" | "testAdequacyWeight" | "riskHandlingWeight" | "reviewabilityWeight",
        score: number | null | undefined,
      ) => {
        if (score === null || score === undefined || !Number.isFinite(score)) {
          return;
        }
        bucket[axisWeighted] += score * weight;
        bucket[axisWeight] += weight;
      };
      accumulate(
        "executionQualityWeighted",
        "executionQualityWeight",
        row.executionQuality,
      );
      accumulate(
        "testAdequacyWeighted",
        "testAdequacyWeight",
        row.testAdequacy,
      );
      accumulate(
        "riskHandlingWeighted",
        "riskHandlingWeight",
        row.riskHandling,
      );
      accumulate(
        "reviewabilityWeighted",
        "reviewabilityWeight",
        row.reviewability,
      );
      if (row.technicalDifficulty !== null) {
        bucket.difficultySum += row.technicalDifficulty;
        bucket.difficultyWeight += 1;
      }
      if (row.revertWithin14d) bucket.revertCount += 1;
      if ((row.reviewRounds ?? 0) > 0) bucket.reviewedCount += 1;
      if (
        row.timeToMergeMinutes !== null &&
        row.timeToMergeMinutes > 0 &&
        Number.isFinite(row.timeToMergeMinutes)
      ) {
        bucket.timeToMergeMinutes.push(row.timeToMergeMinutes);
      }
      byLogin.set(row.authorLogin, bucket);
    }
    return byLogin;
  } catch (err) {
    console.warn("[engineering-composite] rubric fetch failed:", err);
    return new Map();
  }
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rollupToSignal(
  rollup: PerAuthorRubricRollup | null,
): Pick<
  EngineerCompositeInput,
  | "analysedPrCount"
  | "executionQualityMean"
  | "testAdequacyMean"
  | "riskHandlingMean"
  | "reviewabilityMean"
  | "technicalDifficultyMean"
  | "revertRate"
  | "reviewParticipationRate"
  | "medianTimeToMergeMinutes"
> {
  if (rollup === null) {
    return {
      analysedPrCount: 0,
      executionQualityMean: null,
      testAdequacyMean: null,
      riskHandlingMean: null,
      reviewabilityMean: null,
      technicalDifficultyMean: null,
      revertRate: null,
      reviewParticipationRate: null,
      medianTimeToMergeMinutes: null,
    };
  }
  const meanOf = (weighted: number, weight: number): number | null => {
    if (weight === 0) return null;
    if (rollup.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS) return null;
    return weighted / weight;
  };
  return {
    analysedPrCount: rollup.analysedPrCount,
    executionQualityMean: meanOf(
      rollup.executionQualityWeighted,
      rollup.executionQualityWeight,
    ),
    testAdequacyMean: meanOf(
      rollup.testAdequacyWeighted,
      rollup.testAdequacyWeight,
    ),
    riskHandlingMean: meanOf(
      rollup.riskHandlingWeighted,
      rollup.riskHandlingWeight,
    ),
    reviewabilityMean: meanOf(
      rollup.reviewabilityWeighted,
      rollup.reviewabilityWeight,
    ),
    technicalDifficultyMean:
      rollup.difficultyWeight === 0
        ? null
        : rollup.difficultySum / rollup.difficultyWeight,
    revertRate:
      rollup.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS
        ? null
        : rollup.revertCount / rollup.analysedPrCount,
    reviewParticipationRate:
      rollup.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS
        ? null
        : rollup.reviewedCount / rollup.analysedPrCount,
    medianTimeToMergeMinutes:
      rollup.analysedPrCount < COMPOSITE_MIN_ANALYSED_PRS
        ? null
        : medianOf(rollup.timeToMergeMinutes),
  };
}

function cleanPillar(deptName: string | null | undefined): string {
  if (!deptName) return "Unknown";
  return deptName.replace(/\s+Pillar$/i, "").trim();
}

function diffDays(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.slice(0, 10);
  if (!trimmed) return null;
  const d = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pure assembler for composite inputs. Exposed so tests can drive the full
 * join path without mocking the DB layer.
 */
export function assembleCompositeInputs(params: {
  headcountRows: EligibilityHeadcountRow[];
  githubMap: EligibilityGithubMapRow[];
  prCountByLogin: Map<string, PerLoginActivity>;
  rubricByLogin: Map<string, PerAuthorRubricRollup>;
  now: Date;
}): EngineerCompositeInput[] {
  const { headcountRows, githubMap, prCountByLogin, rubricByLogin, now } =
    params;

  const emailToLogin = new Map<string, string>();
  for (const m of githubMap) {
    if (m.isBot || !m.employeeEmail) continue;
    emailToLogin.set(m.employeeEmail.toLowerCase(), m.githubLogin);
  }

  const out: EngineerCompositeInput[] = [];
  for (const row of headcountRows) {
    const func = (row.hb_function ?? "").toLowerCase();
    if (!func.includes("engineer")) continue;

    const email = (row.email ?? "").toLowerCase();
    if (!email) continue;

    const discipline = classifyDiscipline(
      row.rp_specialisation ?? undefined,
      row.job_title ?? undefined,
    );
    if (!isRankableDiscipline(discipline)) continue;

    const startDate = parseDate(row.start_date);
    if (startDate && startDate.getTime() > now.getTime()) continue; // future hire

    const termDate = parseDate(row.termination_date);
    const isLeaverOrInactive = Boolean(
      termDate &&
        termDate.getTime() <= now.getTime() &&
        (!startDate || termDate.getTime() >= startDate.getTime()),
    );

    const tenureDays = startDate ? diffDays(startDate, now) : null;
    const githubLogin = emailToLogin.get(email) ?? null;
    const activity = githubLogin ? prCountByLogin.get(githubLogin) : null;
    const rollup =
      githubLogin ? rubricByLogin.get(githubLogin) ?? null : null;
    const rubricFields = rollupToSignal(rollup);

    out.push({
      emailHash: hashEmailForRanking(email),
      displayName:
        row.preferred_name?.trim() ||
        row.rp_full_name?.trim() ||
        email ||
        "(unknown)",
      email,
      githubLogin,
      discipline,
      pillar: cleanPillar(row.rp_department_name),
      squad: row.hb_squad ?? null,
      managerEmail: row.line_manager_email?.toLowerCase().trim() || null,
      tenureDays,
      isLeaverOrInactive,
      prCount: activity?.prCount ?? null,
      ...rubricFields,
    });
  }
  return out;
}

export async function getEngineeringComposite(): Promise<CompositeBundle> {
  const now = new Date();
  const windowStart = new Date(
    now.getTime() - COMPOSITE_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [headcountRows, githubMap, prCountByLogin, rubricByLogin] =
    await Promise.all([
      fetchHeadcountRows(),
      fetchGithubMap(),
      fetchPrCountByLogin(windowStart),
      fetchRubricRollupsByLogin(windowStart, RUBRIC_VERSION),
    ]);

  const engineers = assembleCompositeInputs({
    headcountRows,
    githubMap,
    prCountByLogin,
    rubricByLogin,
    now,
  });

  const inputs: BuildCompositeInputs = {
    now,
    windowDays: COMPOSITE_SIGNAL_WINDOW_DAYS,
    engineers,
  };
  return buildComposite(inputs);
}
