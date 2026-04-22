import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPerformanceData, mockGetActiveEmployees, mockGetAiUsageData } =
  vi.hoisted(() => ({
    mockGetPerformanceData: vi.fn(),
    mockGetActiveEmployees: vi.fn(),
    mockGetAiUsageData: vi.fn(),
  }));

vi.mock("../performance", async () => {
  const actual = await vi.importActual<typeof import("../performance")>(
    "../performance"
  );
  return {
    ...actual,
    getPerformanceData: mockGetPerformanceData,
  };
});

// The DB/Mode dependencies aren't needed for the bridge function under test;
// stub the modules at the import boundary.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("../people", () => ({
  getActiveEmployees: mockGetActiveEmployees,
}));
vi.mock("../okrs", () => ({
  groupLatestOkrRows: vi.fn(() => new Map()),
}));
vi.mock("../ai-usage", async () => {
  const actual =
    await vi.importActual<typeof import("../ai-usage")>("../ai-usage");
  return {
    ...actual,
    getAiUsageData: mockGetAiUsageData,
  };
});

import {
  getEmployeeOptions,
  getEngineerPerformanceRatings,
  getEngineerAiUsage,
} from "../engineer-profile";
import type { Person } from "../people";
import type { PersonPerformance } from "../performance";

function person(overrides: Partial<PersonPerformance> = {}): PersonPerformance {
  return {
    email: "alice@meetcleo.com",
    name: "Alice",
    jobTitle: "",
    level: "",
    squad: "",
    pillar: "",
    function: "",
    ratings: [
      {
        reviewCycle: "2025 H2-B",
        rating: 4,
        reviewerName: "Bob",
        flagged: false,
        missed: false,
      },
    ],
    ...overrides,
  };
}

describe("getEngineerPerformanceRatings", () => {
  beforeEach(() => {
    mockGetPerformanceData.mockReset();
  });

  it("returns null when email is null", async () => {
    const result = await getEngineerPerformanceRatings(null);
    expect(result).toBeNull();
    expect(mockGetPerformanceData).not.toHaveBeenCalled();
  });

  it("returns null when no person matches the email", async () => {
    mockGetPerformanceData.mockResolvedValue({
      people: [person({ email: "other@meetcleo.com" })],
      reviewCycles: ["2025 H2-B"],
    });
    const result = await getEngineerPerformanceRatings("alice@meetcleo.com");
    expect(result).toBeNull();
  });

  it("returns null when the matched person has no ratings", async () => {
    mockGetPerformanceData.mockResolvedValue({
      people: [person({ ratings: [] })],
      reviewCycles: [],
    });
    const result = await getEngineerPerformanceRatings("alice@meetcleo.com");
    expect(result).toBeNull();
  });

  it("matches emails case-insensitively", async () => {
    mockGetPerformanceData.mockResolvedValue({
      people: [person({ email: "alice@MeetCleo.com" })],
      reviewCycles: ["2025 H2-B"],
    });
    const result = await getEngineerPerformanceRatings("ALICE@meetcleo.com");
    expect(result).not.toBeNull();
    expect(result?.ratings).toHaveLength(1);
  });

  it("returns ratings and reviewCycles on the happy path", async () => {
    const p = person();
    mockGetPerformanceData.mockResolvedValue({
      people: [p],
      reviewCycles: ["2025 H2-B"],
    });
    const result = await getEngineerPerformanceRatings(p.email);
    expect(result).toEqual({
      ratings: p.ratings,
      reviewCycles: ["2025 H2-B"],
    });
  });

  it("swallows errors from getPerformanceData and returns null", async () => {
    mockGetPerformanceData.mockRejectedValue(new Error("Mode unavailable"));
    const result = await getEngineerPerformanceRatings("alice@meetcleo.com");
    expect(result).toBeNull();
  });
});

function employee(overrides: Partial<Person> = {}): Person {
  return {
    name: "Alice",
    email: "alice@meetcleo.com",
    jobTitle: "Engineer",
    level: "L4",
    squad: "Squad A",
    pillar: "Engineering",
    function: "Engineering",
    manager: "",
    startDate: "2024-01-01",
    location: "",
    tenureMonths: 12,
    employmentType: "full-time",
    ...overrides,
  };
}

