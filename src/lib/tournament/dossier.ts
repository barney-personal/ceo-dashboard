import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  githubCommits,
  githubEmployeeMap,
  githubPrs,
  prReviewAnalyses,
} from "@/lib/db/schema";
import { getActiveEmployees, type Person } from "@/lib/data/people";
import type { EngineerDossier } from "./types";

const MIN_ANALYSED_PRS_FOR_ELIGIBILITY = 5;

export interface EligibleEngineer {
  email: string;
  displayName: string;
  githubLogins: string[];
  analysedPrCount: number;
}

/**
 * Engineers eligible for the tournament: active employees in the Engineering
 * function (per Mode SSoT) with at least N analysed PRs in the window across
 * all of their GitHub accounts. Aggregating across logins matters because some
 * engineers (e.g. Ignacio Garrido) have multiple GitHub accounts mapped to
 * the same employee email.
 */
export async function listEligibleEngineers(
  windowStart: Date,
  windowEnd: Date,
): Promise<EligibleEngineer[]> {
  const [people, mapRows] = await Promise.all([
    getActiveEngineersSafe(),
    db
      .select({
        githubLogin: githubEmployeeMap.githubLogin,
        employeeEmail: githubEmployeeMap.employeeEmail,
        isBot: githubEmployeeMap.isBot,
      })
      .from(githubEmployeeMap),
  ]);

  // email → [githubLogin] (one engineer can have several GitHub accounts)
  const loginsByEmail = new Map<string, string[]>();
  for (const row of mapRows) {
    if (row.isBot || !row.employeeEmail) continue;
    const email = row.employeeEmail.toLowerCase();
    const list = loginsByEmail.get(email) ?? [];
    list.push(row.githubLogin);
    loginsByEmail.set(email, list);
  }

  const engineerEmails = people.map((p) => p.email.toLowerCase()).filter(Boolean);
  const allEngineerLogins = engineerEmails.flatMap(
    (email) => loginsByEmail.get(email) ?? [],
  );

  if (allEngineerLogins.length === 0) return [];

  const analysedRows = await db
    .select({
      authorLogin: prReviewAnalyses.authorLogin,
      count: sql<number>`count(*)::int`,
    })
    .from(prReviewAnalyses)
    .where(
      and(
        gte(prReviewAnalyses.mergedAt, windowStart),
        lt(prReviewAnalyses.mergedAt, windowEnd),
        inArray(
          sql`lower(${prReviewAnalyses.authorLogin})`,
          allEngineerLogins.map((l) => l.toLowerCase()),
        ),
      ),
    )
    .groupBy(prReviewAnalyses.authorLogin);

  const analysesByLogin = new Map<string, number>();
  for (const row of analysedRows) {
    analysesByLogin.set(row.authorLogin.toLowerCase(), row.count);
  }

  const eligible: EligibleEngineer[] = [];
  for (const person of people) {
    const email = person.email.toLowerCase();
    if (!email) continue;
    const logins = loginsByEmail.get(email) ?? [];
    if (logins.length === 0) continue;

    const analysedPrCount = logins.reduce(
      (sum, login) => sum + (analysesByLogin.get(login.toLowerCase()) ?? 0),
      0,
    );
    if (analysedPrCount < MIN_ANALYSED_PRS_FOR_ELIGIBILITY) continue;

    eligible.push({
      email,
      displayName: person.name,
      githubLogins: logins,
      analysedPrCount,
    });
  }

  return eligible.sort((a, b) => b.analysedPrCount - a.analysedPrCount);
}

export async function buildEngineerDossier(
  email: string,
  windowStart: Date,
  windowEnd: Date,
  displayLabel: "A" | "B",
): Promise<EngineerDossier | null> {
  const mappingRows = await db
    .select({ githubLogin: githubEmployeeMap.githubLogin })
    .from(githubEmployeeMap)
    .where(eq(sql`lower(${githubEmployeeMap.employeeEmail})`, email.toLowerCase()));

  const githubLogins = mappingRows.map((m) => m.githubLogin);
  if (githubLogins.length === 0) return null;
  const lcLogins = githubLogins.map((l) => l.toLowerCase());

  const [analyses, allPrs, commitStats] = await Promise.all([
    db
      .select()
      .from(prReviewAnalyses)
      .where(
        and(
          inArray(sql`lower(${prReviewAnalyses.authorLogin})`, lcLogins),
          gte(prReviewAnalyses.mergedAt, windowStart),
          lt(prReviewAnalyses.mergedAt, windowEnd),
        ),
      )
      .orderBy(desc(prReviewAnalyses.mergedAt)),
    db
      .select({
        repo: githubPrs.repo,
        additions: githubPrs.additions,
        deletions: githubPrs.deletions,
        changedFiles: githubPrs.changedFiles,
        mergedAt: githubPrs.mergedAt,
      })
      .from(githubPrs)
      .where(
        and(
          inArray(sql`lower(${githubPrs.authorLogin})`, lcLogins),
          gte(githubPrs.mergedAt, windowStart),
          lt(githubPrs.mergedAt, windowEnd),
        ),
      ),
    db
      .select({
        commitCount: sql<number>`count(*)::int`,
        additions: sql<number>`coalesce(sum(${githubCommits.additions}), 0)::int`,
        deletions: sql<number>`coalesce(sum(${githubCommits.deletions}), 0)::int`,
      })
      .from(githubCommits)
      .where(
        and(
          inArray(sql`lower(${githubCommits.authorLogin})`, lcLogins),
          gte(githubCommits.committedAt, windowStart),
          lt(githubCommits.committedAt, windowEnd),
        ),
      ),
  ]);

  const rendered = renderDossier({
    displayLabel,
    windowStart,
    windowEnd,
    analyses,
    allPrs,
    commitCount: commitStats[0]?.commitCount ?? 0,
  });

  return {
    email: email.toLowerCase(),
    displayLabel,
    windowStart,
    windowEnd,
    rendered,
  };
}

