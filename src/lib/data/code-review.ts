import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubEmployeeMap, prReviewAnalyses } from "@/lib/db/schema";
import {
  RUBRIC_VERSION,
  type AnalysisCategory,
  type AnalysisStandout,
  type CodeReviewSurface,
  type ModelAgreementLevel,
  type SecondOpinionReason,
} from "@/lib/integrations/code-review-analyser";
import { CODE_REVIEW_WINDOW_DAYS } from "@/lib/sync/code-review";

export const SECOND_LOOK_REASONS = [
  "model_flagged_concerning",
  "model_flagged_low_quality",
  "reverted_within_14d",
  "heavy_change_requests",
  "heavy_post_review_commits",
  "low_landing_high_churn",
] as const;

export type SecondLookReason = (typeof SECOND_LOOK_REASONS)[number];

export interface PrReviewEntry {
  repo: string;
  prNumber: number;
  mergedAt: Date;
  technicalDifficulty: number;
  executionQuality: number;
  testAdequacy: number;
  riskHandling: number;
  reviewability: number;
  analysisConfidencePct: number;
  category: AnalysisCategory;
  summary: string;
  caveats: string[];
  standout: AnalysisStandout | null;
  primarySurface: CodeReviewSurface;
  approvalCount: number;
  changeRequestCount: number;
  reviewCommentCount: number;
  conversationCommentCount: number;
  reviewRounds: number;
  timeToFirstReviewMinutes: number | null;
  timeToMergeMinutes: number;
  commitCount: number;
  commitsAfterFirstReview: number;
  revertWithin14d: boolean;
  outcomeScore: number;
  reviewProvider: string;
  reviewModel: string;
  secondOpinionUsed: boolean;
  agreementLevel: ModelAgreementLevel;
  secondOpinionReasons: SecondOpinionReason[];
  qualityScore: number;
  reviewHealthScore: number;
  prScore: number;
  recencyWeight: number;
  githubUrl: string;
  secondLookReasons: SecondLookReason[];
}

export type DiagnosticFlag =
  | "low_evidence"
  | "low_confidence"
  | "quality_variance_high"
  | "review_churn_high"
  | "has_concerning_pr"
  | "reverted_pr";

export interface EngineerRollup {
  authorLogin: string;
  employeeName: string | null;
  employeeEmail: string | null;
  isBot: boolean;
  cohort: CodeReviewSurface;
  prCount: number;
  effectivePrCount: number;
  confidencePct: number;
  distinctRepos: number;
  avgTechnicalDifficulty: number;
  avgExecutionQuality: number;
  avgTestAdequacy: number;
  avgRiskHandling: number;
  avgReviewability: number;
  avgOutcomeScore: number;
  qualityPercentile: number;
  difficultyPercentile: number;
  reliabilityPercentile: number;
  reviewHealthPercentile: number;
  throughputPercentile: number;
  rawScore: number;
  finalScore: number;
  categoryCounts: Record<AnalysisCategory, number>;
  flags: DiagnosticFlag[];
  prs: PrReviewEntry[];
  prevFinalScore: number | null;
  weeklyScore: number[];
  reviewChurnResidual: number;
}

export interface CodeReviewView {
  windowDays: number;
  rubricVersion: string;
  analysedAtLatest: Date | null;
  engineers: EngineerRollup[];
  totalPrs: number;
}

