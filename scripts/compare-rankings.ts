/**
 * Cross-ranking comparison.
 *
 * Pulls each engineer's rank from the four ranking surfaces we have
 * — engineers page (volume-based), code-review page (quality composite),
 * ranking page snapshot (cohort-relative methodology), tournament ELO —
 * and reports per-engineer ranks side-by-side plus an aggregate.
 *
 * The B-side surface displays the same `engineering_ranking_snapshots`
 * data as the ranking page, just with different UI framing — it isn't a
 * fifth scoring system.
 */
import { sql, desc, eq, gte, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  engineerRatings,
  engineerTournamentRuns,
  engineeringRankingSnapshots,
  prReviewAnalyses,
  githubEmployeeMap,
} from "@/lib/db/schema";
import { getEngineeringRankings } from "@/lib/data/engineering";
import { hashEmailForRanking } from "@/lib/data/engineering-ranking";

interface RankRow {
  email: string;
  name: string;
  engineersRank: number | null;
  codeReviewRank: number | null;
  rankingPageRank: number | null;
  tournamentRank: number | null;
}

async function main() {
  const windowDays = 90;

  // 1. Engineers page — sorted by prsCount desc (the page's default).
  const engineering = await getEngineeringRankings(windowDays);
  const engineeringSorted = [...engineering]
    .filter((e) => !e.isBot && e.employeeEmail && e.prsCount > 0)
    .sort((a, b) => b.prsCount - a.prsCount);

  // 2. Code-review page — sorted by composite quality * volume score.
  // Note: dev has data on older rubric versions only — this picks the most
  // recent populated version and computes a simple proxy of finalScore
  // rather than calling getCodeReviewView (which is hard-coded to the
  // current rubric and returns 0 in dev).
  const [latestRubric] = await db
    .select({ rubricVersion: prReviewAnalyses.rubricVersion })
    .from(prReviewAnalyses)
    .groupBy(prReviewAnalyses.rubricVersion)
    .orderBy(desc(sql`max(${prReviewAnalyses.analysedAt})`))
    .limit(1);
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const crRows = latestRubric
    ? await db
        .select({
          authorLogin: prReviewAnalyses.authorLogin,
          email: githubEmployeeMap.employeeEmail,
          name: githubEmployeeMap.employeeName,
          isBot: githubEmployeeMap.isBot,
          prCount: sql<number>`count(*)::int`,
          avgQuality: sql<number>`avg(${prReviewAnalyses.executionQuality})::float`,
          avgDifficulty: sql<number>`avg(${prReviewAnalyses.technicalDifficulty})::float`,
          avgOutcome: sql<number>`avg(${prReviewAnalyses.outcomeScore})::float`,
        })
        .from(prReviewAnalyses)
        .leftJoin(
          githubEmployeeMap,
          eq(
            sql`lower(${githubEmployeeMap.githubLogin})`,
            sql`lower(${prReviewAnalyses.authorLogin})`,
          ),
        )
        .where(
          and(
            eq(prReviewAnalyses.rubricVersion, latestRubric.rubricVersion),
            gte(prReviewAnalyses.mergedAt, since),
          ),
        )
        .groupBy(
          prReviewAnalyses.authorLogin,
          githubEmployeeMap.employeeEmail,
          githubEmployeeMap.employeeName,
          githubEmployeeMap.isBot,
        )
    : [];
  // Composite score similar to the page's finalScore: weighted product of
  // quality * difficulty * outcome, scaled by sqrt(prCount).
  const codeReviewSorted = crRows
    .filter((r) => !r.isBot && r.email && r.prCount >= 5)
    .map((r) => ({
      ...r,
      finalScore:
        r.avgQuality * r.avgDifficulty * (r.avgOutcome / 100) *
        Math.sqrt(r.prCount),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);

  // 3. Ranking page snapshot — latest snapshot for the current methodology.
  const latestSnapshot = await db
    .select({ snapshotDate: engineeringRankingSnapshots.snapshotDate })
    .from(engineeringRankingSnapshots)
    .orderBy(desc(engineeringRankingSnapshots.snapshotDate))
    .limit(1);
  const snapshotRows =
    latestSnapshot.length === 0
      ? []
      : await db
          .select({
            emailHash: engineeringRankingSnapshots.emailHash,
            rank: engineeringRankingSnapshots.rank,
            compositeScore: engineeringRankingSnapshots.compositeScore,
          })
          .from(engineeringRankingSnapshots)
          .where(
            eq(
              engineeringRankingSnapshots.snapshotDate,
              latestSnapshot[0].snapshotDate,
            ),
          );
  const rankByEmailHash = new Map<string, number>();
  for (const row of snapshotRows) {
    if (row.rank !== null) rankByEmailHash.set(row.emailHash, row.rank);
  }

  // 4. Tournament — latest completed run.
  const [latestRun] = await db
    .select({ id: engineerTournamentRuns.id })
    .from(engineerTournamentRuns)
    .where(eq(engineerTournamentRuns.status, "completed"))
    .orderBy(desc(engineerTournamentRuns.id))
    .limit(1);
  const tournamentSorted = latestRun
    ? await db
        .select({
          email: engineerRatings.engineerEmail,
          rating: sql<number>`${engineerRatings.rating}::float`,
          judgments: engineerRatings.judgmentsPlayed,
        })
        .from(engineerRatings)
        .where(eq(engineerRatings.runId, latestRun.id))
        .orderBy(desc(engineerRatings.rating))
    : [];
  const tournamentRankByEmail = new Map<string, number>();
  let tRank = 0;
  for (const row of tournamentSorted) {
    if (row.judgments > 0) {
      tRank++;
      tournamentRankByEmail.set(row.email.toLowerCase(), tRank);
    }
  }

  // Merge all four by email.
  const byEmail = new Map<string, RankRow>();
  function ensure(email: string, name: string): RankRow {
    const key = email.toLowerCase();
    let row = byEmail.get(key);
    if (!row) {
      row = {
        email: key,
        name,
        engineersRank: null,
        codeReviewRank: null,
        rankingPageRank: null,
        tournamentRank: null,
      };
      byEmail.set(key, row);
    }
    return row;
  }

  engineeringSorted.forEach((e, idx) => {
    if (!e.employeeEmail) return;
    const row = ensure(e.employeeEmail, e.employeeName ?? e.employeeEmail);
    row.engineersRank = idx + 1;
  });
  codeReviewSorted.forEach((e, idx) => {
    if (!e.email) return;
    const row = ensure(e.email, e.name ?? e.email);
    row.codeReviewRank = idx + 1;
  });
  for (const e of engineering) {
    if (!e.employeeEmail) continue;
    const hash = hashEmailForRanking(e.employeeEmail);
    const rank = rankByEmailHash.get(hash);
    if (rank) {
      const row = ensure(e.employeeEmail, e.employeeName ?? e.employeeEmail);
      row.rankingPageRank = rank;
    }
  }
  for (const [email, rank] of tournamentRankByEmail) {
    const eng = engineering.find(
      (x) => x.employeeEmail?.toLowerCase() === email,
    );
    const row = ensure(email, eng?.employeeName ?? email);
    row.tournamentRank = rank;
  }

  // Compute aggregate (mean rank across the surfaces the engineer appears on).
  // Only include engineers ranked on ≥3 surfaces so partial coverage doesn't
  // produce misleading "rank 1 averages" from a single source.
  const all = [...byEmail.values()];
  const enriched = all
    .map((row) => {
      const ranks = [
        row.engineersRank,
        row.codeReviewRank,
        row.rankingPageRank,
        row.tournamentRank,
      ].filter((r): r is number => r !== null);
      const meanRank = ranks.length > 0
        ? ranks.reduce((s, r) => s + r, 0) / ranks.length
        : null;
      const spread = ranks.length > 1 ? Math.max(...ranks) - Math.min(...ranks) : 0;
      return { ...row, ranks, meanRank, spread };
    })
    .filter((r) => r.ranks.length >= 3);
  enriched.sort((a, b) => (a.meanRank ?? Infinity) - (b.meanRank ?? Infinity));

  // Sources summary
  console.log(`\nSources:`);
  console.log(`  Engineers page (volume): ${engineeringSorted.length} engineers`);
  console.log(`  Code review (composite, rubric ${latestRubric?.rubricVersion ?? "n/a"}): ${codeReviewSorted.length} engineers`);
  console.log(`  Ranking page snapshot:   ${rankByEmailHash.size} engineers (date ${latestSnapshot[0]?.snapshotDate ?? "n/a"})`);
  console.log(`  Tournament (run #${latestRun?.id}):       ${tournamentRankByEmail.size} engineers`);
  console.log(`  Engineers ranked on ≥3 surfaces: ${enriched.length}\n`);

  console.log("Aggregate ranking (engineers in ≥3 surfaces, sorted by mean rank):\n");
  console.log("   #  | mean | spread | Eng | CR  | Rank| Tour | Engineer");
  console.log("------+------+--------+-----+-----+-----+------+--------------------------------");
  enriched.forEach((row, idx) => {
    const fmt = (r: number | null) => (r === null ? " — " : String(r).padStart(3));
    console.log(
      ` ${String(idx + 1).padStart(3)}  | ${row.meanRank!.toFixed(1).padStart(4)} | ${String(row.spread).padStart(6)} | ${fmt(row.engineersRank)} | ${fmt(row.codeReviewRank)} | ${fmt(row.rankingPageRank)} | ${fmt(row.tournamentRank).padStart(4)} | ${row.name}`,
    );
  });

  // Most divergent (highest spread) — engineers where the surfaces disagree most.
  console.log("\n\nLargest disagreements (highest spread between best and worst rank):");
  const divergent = [...enriched].sort((a, b) => b.spread - a.spread).slice(0, 12);
  console.log("   spread | Eng | CR  | Rank| Tour | Engineer");
  console.log("---------+-----+-----+-----+------+--------------------------------");
  divergent.forEach((row) => {
    const fmt = (r: number | null) => (r === null ? " — " : String(r).padStart(3));
    console.log(
      `   ${String(row.spread).padStart(6)} | ${fmt(row.engineersRank)} | ${fmt(row.codeReviewRank)} | ${fmt(row.rankingPageRank)} | ${fmt(row.tournamentRank).padStart(4)} | ${row.name}`,
    );
  });
}

main().then(() => process.exit(0));
