import { db } from "@/lib/db";
import { engineeringRankingSnapshots } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { hashEmailForRanking } from "@/lib/data/engineering-ranking";
import { getDirectReports } from "@/lib/data/managers";
import {
  applyManagerFlagThreshold,
  type BriefingManagerFlag,
  type BriefingManagerFlagsBlock,
} from "@/lib/data/briefing-helpers";

/**
 * Flag a manager's direct reports who sit in the bottom of the persisted
 * engineering ranking with enough confidence to be worth discussing. Reads
 * the most recent snapshot slice (latest `snapshotDate`, any methodology
 * version) so the briefing stays useful between methodology bumps.
 *
 * Returns null when the viewer isn't a manager (no direct reports), when no
 * report is in the ranking (e.g. non-engineering team), or when no snapshot
 * has been persisted yet. `flagged` may be empty even when non-null — that
 * means reports were found in the ranking but none cleared the threshold.
 */
export async function loadManagerFlags({
  managerEmail,
}: {
  managerEmail: string | null;
}): Promise<BriefingManagerFlagsBlock | null> {
  if (!managerEmail) return null;

  const reports = await getDirectReports(managerEmail);
  if (reports.length === 0) return null;

  const hashByEmail = new Map<string, string>();
  const nameByHash = new Map<string, string>();
  const squadByHash = new Map<string, string | null>();
  for (const r of reports) {
    const email = r.email.toLowerCase();
    const hash = hashEmailForRanking(email);
    hashByEmail.set(email, hash);
    nameByHash.set(hash, r.name);
    squadByHash.set(hash, r.squad ?? r.pillar ?? null);
  }

  const hashes = Array.from(hashByEmail.values());

  const [latestRow] = await db
    .select({ snapshotDate: engineeringRankingSnapshots.snapshotDate })
    .from(engineeringRankingSnapshots)
    .where(inArray(engineeringRankingSnapshots.emailHash, hashes))
    .orderBy(desc(engineeringRankingSnapshots.snapshotDate))
    .limit(1);

  if (!latestRow) return null;
  const snapshotDate = latestRow.snapshotDate;

  const rows = await db
    .select({
      emailHash: engineeringRankingSnapshots.emailHash,
      rank: engineeringRankingSnapshots.rank,
      adjustedPercentile: engineeringRankingSnapshots.adjustedPercentile,
      confidenceHigh: engineeringRankingSnapshots.confidenceHigh,
    })
    .from(engineeringRankingSnapshots)
    .where(
      and(
        eq(engineeringRankingSnapshots.snapshotDate, snapshotDate),
        inArray(engineeringRankingSnapshots.emailHash, hashes),
      ),
    );

  if (rows.length === 0) return null;

  const parseNumeric = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const candidates: BriefingManagerFlag[] = rows.map((row) => ({
    name: nameByHash.get(row.emailHash) ?? "Unknown",
    rank: row.rank,
    percentile: parseNumeric(row.adjustedPercentile),
    confidenceHigh: parseNumeric(row.confidenceHigh),
    squad: squadByHash.get(row.emailHash) ?? null,
    snapshotDate,
  }));

  const flagged = applyManagerFlagThreshold(candidates);

  return {
    snapshotDate,
    totalReportsChecked: rows.length,
    flagged,
  };
}
