import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData, mockValidateModeColumns } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
  mockValidateModeColumns: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  validateModeColumns: mockValidateModeColumns,
  rowStr: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "string" ? row[key] : row[key] != null ? String(row[key]) : "",
  rowNum: (row: Record<string, unknown>, key: string, fallback = 0) =>
    typeof row[key] === "number" ? row[key] : fallback,
}));

import {
  computeTenureDays,
  getActiveEmployees,
  getMonthlyJoinersAndDepartures,
  getPeopleMetrics,
  getTenureDistribution,
  groupByPillarAndSquad,
  isPartTimeChampion,
  isUnassigned,
  transformToPersons,
  type Person,
} from "../people";

function monthDate(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toISOString().slice(0, 10);
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    name: "Person",
    email: "person@example.com",
    jobTitle: "Engineer",
    level: "L3",
    squad: "Growth Marketing",
    pillar: "Growth",
    function: "Growth",
    manager: "Manager",
    startDate: "2025-01-01T00:00:00Z",
    location: "London",
    tenureMonths: 12,
    employmentType: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-08T12:00:00Z"));
  mockValidateModeColumns.mockReset();
  mockValidateModeColumns.mockReturnValue({
    expectedColumns: [],
    presentColumns: [],
    missingColumns: [],
    isValid: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  mockGetReportData.mockReset();
});

describe("transformToPersons", () => {
  it("gives zero tenure when start_date is null or invalid", () => {
    const people = transformToPersons([
      { preferred_name: "NullDate", email: "a@example.com", start_date: null },
      {
        preferred_name: "InvalidDate",
        email: "b@example.com",
        start_date: "not-a-date",
      },
    ]);
    expect(people.every((p) => Number.isFinite(p.tenureMonths))).toBe(true);
    expect(people.every((p) => p.tenureMonths >= 0)).toBe(true);
  });

  it("maps fields, fills fallbacks, calculates tenure, and sorts by name", () => {
    const people = transformToPersons([
      {
        preferred_name: "Zed",
        email: "zed@example.com",
        job_title: "Engineer",
        hb_level: "L4",
        hb_squad: "Growth Conversion",
        hb_function: "Growth",
        manager: "Boss",
        start_date: "2025-04-01T00:00:00Z",
        work_location: "London",
      },
      {
        email: "finance@example.com",
        hb_function: "Finance",
      },
      {
        preferred_name: "Amy",
        email: "amy@example.com",
        job_title: "PM",
        hb_level: "L5",
        hb_squad: "Chat 1: Chat Evaluations",
        hb_function: "Product",
        manager: "Lead",
        start_date: "2025-10-01T00:00:00Z",
        work_location: "Remote",
      },
    ]);

    expect(people.map((person) => person.name)).toEqual(["Amy", "Unknown", "Zed"]);
    expect(people[0]).toMatchObject({
      name: "Amy",
      squad: "Chat 1: Chat Evaluations",
      function: "Product",
      location: "Remote",
      tenureMonths: 6,
    });
    expect(people[1]).toMatchObject({
      name: "Unknown",
      squad: "Finance",
      function: "Finance",
      startDate: "",
      tenureMonths: 0,
    });
    expect(people[2]).toMatchObject({
      name: "Zed",
      email: "zed@example.com",
      jobTitle: "Software Engineer",
      level: "L4",
      manager: "Boss",
      tenureMonths: 12,
    });
  });
});

describe("getPeopleMetrics", () => {
  it("computes hires, attrition, average tenure, and department count", () => {
    const active = [
      makePerson({
        name: "New Hire",
        startDate: "2026-04-03T12:00:00Z",
        tenureMonths: 0,
        function: "Growth",
      }),
      makePerson({
        name: "Last Month",
        startDate: "2026-03-10T12:00:00Z",
        tenureMonths: 1,
        function: "Growth",
      }),
      makePerson({
        name: "Tenured",
        startDate: "2025-01-10T12:00:00Z",
        tenureMonths: 16,
        function: "People",
      }),
    ];

    const metrics = getPeopleMetrics(active, [
      {
        lifecycle_status: "Terminated",
        is_cleo_headcount: 1,
        termination_date: "2026-02-15T12:00:00Z",
      },
      {
        lifecycle_status: "terminated",
        is_cleo_headcount: 1,
        termination_date: "2025-11-15T12:00:00Z",
      },
      {
        lifecycle_status: "Terminated",
        is_cleo_headcount: 0,
        termination_date: "2026-03-01T12:00:00Z",
      },
    ]);

    expect(metrics).toEqual({
      total: 3,
      departments: 2,
      newHiresThisMonth: 1,
      newHiresLastMonth: 1,
      averageTenureMonths: 6,
      attritionLast90Days: 1,
    });
  });
});

describe("groupByPillarAndSquad", () => {
  it("groups people by their pillar field directly", () => {
    const grouped = groupByPillarAndSquad([
      makePerson({ name: "A", squad: "Growth Marketing", pillar: "Growth Pillar" }),
      makePerson({ name: "B", squad: "Growth Marketing", pillar: "Growth Pillar" }),
      makePerson({ name: "C", squad: "Growth Conversion", pillar: "Growth Pillar" }),
      makePerson({ name: "D", squad: "Finance Squad", pillar: "Commercial & Finance" }),
      makePerson({ name: "E", squad: "Mystery Squad", pillar: "Other" }),
    ]);

    expect(grouped.map((pillar) => pillar.name)).toEqual([
      "Growth Pillar",
      "Commercial & Finance",
      "Other",
    ]);
    expect(grouped[0]).toMatchObject({
      name: "Growth Pillar",
      count: 3,
      isProduct: true,
    });
    expect(grouped[0].squads.map((squad) => squad.name)).toEqual([
      "Growth Marketing",
      "Growth Conversion",
    ]);
    expect(grouped[1]).toMatchObject({
      name: "Commercial & Finance",
      count: 1,
      isProduct: false,
    });
    expect(grouped[2]).toMatchObject({
      name: "Other",
      count: 1,
      isProduct: false,
    });
  });
});

describe("getTenureDistribution", () => {
  it("counts people into the expected tenure buckets", () => {
    const distribution = getTenureDistribution([
      makePerson({ tenureMonths: 0 }),
      makePerson({ tenureMonths: 6 }),
      makePerson({ tenureMonths: 12 }),
      makePerson({ tenureMonths: 24 }),
      makePerson({ tenureMonths: 36 }),
      makePerson({ tenureMonths: 60 }),
    ]);

    expect(distribution.map((bucket) => bucket.value)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe("getPeopleMetrics — null safety", () => {
  it("excludes rows with null lifecycle_status or null is_cleo_headcount from attrition count", () => {
    const metrics = getPeopleMetrics([], [
      // null lifecycle_status — should not count
      { lifecycle_status: null, is_cleo_headcount: 1, termination_date: "2026-02-15T12:00:00Z" },
      // null is_cleo_headcount — should not count
      { lifecycle_status: "Terminated", is_cleo_headcount: null, termination_date: "2026-02-15T12:00:00Z" },
      // valid terminated row — should count
      { lifecycle_status: "terminated", is_cleo_headcount: 1, termination_date: "2026-03-01T12:00:00Z" },
    ]);
    expect(metrics.attritionLast90Days).toBe(1);
  });
});

describe("getMonthlyJoinersAndDepartures", () => {
  it("skips rows with null or invalid start_date or termination_date", () => {
    const result = getMonthlyJoinersAndDepartures(
      [
        { is_cleo_headcount: 1, start_date: null },
        { is_cleo_headcount: 1, start_date: "not-a-date" },
        { lifecycle_status: "terminated", is_cleo_headcount: 1, termination_date: null },
        { lifecycle_status: "terminated", is_cleo_headcount: 1, termination_date: "bad-date" },
        // one valid joiner in April 2026
        { is_cleo_headcount: 1, start_date: "2026-04-01T12:00:00Z" },
      ],
      1,
    );
    expect(result.joiners[0].value).toBe(1);
    expect(result.departures[0].value).toBe(0);
  });

  it("builds monthly joiner and departure counts across the requested window", () => {
    const result = getMonthlyJoinersAndDepartures(
      [
        { is_cleo_headcount: 1, start_date: "2026-01-05T12:00:00Z" },
        { is_cleo_headcount: 1, start_date: "2026-02-10T12:00:00Z" },
        { is_cleo_headcount: 1, start_date: "2026-04-01T12:00:00Z" },
        { is_cleo_headcount: 0, start_date: "2026-04-02T12:00:00Z" },
        {
          lifecycle_status: "Terminated",
          is_cleo_headcount: 1,
          termination_date: "2026-02-20T12:00:00Z",
        },
        {
          lifecycle_status: "terminated",
          is_cleo_headcount: 1,
          termination_date: "2026-04-07T12:00:00Z",
        },
      ],
      4
    );

    expect(result).toEqual({
      joiners: [
        { date: monthDate(2026, 0), value: 1 },
        { date: monthDate(2026, 1), value: 1 },
        { date: monthDate(2026, 2), value: 0 },
        { date: monthDate(2026, 3), value: 1 },
      ],
      departures: [
        { date: monthDate(2026, 0), value: 0 },
        { date: monthDate(2026, 1), value: 1 },
        { date: monthDate(2026, 2), value: 0 },
        { date: monthDate(2026, 3), value: 1 },
      ],
    });
  });
});

describe("getActiveEmployees", () => {
  it("returns empty people data when both reports are missing", async () => {
    mockGetReportData.mockResolvedValue([]);

    const result = await getActiveEmployees();

    expect(result).toEqual({ employees: [], partTimeChampions: [], unassigned: [], allRows: [], lastSync: null });
    expect(mockGetReportData).toHaveBeenCalledWith("people", "org", [
      "current_employees",
    ]);
    expect(mockGetReportData).toHaveBeenCalledWith("people", "headcount", [
      "headcount",
    ]);
  });

  it("uses Current FTEs as primary and merges with Headcount SSoT", async () => {
    mockGetReportData.mockImplementation(
      (section: string, category: string) => {
        if (category === "org") {
          return Promise.resolve([
            {
              reportName: "Current FTEs",
              queryName: "current_employees",
              syncedAt: new Date("2026-04-08T12:00:00Z"),
              columns: [
                { name: "employee_email", type: "text" },
                { name: "preferred_name", type: "text" },
                { name: "employment_type", type: "text" },
                { name: "start_date", type: "timestamp" },
                { name: "line_manager_email", type: "text" },
                { name: "pillar_name", type: "text" },
                { name: "squad_name", type: "text" },
                { name: "function_name", type: "text" },
              ],
              rows: [
                {
                  employee_email: "amy@example.com",
                  preferred_name: "Amy",
                  employment_type: "Permanent (UK)",
                  start_date: "2025-10-01T00:00:00Z",
                  line_manager_email: "lead@example.com",
                  pillar_name: "Growth Pillar",
                  squad_name: "Growth Marketing",
                  function_name: "Product",
                },
              ],
            },
          ]);
        }
        return Promise.resolve([
          {
            reportName: "Headcount SSoT",
            queryName: "headcount",
            rows: [
              {
                email: "amy@example.com",
                preferred_name: "Amy",
                job_title: "PM",
                hb_level: "L5",
                work_location: "London",
                lifecycle_status: "employed",
                is_cleo_headcount: 1,
                manager: "Lead",
              },
            ],
          },
        ]);
      },
    );

    const result = await getActiveEmployees();

    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]).toMatchObject({
      name: "Amy",
      email: "amy@example.com",
      squad: "Growth Marketing",
      pillar: "Growth Pillar",
      function: "Product",
      jobTitle: "PM",
      level: "L5",
      location: "London",
      employmentType: "Permanent (UK)",
    });
  });

  it("falls back to Headcount SSoT when Current FTEs columns drift", async () => {
    mockGetReportData.mockImplementation(
      (section: string, category: string) => {
        if (category === "org") {
          return Promise.resolve([
            {
              reportName: "Current FTEs",
              queryName: "current_employees",
              syncedAt: new Date("2026-04-08T12:00:00Z"),
              columns: [],
              rows: [{ employee_email: "amy@example.com" }],
            },
          ]);
        }
        return Promise.resolve([
          {
            reportName: "Headcount SSoT",
            queryName: "headcount",
            syncedAt: new Date("2026-04-08T12:00:00Z"),
            rows: [
              {
                preferred_name: "Amy",
                email: "amy@example.com",
                job_title: "PM",
                hb_level: "L5",
                hb_squad: "Product",
                hb_function: "Product",
                manager: "Lead",
                start_date: "2025-10-01T00:00:00Z",
                work_location: "London",
                lifecycle_status: "employed",
                is_cleo_headcount: 1,
                termination_date: null,
              },
            ],
          },
        ]);
      },
    );
    // First call (headcount validation) succeeds, second call (FTE validation) fails
    mockValidateModeColumns
      .mockReturnValueOnce({ isValid: true, expectedColumns: [], presentColumns: [], missingColumns: [] })
      .mockReturnValueOnce({ isValid: false, expectedColumns: [], presentColumns: [], missingColumns: ["squad_name"] });

    const result = await getActiveEmployees();

    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].name).toBe("Amy");
    expect(mockValidateModeColumns).toHaveBeenCalledTimes(2);
  });
});

describe("isPartTimeChampion", () => {
  it("returns true for Customer Operations with no pillar", () => {
    expect(isPartTimeChampion(makePerson({ pillar: "no pillar", function: "Customer Operations" }))).toBe(true);
  });

  it("returns true for Customer Operations with no squad", () => {
    expect(isPartTimeChampion(makePerson({ squad: "no squad", function: "Customer Operations" }))).toBe(true);
  });

  it("returns false for non-Customer Operations even with no pillar", () => {
    expect(isPartTimeChampion(makePerson({ pillar: "no pillar", function: "Growth" }))).toBe(false);
  });

  it("returns false for Customer Operations with normal pillar and squad", () => {
    expect(isPartTimeChampion(makePerson({ pillar: "Operations", squad: "Champs", function: "Customer Operations" }))).toBe(false);
  });
});

describe("isUnassigned", () => {
  it("returns true for non-Customer Operations with no pillar", () => {
    expect(isUnassigned(makePerson({ pillar: "no pillar", function: "Growth" }))).toBe(true);
  });

  it("returns true for non-Customer Operations with no squad", () => {
    expect(isUnassigned(makePerson({ squad: "no squad", function: "Engineering" }))).toBe(true);
  });

  it("returns false for Customer Operations with no pillar", () => {
    expect(isUnassigned(makePerson({ pillar: "no pillar", function: "Customer Operations" }))).toBe(false);
  });

  it("returns false for people with normal pillar and squad", () => {
    expect(isUnassigned(makePerson({ pillar: "Growth", squad: "Growth Marketing", function: "Growth" }))).toBe(false);
  });
});

describe("computeTenureDays", () => {
  it("returns the number of days between start date and now", () => {
    // System time is 2026-04-08T12:00:00Z, start is 7 days earlier
    expect(computeTenureDays("2026-04-01T12:00:00Z")).toBe(7);
  });

  it("returns 0 for invalid start date", () => {
    expect(computeTenureDays("not-a-date")).toBe(0);
  });

  it("returns 0 for empty start date", () => {
    expect(computeTenureDays("")).toBe(0);
  });
});
