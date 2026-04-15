import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  rowStr: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "string" ? row[key] : row[key] != null ? String(row[key]) : "",
  rowNum: (row: Record<string, unknown>, key: string, fallback = 0) =>
    typeof row[key] === "number" ? row[key] : fallback,
  rowNumOrNull: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "number" ? row[key] : null,
}));

const { mockGetActiveEmployees } = vi.hoisted(() => ({
  mockGetActiveEmployees: vi.fn(),
}));

vi.mock("../people", () => ({
  getActiveEmployees: mockGetActiveEmployees,
}));

import type { Person } from "../people";
import {
  getRatingDistribution,
  transformPerformanceData,
  groupPerformanceByPillar,
  groupPerformanceByFunction,
  getPerformanceData,
  type PerformanceRating,
  type PersonPerformance,
} from "../performance";

function makeRating(overrides: Partial<PerformanceRating> = {}): PerformanceRating {
  return {
    reviewCycle: "2025 H2-B Performance Review",
    rating: 4,
    reviewerName: "Manager A",
    flagged: false,
    missed: false,
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    name: "Alice Test",
    email: "alice@meetcleo.com",
    jobTitle: "Engineer",
    level: "L3",
    squad: "Payments",
    pillar: "Core",
    function: "Engineering",
    manager: "Bob Manager",
    startDate: "2024-01-01",
    location: "London",
    tenureMonths: 28,
    employmentType: "FTE",
    ...overrides,
  };
}

function makePersonPerf(overrides: Partial<PersonPerformance> = {}): PersonPerformance {
  return {
    email: "alice@meetcleo.com",
    name: "Alice Test",
    jobTitle: "Engineer",
    level: "L3",
    squad: "Payments",
    pillar: "Core",
    function: "Engineering",
    ratings: [makeRating()],
    ...overrides,
  };
}

describe("getRatingDistribution", () => {
  it("counts ratings 1-5 and missed", () => {
    const ratings: PerformanceRating[] = [
      makeRating({ rating: 5 }),
      makeRating({ rating: 4 }),
      makeRating({ rating: 4 }),
      makeRating({ rating: 3 }),
      makeRating({ rating: null, missed: true }),
    ];
    const dist = getRatingDistribution(ratings);
    expect(dist).toEqual({
      1: 0, 2: 0, 3: 1, 4: 2, 5: 1,
      missed: 1, flagged: 0, total: 5,
    });
  });

  it("filters by cycle when provided", () => {
    const ratings: PerformanceRating[] = [
      makeRating({ reviewCycle: "2025 H2-B Performance Review", rating: 5 }),
      makeRating({ reviewCycle: "2025 H1-B Performance Review", rating: 3 }),
    ];
    const dist = getRatingDistribution(ratings, "2025 H2-B Performance Review");
    expect(dist).toEqual({
      1: 0, 2: 0, 3: 0, 4: 0, 5: 1,
      missed: 0, flagged: 0, total: 1,
    });
  });

  it("returns zeros for empty input", () => {
    const dist = getRatingDistribution([]);
    expect(dist.total).toBe(0);
    expect(dist[5]).toBe(0);
  });

  it("counts flagged reviews", () => {
    const ratings = [makeRating({ flagged: true }), makeRating({ flagged: true })];
    const dist = getRatingDistribution(ratings);
    expect(dist.flagged).toBe(2);
  });
});

describe("transformPerformanceData", () => {
  it("joins Mode rows with employee data by email", () => {
    const modeRows = [
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H2-B Performance Review",
        performance_rating: 4,
        reviewer_name: "Bob Manager",
        current_slt_representative_name: "CTO",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H1-B Performance Review",
        performance_rating: 3,
        reviewer_name: "Bob Manager",
        current_slt_representative_name: "CTO",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
    ];
    const employees = [makePerson({ email: "alice@meetcleo.com" })];
    const { people, reviewCycles } = transformPerformanceData(modeRows, employees);

    expect(people).toHaveLength(1);
    expect(people[0].name).toBe("Alice Test");
    expect(people[0].squad).toBe("Payments");
    expect(people[0].pillar).toBe("Core");
    expect(people[0].ratings).toHaveLength(2);
    expect(people[0].ratings[0].rating).toBe(3); // H1-B sorts before H2-B
    expect(people[0].ratings[1].rating).toBe(4);
    expect(reviewCycles).toEqual([
      "2025 H1-B Performance Review",
      "2025 H2-B Performance Review",
    ]);
  });

  it("handles employees not in active list (former employees)", () => {
    const modeRows = [
      {
        employee_email: "gone@meetcleo.com",
        review_cycle_name: "2025 H2-B Performance Review",
        performance_rating: 2,
        reviewer_name: "Manager X",
        current_slt_representative_name: "VP",
        function: "Marketing",
        flagged_review: 1,
        missed_review: 0,
        counter: 1,
      },
    ];
    const { people } = transformPerformanceData(modeRows, []);

    expect(people).toHaveLength(1);
    expect(people[0].name).toBe("gone@meetcleo.com");
    expect(people[0].function).toBe("Marketing");
    expect(people[0].squad).toBe("");
    expect(people[0].pillar).toBe("Marketing");
    expect(people[0].ratings[0].flagged).toBe(true);
  });

  it("handles null performance_rating as missed", () => {
    const modeRows = [
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H1-A Performance Check-In",
        performance_rating: null,
        reviewer_name: "Bob Manager",
        current_slt_representative_name: "CTO",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 1,
        counter: 1,
      },
    ];
    const employees = [makePerson({ email: "alice@meetcleo.com" })];
    const { people } = transformPerformanceData(modeRows, employees);

    expect(people[0].ratings[0].rating).toBeNull();
    expect(people[0].ratings[0].missed).toBe(true);
  });

  it("sorts review cycles chronologically", () => {
    const modeRows = [
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H2-B Performance Review",
        performance_rating: 5,
        reviewer_name: "M",
        current_slt_representative_name: "S",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H1-A Performance Check-In",
        performance_rating: 3,
        reviewer_name: "M",
        current_slt_representative_name: "S",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
    ];
    const employees = [makePerson({ email: "alice@meetcleo.com" })];
    const { reviewCycles } = transformPerformanceData(modeRows, employees);

    expect(reviewCycles).toEqual([
      "2025 H1-A Performance Check-In",
      "2025 H2-B Performance Review",
    ]);
  });
});

