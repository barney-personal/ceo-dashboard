// Average Gregorian month length used for tenure bucketing.
export const DAYS_PER_MONTH = 30.44;

// ---------------------------------------------------------------------------
// Job-title normalisation
// ---------------------------------------------------------------------------

/**
 * Seniority prefixes stripped from job titles — the `level` field handles
 * seniority. Longer prefixes first to avoid partial matches.
 */
const SENIORITY_PREFIXES = [
  "principal",
  "associate",
  "graduate",
  "senior",
  "junior",
  "staff",
  "lead",
  "grad",
  "intern",
];

/**
 * Maps variant job titles (lowercased, after seniority stripping) to a single
 * canonical display name. Only roles that genuinely need consolidation are
 * listed — everything else gets title-cased as-is.
 */
const JOB_TITLE_ALIASES: Record<string, string> = {
  // Backend Engineering
  "backend engineer": "Backend Engineer",
  "back-end engineer": "Backend Engineer",
  "python engineer": "Backend Engineer",
  // Frontend Engineering
  "frontend engineer": "Frontend Engineer",
  "front-end engineer": "Frontend Engineer",
  "frontend software engineer": "Frontend Engineer",
  // Generic Software Engineering (level prefix may refine further)
  "full stack engineer": "Software Engineer",
  "full-stack engineer": "Software Engineer",
  "fullstack engineer": "Software Engineer",
  "software engineer": "Software Engineer",
  "software developer": "Software Engineer",
  "engineer": "Software Engineer",
  // Data Science → Machine Learning
  "data scientist": "Machine Learning",
  "data science": "Machine Learning",
  "data science manager": "Machine Learning Manager",
  // UX Researcher → User Researcher
  "ux researcher": "User Researcher",
};

/** Words that should remain fully uppercased in title-cased output. */
const UPPERCASE_WORDS = new Set([
  "qa", "it", "vp", "hr", "pm", "cto", "cfo", "coo", "ceo",
  "ui", "ux", "ml", "ai", "sre", "devops",
]);

/** Level suffixes stripped from job titles (e.g. "Software Engineer II"). */
const LEVEL_SUFFIX_RE = /\s+I{1,3}$/i;

/**
 * Normalise a raw job title:
 * 1. Strip seniority prefix (Senior, Graduate, etc.)
 * 2. Strip level suffix (II, III)
 * 3. Consolidate known aliases (Backend Engineer → Software Engineer)
 * 4. Apply consistent Title Case
 */
export function normalizeJobTitle(raw: string): string {
  let title = raw.trim();
  if (!title) return title;

  // Strip one seniority prefix
  const lower = title.toLowerCase();
  for (const prefix of SENIORITY_PREFIXES) {
    if (lower.startsWith(prefix + " ")) {
      title = title.slice(prefix.length + 1).trim();
      break;
    }
  }

  // Strip level suffix (e.g. "II", "III")
  title = title.replace(LEVEL_SUFFIX_RE, "").trim();

  if (!title) return toTitleCase(raw.trim());

  // Check aliases (after prefix/suffix stripping)
  const key = title.toLowerCase();
  const alias = JOB_TITLE_ALIASES[key];
  if (alias) return alias;

  return toTitleCase(title);
}

/**
 * Resolve a person's engineering discipline from the standardised
 * `rp_specialisation` field in the Mode Headcount SSoT.
 *
 * The People team standardised `rp_specialisation` in April 2026 so it carries
 * the canonical discipline without seniority prefix ("Backend Engineer",
 * "Frontend Engineer", "Machine Learning Engineer", etc.). When that signal is
 * present we trust it directly and ignore the normalised job title. Falling
 * back to the title only matters for stragglers whose `rp_specialisation` is
 * blank.
 */
export function resolveEngineerDiscipline(
  normalizedTitle: string,
  specialisation?: string,
): string {
  const spec = (specialisation ?? "").trim();
  if (spec) {
    const aliased = JOB_TITLE_ALIASES[spec.toLowerCase()];
    if (aliased) return aliased;
    return spec;
  }
  return normalizedTitle;
}

/**
 * Reassign people to the correct department based on their specialisation.
 *
 * The People team split "Data Science" into "Analytics" and "Machine Learning"
 * at source, but some HiBob rows still carry `hb_function = "Data Science"`
 * during the transition. We route them based on `rp_specialisation` first
 * (canonical), then fall back to the normalised job title.
 *
 * "Product" rows whose specialisation/title is analyst, marketing, or design
 * belong in their functional department.
 */
