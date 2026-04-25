import { ELO_K_FACTOR } from "./config";
import type { Verdict } from "./types";

export interface EloUpdate {
  ratingA: number;
  ratingB: number;
  scoreA: number; // 1 = A win, 0.5 = draw, 0 = B win
  expectedA: number;
  deltaA: number;
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function applyEloUpdate(
  ratingA: number,
  ratingB: number,
  verdict: Verdict,
  k: number = ELO_K_FACTOR,
): EloUpdate {
  const scoreA = verdict === "A" ? 1 : verdict === "B" ? 0 : 0.5;
  const expectedA = expectedScore(ratingA, ratingB);
  const deltaA = k * (scoreA - expectedA);
  return {
    ratingA: ratingA + deltaA,
    ratingB: ratingB - deltaA,
    scoreA,
    expectedA,
    deltaA,
  };
}
