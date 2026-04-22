import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AiAdoptionByTenure,
  AiSpendVsImpactScatter,
  RampUpByAiUsage,
} from "../ai-tooling";
import type {
  ImpactEngineer,
  ImpactTenureBucket,
} from "@/lib/data/engineering-impact";

const MOCK_CLIENT_WIDTH = 900;
const MOCK_PADDING = 16;

let originalGetComputedStyle: typeof window.getComputedStyle;

beforeEach(() => {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return MOCK_CLIENT_WIDTH;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: MOCK_CLIENT_WIDTH,
      bottom: 400,
      width: MOCK_CLIENT_WIDTH,
      height: 400,
      toJSON: () => "",
    }),
  });
  originalGetComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
    const real = originalGetComputedStyle.call(window, el);
    return new Proxy(real, {
      get(target, prop) {
        if (prop === "paddingLeft") return `${MOCK_PADDING}px`;
        if (prop === "paddingRight") return `${MOCK_PADDING}px`;
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
    });
  });
  // ResizeObserver isn't in jsdom — provide a noop so useContainerWidth
  // doesn't throw when mounted.
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

function makeEngineer(over: Partial<ImpactEngineer>): ImpactEngineer {
  return {
    email: "alice@example.com",
    name: "Alice",
    githubLogin: "alice",
    isMatched: true,
    discipline: "BE",
    levelRaw: "L4",
    levelNum: 4,
    levelTrack: "IC",
    levelLabel: "L4",
    squad: null,
    pillar: "Money",
    jobTitle: "Backend Engineer",
    startDate: "2024-01-01",
    tenureMonthsNow: 14,
    location: null,
    totalPrs: 100,
    totalAdditions: 5000,
    totalDeletions: 2000,
    totalImpact: 200,
    impact30d: 40,
    impact90d: 100,
    impact180d: 180,
    impact360d: 250,
    prs30d: 4,
    prs90d: 10,
    prs180d: 18,
    aiSpend: null,
    aiTokens: null,
    aiMonthStart: null,
    ...over,
  };
}

describe("AiSpendVsImpactScatter", () => {
  it("falls back to a not-enough-data message when fewer than 5 engineers have AI rows", () => {
    const engineers = [
      makeEngineer({ email: "a@x", aiSpend: 100, impact90d: 50 }),
      makeEngineer({ email: "b@x", aiSpend: null, impact90d: 30 }),
    ];
    const { container } = render(
      <AiSpendVsImpactScatter engineers={engineers} />,
    );
    expect(container.textContent).toContain("Insufficient AI usage data");
  });

  it("plots one circle per engineer with AI usage", () => {
    const engineers = Array.from({ length: 8 }, (_, i) =>
      makeEngineer({
        email: `e${i}@x`,
        impact90d: 30 + i * 10,
        aiSpend: 10 + i * 50,
        aiMonthStart: "2026-04-01",
      }),
    );
    const { container } = render(
      <AiSpendVsImpactScatter engineers={engineers} />,
    );
    // Plot dots are <circle> nodes inside the scatter SVG.
    const dots = container.querySelectorAll("svg circle");
    expect(dots.length).toBe(8);
    // Median crosshair labels render the chosen medians.
    expect(container.textContent).toMatch(/median spend:/);
    expect(container.textContent).toMatch(/median impact:/);
    // Quadrant labels present.
    expect(container.textContent).toContain("HIGH IMPACT · HIGH SPEND");
    expect(container.textContent).toContain("LOW IMPACT · LOW SPEND");
  });

  it("excludes engineers with null aiSpend from the dot count", () => {
    const engineers = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeEngineer({
          email: `with${i}@x`,
          impact90d: 50,
          aiSpend: 100 + i,
          aiMonthStart: "2026-04-01",
        }),
      ),
      makeEngineer({ email: "without@x", impact90d: 50, aiSpend: null }),
    ];
    const { container } = render(
      <AiSpendVsImpactScatter engineers={engineers} />,
    );
    expect(container.querySelectorAll("svg circle").length).toBe(5);
  });
});

describe("RampUpByAiUsage", () => {
  function bucket(
    over: Partial<ImpactTenureBucket>,
  ): ImpactTenureBucket {
    return {
      email: "alice@example.com",
      tenureMonth: 0,
      bucketStart: "2024-01-01",
      prs: 0,
      additions: 0,
      deletions: 0,
      impact: 0,
      inWindow: true,
      ...over,
    };
  }

  it("renders a ramp-up line per AI usage tier with engineer counts", () => {
    const engineers = [
      makeEngineer({ email: "heavy@x", aiSpend: 800 }),
      makeEngineer({ email: "light@x", aiSpend: 50 }),
      makeEngineer({ email: "none@x", aiSpend: null }),
    ];
    const buckets: ImpactTenureBucket[] = [];
    for (const e of engineers) {
      for (let m = 0; m <= 6; m++) {
        buckets.push(
          bucket({
            email: e.email,
            tenureMonth: m,
            prs: 5 + m,
            additions: (5 + m) * 100,
            deletions: 50,
          }),
        );
      }
    }
    const { container } = render(
      <RampUpByAiUsage engineers={engineers} buckets={buckets} />,
    );
    // Caption should reference the tier-3 threshold.
    expect(container.textContent).toContain("Heavy = top tertile");
    // Direct labels — at minimum one tier label per cohort, with the (n) count.
    expect(container.textContent).toMatch(/Heavy AI \(\d+\)/);
    expect(container.textContent).toMatch(/Light AI \(\d+\)/);
    expect(container.textContent).toMatch(/No AI/);
  });
});

describe("AiAdoptionByTenure", () => {
  it("renders one bar per tenure bucket with adoption percentages", () => {
    // 4 engineers in 0–3mo (3 with AI), 2 in 1–2yr (1 with AI), 1 in 4yr+ (0)
    const engineers = [
      makeEngineer({ email: "a@x", tenureMonthsNow: 1, aiSpend: 50 }),
      makeEngineer({ email: "b@x", tenureMonthsNow: 1, aiSpend: 80 }),
      makeEngineer({ email: "c@x", tenureMonthsNow: 2, aiSpend: 20 }),
      makeEngineer({ email: "d@x", tenureMonthsNow: 2, aiSpend: 0 }),
      makeEngineer({ email: "e@x", tenureMonthsNow: 18, aiSpend: 100 }),
      makeEngineer({ email: "f@x", tenureMonthsNow: 18, aiSpend: null }),
      makeEngineer({ email: "g@x", tenureMonthsNow: 60, aiSpend: null }),
    ];
    const { container } = render(<AiAdoptionByTenure engineers={engineers} />);
    expect(container.textContent).toContain("0–3 mo");
    expect(container.textContent).toContain("4 yr+");
    // Overall reference line label
    expect(container.textContent).toMatch(/overall: \d+%/);
    // n labels under bars
    expect(container.textContent).toMatch(/n=4/);
  });
});
