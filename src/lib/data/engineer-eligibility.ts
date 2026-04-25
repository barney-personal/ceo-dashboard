import { classifyDiscipline, isRankableDiscipline } from "./disciplines";
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
  /** If true (default), restrict to backend + frontend engineers — the
   *  "product engineer" cohort that gets judged head-to-head against the
   *  same rubric. QA, platform, ML, data and engineering managers do real
   *  work but their output looks different and shouldn't compete on the
   *  same leaderboard. Set to false on pages that explicitly want the full
   *  Engineering function (e.g. headcount-style listings). */
  productEngineerOnly?: boolean;
}

/**
 * Active engineering employees eligible for performance ranking over the
 * given window. Single source of truth for "is this person an engineer we
 * should rank" — adopted by:
 *   - /dashboard/engineering/engineers (+ squads + pillars)
 *   - /dashboard/engineering/code-review
 *   - /dashboard/engineering/ranking
 *   - /dashboard/engineering/tournament
 * so the four ranking surfaces share the same inclusion rules.
 *
 * Filters applied (defaults in parens):
 *  - person.function === "Engineering" (per Mode SSoT normalisation)
 *  - person has a non-empty email
 *  - tenure ≥ windowDays  (requireFullTenure default true)
 *  - jobTitle is backend/frontend  (productEngineerOnly default true)
 */
export async function getEligibleEngineers(
  criteria: EngineerEligibilityCriteria,
): Promise<Person[]> {
  try {
    const { employees, unassigned } = await getActiveEmployees();
    const requireTenure = criteria.requireFullTenure !== false;
    const productOnly = criteria.productEngineerOnly !== false;
    return [...employees, ...unassigned].filter((p) => {
      if (p.function !== "Engineering") return false;
      if (!p.email) return false;
      // person.jobTitle preserves the rp_specialisation "(M)" suffix when
      // present (see resolveEngineerDiscipline in config/people.ts), so we
      // pass it as the rpSpecialisation argument — the canonical
      // classifyDiscipline helper handles the manager-suffix detection there.
      if (productOnly && !isRankableDiscipline(classifyDiscipline(p.jobTitle, undefined))) {
        return false;
      }
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

/** Convenience: just the email set, lowercased — handy for filtering joined
 *  data (PR analyses, Slack messages, etc.) without re-running the full
 *  Person reconstruction. */
export async function getEligibleEngineerEmails(
  criteria: EngineerEligibilityCriteria,
): Promise<Set<string>> {
  const people = await getEligibleEngineers(criteria);
  return new Set(people.map((p) => p.email.toLowerCase()));
}
