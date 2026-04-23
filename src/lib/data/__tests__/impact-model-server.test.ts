import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const { mockGetReportData } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  rowStr: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "string" ? row[key] : row[key] != null ? String(row[key]) : "",
}));

const TEST_KEY = "test-key-do-not-use-in-prod";

function hash(email: string): string {
  return createHmac("sha256", TEST_KEY)
    .update(email.toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

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

const ALICE_HASH = hash("alice@example.com");
const BOB_HASH = hash("BOB@example.com"); // uppercase source — should still match

function makeModel() {
  return {
    generated_at: "2026-01-01",
    n_engineers: 2,
    n_features: 1,
    engineers: [
      { name: "Engineer 001", email: "anon-001", email_hash: ALICE_HASH },
      { name: "Engineer 002", email: "anon-002", email_hash: BOB_HASH },
      { name: "Engineer 003", email: "anon-003", email_hash: "deadbeefdeadbeef" },
    ],
  } as unknown as ReturnType<typeof mockGetImpactModel>;
}

describe("getImpactModelHydrated", () => {
  const originalKey = process.env.IMPACT_MODEL_HASH_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImpactModel.mockReturnValue(makeModel());
    process.env.IMPACT_MODEL_HASH_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.IMPACT_MODEL_HASH_KEY;
    else process.env.IMPACT_MODEL_HASH_KEY = originalKey;
  });

  it("hydrates real names when hashes match, preserves pseudonym otherwise", async () => {
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
    expect(model.engineers[2].name).toBe("Engineer 003"); // unmatched hash → fallback
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

  it("does not populate real email addresses onto the engineers array", async () => {
    mockGetReportData.mockResolvedValue([
      {
        queryName: "headcount",
        rows: [{ email: "alice@example.com", preferred_name: "Alice" }],
      },
    ]);

    const model = await getImpactModelHydrated();
    for (const e of model.engineers) {
      expect(e.email).toMatch(/^anon-\d{3}$/);
      expect(e.email).not.toContain("@");
    }
  });

  it("falls back to anonymised when IMPACT_MODEL_HASH_KEY is not set", async () => {
    delete process.env.IMPACT_MODEL_HASH_KEY;
    const model = await getImpactModelHydrated();
    expect(mockGetReportData).not.toHaveBeenCalled();
    expect(model.engineers[0].name).toBe("Engineer 001");
  });

  it("falls back to anonymised when the DB lookup throws", async () => {
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

  it("warns loudly when 0/many hashes match a populated headcount (key rotation signal)", async () => {
    // Simulates the key-rotation failure mode: JSON was hashed with an old
    // key, so none of the committed hashes match anything in the current
    // headcount. The page still degrades gracefully but on-call gets a
    // clear log line telling them what happened.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetImpactModel.mockReturnValue({
      ...makeModel(),
      // All-mismatched hashes — simulates a post-rotation JSON
      engineers: Array.from({ length: 12 }).map((_, i) => ({
        name: `Engineer ${i}`,
        email: `anon-${i}`,
        email_hash: `ffff${i.toString().padStart(12, "0")}`,
      })),
    } as unknown as ReturnType<typeof mockGetImpactModel>);
    mockGetReportData.mockResolvedValue([
      {
        queryName: "headcount",
        rows: Array.from({ length: 15 }).map((_, i) => ({
          email: `person${i}@example.com`,
          preferred_name: `Person ${i}`,
        })),
      },
    ]);

    await getImpactModelHydrated();

    const matched = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes("IMPACT_MODEL_HASH_KEY was rotated"),
    );
    expect(matched).toBeDefined();
    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// buildTeamView — hash-join between manager's reports and the model, plus
// sort / null-key / reportsNotInModel handling. This is the centrepiece of
// the manager team-coaching view so worth direct coverage rather than only
// testing through the React component.
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

function makeEngineerForHash(email: string, predicted: number, actual: number) {
  return {
    name: "Engineer 000",
    email: "anon-000",
    email_hash: hash(email),
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
  const originalKey = process.env.IMPACT_MODEL_HASH_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.IMPACT_MODEL_HASH_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.IMPACT_MODEL_HASH_KEY;
    else process.env.IMPACT_MODEL_HASH_KEY = originalKey;
  });

  function fakeModel(engineers: ReturnType<typeof makeEngineerForHash>[]) {
    return {
      engineers,
      shap: { expected_impact: 500, expected_log: 6 },
    } as unknown as Parameters<typeof buildTeamView>[0];
  }

  it("returns null when IMPACT_MODEL_HASH_KEY is unset", async () => {
    delete process.env.IMPACT_MODEL_HASH_KEY;
    const result = await buildTeamView(fakeModel([]), "mgr@example.com");
    expect(result).toBeNull();
    expect(mockGetDirectReports).not.toHaveBeenCalled();
  });

  it("returns null when manager has no direct reports", async () => {
    mockGetDirectReports.mockResolvedValue([]);
    const result = await buildTeamView(fakeModel([]), "mgr@example.com");
    expect(result).toBeNull();
  });

  it("joins reports to engineers via hash, sorts by predicted desc, and separates missing reports", async () => {
    mockGetDirectReports.mockResolvedValue([
      makeReport("alice@example.com", "Alice"),
      makeReport("bob@example.com", "Bob"),
      makeReport("ghost@example.com", "Ghost"), // no match in model
    ]);

    const model = fakeModel([
      makeEngineerForHash("alice@example.com", /* predicted */ 900, 950),
      makeEngineerForHash("bob@example.com", /* predicted */ 1400, 1200),
      makeEngineerForHash("nobody@example.com", 700, 700), // not on team
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

  it("is case-insensitive on report emails", async () => {
    mockGetDirectReports.mockResolvedValue([
      makeReport("ALICE@example.com", "Alice Capital"),
    ]);
    const model = fakeModel([
      makeEngineerForHash("alice@example.com", 900, 1000),
    ]);
    const team = await buildTeamView(model, "mgr@example.com");
    expect(team!.entries.length).toBe(1);
    expect(team!.reportsNotInModel).toEqual([]);
  });

  it("coaching card is attached to each matched entry", async () => {
    mockGetDirectReports.mockResolvedValue([makeReport("alice@example.com", "Alice")]);
    const model = fakeModel([
      makeEngineerForHash("alice@example.com", 1000, 1100),
    ]);
    const team = await buildTeamView(model, "mgr@example.com");
    expect(team!.entries[0].coaching).toBeDefined();
    expect(team!.entries[0].coaching.residualDirection).toBe("above");
  });
});
