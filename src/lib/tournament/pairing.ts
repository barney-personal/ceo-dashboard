export interface PairSelection {
  aEmail: string;
  bEmail: string;
}

export interface PairingEngineer {
  email: string;
  rating: number;
  judgmentsPlayed: number;
}

export interface PairingOptions {
  /** Every engineer must have at least this many judgments before Swiss kicks in. */
  minMatchesFloor?: number;
  /** Swiss-mode look-ahead: pair against engineers within ±N positions in the
   *  rating-sorted order. Smaller = tighter rating bands but more rematches. */
  swissBandSize?: number;
  /** Skip pairs whose rating gap exceeds this in the Swiss phase. Once an
   *  engineer is clearly above/below the field they should stop scheduling
   *  matches that just confirm what we already know. */
  maxRatingGap?: number;
  /** Cap on how many times the same pair can play. Forces the algorithm to
   *  spread matches across the pool rather than re-running settled matchups. */
  maxRematches?: number;
  /** Cap on how many judgments any single engineer can be in across the run.
   *  Prevents one strong engineer (e.g. Cassie/Nacho) from soaking up most of
   *  the compute by being paired with every newcomer who hasn't lost yet. */
  maxJudgmentsPerEngineer?: number;
}

const DEFAULT_MIN_MATCHES = 5;
const DEFAULT_SWISS_BAND = 4;
const DEFAULT_MAX_RATING_GAP = 350;
const DEFAULT_MAX_REMATCHES = 5;
const DEFAULT_MAX_JUDGMENTS_PER_ENGINEER = 60;
/** Seen-count weight in the score. Lower = more willing to rematch close pairs
 *  rather than playing far-apart unseen ones. We keep this lower than the
 *  rating-gap signal so a 4× rematch of a close pair still beats an unseen
 *  pair that's >400 ELO apart. */
const SCORE_SEEN_WEIGHT = 100;

/**
 * Pick the next pair given current ratings + per-engineer judgment counts +
 * historical pair counts. Returns null when no eligible pair remains — the
 * tournament should stop scheduling matches at that point rather than burning
 * compute on rematches above the cap or pairings far above the rating-gap.
 *
 * Strategy:
 *  1. Min-matches floor — until every engineer has at least N judgments,
 *     pair under-played engineers together so coverage gets locked in cheaply.
 *  2. Swiss-style — sort by rating, pick a random anchor, then pick a partner
 *     from within ±band positions, filtered by maxRematches + maxRatingGap,
 *     scored by seen-count + rating-gap.
 *  3. Whole-pool fallback — if no in-band candidate qualifies, search the
 *     whole pool under the same constraints. If still nothing: null.
 */