async function getActiveEngineersSafe(): Promise<Person[]> {
  try {
    const { employees, unassigned } = await getActiveEmployees();
    return [...employees, ...unassigned].filter(
      (p) => p.function === "Engineering" && !!p.email,
    );
  } catch {
    return [];
  }
}

interface DossierInputs {
  displayLabel: "A" | "B";
  windowStart: Date;
  windowEnd: Date;
  analyses: Array<typeof prReviewAnalyses.$inferSelect>;
  allPrs: Array<{
    repo: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    mergedAt: Date;
  }>;
  commitCount: number;
}

function renderDossier(input: DossierInputs): string {
  const { displayLabel, windowStart, windowEnd, analyses, allPrs, commitCount } =
    input;

  const repoLabels = buildBlindedRepoLabels(
    analyses.map((a) => a.repo).concat(allPrs.map((p) => p.repo)),
  );

  const totalPrs = allPrs.length;
  const totalAdditions = allPrs.reduce((sum, pr) => sum + pr.additions, 0);
  const totalDeletions = allPrs.reduce((sum, pr) => sum + pr.deletions, 0);
  const totalFilesChanged = allPrs.reduce((sum, pr) => sum + pr.changedFiles, 0);

  const categoryCounts = countBy(analyses, (a) => a.category);
  const standoutCounts = countBy(
    analyses.filter((a) => a.standout),
    (a) => a.standout!,
  );

  const avgs = averages(analyses);

  const weeksActive = countDistinctWeeks(allPrs.map((p) => p.mergedAt));
  const timeToMergeP50 = percentile(
    analyses.map((a) => a.timeToMergeMinutes).filter((v) => v > 0),
    50,
  );

  const reviewChurn = analyses.reduce(
    (acc, a) => ({
      reverts: acc.reverts + (a.revertWithin14d ? 1 : 0),
      changeRequests: acc.changeRequests + a.changeRequestCount,
      reviewRounds: acc.reviewRounds + a.reviewRounds,
      commitsAfterFirstReview:
        acc.commitsAfterFirstReview + a.commitsAfterFirstReview,
    }),
    { reverts: 0, changeRequests: 0, reviewRounds: 0, commitsAfterFirstReview: 0 },
  );

  const topPrs = pickTopPrs(analyses, 6);

  const lines: string[] = [];
  lines.push(`Engineer ${displayLabel}`);
  lines.push(
    `Window: ${dateOnly(windowStart)} → ${dateOnly(windowEnd)} (${daysBetween(windowStart, windowEnd)} days)`,
  );
  lines.push("");
  lines.push("### Activity");
  lines.push(`- Merged PRs: ${totalPrs}`);
  lines.push(`- Analysed PRs (with rubric scores): ${analyses.length}`);
  lines.push(`- Commits: ${commitCount}`);
  lines.push(
    `- Lines: +${totalAdditions.toLocaleString()} / -${totalDeletions.toLocaleString()} across ${totalFilesChanged.toLocaleString()} file-changes`,
  );
  lines.push(`- Distinct weeks with merged PRs: ${weeksActive}`);
  if (timeToMergeP50 !== null) {
    lines.push(`- Median time-to-merge: ${formatDuration(timeToMergeP50)}`);
  }
  lines.push("");

  lines.push("### Work composition");
  if (analyses.length === 0) {
    lines.push("- (No rubric-scored PRs in window — judge with caution.)");
  } else {
    for (const [category, count] of sortByCount(categoryCounts)) {
      const pct = ((count / analyses.length) * 100).toFixed(0);
      lines.push(`- ${category}: ${count} (${pct}%)`);
    }
  }
  lines.push("");

  lines.push("### Average rubric scores (1–5 scale, higher is better)");
  if (avgs) {
    lines.push(
      `- Technical difficulty: ${avgs.technicalDifficulty.toFixed(2)}`,
    );
    lines.push(`- Execution quality: ${avgs.executionQuality.toFixed(2)}`);
    lines.push(`- Test adequacy: ${avgs.testAdequacy.toFixed(2)}`);
    lines.push(`- Risk handling: ${avgs.riskHandling.toFixed(2)}`);
    lines.push(`- Reviewability: ${avgs.reviewability.toFixed(2)}`);
    lines.push(`- Outcome score (0–100): ${avgs.outcomeScore.toFixed(0)}`);
    lines.push(`- Analysis confidence: ${avgs.analysisConfidencePct.toFixed(0)}%`);
  } else {
    lines.push("- (No analysed PRs.)");
  }
  lines.push("");

  lines.push("### Quality and stability signals");
  lines.push(`- Reverts within 14d: ${reviewChurn.reverts}`);
  lines.push(`- Total change-requests received: ${reviewChurn.changeRequests}`);
  lines.push(`- Total review rounds: ${reviewChurn.reviewRounds}`);
  lines.push(
    `- Commits after first review (rework signal): ${reviewChurn.commitsAfterFirstReview}`,
  );
  if (Object.keys(standoutCounts).length > 0) {
    lines.push("- PR standouts:");
    for (const [flag, count] of sortByCount(standoutCounts)) {
      lines.push(`  - ${flag}: ${count}`);
    }
  }
  lines.push("");

  lines.push("### Notable PRs (top 6 by impact-weighted score)");
  if (topPrs.length === 0) {
    lines.push("- (No analysed PRs to surface.)");
  } else {
    for (const pr of topPrs) {
      const repoLabel = repoLabels.get(pr.repo) ?? "repo-?";
      lines.push(
        `- [${repoLabel}#${pr.prNumber}] ${pr.category} | difficulty ${pr.technicalDifficulty}/5 | quality ${pr.executionQuality}/5 | outcome ${pr.outcomeScore}/100${pr.standout ? ` | ${pr.standout}` : ""}`,
      );
      lines.push(`  Summary: ${truncate(pr.summary, 240)}`);
    }
  }

  return lines.join("\n");
}

