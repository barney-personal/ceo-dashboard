import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WatchlistTable } from "../watchlist";
import type { ImpactEngineer } from "@/lib/data/engineering-impact";

beforeEach(() => {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 900;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 900,
      bottom: 400,
      width: 900,
      height: 400,
      toJSON: () => "",
    }),
  });
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)
    .clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .getBoundingClientRect;
});

/** Build a peer cohort sized so the under-performer is "moderate"
 *  (peerRatio < 0.75) and the trajectory is "declining" — both
 *  conditions required for a row to appear in the watchlist. */
function makeCohort(opts: {
  underperformer: { aiSpend: number | null; impact90d: number; impact30d: number };
}): ImpactEngineer[] {
  const peers: ImpactEngineer[] = Array.from({ length: 6 }, (_, i) =>
    base({
      email: `peer${i}@x`,
      name: `Peer ${i}`,
      githubLogin: `peer${i}`,
      impact90d: 100,
      impact30d: 30,
      aiSpend: 50,
    }),
  );
  const target = base({
    email: "target@x",
    name: "Target",
    githubLogin: "target",
    impact90d: opts.underperformer.impact90d,
    impact30d: opts.underperformer.impact30d,
    aiSpend: opts.underperformer.aiSpend,
  });
  return [...peers, target];
}

function base(over: Partial<ImpactEngineer>): ImpactEngineer {
  return {
    email: "x@example.com",
    name: "Person",
    githubLogin: "person",
    isMatched: true,
    discipline: "BE",
    levelRaw: "L4",
    levelNum: 4,
    levelTrack: "IC",
    levelLabel: "L4",
    squad: null,
    pillar: "Pillar",
    jobTitle: "Backend Engineer",
    startDate: "2023-01-01",
    tenureMonthsNow: 18,
    location: null,
    totalPrs: 100,
    totalAdditions: 5000,
    totalDeletions: 2000,
    totalImpact: 200,
    impact30d: 30,
    impact90d: 100,
    impact180d: 180,
    impact360d: 250,
    prs30d: 4,
    prs90d: 10,
    prs180d: 18,
    aiSpend: 50,
    aiTokens: 50_000_000,
    aiMonthStart: "2026-04-01",
    ...over,
  };
}

describe("WatchlistTable AI pill", () => {
  it("shows the 'try AI?' pill when the engineer has aiSpend === 0", () => {
    const engineers = makeCohort({
      underperformer: { aiSpend: 0, impact90d: 60, impact30d: 4 },
    });
    const { container } = render(<WatchlistTable engineers={engineers} />);
    expect(container.textContent).toContain("Target");
    expect(container.textContent).toContain("try AI?");
    // Column header is shown because at least one engineer has AI data.
    expect(container.textContent).toContain("AI $/mo");
  });

  it("does NOT show the pill when aiSpend is null (unmatched in dataset)", () => {
    const engineers = makeCohort({
      underperformer: { aiSpend: null, impact90d: 60, impact30d: 4 },
    });
    const { container } = render(<WatchlistTable engineers={engineers} />);
    expect(container.textContent).toContain("Target");
    // Pill must not fire — null means "not matched", not "non-adopter".
    expect(container.textContent).not.toContain("try AI?");
  });

  it("does NOT show the pill or AI column when no engineer has AI data (Mode outage)", () => {
    // Wipe AI fields on every engineer in the cohort.
    const engineers = makeCohort({
      underperformer: { aiSpend: null, impact90d: 60, impact30d: 4 },
    }).map((e) => ({ ...e, aiSpend: null, aiTokens: null, aiMonthStart: null }));
    const { container } = render(<WatchlistTable engineers={engineers} />);
    expect(container.textContent).toContain("Target");
    expect(container.textContent).not.toContain("try AI?");
    // Column header gone.
    expect(container.textContent).not.toContain("AI $/mo");
  });

  it("does NOT show the pill for engineers with positive AI spend", () => {
    const engineers = makeCohort({
      underperformer: { aiSpend: 25, impact90d: 60, impact30d: 3 },
    });
    const { container } = render(<WatchlistTable engineers={engineers} />);
    expect(container.textContent).toContain("Target");
    expect(container.textContent).not.toContain("try AI?");
  });
});
