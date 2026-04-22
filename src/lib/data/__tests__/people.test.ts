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
  getMonthlyMovementPeople,
  getPeopleMetrics,
  getTenureDistribution,
  groupByPillarAndSquad,
  selectModeFteActive,
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

describe("selectModeFteActive", () => {
  // System time is 2026-04-08T12:00:00Z, so today (UTC) = "2026-04-08".
  const fte = (overrides: Record<string, unknown> = {}) => ({
    headcount_label: "FTE",
    start_date: "2025-01-01T00:00:00Z",
    termination_date: null,
    ...overrides,
  });

  it("includes FTE rows whose start_date has passed and that have no termination", () => {
    expect(selectModeFteActive([fte()])).toHaveLength(1);
  });

  it("excludes future-start FTE rows", () => {
    expect(
      selectModeFteActive([fte({ start_date: "2026-05-01T00:00:00Z" })]),
    ).toHaveLength(0);
  });

  it("excludes FTE rows whose termination_date is on or before asOf", () => {
    expect(
      selectModeFteActive([fte({ termination_date: "2026-04-08T00:00:00Z" })]),
    ).toHaveLength(0);
    expect(
      selectModeFteActive([fte({ termination_date: "2026-04-07T00:00:00Z" })]),
    ).toHaveLength(0);
  });

  it("includes FTE rows whose termination_date is in the future", () => {
    expect(
      selectModeFteActive([fte({ termination_date: "2026-05-01T00:00:00Z" })]),
    ).toHaveLength(1);
  });

  it("filters by headcount_label — defaults to FTE", () => {
    const rows = [
      fte(),
      { ...fte(), headcount_label: "CS" },
      { ...fte(), headcount_label: "Contractor" },
    ];
    expect(selectModeFteActive(rows)).toHaveLength(1);
    expect(selectModeFteActive(rows, undefined, "CS")).toHaveLength(1);
    expect(selectModeFteActive(rows, undefined, "Contractor")).toHaveLength(1);
  });

  it("respects an explicit asOf date", () => {
    const rows = [
      fte({
        start_date: "2025-12-01T00:00:00Z",
        termination_date: "2026-02-01T00:00:00Z",
      }),
    ];
    // Active on 2026-01-15:
    expect(selectModeFteActive(rows, "2026-01-15")).toHaveLength(1);
    // Not active on 2026-03-01 (terminated):
    expect(selectModeFteActive(rows, "2026-03-01")).toHaveLength(0);
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
      // FTE terminated 53 days ago — counts
      { headcount_label: "FTE", termination_date: "2026-02-15T12:00:00Z" },
      // FTE terminated > 90 days ago — does not count
      { headcount_label: "FTE", termination_date: "2025-11-15T12:00:00Z" },
      // CS terminated within 90 days — does not count (FTE-only attrition)
      { headcount_label: "CS", termination_date: "2026-03-01T12:00:00Z" },
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
  it("excludes rows with missing headcount_label or termination_date from attrition count", () => {
    const metrics = getPeopleMetrics([], [
      // missing headcount_label — should not count
      { termination_date: "2026-02-15T12:00:00Z" },
      // FTE but no termination_date — should not count
      { headcount_label: "FTE", termination_date: null },
      // valid FTE termination within 90d — should count
      { headcount_label: "FTE", termination_date: "2026-03-01T12:00:00Z" },
    ]);
    expect(metrics.attritionLast90Days).toBe(1);
  });

  it("excludes future termination_dates from attrition (garden-leave FTEs)", () => {
    // System time is 2026-04-08; a term date in May/June is in the future.
    const metrics = getPeopleMetrics([], [
      { headcount_label: "FTE", termination_date: "2026-05-15T12:00:00Z" },
      { headcount_label: "FTE", termination_date: "2026-06-30T12:00:00Z" },
      // Today's termination counts (term <= now passes the upper bound).
      { headcount_label: "FTE", termination_date: "2026-04-08T00:00:00Z" },
    ]);
    expect(metrics.attritionLast90Days).toBe(1);
  });
});

describe("getMonthlyJoinersAndDepartures", () => {
  it("skips rows with null or invalid start_date or termination_date", () => {
    const result = getMonthlyJoinersAndDepartures(
      [
        { headcount_label: "FTE", start_date: null },
        { headcount_label: "FTE", start_date: "not-a-date" },
        { headcount_label: "FTE", termination_date: null },
        { headcount_label: "FTE", termination_date: "bad-date" },
        // one valid joiner in April 2026
        { headcount_label: "FTE", start_date: "2026-04-01T12:00:00Z" },
      ],
      1,
    );
    expect(result.joiners[0].value).toBe(1);
    expect(result.departures[0].value).toBe(0);
  });

  it("excludes future start_date and termination_date (pre-employment / garden-leave FTEs)", () => {
    // System time is 2026-04-08. Anything after is "future".
    const result = getMonthlyJoinersAndDepartures(
      [
        // Future start — pre-employment; should not appear as a joiner
        { headcount_label: "FTE", start_date: "2026-05-01T12:00:00Z" },
        // Future termination — garden leave; should not appear as a departure
        { headcount_label: "FTE", termination_date: "2026-06-15T12:00:00Z" },
        // Past start in window — counts
        { headcount_label: "FTE", start_date: "2026-04-01T12:00:00Z" },
        // Past termination in window — counts
        { headcount_label: "FTE", termination_date: "2026-04-05T12:00:00Z" },
      ],
      1,
    );
    expect(result.joiners[0].value).toBe(1);
    expect(result.departures[0].value).toBe(1);
  });

  it("builds monthly joiner and departure counts across the requested window — FTE only", () => {
    const result = getMonthlyJoinersAndDepartures(
      [
        { headcount_label: "FTE", start_date: "2026-01-05T12:00:00Z" },
        { headcount_label: "FTE", start_date: "2026-02-10T12:00:00Z" },
        { headcount_label: "FTE", start_date: "2026-04-01T12:00:00Z" },
        // CS — excluded
        { headcount_label: "CS", start_date: "2026-04-02T12:00:00Z" },
        // FTE departures
        { headcount_label: "FTE", termination_date: "2026-02-20T12:00:00Z" },
        { headcount_label: "FTE", termination_date: "2026-04-07T12:00:00Z" },
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
  // Headcount SSoT is the spine; Current FTEs only contributes pillar/squad.
  const ssotReport = (rows: Record<string, unknown>[]) => ({
    reportName: "Headcount SSoT",
    queryName: "headcount",
    syncedAt: new Date("2026-04-08T12:00:00Z"),
    columns: [],
    rows,
  });
  const fteReport = (rows: Record<string, unknown>[]) => ({
    reportName: "Current FTEs",
    queryName: "current_employees",
    syncedAt: new Date("2026-04-08T12:00:00Z"),
    columns: [],
    rows,
  });

  it("returns all-empty buckets when SSoT is missing", async () => {
    mockGetReportData.mockResolvedValue([]);

    const result = await getActiveEmployees();

    expect(result).toEqual({
      employees: [],
      partTimeChampions: [],
      unassigned: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });
    expect(mockGetReportData).toHaveBeenCalledWith("people", "org", [
      "current_employees",
    ]);
    expect(mockGetReportData).toHaveBeenCalledWith("people", "headcount", [
      "headcount",
    ]);
  });

  it("returns all-empty buckets when SSoT schema validation fails", async () => {
    mockGetReportData.mockImplementation((_section: string, category: string) =>
      Promise.resolve(
        category === "headcount"
          ? [ssotReport([{ headcount_label: "FTE", start_date: "2025-01-01" }])]
          : [],
      ),
    );
    mockValidateModeColumns.mockReturnValue({
      isValid: false,
      expectedColumns: [],
      presentColumns: [],
      missingColumns: ["headcount_label"],
    });

    const result = await getActiveEmployees();

    expect(result.employees).toEqual([]);
    expect(result.partTimeChampions).toEqual([]);
    expect(result.contractors).toEqual([]);
    expect(result.allRows).toEqual([]);
  });

  it("buckets SSoT rows by headcount_label and Mode's date filter", async () => {
    mockGetReportData.mockImplementation((_section: string, category: string) => {
      if (category === "org") {
        return Promise.resolve([
          fteReport([
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
          ]),
        ]);
      }
      return Promise.resolve([
        ssotReport([
          // FTE active — should appear in `employees` (has matching FTE row)
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
            termination_date: null,
            headcount_label: "FTE",
          },
          // FTE active but missing from Current FTEs — should be `unassigned`
          {
            preferred_name: "Drift",
            email: "drift@example.com",
            start_date: "2025-09-01T00:00:00Z",
            termination_date: null,
            headcount_label: "FTE",
            hb_function: "Engineering",
          },
          // CS active — partTimeChampions
          {
            preferred_name: "Champ",
            email: "champ@example.com",
            start_date: "2025-05-01T00:00:00Z",
            termination_date: null,
            headcount_label: "CS",
            hb_function: "Customer Operations",
          },
          // Contractor active — contractors
          {
            preferred_name: "Conn",
            email: "conn@example.com",
            start_date: "2025-08-01T00:00:00Z",
            termination_date: null,
            headcount_label: "Contractor",
            hb_function: "Engineering",
          },
          // FTE terminated yesterday — excluded everywhere
          {
            preferred_name: "Gone",
            email: "gone@example.com",
            start_date: "2024-01-01T00:00:00Z",
            termination_date: "2026-04-07T00:00:00Z",
            headcount_label: "FTE",
          },
          // FTE future-start — excluded
          {
            preferred_name: "Future",
            email: "future@example.com",
            start_date: "2026-05-01T00:00:00Z",
            termination_date: null,
            headcount_label: "FTE",
          },
        ]),
      ]);
    });

    const result = await getActiveEmployees();

    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]).toMatchObject({
      name: "Amy",
      email: "amy@example.com",
      squad: "Growth Marketing",
      pillar: "Growth Pillar",
      function: "Product",
      employmentType: "Permanent (UK)",
    });
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0]).toMatchObject({
      name: "Drift",
      pillar: "no pillar",
      squad: "no squad",
    });
    expect(result.partTimeChampions).toHaveLength(1);
    expect(result.partTimeChampions[0].name).toBe("Champ");
    expect(result.contractors).toHaveLength(1);
    expect(result.contractors[0].name).toBe("Conn");
    // Terminated and future-start FTEs are filtered out:
    const allNames = [
      ...result.employees,
      ...result.unassigned,
      ...result.partTimeChampions,
      ...result.contractors,
    ].map((p) => p.name);
    expect(allNames).not.toContain("Gone");
    expect(allNames).not.toContain("Future");
    // allRows is the raw SSoT for downstream attrition/movement metrics:
    expect(result.allRows).toHaveLength(6);
  });

  it("treats Current FTEs as augmentation only — invalid Current FTEs leaves the FTE in `unassigned`", async () => {
    mockGetReportData.mockImplementation((_section: string, category: string) =>
      Promise.resolve(
        category === "org"
          ? [fteReport([{ employee_email: "amy@example.com" }])]
          : [
              ssotReport([
                {
                  preferred_name: "Amy",
                  email: "amy@example.com",
                  start_date: "2025-10-01T00:00:00Z",
                  termination_date: null,
                  headcount_label: "FTE",
                  hb_function: "Product",
                },
              ]),
            ],
      ),
    );
    // SSoT validates; Current FTEs validation fails.
    mockValidateModeColumns
      .mockReturnValueOnce({ isValid: true, expectedColumns: [], presentColumns: [], missingColumns: [] })
      .mockReturnValueOnce({ isValid: false, expectedColumns: [], presentColumns: [], missingColumns: ["squad_name"] });

    const result = await getActiveEmployees();

    expect(result.employees).toEqual([]);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0]).toMatchObject({
      name: "Amy",
      pillar: "no pillar",
      squad: "no squad",
    });
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

describe("getMonthlyMovementPeople", () => {
  it("returns joiners keyed by start_date month", () => {
    const rows = [
      {
        preferred_name: "Alice",
        email: "alice@co.com",
        job_title: "Software Engineer",
        hb_level: "SE3",
        hb_squad: "Core",
        hb_function: "Engineering",
        manager: "Bob",
        start_date: "2026-03-15",
        work_location: "London",
        headcount_label: "FTE",
      },
    ];
    const { joiners, departures } = getMonthlyMovementPeople(rows);
    expect(joiners).toHaveLength(1);
    expect(joiners[0].name).toBe("Alice");
    expect(joiners[0].monthKey).toBe("2026-03");
    expect(joiners[0].jobTitle).toBe("Software Engineer");
    expect(departures).toHaveLength(0);
  });

  it("returns departures keyed by termination_date month", () => {
    const rows = [
      {
        preferred_name: "Charlie",
        email: "charlie@co.com",
        job_title: "Product Manager",
        hb_level: "SE4",
        hb_squad: "Growth",
        hb_function: "Product",
        manager: "Dana",
        start_date: "2024-01-10",
        termination_date: "2026-02-28",
        work_location: "Remote",
        headcount_label: "FTE",
      },
    ];
    const { joiners, departures } = getMonthlyMovementPeople(rows);
    expect(joiners).toHaveLength(1);
    expect(joiners[0].monthKey).toBe("2024-01");
    expect(departures).toHaveLength(1);
    expect(departures[0].name).toBe("Charlie");
    expect(departures[0].monthKey).toBe("2026-02");
    expect(departures[0].terminationDate).toBe("2026-02-28");
  });

  it("skips non-FTE rows (CS, Contractor)", () => {
    const rows = [
      {
        preferred_name: "Contractor",
        email: "c@co.com",
        job_title: "Consultant",
        hb_level: "",
        hb_squad: "",
        hb_function: "",
        manager: "",
        start_date: "2026-01-01",
        work_location: "",
        headcount_label: "Contractor",
      },
      {
        preferred_name: "Champ",
        email: "champ@co.com",
        start_date: "2026-01-01",
        headcount_label: "CS",
      },
    ];
    const { joiners, departures } = getMonthlyMovementPeople(rows);
    expect(joiners).toHaveLength(0);
    expect(departures).toHaveLength(0);
  });

  it("resolves job title from rp_specialisation and passes level through", () => {
    const rows = [
      {
        preferred_name: "Eve",
        email: "eve@co.com",
        job_title: "Senior Software Engineer",
        hb_level: "L3",
        rp_specialisation: "Backend Engineer",
        hb_squad: "Payments",
        hb_function: "Engineering",
        manager: "Frank",
        start_date: "2025-06-01",
        work_location: "Berlin",
        headcount_label: "FTE",
      },
    ];
    const { joiners } = getMonthlyMovementPeople(rows);
    expect(joiners[0].jobTitle).toBe("Backend Engineer");
    // Levels are now canonical L1-L8 at source — we pass them through unchanged.
    expect(joiners[0].level).toBe("L3");
  });

  it("applies department normalization", () => {
    const rows = [
      {
        preferred_name: "Grace",
        email: "grace@co.com",
        job_title: "Product Analyst",
        hb_level: "SE2",
        hb_squad: "Insights",
        hb_function: "Product",
        manager: "Hank",
        start_date: "2025-09-01",
        work_location: "London",
        headcount_label: "FTE",
      },
    ];
    const { joiners } = getMonthlyMovementPeople(rows);
    expect(joiners[0].function).toBe("Analytics");
  });

  it("excludes future start_date and termination_date", () => {
    // System time is 2026-04-08.
    const rows = [
      // Pre-employment FTE (future start) — should not be a joiner
      {
        preferred_name: "Future Joiner",
        email: "future-joiner@co.com",
        start_date: "2026-05-15",
        headcount_label: "FTE",
      },
      // Garden-leave FTE (future term) — should not be a departure (or joiner,
      // their start is in the past and counts there)
      {
        preferred_name: "Garden Leave",
        email: "gl@co.com",
        start_date: "2024-01-01",
        termination_date: "2026-06-30",
        headcount_label: "FTE",
      },
    ];
    const { joiners, departures } = getMonthlyMovementPeople(rows);
    expect(joiners.map((p) => p.name)).toEqual(["Garden Leave"]);
    expect(departures).toHaveLength(0);
  });
});