function buildBlindedRepoLabels(repos: string[]): Map<string, string> {
  const seen = new Map<string, string>();
  let counter = 0;
  for (const repo of repos) {
    if (!seen.has(repo)) {
      counter++;
      seen.set(repo, `repo-${counter}`);
    }
  }
  return seen;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function sortByCount(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function averages(analyses: Array<typeof prReviewAnalyses.$inferSelect>) {
  if (analyses.length === 0) return null;
  const sum = analyses.reduce(
    (acc, a) => ({
      technicalDifficulty: acc.technicalDifficulty + a.technicalDifficulty,
      executionQuality: acc.executionQuality + a.executionQuality,
      testAdequacy: acc.testAdequacy + a.testAdequacy,
      riskHandling: acc.riskHandling + a.riskHandling,
      reviewability: acc.reviewability + a.reviewability,
      outcomeScore: acc.outcomeScore + a.outcomeScore,
      analysisConfidencePct: acc.analysisConfidencePct + a.analysisConfidencePct,
    }),
    {
      technicalDifficulty: 0,
      executionQuality: 0,
      testAdequacy: 0,
      riskHandling: 0,
      reviewability: 0,
      outcomeScore: 0,
      analysisConfidencePct: 0,
    },
  );
  const n = analyses.length;
  return {
    technicalDifficulty: sum.technicalDifficulty / n,
    executionQuality: sum.executionQuality / n,
    testAdequacy: sum.testAdequacy / n,
    riskHandling: sum.riskHandling / n,
    reviewability: sum.reviewability / n,
    outcomeScore: sum.outcomeScore / n,
    analysisConfidencePct: sum.analysisConfidencePct / n,
  };
}

function pickTopPrs(
  analyses: Array<typeof prReviewAnalyses.$inferSelect>,
  count: number,
): typeof analyses {
  const scored = analyses.map((a) => ({
    pr: a,
    score:
      a.technicalDifficulty * 2 +
      a.executionQuality +
      a.outcomeScore / 25 +
      (a.standout === "notably_complex" || a.standout === "notably_high_quality"
        ? 3
        : 0) -
      (a.category === "test" || a.category === "docs" || a.category === "chore"
        ? 2
        : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.pr);
}

function percentile(values: number[], pct: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((pct / 100) * sorted.length)),
  );
  return sorted[idx];
}

function countDistinctWeeks(dates: Date[]): number {
  const weeks = new Set<string>();
  for (const d of dates) {
    const year = d.getUTCFullYear();
    const week = Math.floor(d.getTime() / (7 * 86_400_000));
    weeks.add(`${year}-${week}`);
  }
  return weeks.size;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (60 * 24)).toFixed(1)}d`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
