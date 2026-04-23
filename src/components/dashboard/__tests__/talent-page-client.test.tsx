import { render, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TalentPageClient } from "../talent-page-client";
import type {
  EmploymentRecord,
  TalentHireRow,
  TalentTargetRow,
} from "@/lib/data/talent-utils";

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

const UNKNOWN_EMPLOYMENT: EmploymentRecord = {
  status: "unknown",
  role: "talent_partner",
  terminationDate: null,
  matchedName: null,
  department: null,
  jobTitle: null,
};

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
    const employmentByRecruiter: Record<string, EmploymentRecord> = {
      Lucy: UNKNOWN_EMPLOYMENT,
      Ellis: UNKNOWN_EMPLOYMENT,
    };

    const { container } = render(
      <TalentPageClient
        hireRows={hireRows}
        targets={targets}
        employmentByRecruiter={employmentByRecruiter}
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
    const employmentByRecruiter: Record<string, EmploymentRecord> = {
      Lucy: { status: "active", role: "talent_partner", terminationDate: null, matchedName: "Lucy", department: "People", jobTitle: "Talent Partner" } as EmploymentRecord,
      Ellis: { status: "active", role: "talent_partner", terminationDate: null, matchedName: "Ellis", department: "People", jobTitle: "Talent Partner" },
      Beth: { status: "active", role: "talent_partner", terminationDate: null, matchedName: "Beth", department: "People", jobTitle: "Talent Partner" },
    };

    const { container, getByRole } = render(
      <TalentPageClient
        hireRows={hireRows}
        targets={targets}
        employmentByRecruiter={employmentByRecruiter}
        modeUrl="https://app.mode.com/cleoai/reports/e9766a6cd260"
        emptyReason={null}
      />,
    );

    // Row order — first direct child span inside the name cell.
    const rowNames = () =>
      Array.from(
        container.querySelectorAll("tbody tr td:first-child div > span:first-child"),
      )
        .map((el) => el.textContent?.trim())
        .filter(Boolean);

    // Default sort: hires L12m desc → Beth, Lucy, Ellis
    expect(rowNames()).toEqual(["Beth", "Lucy", "Ellis"]);

    // Click Recruiter header → alphabetical asc: Beth, Ellis, Lucy
    fireEvent.click(getByRole("button", { name: /^Recruiter/i }));
    expect(rowNames()).toEqual(["Beth", "Ellis", "Lucy"]);

    // Click again → alphabetical desc: Lucy, Ellis, Beth
    fireEvent.click(getByRole("button", { name: /^Recruiter/i }));
    expect(rowNames()).toEqual(["Lucy", "Ellis", "Beth"]);

    // Click Attainment → attainment desc: Beth 133%, Lucy 80%, Ellis 75%
    fireEvent.click(getByRole("button", { name: /^Attainment/i }));
    expect(rowNames()).toEqual(["Beth", "Lucy", "Ellis"]);
  });

  it("hides departed recruiters by default and reveals them via the filter", () => {
    const hireRows: TalentHireRow[] = [
      hire("Lucy", "2026-01", 2),
      hire("Lucy", "2026-02", 2),
      hire("Lucy", "2026-03", 2),
      hire("Chris", "2025-08", 3),
      hire("Chris", "2025-09", 2),
    ];
    const targets: TalentTargetRow[] = [
      { recruiter: "Lucy", tech: "Tech", hiresQtd: 4, targetQtd: 5, teamQtd: 20 },
    ];
    const employmentByRecruiter: Record<string, EmploymentRecord> = {
      Lucy: {
        status: "active",
        role: "talent_partner",
        terminationDate: null,
        matchedName: "Lucy",
        department: "People",
        jobTitle: "Talent Partner",
      },
      Chris: {
        status: "departed",
        role: "talent_partner",
        terminationDate: "2025-09-22",
        matchedName: "Chris Rea",
        department: "Talent",
        jobTitle: "Principal Talent Partner",
      },
    };

    const { container, getByRole } = render(
      <TalentPageClient
        hireRows={hireRows}
        targets={targets}
        employmentByRecruiter={employmentByRecruiter}
        modeUrl="https://app.mode.com/cleoai/reports/e9766a6cd260"
        emptyReason={null}
      />,
    );

    const rowNames = () =>
      Array.from(
        container.querySelectorAll("tbody tr td:first-child div > span:first-child"),
      )
        .map((el) => el.textContent?.trim())
        .filter(Boolean);

    // Default filter is Active + Talent Partner — Chris is departed so hidden.
    expect(rowNames()).toEqual(["Lucy"]);

    // Switch employment to Departed — now only Chris, with a "left" badge.
    fireEvent.click(getByRole("button", { name: /^Departed/ }));
    expect(rowNames()?.[0]).toContain("Chris");
    // Badge text uses the abbreviated month/year.
    expect(container.textContent).toMatch(/left .*2025/i);

    // Switch employment to All — both visible. There are two "All" buttons
    // (one per filter group) so we scope by aria-label.
    const employmentGroup = container.querySelector(
      '[aria-label="Employment filter"]',
    )!;
    fireEvent.click(
      within(employmentGroup as HTMLElement).getByRole("button", {
        name: /^All/,
      }),
    );
    const all = rowNames();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((n) => n?.startsWith("Lucy"))).toBe(true);
    expect(all.some((n) => n?.startsWith("Chris"))).toBe(true);
  });

  it("renders an empty state when emptyReason is provided", () => {
    const { container } = render(
      <TalentPageClient
        hireRows={[]}
        targets={[]}
        employmentByRecruiter={{}}
        modeUrl="https://app.mode.com/cleoai/reports/e9766a6cd260"
        emptyReason="No data synced yet"
      />,
    );
    expect(container.textContent).toContain("No data synced yet");
    expect(container.querySelector("table")).toBeFalsy();
  });
});
