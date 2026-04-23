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

import { getImpactModelHydrated } from "../impact-model.server";

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
});