describe("groupPerformanceByPillar", () => {
  it("groups people by pillar then squad", () => {
    const people = [
      makePersonPerf({ pillar: "Core", squad: "Payments", name: "Alice" }),
      makePersonPerf({ pillar: "Core", squad: "Payments", name: "Bob", email: "bob@meetcleo.com" }),
      makePersonPerf({ pillar: "Core", squad: "Banking", name: "Charlie", email: "charlie@meetcleo.com" }),
      makePersonPerf({ pillar: "Growth", squad: "SEO", name: "Diana", email: "diana@meetcleo.com" }),
    ];
    const groups = groupPerformanceByPillar(people);

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe("Core");
    expect(groups[0].count).toBe(3);
    expect(groups[0].squads).toHaveLength(2);
    expect(groups[1].name).toBe("Growth");
    expect(groups[1].count).toBe(1);
  });

  it("excludes people with no squad from pillar view", () => {
    const people = [makePersonPerf({ squad: "", pillar: "Marketing" })];
    const groups = groupPerformanceByPillar(people);
    expect(groups).toHaveLength(0);
  });
});

describe("groupPerformanceByFunction", () => {
  it("groups people by function", () => {
    const people = [
      makePersonPerf({ function: "Engineering", name: "Alice" }),
      makePersonPerf({ function: "Engineering", name: "Bob", email: "bob@meetcleo.com" }),
      makePersonPerf({ function: "Marketing", name: "Charlie", email: "charlie@meetcleo.com" }),
    ];
    const groups = groupPerformanceByFunction(people);

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe("Engineering");
    expect(groups[0].people).toHaveLength(2);
    expect(groups[1].name).toBe("Marketing");
    expect(groups[1].people).toHaveLength(1);
  });
});

describe("getPerformanceData", () => {
  beforeEach(() => {
    mockGetReportData.mockReset();
    mockGetActiveEmployees.mockReset();
  });

  it("fetches Mode data and joins with employees", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Performance Dashboard",
        section: "people",
        category: "performance",
        queryName: "manager_distributions_individual_ratings",
        columns: [],
        rows: [
          {
            employee_email: "alice@meetcleo.com",
            review_cycle_name: "2025 H2-B Performance Review",
            performance_rating: 4,
            reviewer_name: "Bob",
            current_slt_representative_name: "CTO",
            function: "Engineering",
            flagged_review: 0,
            missed_review: 0,
            counter: 1,
          },
        ],
        rowCount: 1,
        syncedAt: new Date("2026-04-15"),
      },
    ]);

    mockGetActiveEmployees.mockResolvedValue({
      employees: [makePerson({ email: "alice@meetcleo.com" })],
      partTimeChampions: [],
      unassigned: [],
      allRows: [],
      lastSync: new Date(),
    });

    const result = await getPerformanceData();

    expect(result.people).toHaveLength(1);
    expect(result.people[0].name).toBe("Alice Test");
    expect(result.people[0].ratings[0].rating).toBe(4);
    expect(result.reviewCycles).toContain("2025 H2-B Performance Review");
    expect(mockGetReportData).toHaveBeenCalledWith(
      "people",
      "performance",
      ["manager_distributions_individual_ratings"],
    );
  });

  it("returns empty when no Mode data", async () => {
    mockGetReportData.mockResolvedValue([]);
    mockGetActiveEmployees.mockResolvedValue({
      employees: [],
      partTimeChampions: [],
      unassigned: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getPerformanceData();

    expect(result.people).toHaveLength(0);
    expect(result.reviewCycles).toHaveLength(0);
  });
});
