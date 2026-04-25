import { computeTenureDays, getActiveEmployees, type Person } from "./people";

export interface EngineerEligibilityCriteria {
  /** Window length in days the ranking covers. */
  windowDays: number;
  /** If true (default), require tenure ≥ windowDays so the dossier reflects
   *  performance across a full window — engineers who joined mid-window get
   *  excluded rather than judged on a short ramp-up. Set to false on pages
   *  that explicitly want to surface recent hires (e.g. the engineers page
   *  shows them under a "+N new hires" banner instead of ranking them). */
  requireFullTenure?: boolean;
}

/**
 * Active engineering employees eligible for performance ranking over the
 * given window. Single source of truth for "is this person an engineer we
 * should rank" — adopted by:
 *   - /dashboard/engineering/tournament (this PR)
 * and intended to be adopted by engineers + code-review pages as a follow-up
 * so the three rankings stay consistent.
 *
 * Filters applied:
 *  - person.function === "Engineering" (per Mode SSoT normalisation)
 *  - person has a non-empty email
 *  - tenure ≥ windowDays when requireFullTenure (default true)
 */
export async function getEligibleEngineers(
  criteria: EngineerEligibilityCriteria,
): Promise<Person[]> {
  try {
    const { employees, unassigned } = await getActiveEmployees();
    const requireTenure = criteria.requireFullTenure !== false;
    return [...employees, ...unassigned].filter((p) => {
      if (p.function !== "Engineering") return false;
      if (!p.email) return false;
      if (requireTenure) {
        // computeTenureDays returns 0 when startDate is missing/unparseable,
        // which is fine — we'd rather exclude people with unknown tenure than
        // wrongly rank them on a partial window.
        if (!p.startDate) return false;
        if (computeTenureDays(p.startDate) < criteria.windowDays) return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}
