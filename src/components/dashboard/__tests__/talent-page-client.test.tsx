import { render, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TalentPageClient } from "../talent-page-client";
import type { TalentHireRow, TalentTargetRow } from "@/lib/data/talent-utils";

// The LineChart uses d3 and reads element sizes from the DOM — jsdom doesn't
// lay anything out, so we stub clientWidth and getBoundingClientRect just
// enough that the chart doesn't throw when it tries to draw.
const MOCK_WIDTH = 1000;

let originalGetComputedStyle: typeof window.getComputedStyle;

beforeEach(() => {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return MOCK_WIDTH;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: MOCK_WIDTH,
      bottom: 300,
      width: MOCK_WIDTH,
      height: 300,
      toJSON: () => "",
    }),
  });
  originalGetComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
    const real = originalGetComputedStyle.call(window, el);
    return new Proxy(real, {
      get(target, prop) {
        if (prop === "paddingLeft") return "16px";
        if (prop === "paddingRight") return "16px";
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

function hire(
  recruiter: string,
  month: string,
  cnt = 1,
  actionType = "hires",
): TalentHireRow {
  return {
    recruiter,
    actionType,
    actionDate: `${month}-15T00:00:00.000Z`,
    cnt,
    role: "Engineer",
    department: "Eng",
    candidate: "Cand",
    level: null,
    tech: null,
  };
}

describe("TalentPageClient", () => {
  it("renders summary cards, chart section, and per-recruiter table with real-shaped data", () => {
    const hireRows: TalentHireRow[] = [
      hire("Lucy", "2025-11", 1),
      hire("Lucy", "2025-12", 2),
      hire("Lucy", "2026-01", 1),
      hire("Ellis", "2025-12", 1),
      hire("Ellis", "2026-01", 2),
    ];
    const targets: TalentTargetRow[] = [
      {
        recruiter: "Lucy",
        tech: "Tech",
        hiresQtd: 4,
        targetQtd: 5,
        teamQtd: 20,
      },
      {
        recruiter: "Ellis",
        tech: "Data",
        hiresQtd: 3,
        targetQtd: 4,
        teamQtd: 20,
      },
    ];

    const { container } = render(
      <TalentPageClient
        hireRows={hireRows}
        targets={targets}
        modeUrl="https://app.mode.com/cleoai/reports/e9766a6cd260"
        emptyReason={null}
      />,
    );

    // Summary cards present
    expect(container.textContent).toContain("Hires · last 12 months");
    expect(container.textContent).toContain("Trailing 3mo avg");
    expect(container.textContent).toContain("Projected next 3mo");
    expect(container.textContent).toContain("QTD vs target");

    // Chart section header
    expect(container.textContent).toContain("Team hires per month");

    // Table rows present
    expect(container.textContent).toContain("Recruiter performance");
    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    const bodyText = within(table!).getByText("Lucy");
    expect(bodyText).toBeTruthy();
    const ellis = within(table!).getByText("Ellis");
    expect(ellis).toBeTruthy();

    // 4 hires QTD / 5 target = 80% attainment shown
    expect(container.textContent).toContain("80%");
  });

  it("sorts the recruiter table when a column header is clicked", () => {
    const hireRows: TalentHireRow[] = [
      hire("Lucy", "2025-11", 1),
      hire("Lucy", "2025-12", 2),
      hire("Lucy", "2026-01", 1),
      hire("Ellis", "2025-12", 1),
      hire("Ellis", "2026-01", 2),
      hire("Beth", "2025-12", 4),
      hire("Beth", "2026-01", 4),
    ];
    const targets: TalentTargetRow[] = [
      { recruiter: "Lucy", tech: "Tech", hiresQtd: 4, targetQtd: 5, teamQtd: 20 },
      { recruiter: "Ellis", tech: "Data", hiresQtd: 3, targetQtd: 4, teamQtd: 20 },
      { recruiter: "Beth", tech: "Data", hiresQtd: 8, targetQtd: 6, teamQtd: 20 },
    ];

    const { container, getByRole } = render(
      <TalentPageClient
        hireRows={hireRows}
        targets={targets}
        modeUrl="https://app.mode.com/cleoai/reports/e9766a6cd260"
        emptyReason={null}
      />,
    );

    const rowNames = () =>
      Array.from(container.querySelectorAll("tbody tr td:first-child"))
        .map((el) => el.textContent?.trim())
        .filter(Boolean);

    // Default sort: hires L12m desc → Beth, Lucy, Ellis
    expect(rowNames()).toEqual(["Beth", "Lucy", "Ellis"]);

    // Click Recruiter header → alphabetical asc: Beth, Ellis, Lucy
    fireEvent.click(getByRole("button", { name: /recruiter/i }));
    expect(rowNames()).toEqual(["Beth", "Ellis", "Lucy"]);

    // Click again → alphabetical desc: Lucy, Ellis, Beth
    fireEvent.click(getByRole("button", { name: /recruiter/i }));
    expect(rowNames()).toEqual(["Lucy", "Ellis", "Beth"]);

    // Click Attainment → attainment desc: Beth 133%, Lucy 80%, Ellis 75%
    fireEvent.click(getByRole("button", { name: /attainment/i }));
    expect(rowNames()).toEqual(["Beth", "Lucy", "Ellis"]);
  });

  it("renders an empty state when emptyReason is provided", () => {
    const { container } = render(
      <TalentPageClient
        hireRows={[]}
        targets={[]}
        modeUrl="https://app.mode.com/cleoai/reports/e9766a6cd260"
        emptyReason="No data synced yet"
      />,
    );
    expect(container.textContent).toContain("No data synced yet");
    expect(container.querySelector("table")).toBeFalsy();
  });
});
