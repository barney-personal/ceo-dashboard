import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPerformanceData, mockGetActiveEmployees } = vi.hoisted(() => ({
  mockGetPerformanceData: vi.fn(),
  mockGetActiveEmployees: vi.fn(),
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

import {
  getEmployeeOptions,
  getEngineerPerformanceRatings,
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
