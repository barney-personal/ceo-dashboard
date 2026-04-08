// Average Gregorian month length used for tenure bucketing.
export const DAYS_PER_MONTH = 30.44;

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

  return "Business Operations";
}

export function isProductPillar(pillar: string): boolean {
  return PRODUCT_PILLARS.has(pillar);
}
