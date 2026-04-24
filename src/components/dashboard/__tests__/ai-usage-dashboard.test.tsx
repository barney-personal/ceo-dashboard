import { render, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AiUsageDashboard } from "../ai-usage-dashboard";
import { AiUsageMetricCard } from "../ai-usage-metric-card";
import { PeerDistributionStrip } from "../../charts/peer-distribution-strip";

const MOCK_CLIENT_WIDTH = 1000;
const MOCK_PADDING = 16;

let originalGetComputedStyle: typeof window.getComputedStyle;

beforeEach(() => {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return MOCK_CLIENT_WIDTH;
    },
  });
  // jsdom doesn't implement getBoundingClientRect sizing — emulate so the
  // Panel width calc returns something usable.
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: MOCK_CLIENT_WIDTH,
      bottom: 300,
      width: MOCK_CLIENT_WIDTH,
      height: 300,
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
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)
    .clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .getBoundingClientRect;
});

const WEEKLY_CATEGORY = [
  { weekStart: "2026-03-16", category: "cursor", distinctUsers: 80, totalCost: 1900, totalTokens: 2_000_000_000 },
  { weekStart: "2026-03-23", category: "claude", distinctUsers: 35, totalCost: 900, totalTokens: 1_500_000_000 },
  { weekStart: "2026-03-23", category: "cursor", distinctUsers: 90, totalCost: 2100, totalTokens: 2_500_000_000 },
  { weekStart: "2026-04-06", category: "claude", distinctUsers: 40, totalCost: 1200, totalTokens: 2_000_000_000 },
  { weekStart: "2026-04-06", category: "cursor", distinctUsers: 100, totalCost: 2400, totalTokens: 3_000_000_000 },
  { weekStart: "2026-04-13", category: "claude", distinctUsers: 45, totalCost: 1500, totalTokens: 2_500_000_000 },
  { weekStart: "2026-04-13", category: "cursor", distinctUsers: 110, totalCost: 3700, totalTokens: 4_400_000_000 },
];

const MONTHLY_MODEL = [
  { monthStart: "2026-04-01", category: "ALL MODELS", modelName: "ALL MODELS", distinctUsers: 150, nDays: 22, totalCost: 8000, totalTokens: 9_000_000_000 },
  { monthStart: "2026-03-01", category: "ALL MODELS", modelName: "ALL MODELS", distinctUsers: 140, nDays: 30, totalCost: 6200, totalTokens: 7_500_000_000 },
  { monthStart: "2026-04-01", category: "claude", modelName: "Claude Sonnet 4.6", distinctUsers: 80, nDays: 18, totalCost: 4500, totalTokens: 5_500_000_000 },
  { monthStart: "2026-03-01", category: "claude", modelName: "Claude Sonnet 4.6", distinctUsers: 70, nDays: 28, totalCost: 3800, totalTokens: 4_800_000_000 },
  { monthStart: "2026-04-01", category: "cursor", modelName: "default", distinctUsers: 120, nDays: 21, totalCost: 2800, totalTokens: 3_300_000_000 },
  { monthStart: "2026-03-01", category: "cursor", modelName: "default", distinctUsers: 100, nDays: 29, totalCost: 1800, totalTokens: 2_100_000_000 },
];

const MONTHLY_USER = [
  {
    monthStart: "2026-04-01",
    category: "claude",
    userEmail: "alice@meetcleo.com",
    nDays: 15, nModelsUsed: 2,
    totalCost: 900, totalTokens: 1_200_000_000,
  },
  {
    monthStart: "2026-04-01",
    category: "cursor",
    userEmail: "alice@meetcleo.com",
    nDays: 10, nModelsUsed: 1,
    totalCost: 240, totalTokens: 300_000_000,
  },
  {
    monthStart: "2026-03-01",
    category: "claude",
    userEmail: "alice@meetcleo.com",
    nDays: 18, nModelsUsed: 2,
    totalCost: 600, totalTokens: 900_000_000,
  },
  {
    monthStart: "2026-04-01",
    category: "cursor",
    userEmail: "bob@meetcleo.com",
    nDays: 8, nModelsUsed: 1,
    totalCost: 120, totalTokens: 200_000_000,
  },
];

const USER_TRENDS = {
  "alice@meetcleo.com": [
    { monthStart: "2026-03-01", cost: 600, tokens: 900_000_000 },
    { monthStart: "2026-04-01", cost: 1140, tokens: 1_500_000_000 },
  ],
  "bob@meetcleo.com": [
    { monthStart: "2026-03-01", cost: 0, tokens: 0 },
    { monthStart: "2026-04-01", cost: 120, tokens: 200_000_000 },
  ],
};

