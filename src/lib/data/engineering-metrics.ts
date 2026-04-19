/**
 * Pure, client-safe math for engineering impact metrics.
 *
 * Kept separate from `./engineering.ts` so the EngineeringTable client
 * component can import the helpers without dragging the Postgres/drizzle
 * server dependencies into the browser bundle.
 */

/** Days below this get the "New" treatment: rate is shown but de-emphasised
 *  and they sort to the bottom of the rate column. */
export const RAMPING_DAYS = 30;
/** Lower bound on the rate denominator — a 3-day tenure doesn't get to
 *  project 10× its output onto a 30-day window. */
export const MIN_ACTIVE_DAYS = 14;

/**
 * Raw impact score. Mirrors the formula displayed in the UI.
 */
export function computeImpact(
  prs: number,
  additions: number,
  deletions: number
): number {
  if (prs <= 0) return 0;
  return Math.round(prs * Math.log2(1 + (additions + deletions) / prs));
}

/**
 * Tenure-normalised impact: extrapolates raw impact to a 30-day cadence over
 * the engineer's actual active days inside the measurement window. Keeps
 * short-tenured employees from being unfairly ranked last against veterans.
 *
 * When `tenureDays` is null (unmatched engineer), we assume the full
 * `periodDays` to avoid silent inflation.
 */
export function computeImpactRate(
  impact: number,
  tenureDays: number | null,
  periodDays: number
): { impactPer30d: number; activeDays: number; isRamping: boolean } {
  const tenure = tenureDays ?? periodDays;
  const activeDays = Math.max(MIN_ACTIVE_DAYS, Math.min(periodDays, tenure));
  const impactPer30d = Math.round((impact * 30) / activeDays);
  const isRamping = tenureDays != null && tenureDays < RAMPING_DAYS;
  return { impactPer30d, activeDays, isRamping };
}
