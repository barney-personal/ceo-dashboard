/**
 * Engineering discipline classification — the single source of truth for
 * "what kind of engineer is this person?".
 *
 * Every page that filters the engineering cohort — the ranking page
 * (`engineering-ranking.ts`), the impact page (`engineering-impact.ts`), and
 * the engineers list (`engineering.ts`) — reads this module so they cannot
 * drift on edge cases like the `(M)` manager suffix or the long tail of
 * specialisation strings HiBob emits during a standardisation rollout.
 *
 * Two separate definitions of `classifyDiscipline` existed here before this
 * module landed; the ranking-side one gained `(M)`-suffix handling while the
 * impact-side one kept a `DISCIPLINE_BY_SPECIALISATION` map. Both are merged
 * below.
 */

export type Discipline =
  | "BE"
  | "FE"
  | "EM"
  | "QA"
  | "ML"
  | "Ops"
  | "Other";

/**
 * `rp_specialisation` is the authoritative HiBob signal post-April-2026
 * standardisation. Values are canonical role names ("Backend Engineer",
 * "Machine Learning Engineer", etc.) with no seniority prefix, so exact
 * matches are cheap and reliable. The substring fallback below catches
 * anyone whose `rp_specialisation` is still blank during the rollout.
 */
const DISCIPLINE_BY_SPECIALISATION: Record<string, Discipline> = {
  "backend engineer": "BE",
  "python engineer": "BE",
  "frontend engineer": "FE",
  "engineering manager": "EM",
  "qa engineer": "QA",
  "machine learning engineer": "ML",
  "ml ops engineer": "ML",
  "head of machine learning": "ML",
  "machine learning engineering manager": "ML",
  "technical operations": "Ops",
};

/**
 * Classify a headcount row into a discipline from its `rp_specialisation`
 * and, if needed, `job_title`. The "(M)" suffix on rp_specialisation marks
 * managers across every discipline (e.g. "Engineer - Backend (M)",
 * "Data Engineer - ML Ops (M)") — detected first so a manager variant
 * never inherits the IC discipline below.
 */
export function classifyDiscipline(
  rpSpecialisation: string | null | undefined,
  jobTitle: string | null | undefined,
): Discipline {
  const s = (rpSpecialisation ?? "").trim().toLowerCase();
  const j = (jobTitle ?? "").toLowerCase();

  if (/\(m\)\s*$/.test(s)) return "EM";

  const exact = DISCIPLINE_BY_SPECIALISATION[s];
  if (exact) return exact;

  if (s.includes("backend") || j.includes("backend")) return "BE";
  if (s.includes("frontend") || j.includes("frontend")) return "FE";
  if (s.includes("engineering manager") || j.includes("engineering manager")) {
    return "EM";
  }
  if (s.includes("qa") || j.includes("qa")) return "QA";
  if (s.includes("machine learning") || s.includes("ml ") || j.includes("ml ")) {
    return "ML";
  }
  if (s.includes("python")) return "BE";
  if (s.includes("technical operations")) return "Ops";
  return "Other";
}

/**
 * Disciplines eligible for the competitive cohort — product-engineering IC
 * roles (Backend and Frontend) whose primary output is merging code into
 * product repos. Every other discipline is deliberately excluded:
 *
 *  - EM: managers ship less code by role design — ranking alongside ICs
 *    mislabels the role itself as underperformance.
 *  - QA: test / quality engineering has a different shipping cadence and
 *    often lands changes via non-PR surfaces.
 *  - ML: model training / data-science work does not line up with the
 *    per-PR rubric and impact model on which this ranking is built.
 *  - Ops: platform / infra / DevOps roles deploy changes via different
 *    pipelines and often land fewer but higher-risk PRs.
 *  - Other: any specialisation the discipline classifier could not
 *    confidently tag (Data engineers, Graduate buckets, etc.).
 *
 * Rows that classify into any of those disciplines are recorded on the
 * roster as `non_rankable_role` (so they appear in coverage counts) but
 * not ranked. See `engineering-ranking.ts` for the roster build.
 */
export const RANKABLE_DISCIPLINES: ReadonlySet<Discipline> = new Set<Discipline>([
  "BE",
  "FE",
]);

export function isRankableDiscipline(discipline: Discipline): boolean {
  return RANKABLE_DISCIPLINES.has(discipline);
}