interface AnalysisRow {
  repo: string;
  prNumber: number;
  authorLogin: string;
  mergedAt: Date;
  technicalDifficulty?: number | null;
  executionQuality?: number | null;
  testAdequacy?: number | null;
  riskHandling?: number | null;
  reviewability?: number | null;
  analysisConfidencePct?: number | null;
  category: string;
  summary: string;
  caveats: unknown;
  standout: string | null;
  primarySurface?: string | null;
  approvalCount?: number | null;
  changeRequestCount?: number | null;
  reviewCommentCount?: number | null;
  conversationCommentCount?: number | null;
  reviewRounds?: number | null;
  timeToFirstReviewMinutes?: number | null;
  timeToMergeMinutes?: number | null;
  commitCount?: number | null;
  commitsAfterFirstReview?: number | null;
  revertWithin14d?: boolean | null;
  outcomeScore?: number | null;
  reviewProvider?: string | null;
  reviewModel?: string | null;
  secondOpinionUsed?: boolean | null;
  agreementLevel?: string | null;
  secondOpinionReasons?: unknown;
  analysedAt: Date;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values: number[], weights: number[]): number {
  if (values.length === 0 || values.length !== weights.length) return 0;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return 0;
  let weighted = 0;
  for (let i = 0; i < values.length; i++) {
    weighted += values[i] * weights[i];
  }
  return weighted / totalWeight;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export function percentileRank(value: number, values: number[]): number {
  if (values.length <= 1) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  let lower = 0;
  let equal = 0;
  for (const candidate of sorted) {
    if (candidate < value) lower++;
    else if (candidate === value) equal++;
  }
  const denominator = Math.max(1, sorted.length - 1);
  return ((lower + Math.max(0, equal - 1) / 2) / denominator) * 100;
}

function recencyWeight(mergedAt: Date, windowDays: number): number {
  const ageDays = Math.max(
    0,
    (Date.now() - mergedAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  // Half-life ~= 30 days inside the 90-day window.
  return Math.pow(0.5, ageDays / Math.min(30, windowDays));
}

function toConfidence(value: number): number {
  return clamp01(value / 100);
}

function computeQualityScore(pr: {
  executionQuality: number;
  testAdequacy: number;
  riskHandling: number;
  reviewability: number;
}): number {
  return clamp100(
    ((0.4 * pr.executionQuality +
      0.25 * pr.testAdequacy +
      0.2 * pr.riskHandling +
      0.15 * pr.reviewability) /
      5) *
      100,
  );
}

function computeReviewHealthScore(pr: {
  reviewability: number;
  changeRequestCount: number;
  commitsAfterFirstReview: number;
  reviewRounds: number;
  reviewCommentCount: number;
  outcomeScore: number;
}): number {
  let score = (pr.reviewability / 5) * 65 + pr.outcomeScore * 0.35;
  score -= Math.min(10, pr.changeRequestCount * 4);
  score -= Math.min(8, pr.commitsAfterFirstReview * 2);
  score -= Math.min(8, Math.max(0, pr.reviewRounds - 1) * 4);
  score -= Math.min(5, pr.reviewCommentCount * 0.25);
  return clamp100(score);
}

function computePrScore(pr: {
  technicalDifficulty: number;
  executionQuality: number;
  testAdequacy: number;
  riskHandling: number;
  reviewability: number;
  analysisConfidencePct: number;
  outcomeScore: number;
  standout: AnalysisStandout | null;
}): number {
  const qualityBlock =
    (0.4 * pr.executionQuality +
      0.25 * pr.testAdequacy +
      0.2 * pr.riskHandling +
      0.15 * pr.reviewability) /
    5;
  const difficultyBonus = 0.85 + 0.05 * pr.technicalDifficulty;
  const outcomeMultiplier = 0.7 + 0.4 * (pr.outcomeScore / 100);
  let score =
    100 *
    qualityBlock *
    difficultyBonus *
    outcomeMultiplier *
    toConfidence(pr.analysisConfidencePct);

  if (pr.executionQuality <= 2) score = Math.min(score, 45);
  if (pr.standout === "concerning") score = Math.min(score, 25);

  return clamp100(score);
}

function emptyCategoryCounts(): Record<AnalysisCategory, number> {
  return {
    bug_fix: 0,
    feature: 0,
    refactor: 0,
    infra: 0,
    test: 0,
    docs: 0,
    chore: 0,
  };
}

// A per-PR "churn unit": one round beyond the first counts as 1, each
// post-review commit as 0.5, each change-request as 0.3. A smooth PR lands
// at 0. Tuned so typical churn residuals (vs bucket baseline) sit in the
// [-2, +2] range, making the >= 1.0 threshold readable.
function churnUnit(pr: {
  reviewRounds: number;
  commitsAfterFirstReview: number;
  changeRequestCount: number;
}): number {
  return (
    Math.max(0, pr.reviewRounds - 1) +
    0.5 * pr.commitsAfterFirstReview +
    0.3 * pr.changeRequestCount
  );
}

function churnBucketKey(pr: {
  category: AnalysisCategory;
  technicalDifficulty: number;
}): string {
  return `${pr.category}:${pr.technicalDifficulty}`;
}

interface ChurnBaselines {
  overall: number;
  byBucket: Map<string, { mean: number; count: number }>;
  shrinkageK: number;
}

function computeChurnBaselines(prs: PrReviewEntry[]): ChurnBaselines {
  const bucketSums = new Map<string, { sum: number; count: number }>();
  let overallSum = 0;
  let overallCount = 0;
  for (const pr of prs) {
    const unit = churnUnit(pr);
    overallSum += unit;
    overallCount += 1;
    const key = churnBucketKey(pr);
    const entry = bucketSums.get(key) ?? { sum: 0, count: 0 };
    entry.sum += unit;
    entry.count += 1;
    bucketSums.set(key, entry);
  }
  const overall = overallCount > 0 ? overallSum / overallCount : 0;
  const byBucket = new Map<string, { mean: number; count: number }>();
  for (const [key, entry] of bucketSums) {
    byBucket.set(key, { mean: entry.sum / entry.count, count: entry.count });
  }
  return { overall, byBucket, shrinkageK: 5 };
}

function expectedChurn(
  pr: { category: AnalysisCategory; technicalDifficulty: number },
  baselines: ChurnBaselines,
): number {
  const entry = baselines.byBucket.get(churnBucketKey(pr));
  if (!entry) return baselines.overall;
  const k = baselines.shrinkageK;
  return (k * baselines.overall + entry.count * entry.mean) / (k + entry.count);
}

function computeSecondLookReasons(pr: {
  standout: AnalysisStandout | null;
  revertWithin14d: boolean;
  changeRequestCount: number;
  commitsAfterFirstReview: number;
  reviewRounds: number;
  outcomeScore: number;
}): SecondLookReason[] {
  const reasons: SecondLookReason[] = [];
  if (pr.standout === "concerning") reasons.push("model_flagged_concerning");
  if (pr.standout === "notably_low_quality") reasons.push("model_flagged_low_quality");
  if (pr.revertWithin14d) reasons.push("reverted_within_14d");
  if (pr.changeRequestCount >= 3) reasons.push("heavy_change_requests");
  if (pr.commitsAfterFirstReview >= 5) reasons.push("heavy_post_review_commits");
  if (pr.outcomeScore <= 40 && pr.reviewRounds >= 3) {
    reasons.push("low_landing_high_churn");
  }
  return reasons;
}

function computeFlags(
  prs: PrReviewEntry[],
  effectivePrCount: number,
  churnResidual: number,
): DiagnosticFlag[] {
  const flags: DiagnosticFlag[] = [];
  if (effectivePrCount < 2.5) flags.push("low_evidence");
  if (weightedAverage(
    prs.map((pr) => pr.analysisConfidencePct),
    prs.map((pr) => Math.max(0.1, pr.recencyWeight)),
  ) < 65) {
    flags.push("low_confidence");
  }
  if (prs.some((pr) => pr.secondLookReasons.length > 0)) {
    flags.push("has_concerning_pr");
  }
  if (prs.some((pr) => pr.revertWithin14d)) {
    flags.push("reverted_pr");
  }
  if (effectivePrCount >= 2.5 && churnResidual >= 1.0) {
    flags.push("review_churn_high");
  }
  if (prs.length >= 5 && stdev(prs.map((pr) => pr.executionQuality)) >= 1.1) {
    flags.push("quality_variance_high");
  }
  return flags;
}

function bucketWeekly(prs: PrReviewEntry[], windowDays: number): number[] {
  const buckets = Math.max(1, Math.ceil(windowDays / 7));
  const totals = new Array<number>(buckets).fill(0);
  const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const bucketMs = (windowDays * 24 * 60 * 60 * 1000) / buckets;
  for (const pr of prs) {
    const offset = pr.mergedAt.getTime() - windowStart;
    let idx = Math.floor(offset / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= buckets) idx = buckets - 1;
    totals[idx] += pr.prScore;
  }
  return totals;
}

function toSurface(value: string | null | undefined): CodeReviewSurface {
  switch (value) {
    case "frontend":
    case "backend":
    case "data":
    case "infra":
    case "mobile":
    case "mixed":
      return value;
    default:
      return "mixed";
  }
}

function toAgreement(value: string | null | undefined): ModelAgreementLevel {
  switch (value) {
    case "single_model":
    case "confirmed":
    case "minor_adjustment":
    case "material_adjustment":
      return value;
    default:
      return "single_model";
  }
}

function normaliseRow(row: AnalysisRow): Omit<PrReviewEntry, "githubUrl"> {
  const technicalDifficulty = Math.max(1, Math.min(5, row.technicalDifficulty ?? 3));
  const executionQuality = Math.max(1, Math.min(5, row.executionQuality ?? 3));
  const testAdequacy = Math.max(1, Math.min(5, row.testAdequacy ?? executionQuality));
  const riskHandling = Math.max(1, Math.min(5, row.riskHandling ?? executionQuality));
  const reviewability = Math.max(1, Math.min(5, row.reviewability ?? executionQuality));
  const analysisConfidencePct = Math.max(
    0,
    Math.min(100, row.analysisConfidencePct ?? 60),
  );
  const standout = row.standout as AnalysisStandout | null;
  const primarySurface = toSurface(row.primarySurface);
  const outcomeScore = Math.max(0, Math.min(100, row.outcomeScore ?? 75));
  const recency = recencyWeight(row.mergedAt, CODE_REVIEW_WINDOW_DAYS);
  const base = {
    repo: row.repo,
    prNumber: row.prNumber,
    mergedAt: row.mergedAt,
    technicalDifficulty,
    executionQuality,
    testAdequacy,
    riskHandling,
    reviewability,
    analysisConfidencePct,
    category: row.category as AnalysisCategory,
    summary: row.summary,
    caveats: (row.caveats as string[] | null) ?? [],
    standout,
    primarySurface,
    approvalCount: row.approvalCount ?? 0,
    changeRequestCount: row.changeRequestCount ?? 0,
    reviewCommentCount: row.reviewCommentCount ?? 0,
    conversationCommentCount: row.conversationCommentCount ?? 0,
    reviewRounds: row.reviewRounds ?? 0,
    timeToFirstReviewMinutes: row.timeToFirstReviewMinutes ?? null,
    timeToMergeMinutes: row.timeToMergeMinutes ?? 0,
    commitCount: row.commitCount ?? 0,
    commitsAfterFirstReview: row.commitsAfterFirstReview ?? 0,
    revertWithin14d: row.revertWithin14d ?? false,
    outcomeScore,
    reviewProvider: row.reviewProvider ?? "anthropic",
    reviewModel: row.reviewModel ?? "unknown",
    secondOpinionUsed: row.secondOpinionUsed ?? false,
    agreementLevel: toAgreement(row.agreementLevel),
    secondOpinionReasons:
      (row.secondOpinionReasons as SecondOpinionReason[] | null) ?? [],
    qualityScore: 0,
    reviewHealthScore: 0,
    prScore: 0,
    recencyWeight: recency,
  };
  const qualityScore = computeQualityScore(base);
  const reviewHealthScore = computeReviewHealthScore({
    reviewability: base.reviewability,
    changeRequestCount: base.changeRequestCount,
    commitsAfterFirstReview: base.commitsAfterFirstReview,
    reviewRounds: base.reviewRounds,
    reviewCommentCount: base.reviewCommentCount,
    outcomeScore: base.outcomeScore,
  });
  const prScore = computePrScore(base);
  const secondLookReasons = computeSecondLookReasons(base);

  return {
    ...base,
    qualityScore,
    reviewHealthScore,
    prScore,
    secondLookReasons,
  };
}

function buildGithubUrl(repo: string, prNumber: number): string {
  return repo.includes("/")
    ? `https://github.com/${repo}/pull/${prNumber}`
    : `https://github.com/${process.env.GITHUB_ORG ?? ""}/${repo}/pull/${prNumber}`;
}

function rowsLoginFor(rows: Array<{ authorLogin: string }>, key: string): string {
  for (const row of rows) {
    if (row.authorLogin.toLowerCase() === key) return row.authorLogin;
  }
  return key;
}

function buildRollupSet(
  rows: AnalysisRow[],
  employeeByLogin: Map<
    string,
    {
      employeeName?: string | null;
      employeeEmail?: string | null;
      isBot?: boolean | null;
    }
  >,
  windowDays: number,
): EngineerRollup[] {
  const rollupByAuthor = new Map<
    string,
    {
      prs: PrReviewEntry[];
      repos: Set<string>;
      categoryCounts: Record<AnalysisCategory, number>;
      surfaceWeight: Record<CodeReviewSurface, number>;
    }
  >();

  for (const row of rows) {
    const key = row.authorLogin.toLowerCase();
    let bucket = rollupByAuthor.get(key);
    if (!bucket) {
      bucket = {
        prs: [],
        repos: new Set(),
        categoryCounts: emptyCategoryCounts(),
        surfaceWeight: {
          frontend: 0,
          backend: 0,
          data: 0,
          infra: 0,
          mobile: 0,
          mixed: 0,
        },
      };
      rollupByAuthor.set(key, bucket);
    }

    const pr = {
      ...normaliseRow(row),
      githubUrl: buildGithubUrl(row.repo, row.prNumber),
    };
    bucket.prs.push(pr);
    bucket.repos.add(row.repo);
    bucket.categoryCounts[pr.category] = (bucket.categoryCounts[pr.category] ?? 0) + 1;
    bucket.surfaceWeight[pr.primarySurface] += Math.max(
      0.1,
      pr.recencyWeight * toConfidence(pr.analysisConfidencePct),
    );
  }

  const provisional: EngineerRollup[] = [];
  const cohortRawByAuthor = new Map<
    string,
    {
      quality: number;
      difficulty: number;
      reliability: number;
      reviewHealth: number;
      throughput: number;
      cohort: CodeReviewSurface;
    }
  >();

  const allPrsForBaseline: PrReviewEntry[] = [];
  for (const [key, bucket] of rollupByAuthor) {
    const employee = employeeByLogin.get(key);
    if (employee?.isBot) continue;
    allPrsForBaseline.push(...bucket.prs);
  }
  const churnBaselines = computeChurnBaselines(allPrsForBaseline);

  for (const [key, bucket] of rollupByAuthor) {
    const employee = employeeByLogin.get(key);
    if (employee?.isBot) continue;

    const prs = bucket.prs.sort((a, b) => b.mergedAt.getTime() - a.mergedAt.getTime());
    const weights = prs.map((pr) =>
      Math.max(0.1, pr.recencyWeight * toConfidence(pr.analysisConfidencePct)),
    );
    const effectivePrCount = weights.reduce((sum, weight) => sum + weight, 0);
    const totalSurfaceWeight = Object.values(bucket.surfaceWeight).reduce(
      (sum, value) => sum + value,
      0,
    );
    const cohort =
      totalSurfaceWeight <= 0
        ? "mixed"
        : ((Object.entries(bucket.surfaceWeight).sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0] ?? "mixed") as CodeReviewSurface);

    const qualityRaw = weightedAverage(
      prs.map((pr) => pr.qualityScore),
      weights,
    );
    const difficultyRaw = weightedAverage(
      prs.map((pr) => (pr.technicalDifficulty / 5) * 100),
      weights,
    );
    const reliabilityRaw = weightedAverage(
      prs.map((pr) => pr.outcomeScore),
      weights,
    );
    const reviewHealthRaw = weightedAverage(
      prs.map((pr) => pr.reviewHealthScore),
      weights,
    );
    const throughputRaw = prs.reduce(
      (sum, pr) => sum + pr.prScore * pr.recencyWeight,
      0,
    );

    const churnResidual = weightedAverage(
      prs.map((pr) => churnUnit(pr) - expectedChurn(pr, churnBaselines)),
      weights,
    );

    cohortRawByAuthor.set(key, {
      quality: qualityRaw,
      difficulty: difficultyRaw,
      reliability: reliabilityRaw,
      reviewHealth: reviewHealthRaw,
      throughput: throughputRaw,
      cohort,
    });

    provisional.push({
      authorLogin: rowsLoginFor(rows, key),
      employeeName: employee?.employeeName ?? null,
      employeeEmail: employee?.employeeEmail ?? null,
      isBot: employee?.isBot ?? false,
      cohort,
      prCount: prs.length,
      effectivePrCount,
      confidencePct: Math.min(100, Math.round((effectivePrCount / 8) * 100)),
      distinctRepos: bucket.repos.size,
      avgTechnicalDifficulty: weightedAverage(
        prs.map((pr) => pr.technicalDifficulty),
        weights,
      ),
      avgExecutionQuality: weightedAverage(
        prs.map((pr) => pr.executionQuality),
        weights,
      ),
      avgTestAdequacy: weightedAverage(
        prs.map((pr) => pr.testAdequacy),
        weights,
      ),
      avgRiskHandling: weightedAverage(
        prs.map((pr) => pr.riskHandling),
        weights,
      ),
      avgReviewability: weightedAverage(
        prs.map((pr) => pr.reviewability),
        weights,
      ),
      avgOutcomeScore: reliabilityRaw,
      qualityPercentile: 50,
      difficultyPercentile: 50,
      reliabilityPercentile: 50,
      reviewHealthPercentile: 50,
      throughputPercentile: 50,
      rawScore: 50,
      finalScore: 50,
      categoryCounts: bucket.categoryCounts,
      flags: computeFlags(prs, effectivePrCount, churnResidual),
      prs,
      prevFinalScore: null,
      weeklyScore: bucketWeekly(prs, windowDays),
      reviewChurnResidual: churnResidual,
    });
  }

  const allValues = {
    quality: provisional.map((rollup) => cohortRawByAuthor.get(rollup.authorLogin.toLowerCase())!.quality),
    difficulty: provisional.map((rollup) => cohortRawByAuthor.get(rollup.authorLogin.toLowerCase())!.difficulty),
    reliability: provisional.map((rollup) => cohortRawByAuthor.get(rollup.authorLogin.toLowerCase())!.reliability),
    reviewHealth: provisional.map((rollup) => cohortRawByAuthor.get(rollup.authorLogin.toLowerCase())!.reviewHealth),
    throughput: provisional.map((rollup) => cohortRawByAuthor.get(rollup.authorLogin.toLowerCase())!.throughput),
  };

  const byCohort = new Map<CodeReviewSurface, EngineerRollup[]>();
  for (const rollup of provisional) {
    const arr = byCohort.get(rollup.cohort) ?? [];
    arr.push(rollup);
    byCohort.set(rollup.cohort, arr);
  }

  for (const rollup of provisional) {
    const raw = cohortRawByAuthor.get(rollup.authorLogin.toLowerCase())!;
    const cohortMembers = byCohort.get(rollup.cohort) ?? [];
    const useCohort = cohortMembers.length >= 3 ? cohortMembers : provisional;
    const cohortValues = {
      quality: useCohort.map(
        (member) => cohortRawByAuthor.get(member.authorLogin.toLowerCase())!.quality,
      ),
      difficulty: useCohort.map(
        (member) => cohortRawByAuthor.get(member.authorLogin.toLowerCase())!.difficulty,
      ),
      reliability: useCohort.map(
        (member) => cohortRawByAuthor.get(member.authorLogin.toLowerCase())!.reliability,
      ),
      reviewHealth: useCohort.map(
        (member) => cohortRawByAuthor.get(member.authorLogin.toLowerCase())!.reviewHealth,
      ),
      throughput: useCohort.map(
        (member) => cohortRawByAuthor.get(member.authorLogin.toLowerCase())!.throughput,
      ),
    };

    rollup.qualityPercentile = percentileRank(
      raw.quality,
      cohortValues.quality.length === 0 ? allValues.quality : cohortValues.quality,
    );
    rollup.difficultyPercentile = percentileRank(
      raw.difficulty,
      cohortValues.difficulty.length === 0
        ? allValues.difficulty
        : cohortValues.difficulty,
    );
    rollup.reliabilityPercentile = percentileRank(
      raw.reliability,
      cohortValues.reliability.length === 0
        ? allValues.reliability
        : cohortValues.reliability,
    );
    rollup.reviewHealthPercentile = percentileRank(
      raw.reviewHealth,
      cohortValues.reviewHealth.length === 0
        ? allValues.reviewHealth
        : cohortValues.reviewHealth,
    );
    rollup.throughputPercentile = percentileRank(
      raw.throughput,
      cohortValues.throughput.length === 0
        ? allValues.throughput
        : cohortValues.throughput,
    );
    rollup.rawScore =
      0.4 * rollup.qualityPercentile +
      0.2 * rollup.difficultyPercentile +
      0.15 * rollup.reliabilityPercentile +
      0.15 * rollup.reviewHealthPercentile +
      0.1 * rollup.throughputPercentile;
    // Shrink sparse samples toward a neutral prior of 8 effective PRs at score 50.
    rollup.finalScore =
      (8 * 50 + rollup.effectivePrCount * rollup.rawScore) /
      (8 + rollup.effectivePrCount);
  }

  provisional.sort((a, b) => b.finalScore - a.finalScore);
  return provisional;
}

interface RollupOptions {
  windowDays?: number;
  includePrevious?: boolean;
}

export async function getCodeReviewView(
  opts: RollupOptions = {},
): Promise<CodeReviewView> {
  const windowDays = opts.windowDays ?? CODE_REVIEW_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [rows, employeeMap] = await Promise.all([
    db
      .select()
      .from(prReviewAnalyses)
      .where(
        and(
          eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
          gte(prReviewAnalyses.mergedAt, since),
        ),
      )
      .orderBy(desc(prReviewAnalyses.mergedAt)),
    db.select().from(githubEmployeeMap),
  ]);

  let prevRows: AnalysisRow[] = [];
  if (opts.includePrevious) {
    const prevStart = new Date(
      Date.now() - 2 * windowDays * 24 * 60 * 60 * 1000,
    );
    const prevEnd = since;
    prevRows = await db
      .select()
      .from(prReviewAnalyses)
      .where(
        and(
          eq(prReviewAnalyses.rubricVersion, RUBRIC_VERSION),
          gte(prReviewAnalyses.mergedAt, prevStart),
          lt(prReviewAnalyses.mergedAt, prevEnd),
        ),
      );
  }

  const employeeByLogin = new Map(
    employeeMap.map((entry) => [entry.githubLogin.toLowerCase(), entry]),
  );

  const engineers = buildRollupSet(rows as AnalysisRow[], employeeByLogin, windowDays);
  const prevRollups = opts.includePrevious
    ? buildRollupSet(prevRows as AnalysisRow[], employeeByLogin, windowDays)
    : [];
  const prevByAuthor = new Map(
    prevRollups.map((rollup) => [rollup.authorLogin.toLowerCase(), rollup.finalScore]),
  );
  for (const engineer of engineers) {
    engineer.prevFinalScore =
      prevByAuthor.get(engineer.authorLogin.toLowerCase()) ?? null;
  }

  let analysedAtLatest: Date | null = null;
  for (const row of rows as AnalysisRow[]) {
    if (!analysedAtLatest || row.analysedAt > analysedAtLatest) {
      analysedAtLatest = row.analysedAt;
    }
  }

  return {
    windowDays,
    rubricVersion: RUBRIC_VERSION,
    analysedAtLatest,
    engineers,
    totalPrs: rows.length,
  };
}