describe("getEmployeeOptions", () => {
  beforeEach(() => {
    mockGetActiveEmployees.mockReset();
  });

  it("returns employees, unassigned, and part-time champions combined, sorted by name", async () => {
    mockGetActiveEmployees.mockResolvedValue({
      employees: [employee({ name: "Zoe", email: "zoe@meetcleo.com" })],
      unassigned: [employee({ name: "Mike", email: "mike@meetcleo.com" })],
      partTimeChampions: [
        employee({ name: "Alice", email: "alice@meetcleo.com" }),
      ],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEmployeeOptions();

    expect(result.map((e) => e.name)).toEqual(["Alice", "Mike", "Zoe"]);
  });

  it("filters out employees with empty emails (can't be used as mapping keys)", async () => {
    mockGetActiveEmployees.mockResolvedValue({
      employees: [
        employee({ name: "Alice", email: "alice@meetcleo.com" }),
        employee({ name: "Bob", email: "" }),
      ],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEmployeeOptions();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alice");
  });

  it("maps falsy jobTitle/squad/pillar to null", async () => {
    mockGetActiveEmployees.mockResolvedValue({
      employees: [
        employee({
          name: "Alice",
          email: "alice@meetcleo.com",
          jobTitle: "",
          squad: "",
          pillar: "",
        }),
      ],
      unassigned: [],
      partTimeChampions: [],
      contractors: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getEmployeeOptions();

    expect(result[0]).toMatchObject({
      jobTitle: null,
      squad: null,
      pillar: null,
    });
  });

  it("logs and returns [] when getActiveEmployees throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetActiveEmployees.mockRejectedValue(new Error("Mode unavailable"));

    const result = await getEmployeeOptions();

    expect(result).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("getEmployeeOptions"),
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});

describe("getEngineerAiUsage", () => {
  beforeEach(() => {
    mockGetAiUsageData.mockReset();
  });

  it("returns null when email is missing", async () => {
    const result = await getEngineerAiUsage(null);
    expect(result).toBeNull();
    expect(mockGetAiUsageData).not.toHaveBeenCalled();
  });

  it("returns null when Mode throws (graceful fallback)", async () => {
    mockGetAiUsageData.mockRejectedValue(new Error("Mode unavailable"));
    const result = await getEngineerAiUsage("alice@meetcleo.com");
    expect(result).toBeNull();
  });

  it("returns null when the engineer has no monthly usage rows", async () => {
    mockGetAiUsageData.mockResolvedValue({
      weeklyByCategory: [],
      weeklyByModel: [],
      monthlyByModel: [],
      monthlyByUser: [],
      syncedAt: new Date("2026-04-22T06:00:00Z"),
      missing: [],
    });
    expect(await getEngineerAiUsage("alice@meetcleo.com")).toBeNull();
  });

  it("combines Claude + Cursor rows for the latest month and computes peer stats locally", async () => {
    mockGetAiUsageData.mockResolvedValue({
      weeklyByCategory: [],
      weeklyByModel: [],
      monthlyByModel: [],
      monthlyByUser: [
        // Alice — both tools, latest month → combined 620
        {
          monthStart: "2026-04-01",
          category: "claude",
          userEmail: "alice@meetcleo.com",
          nDays: 10,
          nModelsUsed: 2,
          totalCost: 500,
          totalTokens: 800_000_000,
          medianTokensPerPerson: 30_000_000,
          avgTokensPerPerson: 80_000_000,
          // Mode's per-category numbers — intentionally divergent so a
          // bug taking row[0].medianCost would surface as a wrong value.
          avgCostPerPerson: 999,
          medianCost: 999,
        },
        {
          monthStart: "2026-04-01",
          category: "cursor",
          userEmail: "alice@meetcleo.com",
          nDays: 8,
          nModelsUsed: 1,
          totalCost: 120,
          totalTokens: 200_000_000,
          medianTokensPerPerson: 30_000_000,
          avgTokensPerPerson: 80_000_000,
          avgCostPerPerson: 7,
          medianCost: 7,
        },
        // Bob — cursor only, latest month → 60
        {
          monthStart: "2026-04-01",
          category: "cursor",
          userEmail: "bob@meetcleo.com",
          nDays: 4,
          nModelsUsed: 1,
          totalCost: 60,
          totalTokens: 100_000_000,
          medianTokensPerPerson: 30_000_000,
          avgTokensPerPerson: 80_000_000,
          avgCostPerPerson: 7,
          medianCost: 7,
        },
        // Carol — claude only, latest month → 200
        {
          monthStart: "2026-04-01",
          category: "claude",
          userEmail: "carol@meetcleo.com",
          nDays: 6,
          nModelsUsed: 1,
          totalCost: 200,
          totalTokens: 250_000_000,
          medianTokensPerPerson: 30_000_000,
          avgTokensPerPerson: 80_000_000,
          avgCostPerPerson: 999,
          medianCost: 999,
        },
        {
          monthStart: "2026-03-01",
          category: "cursor",
          userEmail: "alice@meetcleo.com",
          nDays: 20,
          nModelsUsed: 3,
          totalCost: 300,
          totalTokens: 500_000_000,
          medianTokensPerPerson: 27_000_000,
          avgTokensPerPerson: 70_000_000,
          avgCostPerPerson: 35,
          medianCost: 20,
        },
      ],
      syncedAt: new Date("2026-04-22T06:00:00Z"),
      missing: [],
    });

    const result = await getEngineerAiUsage("ALICE@meetcleo.com");
    expect(result).toBeDefined();
    expect(result?.latestMonthStart).toBe("2026-04-01");
    expect(result?.latestMonthCost).toBe(620);
    expect(result?.latestMonthTokens).toBe(1_000_000_000);
    expect(result?.nDays).toBe(10);
    expect(result?.byCategory).toHaveLength(2);
    // Peer combined-spend distribution: [60, 200, 620].
    // Median = 200, mean = 880/3 ≈ 293.33. Crucially, NEITHER matches the
    // Mode-supplied medianCost (7 or 999) — proving local computation.
    expect(result?.peerSpend).toEqual(
      expect.arrayContaining([60, 200, 620]),
    );
    expect(result?.peerMedianCost).toBe(200);
    expect(result?.peerAvgCost).toBeCloseTo(293.33, 1);
    expect(result?.monthlyTrend.map((t) => t.monthStart)).toEqual([
      "2026-03-01",
      "2026-04-01",
    ]);
    expect(result?.costSeries).toHaveLength(2);
  });
});
