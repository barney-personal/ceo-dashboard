import { describe, expect, it } from "vitest";
import {
  addMonths,
  aggregateHiresByRecruiterMonth,
  buildEmploymentIndex,
  buildRecruiterSummaries,
  buildTeamChartSeries,
  classifyRole,
  currentMonthKey,
  monthKey,
  monthsBetween,
  onlyHires,
  predictHiresPerRecruiter,
  sumToTeamMonthly,
  trailing3mAvg,
  type TalentHireRow,
  type TalentTargetRow,
} from "../talent-utils";

function hire(
  recruiter: string,
  actionDate: string,
  cnt = 1,
  actionType = "hires",
): TalentHireRow {
  return {
    recruiter,
    actionType,
    actionDate,
    cnt,
    role: "",
    department: "",
    candidate: "",
    level: null,
    tech: null,
  };
}

describe("monthKey / addMonths / monthsBetween", () => {
  it("extracts YYYY-MM", () => {
    expect(monthKey("2026-04-01T00:00:00.000Z")).toBe("2026-04");
  });

  it("addMonths rolls the year forward", () => {
    expect(addMonths("2025-11", 3)).toBe("2026-02");
    expect(addMonths("2025-02", -3)).toBe("2024-11");
  });

  it("monthsBetween returns inclusive range", () => {
    expect(monthsBetween("2026-01", "2026-04")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(monthsBetween("2026-01", "2025-12")).toEqual([]);
  });
});

describe("onlyHires", () => {
  it("filters non-hire rows", () => {
    const rows = [
      hire("Lucy", "2026-01-15"),
      hire("Lucy", "2026-01-15", 1, "screen_calls"),
      hire("Ellis", "2026-02-03"),
      hire("Ellis", "2026-02-03", 1, "leavers"),
    ];
    expect(onlyHires(rows)).toHaveLength(2);
  });

  it("drops cnt=0 placeholder rows that pad the current quarter", () => {
    // talent_summary_gh emits a cnt=0 row per recruiter for the current
    // quarter so every recruiter is in the roster even before they've logged
    // a hire — those rows must not extend the month axis or they flatten
    // trailing-3mo projections to zero.
    const rows = [
      hire("Lucy", "2025-08-10", 1),
      hire("Lucy", "2026-04-01", 0),
      hire("Ellis", "2026-04-01", 0),
    ];
    expect(onlyHires(rows)).toHaveLength(1);
  });
});

describe("aggregateHiresByRecruiterMonth", () => {
  it("aggregates per-recruiter per-month with zero fill across the common axis", () => {
    const rows: TalentHireRow[] = [
      hire("Lucy", "2026-01-10"),
      hire("Lucy", "2026-03-22"),
      hire("Lucy", "2026-03-05"),
      hire("Ellis", "2026-02-15"),
      hire("Lucy", "2026-02-20", 1, "screen_calls"), // not a hire
    ];

    const result = aggregateHiresByRecruiterMonth(rows);
    expect(result).toHaveLength(2);

    const lucy = result.find((r) => r.recruiter === "Lucy");
    const ellis = result.find((r) => r.recruiter === "Ellis");
    expect(lucy?.monthly).toEqual([
      { month: "2026-01", hires: 1 },
      { month: "2026-02", hires: 0 },
      { month: "2026-03", hires: 2 },
    ]);
    expect(ellis?.monthly).toEqual([
      { month: "2026-01", hires: 0 },
      { month: "2026-02", hires: 1 },
      { month: "2026-03", hires: 0 },
    ]);
  });

  it("ignores rows with blank recruiter", () => {
    const rows = [
      hire("", "2026-01-10"),
      hire("  ", "2026-02-10"),
      hire("Lucy", "2026-03-10"),
    ];
    const result = aggregateHiresByRecruiterMonth(rows);
    expect(result.map((r) => r.recruiter)).toEqual(["Lucy"]);
  });

  it("returns empty when no hires present", () => {
    expect(aggregateHiresByRecruiterMonth([])).toEqual([]);
    expect(
      aggregateHiresByRecruiterMonth([
        hire("Lucy", "2026-01-10", 1, "screen_calls"),
      ]),
    ).toEqual([]);
  });
});

describe("trailing3mAvg", () => {
  it("averages over last 3 months when ≥3 available", () => {
    expect(
      trailing3mAvg([
        { month: "2026-01", hires: 1 },
        { month: "2026-02", hires: 2 },
        { month: "2026-03", hires: 3 },
        { month: "2026-04", hires: 6 },
      ]),
    ).toBeCloseTo((2 + 3 + 6) / 3, 10);
  });

  it("falls back to what exists when <3 months", () => {
    expect(
      trailing3mAvg([
        { month: "2026-03", hires: 2 },
        { month: "2026-04", hires: 4 },
      ]),
    ).toBe(3);
    expect(trailing3mAvg([])).toBe(0);
  });
});

describe("predictHiresPerRecruiter", () => {
  it("projects trailing-3mo average for the given horizon, starting month+1", () => {
    const histories = [
      {
        recruiter: "Lucy",
        monthly: [
          { month: "2026-01", hires: 1 },
          { month: "2026-02", hires: 2 },
          { month: "2026-03", hires: 3 },
        ],
      },
    ];
    const projected = predictHiresPerRecruiter(histories, 3);
    expect(projected[0].recruiter).toBe("Lucy");
    expect(projected[0].monthly).toEqual([
      { month: "2026-04", hires: 2 },
      { month: "2026-05", hires: 2 },
      { month: "2026-06", hires: 2 },
    ]);
  });

  it("ignores the partial current month when computing the trailing average", () => {
    // April 2026 is in progress (only 1 hire so far); trailing 3mo should
    // use Jan/Feb/Mar and the projection should start at May.
    const histories = [
      {
        recruiter: "Lucy",
        monthly: [
          { month: "2026-01", hires: 3 },
          { month: "2026-02", hires: 3 },
          { month: "2026-03", hires: 3 },
          { month: "2026-04", hires: 1 },
        ],
      },
    ];
    const projected = predictHiresPerRecruiter(histories, 3, "2026-04");
    expect(projected[0].monthly).toEqual([
      { month: "2026-05", hires: 3 },
      { month: "2026-06", hires: 3 },
      { month: "2026-07", hires: 3 },
    ]);
  });

  it("gives an empty projection when history is empty", () => {
    expect(predictHiresPerRecruiter([{ recruiter: "X", monthly: [] }], 3)).toEqual([
      { recruiter: "X", monthly: [] },
    ]);
  });
});

describe("currentMonthKey", () => {
  it("formats the given date as YYYY-MM using UTC", () => {
    expect(currentMonthKey(new Date("2026-04-23T08:30:00Z"))).toBe("2026-04");
    expect(currentMonthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(currentMonthKey(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12");
  });
});

describe("buildEmploymentIndex", () => {
  const records = [
    {
      displayName: "Lucy Lynn",
      status: "active" as const,
      role: "talent_partner" as const,
      terminationDate: null,
      department: "People",
      jobTitle: "Head of Talent",
    },
    {
      displayName: "Chris Rea",
      status: "departed" as const,
      role: "talent_partner" as const,
      terminationDate: "2025-09-22",
      department: "Talent",
      jobTitle: "Principal Talent Partner",
    },
    {
      displayName: "Florian Rose",
      status: "active" as const,
      role: "talent_partner" as const,
      // Notice period — HR marks lifecycle_status as "garden leave" which
      // we classify as active even though a termination date is set.
      terminationDate: "2026-06-17",
      department: "People",
      jobTitle: "Talent Lead",
    },
  ];

  it("uses the caller-supplied status to classify each recruiter", () => {
    const idx = buildEmploymentIndex(records, [
      "Lucy Lynn",
      "Chris Rea",
      "Florian Rose",
    ]);
    expect(idx["Lucy Lynn"]?.status).toBe("active");
    expect(idx["Chris Rea"]?.status).toBe("departed");
    expect(idx["Chris Rea"]?.terminationDate).toBe("2025-09-22");
    expect(idx["Florian Rose"]?.status).toBe("active");
    expect(idx["Florian Rose"]?.terminationDate).toBe("2026-06-17");
  });

  it("defaults unknown recruiters to role=other", () => {
    const idx = buildEmploymentIndex(records, ["Someone External"]);
    expect(idx["Someone External"]?.status).toBe("unknown");
    expect(idx["Someone External"]?.role).toBe("other");
  });

  it("promotes unknown recruiters on the target roster to role=talent_partner", () => {
    const idx = buildEmploymentIndex(records, ["Beth Baron"], ["Beth Baron"]);
    expect(idx["Beth Baron"]?.status).toBe("unknown");
    expect(idx["Beth Baron"]?.role).toBe("talent_partner");
  });

  it("matches on first/last name variants when middle names differ", () => {
    const idx = buildEmploymentIndex(
      [
        {
          displayName: "Jamie A. Davies",
          status: "departed" as const,
          role: "talent_partner" as const,
          terminationDate: "2025-07-11",
          department: "Talent",
          jobTitle: "Principal Talent Partner",
        },
      ],
      ["Jamie Davies"],
    );
    expect(idx["Jamie Davies"]?.status).toBe("departed");
    expect(idx["Jamie Davies"]?.terminationDate).toBe("2025-07-11");
  });

  it("matches on alias names (e.g. Greenhouse full name vs. preferred name)", () => {
    const idx = buildEmploymentIndex(
      [
        {
          displayName: "Liv Smith",
          aliases: ["Olivia Smith"],
          status: "active" as const,
          role: "talent_partner" as const,
          terminationDate: null,
          department: "People",
          jobTitle: "Talent Partner",
        },
      ],
      ["Olivia Smith"],
    );
    expect(idx["Olivia Smith"]?.status).toBe("active");
    expect(idx["Olivia Smith"]?.matchedName).toBe("Liv Smith");
  });

  it("prefers an active record over a departed one when the same name appears twice", () => {
    // E.g. someone who left and was later re-hired — the active record wins.
    const idx = buildEmploymentIndex(
      [
        {
          displayName: "Angela Komornik",
          status: "departed" as const,
          role: "talent_partner" as const,
          terminationDate: "2024-05-01",
          department: "Talent",
          jobTitle: "Talent Partner",
        },
        {
          displayName: "Angela Komornik",
          status: "active" as const,
          role: "talent_partner" as const,
          terminationDate: null,
          department: "Talent",
          jobTitle: "Talent Partner",
        },
      ],
      ["Angela Komornik"],
    );
    expect(idx["Angela Komornik"]?.status).toBe("active");
  });
});

describe("classifyRole", () => {
  it("matches Talent Partner job titles", () => {
expect(classifyRole("Senior Talent Partner")).toBe("talent_partner");
    expect(classifyRole("Talent Partner II")).toBe("talent_partner");
    expect(classifyRole("Head of Talent")).toBe("talent_partner");
    expect(classifyRole("Principal Talent Partner")).toBe("talent_partner");
    expect(classifyRole("Talent Lead - Data & Machine Learning")).toBe(
      "talent_partner",
    );
    expect(classifyRole("Talent Acquisition Lead")).toBe("talent_partner");
    expect(classifyRole("Recruiter")).toBe("talent_partner");
  });

  it("matches Sourcer job titles", () => {
expect(classifyRole("Talent Sourcer")).toBe("sourcer");
    expect(classifyRole("Sourcing Partner")).toBe("sourcer");
  });

  it("classifies non-recruiter titles as other", () => {
expect(classifyRole("SVP of Technology")).toBe("other");
    expect(classifyRole("Product Director")).toBe("other");
    expect(classifyRole("Strategy & Operations Manager")).toBe("other");
    expect(classifyRole(null)).toBe("other");
  });
});

describe("sumToTeamMonthly", () => {
  it("sums aligned histories month-by-month", () => {
    const histories = [
      {
        recruiter: "Lucy",
        monthly: [
          { month: "2026-01", hires: 1 },
          { month: "2026-02", hires: 2 },
        ],
      },
      {
        recruiter: "Ellis",
        monthly: [
          { month: "2026-01", hires: 3 },
          { month: "2026-02", hires: 4 },
        ],
      },
    ];
    expect(sumToTeamMonthly(histories)).toEqual([
      { month: "2026-01", hires: 4 },
      { month: "2026-02", hires: 6 },
    ]);
  });
});

describe("buildTeamChartSeries", () => {
  it("produces solid + dashed series anchored at the last actual month", () => {
    const actual = [
      { month: "2026-02", hires: 4 },
      { month: "2026-03", hires: 6 },
    ];
    const projection = [
      { month: "2026-04", hires: 5 },
      { month: "2026-05", hires: 5 },
    ];
    const series = buildTeamChartSeries(actual, projection);
    expect(series).toHaveLength(2);
    expect(series[0].dashed).toBeUndefined();
    expect(series[0].data).toEqual([
      { date: "2026-02-01", value: 4 },
      { date: "2026-03-01", value: 6 },
    ]);
    expect(series[1].dashed).toBe(true);
    // Projection starts at the last actual point to keep the line continuous.
    expect(series[1].data).toEqual([
      { date: "2026-03-01", value: 6 },
      { date: "2026-04-01", value: 5 },
      { date: "2026-05-01", value: 5 },
    ]);
  });

  it("omits projection series when there is no projection", () => {
    const series = buildTeamChartSeries(
      [{ month: "2026-03", hires: 6 }],
      [],
    );
    expect(series).toHaveLength(1);
  });
});

describe("buildRecruiterSummaries", () => {
  it("computes last-12m, last-3m, projected, and QTD attainment", () => {
    const histories = [
      {
        recruiter: "Lucy",
        monthly: [
          { month: "2025-06", hires: 2 },
          { month: "2025-07", hires: 1 },
          { month: "2025-08", hires: 1 },
          { month: "2025-09", hires: 2 },
          { month: "2025-10", hires: 2 },
          { month: "2025-11", hires: 3 },
          { month: "2025-12", hires: 2 },
          { month: "2026-01", hires: 1 },
          { month: "2026-02", hires: 4 },
          { month: "2026-03", hires: 3 },
          { month: "2026-04", hires: 2 }, // trailing: (4+3+2)/3 = 3
        ],
      },
      {
        recruiter: "Ellis",
        monthly: [
          { month: "2025-06", hires: 0 },
          { month: "2025-07", hires: 0 },
          { month: "2025-08", hires: 0 },
          { month: "2025-09", hires: 0 },
          { month: "2025-10", hires: 0 },
          { month: "2025-11", hires: 0 },
          { month: "2025-12", hires: 0 },
          { month: "2026-01", hires: 0 },
          { month: "2026-02", hires: 0 },
          { month: "2026-03", hires: 0 },
          { month: "2026-04", hires: 0 },
        ],
      },
    ];
    const targets: TalentTargetRow[] = [
      {
        recruiter: "Lucy",
        tech: "Tech",
        hiresQtd: 6,
        targetQtd: 8,
        teamQtd: 100,
      },
    ];

    const summaries = buildRecruiterSummaries(histories, targets);
    // Sorted by hiresLast12m desc — Lucy first.
    expect(summaries.map((s) => s.recruiter)).toEqual(["Lucy", "Ellis"]);

    const lucy = summaries[0];
    expect(lucy.tech).toBe("Tech");
    expect(lucy.hiresLast12m).toBe(23);
    expect(lucy.hiresLast3m).toBe(9);
    expect(lucy.trailing3mAvg).toBe(3);
    expect(lucy.projectedNext3m).toBe(9);
    expect(lucy.hiresQtd).toBe(6);
    expect(lucy.targetQtd).toBe(8);
    expect(lucy.attainmentQtd).toBeCloseTo(0.75, 5);

    const ellis = summaries[1];
    expect(ellis.tech).toBeNull();
    expect(ellis.targetQtd).toBeNull();
    expect(ellis.attainmentQtd).toBeNull();
  });

  it("treats zero-target recruiters as no attainment", () => {
    const histories = [
      {
        recruiter: "Archie",
        monthly: [{ month: "2026-04", hires: 0 }],
      },
    ];
    const targets: TalentTargetRow[] = [
      {
        recruiter: "Archie",
        tech: "Tech",
        hiresQtd: 0,
        targetQtd: 0,
        teamQtd: 100,
      },
    ];
    const summaries = buildRecruiterSummaries(histories, targets);
    expect(summaries[0].attainmentQtd).toBeNull();
  });
});