export function normalizeDepartment(
  department: string,
  normalizedJobTitle: string,
  specialisation?: string,
): string {
  const signal = (specialisation || normalizedJobTitle || "").toLowerCase();
  if (!signal) return department;

  if (department === "Data Science") {
    if (
      signal.includes("machine learning") ||
      signal.includes("ml ops") ||
      signal.includes("data engineer")
    ) {
      return "Machine Learning";
    }
    return "Analytics";
  }

  if (department === "Product") {
    if (signal.includes("analyst")) return "Analytics";
    if (signal.includes("marketing")) return "Marketing";
    if (signal.includes("design")) return "Experience";
  }

  return department;
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((word) => {
      if (UPPERCASE_WORDS.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

const SQUAD_PILLAR_MAP: Record<string, string> = {
  // Growth
  "Growth Pillar": "Growth",
  "Growth Conversion": "Growth",
  "Growth Marketing": "Growth",
  "Growth Personalisation": "Growth",
  "Growth Engagement (Sea Otters)": "Growth",
  "Growth Activation (Shire)": "Growth",
  Virality: "Growth",
  "Notifications & Prompts": "Growth",
  "Prompts & Upsells": "Growth",
  // EWA & Credit Products
  "EWA Pillar": "EWA & Credit Products",
  "EWA & Credit Products Pillar": "EWA & Credit Products",
  "EWA Core Squad": "EWA & Credit Products",
  "EWA Modelling": "EWA & Credit Products",
  "Geo Expansion": "EWA & Credit Products",
  BNPL: "EWA & Credit Products",
  "Instalment Loan": "EWA & Credit Products",
  Debt: "EWA & Credit Products",
  "Pricing & Lending": "EWA & Credit Products",
  Credit: "EWA & Credit Products",
  // Chat
  "Chat Pillar": "Chat",
  "Chat 1: Chat Evaluations": "Chat",
  "Chat 2: AI Money Pro": "Chat",
  "Chat 3: Recommender": "Chat",
  "Chat 4: Experience": "Chat",
  "Chat 5: AI Core": "Chat",
  "Chat 5: AI Core Squad": "Chat",
  "Chat System": "Chat",
  "Chat tools": "Chat",
  "Chat Insights": "Chat",
  "Chat: Daily Plans": "Chat",
  // New Bets
  "New Bets Pillar": "New Bets",
  "New Bets Pillar Leads & Shared Resources": "New Bets",
  "New Bets - Gamification": "New Bets",
  Discovery: "New Bets",
  Mobile: "New Bets",
  Bundles: "New Bets",
  // Card
  "Card Pillar": "Card",
  "Card 1": "Card",
  "Card 2": "Card",
  "Builder Pillar": "Card",
  // Access, Trust & Money, Risk & Payments
  "Payments Infrastructure": "Access, Trust & Money, Risk & Payments",
  "Fraud & Security": "Access, Trust & Money, Risk & Payments",
  "Fraud Infrastructure": "Access, Trust & Money, Risk & Payments",
  "Identity & Access": "Access, Trust & Money, Risk & Payments",
  "Access Trust and Money": "Access, Trust & Money, Risk & Payments",
  "Risk Analystics": "Access, Trust & Money, Risk & Payments",
  "Pricing & Packaging": "Access, Trust & Money, Risk & Payments",
  // Platform
  "Front End Platform": "Platform",
  "Site Reliability & Data Platform": "Platform",
  "Platform (Backend & MLOps)": "Platform",
  Platform: "Platform",
  "Data Enablement": "Platform",
  // Business Operations
  Talent: "Talent & People",
  People: "Talent & People",
  "People Team": "Talent & People",
  Marketing: "Marketing",
  Champs: "Customer Operations",
  Operations: "Customer Operations",
  "Customer Operations": "Customer Operations",
  Finance: "Finance",
  Commercial: "Commercial",
  "Legal & Compliance": "Legal & Compliance",
  Compliance: "Legal & Compliance",
  Exec: "Exec",
  CEO: "Exec",
  Management: "Exec",
  IT: "Business Operations",
  Experience: "Experience",
  Voice: "Experience",
  "User Research": "Experience",
};

const PRODUCT_PILLARS = new Set([
  // Rev canonical names
  "Growth Pillar",
  "EWA & Credit Products Pillar",
  "Chat Pillar",
  "New Bets Pillar",
  "Access, Trust & Money",
  "Risk & Payments Decisioning",
  "Enablement",
  "Wealth Pillar",
  "Win On Data",
  // Legacy names (old Headcount SSoT fallback)
  "Growth",
  "EWA & Credit Products",
  "Chat",
  "New Bets",
  "Card",
  "Access, Trust & Money, Risk & Payments",
  "Platform",
]);

export function getPillarForSquad(squad: string): string {
  const directMatch = SQUAD_PILLAR_MAP[squad];
  if (directMatch) return directMatch;

  for (const part of squad.split(",")) {
    const pillar = SQUAD_PILLAR_MAP[part.trim()];
    if (pillar) return pillar;
  }

  return "Other";
}

export function isProductPillar(pillar: string): boolean {
  return PRODUCT_PILLARS.has(pillar);
}