export function selectNextPair(
  engineers: PairingEngineer[],
  pairCounts: Map<string, number>,
  options: PairingOptions = {},
  rng: () => number = Math.random,
): PairSelection | null {
  if (engineers.length < 2) {
    throw new Error("Need at least 2 engineers to form a pair");
  }
  const minFloor = options.minMatchesFloor ?? DEFAULT_MIN_MATCHES;
  const band = options.swissBandSize ?? DEFAULT_SWISS_BAND;
  const maxGap = options.maxRatingGap ?? DEFAULT_MAX_RATING_GAP;
  const maxRematches = options.maxRematches ?? DEFAULT_MAX_REMATCHES;
  const maxPerEngineer =
    options.maxJudgmentsPerEngineer ?? DEFAULT_MAX_JUDGMENTS_PER_ENGINEER;

  // Engineers who've hit their per-engineer cap are excluded from any further
  // pairings. This is the primary way we prevent one strong engineer from
  // soaking up all the compute.
  const eligible = engineers.filter((e) => e.judgmentsPlayed < maxPerEngineer);
  if (eligible.length < 2) return null;

  const belowFloor = eligible.filter((e) => e.judgmentsPlayed < minFloor);

  if (belowFloor.length >= 2) {
    const sorted = [...belowFloor].sort(
      (a, b) => a.judgmentsPlayed - b.judgmentsPlayed,
    );
    const a = sorted[0];
    let bestB: PairingEngineer | null = null;
    let bestScore = Infinity;
    for (const candidate of sorted.slice(1)) {
      const seen = pairCounts.get(pairKey(a.email, candidate.email)) ?? 0;
      if (seen >= maxRematches) continue;
      const score = seen * SCORE_SEEN_WEIGHT + candidate.judgmentsPlayed;
      if (score < bestScore) {
        bestScore = score;
        bestB = candidate;
      }
    }
    if (bestB) return { aEmail: a.email, bEmail: bestB.email };
  }

  if (belowFloor.length === 1) {
    const a = belowFloor[0];
    const others = eligible.filter((e) => e.email !== a.email);
    others.sort(
      (x, y) => Math.abs(x.rating - a.rating) - Math.abs(y.rating - a.rating),
    );
    let bestB: PairingEngineer | null = null;
    let bestSeen = Infinity;
    for (const candidate of others.slice(0, 8)) {
      const seen = pairCounts.get(pairKey(a.email, candidate.email)) ?? 0;
      if (seen >= maxRematches) continue;
      if (seen < bestSeen) {
        bestSeen = seen;
        bestB = candidate;
      }
    }
    if (bestB) return { aEmail: a.email, bEmail: bestB.email };
  }

  const sorted = [...eligible].sort((a, b) => b.rating - a.rating);
  let bestPair: PairSelection | null = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < 32; attempt++) {
    const anchorIdx = Math.floor(rng() * sorted.length);
    const anchor = sorted[anchorIdx];
    const lo = Math.max(0, anchorIdx - band);
    const hi = Math.min(sorted.length - 1, anchorIdx + band);
    for (let i = lo; i <= hi; i++) {
      if (i === anchorIdx) continue;
      const candidate = sorted[i];
      const seen = pairCounts.get(pairKey(anchor.email, candidate.email)) ?? 0;
      if (seen >= maxRematches) continue;
      const ratingGap = Math.abs(anchor.rating - candidate.rating);
      if (ratingGap > maxGap) continue;
      const score = seen * SCORE_SEEN_WEIGHT + ratingGap;
      if (score < bestScore) {
        bestScore = score;
        bestPair = { aEmail: anchor.email, bEmail: candidate.email };
      }
    }
    if (bestPair && bestScore < 50) break;
  }

  if (bestPair) return bestPair;

  return wholePoolFallback(eligible, pairCounts, maxGap, maxRematches);
}

function wholePoolFallback(
  engineers: PairingEngineer[],
  pairCounts: Map<string, number>,
  maxGap: number,
  maxRematches: number,
): PairSelection | null {
  let bestPair: PairSelection | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < engineers.length; i++) {
    for (let j = i + 1; j < engineers.length; j++) {
      const a = engineers[i];
      const b = engineers[j];
      const seen = pairCounts.get(pairKey(a.email, b.email)) ?? 0;
      if (seen >= maxRematches) continue;
      const gap = Math.abs(a.rating - b.rating);
      if (gap > maxGap) continue;
      const score = seen * SCORE_SEEN_WEIGHT + gap;
      if (score < bestScore) {
        bestScore = score;
        bestPair = { aEmail: a.email, bEmail: b.email };
      }
    }
  }
  return bestPair;
}

/**
 * Pure-random selection (used by dry-run smoke tests). Kept for backward
 * compatibility; the tournament runner now uses selectNextPair.
 */
export function selectRandomPair(
  eligibleEmails: string[],
  pairCounts: Map<string, number>,
  rng: () => number = Math.random,
): PairSelection {
  if (eligibleEmails.length < 2) {
    throw new Error("Need at least 2 eligible engineers to form a pair");
  }
  const minCount = leastSeenPairCount(eligibleEmails, pairCounts);
  for (let attempt = 0; attempt < 50; attempt++) {
    const a = eligibleEmails[Math.floor(rng() * eligibleEmails.length)];
    const b = eligibleEmails[Math.floor(rng() * eligibleEmails.length)];
    if (a === b) continue;
    const key = pairKey(a, b);
    if ((pairCounts.get(key) ?? 0) <= minCount) {
      return { aEmail: a, bEmail: b };
    }
  }
  const a = eligibleEmails[Math.floor(rng() * eligibleEmails.length)];
  let b = eligibleEmails[Math.floor(rng() * eligibleEmails.length)];
  while (b === a) {
    b = eligibleEmails[Math.floor(rng() * eligibleEmails.length)];
  }
  return { aEmail: a, bEmail: b };
}

export function pairKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join("|");
}

function leastSeenPairCount(
  emails: string[],
  pairCounts: Map<string, number>,
): number {
  if (emails.length < 2) return 0;
  let min = Infinity;
  for (let i = 0; i < emails.length; i++) {
    for (let j = i + 1; j < emails.length; j++) {
      const count = pairCounts.get(pairKey(emails[i], emails[j])) ?? 0;
      if (count < min) min = count;
      if (min === 0) return 0;
    }
  }
  return min === Infinity ? 0 : min;
}
