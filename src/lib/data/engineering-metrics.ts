/**
 * Pure, client-safe math for engineering impact metrics.
 *
 * Kept separate from `./engineering.ts` so the EngineeringTable client
 * component can import it without dragging the Postgres/drizzle server
 * dependencies into the browser bundle.
 */

export function computeImpact(
  prs: number,
  additions: number,
  deletions: number
): number {
  if (prs <= 0) return 0;
  return Math.round(prs * Math.log2(1 + (additions + deletions) / prs));
}