const MODEL_TRENDS = [
  {
    modelName: "Claude Sonnet 4.6",
    category: "claude",
    trend: [
      { monthStart: "2026-03-01", cost: 3800, tokens: 4_800_000_000 },
      { monthStart: "2026-04-01", cost: 4500, tokens: 5_500_000_000 },
    ],
    latestCost: 4500,
    priorCost: 3800,
  },
  {
    modelName: "default",
    category: "cursor",
    trend: [
      { monthStart: "2026-03-01", cost: 1800, tokens: 2_100_000_000 },
      { monthStart: "2026-04-01", cost: 2800, tokens: 3_300_000_000 },
    ],
    latestCost: 2800,
    priorCost: 1800,
  },
];

const PEOPLE = [
  {
    email: "alice@meetcleo.com",
    name: "Alice",
    jobTitle: "Engineer",
    squad: "Alpha",
    pillar: "Engineering",
  },
  {
    email: "bob@meetcleo.com",
    name: "Bob",
    jobTitle: "PM",
    squad: "Beta",
    pillar: "Product",
  },
];

describe("AiUsageDashboard", () => {
  it("renders the stacked-area chart with Claude + Cursor series", () => {
    const { container } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
        claudeDataStart="2026-03-23"
      />,
    );
    // Stacked-area title + legend present.
    expect(container.textContent).toContain("Weekly AI spend");
    expect(container.textContent).toContain("Claude");
    expect(container.textContent).toContain("Cursor");
    // Annotation text rendered.
    expect(container.textContent).toContain("Claude data begins");
  });

  it("renders top-N model breakdown with MoM delta column", () => {
    const { container } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
      />,
    );
    expect(container.textContent).toContain("Latest month by model");
    expect(container.textContent).toContain("Claude Sonnet 4.6");
    // (4500-3800)/3800 = +18%
    expect(container.textContent).toMatch(/\+18%/);
    // (2800-1800)/1800 = +56%
    expect(container.textContent).toMatch(/\+56%/);
  });

  it("renders per-model small multiples with one panel per model", () => {
    const { container } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
      />,
    );
    expect(container.textContent).toContain("Monthly spend by top models");
    expect(container.textContent).toContain("One panel per model");
    // Both panels rendered with their titles.
    const panels = container.querySelectorAll("svg");
    // At least: 1 stacked-area SVG + small-multiples panel SVGs.
    expect(panels.length).toBeGreaterThan(2);
  });

  it("renders leaderboard with sparklines + MoM deltas + median marker", () => {
    const { container, getByText } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
      />,
    );
    expect(container.textContent).toContain("Who's spending the most");
    expect(container.textContent).toContain("Median peer");
    // Alice first (higher spend): 900 + 240 = 1140
    const alice = getByText("Alice");
    expect(alice).toBeTruthy();
    // MoM for Alice: (1140-600)/600 = +90%
    expect(container.textContent).toMatch(/\+90%/);
    // Bob: no prior-month row → "new" badge.
    expect(container.textContent).toContain("new");
    // Sparklines — at least one <polyline path> per user row.
    const tbody = container.querySelector("tbody");
    const sparklines = tbody?.querySelectorAll("svg path") ?? [];
    expect(sparklines.length).toBeGreaterThanOrEqual(2);
  });

  it("only links user names to /dashboard/people/[slug] when canViewProfiles is true", () => {
    // Non-manager view: names render as plain text, no anchor tag.
    const { container: nonMgr } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
        canViewProfiles={false}
      />,
    );
    expect(nonMgr.textContent).toContain("Alice");
    expect(nonMgr.querySelector("a[href*='/dashboard/people/alice']")).toBeNull();

    // Manager view: names become anchor links.
    const { container: mgr } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
        canViewProfiles={true}
      />,
    );
    expect(mgr.querySelector("a[href='/dashboard/people/alice']")).toBeTruthy();
  });

  it("caps leaderboard to the Top 15 default and exposes the selector", () => {
    const { container, getByDisplayValue } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
      />,
    );
    // Only 2 users in fixture but selector still defaults to "Top 15".
    expect(getByDisplayValue("Top 15")).toBeTruthy();
    // Ensure at least one pillar-filter option from the fixture data.
    expect(container.textContent).toContain("Engineering");
  });

  it("renders the monthly model mix chart when data is provided", () => {
    const { container } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        monthlyModelMix={{
          months: ["2026-03-01", "2026-04-01"],
          models: [
            { modelName: "Claude Sonnet 4.6", category: "claude", totalCost: 8300 },
            { modelName: "default", category: "cursor", totalCost: 4600 },
          ],
          rows: [
            { monthStart: "2026-03-01", "Claude Sonnet 4.6": 3800, default: 1800 },
            { monthStart: "2026-04-01", "Claude Sonnet 4.6": 4500, default: 2800 },
          ],
        }}
        people={PEOPLE}
      />,
    );
    expect(container.textContent).toContain("Monthly model mix");
    expect(container.textContent).toContain("How spend is split by model");
    // Both legend entries appear.
    expect(container.textContent).toContain("Claude Sonnet 4.6");
    expect(container.textContent).toContain("default");
  });

  it("renders the weekly metric toggle (cost vs tokens)", () => {
    const { container } = render(
      <AiUsageDashboard
        weeklyByCategory={WEEKLY_CATEGORY}
        monthlyByModel={MONTHLY_MODEL}
        monthlyByUser={MONTHLY_USER}
        userTrends={USER_TRENDS}
        modelTrends={MODEL_TRENDS}
        people={PEOPLE}
      />,
    );
    // Default label is cost.
    expect(container.textContent).toContain("Weekly AI spend");
    // Toggle buttons exist.
    const costTab = container.querySelector("button[aria-selected='true']");
    expect(costTab?.textContent).toContain("$ cost");
  });
});

