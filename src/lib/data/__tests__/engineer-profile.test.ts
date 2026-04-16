import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPerformanceData } = vi.hoisted(() => ({
  mockGetPerformanceData: vi.fn(),
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
  getActiveEmployees: vi.fn(),
}));
vi.mock("../okrs", () => ({
  groupLatestOkrRows: vi.fn(() => new Map()),
}));

import { getEngineerPerformanceRatings } from "../engineer-profile";
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
