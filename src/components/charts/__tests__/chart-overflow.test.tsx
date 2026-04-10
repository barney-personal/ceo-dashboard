import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LineChart } from "../line-chart";
import { ColumnChart } from "../column-chart";
import { ConversionCurveChart } from "../conversion-curve-chart";
import { SmallMultiplesCurveChart } from "../small-multiples-curve-chart";

/*
 * These tests verify that no SVG element extends beyond the right edge of
 * the SVG's coordinate space. The root cause of the overflow bug was
 * twofold:
 *
 * 1. Charts used `container.clientWidth` (which includes padding) as the
 *    SVG width, but CSS `width: 100%` sizes the SVG to the content box.
 *    This mismatch causes the rightmost ~32px to be clipped.
 *
 * 2. Conversion curve charts place end-labels to the right of the last
 *    data point, but the right margin wasn't wide enough to contain them.
 */

const MOCK_CLIENT_WIDTH = 800;
const MOCK_PADDING = 16; // Matches px-4 in Tailwind
const EXPECTED_SVG_WIDTH = MOCK_CLIENT_WIDTH - MOCK_PADDING * 2; // 768

// --- Test data ---

const LINE_SERIES = [
  {
    label: "Actual",
    color: "#3b3bba",
    data: [
      { date: "2024-01-01", value: 10 },
      { date: "2024-06-01", value: 20 },
      { date: "2024-12-01", value: 15 },
    ],
  },
  {
    label: "Target",
    color: "#999",
    dashed: true,
    data: [
      { date: "2024-01-01", value: 12 },
      { date: "2024-06-01", value: 18 },
      { date: "2024-12-01", value: 22 },
    ],
  },
];

const COLUMN_DATA = [
  { date: "2024-01-01", value: 100 },
  { date: "2024-02-01", value: 120 },
  { date: "2024-03-01", value: 90 },
];

const STEPS = ["M0", "M1", "M2", "M3", "M4", "M5", "M6"];

const CURVE_SERIES = [
  {
    label: "2023-01",
    color: "#c4c8d4",
    data: STEPS.map((step, i) => ({ step, value: 5 + i * 3 })),
  },
  {
    label: "2024-01",
    color: "#3b3bba",
    data: STEPS.map((step, i) => ({ step, value: 8 + i * 4 })),
  },
];

const SMALL_MULTIPLES_PANELS = [
  {
    product: "Plus",
    curves: [
      {
        label: "2023-01",
        data: STEPS.map((step, i) => ({ step, value: 10 + i * 5 })),
      },
      {
        label: "2024-07",
        data: STEPS.map((step, i) => ({ step, value: 12 + i * 6 })),
      },
    ],
  },
  {
    product: "AI Pro",
    curves: [
      {
        label: "2023-01",
        data: STEPS.map((step, i) => ({ step, value: 0.01 + i * 0.005 })),
      },
    ],
  },
];

// --- Helpers ---

let originalGetComputedStyle: typeof window.getComputedStyle;

beforeEach(() => {
  // Mock clientWidth on all DIV elements to simulate a real layout.
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return MOCK_CLIENT_WIDTH;
    },
  });

  // Mock getComputedStyle so getContentBoxWidth can read the padding.
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
  // Restore clientWidth
  delete (HTMLDivElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

/**
 * Checks that every circle and text element inside the SVG fits within
 * the SVG's width attribute (its coordinate space).
 *
 * For circles: cx + r must be <= svgWidth
 * For text: x + estimated text width must be <= svgWidth
 *   (jsdom can't measure text, so we estimate ~7px per character at 11px font)
 */
function assertNoRightOverflow(container: HTMLElement) {
  const svg = container.querySelector("svg")!;
  expect(svg).toBeTruthy();

  const svgWidth = Number(svg.getAttribute("width"));
  expect(svgWidth).toBeGreaterThan(0);

  // SVG width should match the content-box width, not clientWidth
  expect(svgWidth).toBe(EXPECTED_SVG_WIDTH);

  // Check circles don't overflow
  const circles = svg.querySelectorAll("circle");
  for (const circle of circles) {
    const cx = Number(circle.getAttribute("cx") || 0);
    const r = Number(circle.getAttribute("r") || 0);

    // cx is relative to the parent <g>, which is translated by margin.left.
    // We need the absolute position. Walk up and sum transforms.
    const absoluteX = getAbsoluteX(circle) + cx;
    expect(absoluteX + r).toBeLessThanOrEqual(svgWidth);
  }

  // Check text elements don't overflow
  const texts = svg.querySelectorAll("text");
  for (const text of texts) {
    const textX = Number(text.getAttribute("x") || 0);
    const content = text.textContent || "";
    const fontSize = parseFloat(text.getAttribute("font-size") || "11");
    // Rough estimate: average character width ≈ 0.6 * fontSize
    const estimatedWidth = content.length * fontSize * 0.6;

    const anchor = text.getAttribute("text-anchor");
    // Only check right-overflow for left-anchored or start-anchored text
    if (anchor === "middle" || anchor === "end") continue;

    const absoluteX = getAbsoluteX(text) + textX;
    expect(absoluteX + estimatedWidth).toBeLessThanOrEqual(svgWidth);
  }
}

/** Sum up translateX from parent <g> elements to get absolute X offset. */
function getAbsoluteX(el: Element): number {
  let x = 0;
  let current = el.parentElement;
  while (current && current.tagName !== "svg") {
    const transform = current.getAttribute("transform");
    if (transform) {
      const match = transform.match(/translate\(([^,)]+)/);
      if (match) x += parseFloat(match[1]);
    }
    current = current.parentElement;
  }
  return x;
}

// --- Tests ---

describe("Chart right-side overflow", () => {
  it("LineChart end-dots fit within SVG bounds", () => {
    const { container } = render(
      <LineChart series={LINE_SERIES} title="Test" yFormatType="number" />,
    );
    assertNoRightOverflow(container);
  });

  it("ColumnChart bars fit within SVG bounds", () => {
    const { container } = render(
      <ColumnChart data={COLUMN_DATA} title="Test" yFormatType="currency" />,
    );
    assertNoRightOverflow(container);
  });

  it("ConversionCurveChart end-labels fit within SVG bounds", () => {
    const { container } = render(
      <ConversionCurveChart
        series={CURVE_SERIES}
        steps={STEPS}
        title="Test"
      />,
    );
    assertNoRightOverflow(container);
  });

  it("SmallMultiplesCurveChart end-labels fit within SVG bounds", () => {
    const { container } = render(
      <SmallMultiplesCurveChart
        panels={SMALL_MULTIPLES_PANELS}
        steps={STEPS}
        title="Test"
      />,
    );
    assertNoRightOverflow(container);
  });
});