describe("AiUsageMetricCard", () => {
  it("shows sparkline + trend badge + value", () => {
    const { container } = render(
      <AiUsageMetricCard
        label="Trailing 30 days"
        value="$7,500"
        deltaPct={12}
        subtitle="vs $6,700 prior 30d"
        sparkline={[100, 200, 180, 220, 260]}
      />,
    );
    expect(container.textContent).toContain("Trailing 30 days");
    expect(container.textContent).toContain("$7,500");
    expect(container.textContent).toContain("+12%");
    // Sparkline rendered as SVG path.
    const spark = container.querySelector("svg path");
    expect(spark).toBeTruthy();
  });

  it("hides sparkline when fewer than 2 points or all zero", () => {
    const { container } = render(
      <AiUsageMetricCard
        label="Test"
        value="$0"
        deltaPct={null}
        sparkline={[0, 0, 0]}
      />,
    );
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBe(0);
  });

  it("colors up deltas amber and down deltas positive (greenlike)", () => {
    const { container: up } = render(
      <AiUsageMetricCard label="X" value="1" deltaPct={25} />,
    );
    expect(up.innerHTML).toContain("text-amber-700");

    const { container: down } = render(
      <AiUsageMetricCard label="X" value="1" deltaPct={-25} />,
    );
    expect(down.innerHTML).toContain("text-positive");
  });

  it("inverts delta color when higherIsBetter", () => {
    const { container: up } = render(
      <AiUsageMetricCard label="X" value="1" deltaPct={25} higherIsBetter />,
    );
    expect(up.innerHTML).toContain("text-positive");
    expect(up.innerHTML).not.toContain("text-amber-700");

    const { container: down } = render(
      <AiUsageMetricCard label="X" value="1" deltaPct={-25} higherIsBetter />,
    );
    expect(down.innerHTML).toContain("text-amber-700");
    expect(down.innerHTML).not.toContain("text-positive");
  });
});

describe("PeerDistributionStrip", () => {
  it("renders peer dots + highlighted user + percentile label", () => {
    const { container } = render(
      <PeerDistributionStrip
        peers={[1, 5, 10, 50, 100, 500, 1000]}
        userValue={100}
      />,
    );
    // Every non-zero peer renders a dot — 7 small dots + 1 highlight.
    const dots = container.querySelectorAll("div.absolute");
    expect(dots.length).toBeGreaterThanOrEqual(7);
    // Percentile reported (100 is the 5th of 7 sorted → 71% → "top 29%")
    const pct = within(container).getByText(/top \d+%|bottom \d+%/);
    expect(pct).toBeTruthy();
  });

  it("returns null when no positive peers", () => {
    const { container } = render(
      <PeerDistributionStrip peers={[0, 0, 0]} userValue={0} />,
    );
    expect(container.textContent).toBe("");
  });
});
