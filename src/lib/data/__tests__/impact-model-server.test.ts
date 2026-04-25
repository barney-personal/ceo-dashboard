import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  rowStr: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "string" ? row[key] : row[key] != null ? String(row[key]) : "",
}));

const { mockGetImpactModel } = vi.hoisted(() => ({
  mockGetImpactModel: vi.fn(),
}));

vi.mock("../impact-model", () => ({
  getImpactModel: mockGetImpactModel,
}));

const { mockGetDirectReports } = vi.hoisted(() => ({
  mockGetDirectReports: vi.fn(),
}));

vi.mock("../managers", () => ({
  getDirectReports: mockGetDirectReports,
}));

import { buildTeamView, getImpactModelHydrated } from "../impact-model.server";

function makeModel() {
  return {
    generated_at: "2026-01-01",
    n_engineers: 3,
    n_features: 1,
    engineers: [
      { name: "Engineer 001", email: "alice@example.com" },
      { name: "Engineer 002", email: "bob@example.com" },
      { name: "Engineer 003", email: "nobody@example.com" },
    ],
  } as unknown as ReturnType<typeof mockGetImpactModel>;
}

describe("getImpactModelHydrated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImpactModel.mockReturnValue(makeModel());
  });

  it("hydrates real names when emails match, preserves JSON-name otherwise", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "headcount",
        rows: [
          { email: "alice@example.com", preferred_name: "Alice" },
          { email: "bob@example.com", preferred_name: "Bob" },
          { email: "other@example.com", preferred_name: "Other" },
        ],
      },
    ]);

    const model = await getImpactModelHydrated();
    expect(model.engineers[0].name).toBe("Alice");
    expect(model.engineers[1].name).toBe("Bob");
    // No match in headcount → fallback to whatever the JSON already has.
    expect(model.engineers[2].name).toBe("Engineer 003");
  });

  it("is case-insensitive — uppercase headcount emails still match", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "headcount",
        rows: [
          { email: "ALICE@EXAMPLE.COM", preferred_name: "Alice Capital" },
        ],
      },
    ]);

    const model = await getImpactModelHydrated();
    expect(model.engineers[0].name).toBe("Alice Capital");
  });

  it("falls back to JSON-name when the DB lookup throws", async () => {
    mockGetReportData.mockRejectedValue(new Error("db down"));
    const model = await getImpactModelHydrated();
    expect(model.engineers[0].name).toBe("Engineer 001");
    expect(model.engineers[1].name).toBe("Engineer 002");
  });

  it("handles missing preferred_name by falling back to rp_full_name then email", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "headcount",
        rows: [
          { email: "alice@example.com", rp_full_name: "Alice Formal" },
          { email: "bob@example.com" },
        ],
      },
    ]);

    const model = await getImpactModelHydrated();
    expect(model.engineers[0].name).toBe("Alice Formal");
    expect(model.engineers[1].name).toBe("bob@example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// buildTeamView — email-join between manager's reports and the model, plus
// sort / reportsNotInModel handling. This is the centrepiece of the manager
// team-coaching view so worth direct coverage rather than only testing
// through the React component.
// ─────────────────────────────────────────────────────────────────────────

function makeReport(email: string, name: string) {
  return {
    email,
    name,
    jobTitle: "Engineer",
    function: "Engineering",
    pillar: "Core",
    squad: null,
    startDate: null,
    level: "L4",
  };
}

function makeEngineerForEmail(email: string, predicted: number, actual: number) {
  return {
    name: "Engineer 000",
    email,
    discipline: "Engineering",
    pillar: "Core",
    level_label: "L4",
    tenure_months: 18,
    actual,
    predicted,
    predicted_insample: predicted,
    residual: actual - predicted,
    slack_msgs_per_day: 5,
    ai_tokens: 0,
    latest_rating: 4,
    shap_contributions: [],
  };
}

describe("buildTeamView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function fakeModel(engineers: ReturnType<typeof makeEngineerForEmail>[]) {
    return {
      engineers,
      shap: { expected_impact: 500, expected_log: 6 },
    } as unknown as Parameters<typeof buildTeamView>[0];
  }

  it("returns null when manager has no direct reports", async () => {
    mockGetDirectReports.mockResolvedValue([]);
    const result = await buildTeamView(fakeModel([]), "mgr@example.com");
    expect(result).toBeNull();
  });

  it("joins reports to engineers by email, sorts by predicted desc, and separates missing reports", async () => {
    mockGetDirectReports.mockResolvedValue([
      makeReport("alice@example.com", "Alice"),
      makeReport("bob@example.com", "Bob"),
      makeReport("ghost@example.com", "Ghost"), // no match in model
    ]);

    const model = fakeModel([
      makeEngineerForEmail("alice@example.com", /* predicted */ 900, 950),
      makeEngineerForEmail("bob@example.com", /* predicted */ 1400, 1200),
      makeEngineerForEmail("nobody@example.com", 700, 700), // not on team
    ]);

    const team = await buildTeamView(model, "mgr@example.com", "Manager Manny");
    expect(team).not.toBeNull();
    expect(team!.managerEmail).toBe("mgr@example.com");
    expect(team!.managerName).toBe("Manager Manny");
    // Sort = predicted desc
    expect(team!.entries.map((e) => e.report.name)).toEqual(["Bob", "Alice"]);
    // Non-team engineer isn't included
    expect(team!.entries.length).toBe(2);
    // Ghost falls into reportsNotInModel
    expect(team!.reportsNotInModel.map((r) => r.name)).toEqual(["Ghost"]);
    // Median of [900, 1400] = 1150
    expect(team!.teamMedianPredicted).toBe(1150);
    expect(team!.expectedImpact).toBe(500);
  });

  it("is case-insensitive on both sides (report email and model email)", async () => {
    mockGetDirectReports.mockResolvedValue([
      makeReport("ALICE@example.com", "Alice Capital"),
    ]);
    const model = fakeModel([
      makeEngineerForEmail("alice@example.com", 900, 1000),
    ]);
    const team = await buildTeamView(model, "mgr@example.com");
    expect(team!.entries.length).toBe(1);
    expect(team!.reportsNotInModel).toEqual([]);
  });

  it("coaching card is attached to each matched entry", async () => {
    mockGetDirectReports.mockResolvedValue([makeReport("alice@example.com", "Alice")]);
    const model = fakeModel([
      makeEngineerForEmail("alice@example.com", 1000, 1100),
    ]);
    const team = await buildTeamView(model, "mgr@example.com");
    expect(team!.entries[0].coaching).toBeDefined();
    expect(team!.entries[0].coaching.residualDirection).toBe("above");
  });
});
