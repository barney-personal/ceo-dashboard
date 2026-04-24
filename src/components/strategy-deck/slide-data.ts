// Static, copy-only data for the strategy deck. Kept out of the rendering
// component so editorial copy edits (move principles, focus areas, slide
// preview captions) don't require touching the JSX in `strategy-deck.tsx`.

export const SLIDE_PREVIEWS: Record<string, string> = {
  cover: "Cleo.",
  mission: "To change the world’s relationship with money.",
  vision: "An AI assistant between people and their money.",
  target: "IPO. Within five years.",
  market: "TAM · SAM · SOM",
  users: "Who uses Cleo today.",
  crux: "By 2026, we exhaust our core audience.",
  "strategy-core": "Build a financial AI assistant.",
  "move-1": "Break the high-cost credit trap.",
  "move-2": "Save users money on recurring expenses.",
  "move-3": "Win on data.",
  "move-4": "Expand beyond the US.",
  flywheel: "The compounding loop.",
  "wont-do": "What we will not do.",
  closing: "The loop starts now.",
};

export interface MoveSlideData {
  id: string;
  label: string;
  n: number;
  sectionNumber: string;
  title: string;
  principle: string;
  focusAreas: string[];
}

export const MOVE_SLIDES: readonly MoveSlideData[] = [
  {
    id: "move-1",
    label: "Move 01 · Credit",
    n: 1,
    sectionNumber: "08",
    title: "Break the high-cost credit trap.",
    principle:
      "Help users break the credit trap with a suite of affordable products and guided support across the cycle — driving scale and profitability via retention and cross-selling.",
    focusAreas: [
      "Build a product suite that addresses additional stages in the debt cycle.",
      "Improve product economics to offer competitive pricing at scale.",
      "Use AI to drive behavioural change through credit guidance.",
      "Optimise for credit-suite-level success and retention.",
    ],
  },
  {
    id: "move-2",
    label: "Move 02 · Recurring",
    n: 2,
    sectionNumber: "09",
    title: "Save users money on recurring expenses.",
    principle:
      "Help users reduce recurring expenses and free up cashflow — using AI to spot savings opportunities and take action: cancel, switch, or optimise.",
    focusAreas: [
      "Cut major expenses via bundling services directly.",
      "Transform cashflow via consolidated payments and credit.",
      "Save money automatically across the long-tail via affiliate offers and negotiation.",
    ],
  },
  {
    id: "move-3",
    label: "Move 03 · Data",
    n: 3,
    sectionNumber: "10",
    title: "Win on data.",
    principle:
      "Use data to make the AI smarter every day — the flywheel that sharpens recommendations and decisions, boosts trust, and deepens engagement.",
    focusAreas: [
      "Understand each user’s financial life in depth.",
      "Prioritise data accuracy and quality.",
      "Provide universal data accessibility across the platform.",
    ],
  },
  {
    id: "move-4",
    label: "Move 04 · Geo",
    n: 4,
    sectionNumber: "11",
    title: "Expand beyond the US.",
    principle:
      "Bring Cleo to more lives by expanding into geographies where we can deliver fast value — phased, scalable, and locally informed.",
    focusAreas: [
      "Start in markets most similar to the U.S.",
      "Dual-track rollout: chat & EWA.",
      "Modularise tech to enable repeatable launches.",
      "Operate within regulations, in close contact with regulators.",
      "Ramp paid growth only once metrics validate readiness.",
    ],
  },
] as const;
