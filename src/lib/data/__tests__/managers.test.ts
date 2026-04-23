import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/lib/db/schema", () => ({
  modeReportData: { data: "data", reportId: "report_id" },
  modeReports: { id: "id", name: "name", section: "section" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  desc: (v: unknown) => v,
  sql: vi.fn(() => ({})),
}));

// React's `cache()` memoises on module identity. Each test wants a clean
// load, so we re-import the module (and reset its cache) between scenarios.
async function freshImport() {
  vi.resetModules();
  return await import("../managers");
}

function buildSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "innerJoin", "where", "orderBy", "limit"];
  for (const m of methods) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (r: unknown) => unknown) => resolve(rows);
  return chain;
}

beforeEach(() => {
  mockSelect.mockImplementation(() => buildSelectChain([]));
});

afterEach(() => {
  mockSelect.mockReset();
});

describe("getEmployeeSummariesByEmail", () => {
  it("returns an empty map when no emails are provided", async () => {
    const { getEmployeeSummariesByEmail } = await freshImport();
    const out = await getEmployeeSummariesByEmail([]);
    expect(out.size).toBe(0);
  });

  it("treats null/undefined/blank emails as no-ops", async () => {
    const { getEmployeeSummariesByEmail } = await freshImport();
    const out = await getEmployeeSummariesByEmail([null, undefined, "   "]);
    expect(out.size).toBe(0);
    // Short-circuited before any DB read.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("matches emails case-insensitively and omits unknowns", async () => {
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          data: [
            {
              email: "Alice@MeetCleo.com",
              preferred_name: "Alice",
              rp_full_name: "Alice Test",
              job_title: "Senior Engineer",
              hb_function: "Engineering",
              termination_date: null,
              manager_email: "bob@meetcleo.com",
            },
            {
              email: "bob@meetcleo.com",
              preferred_name: "Bob",
              rp_full_name: "Bob Boss",
              job_title: "CTO",
              hb_function: "Engineering",
              termination_date: null,
              manager_email: null,
            },
          ],
        },
      ])
    );

    const { getEmployeeSummariesByEmail } = await freshImport();
    const out = await getEmployeeSummariesByEmail([
      "ALICE@meetcleo.com",
      "carol@meetcleo.com",
    ]);

    expect(out.size).toBe(1);
    expect(out.has("alice@meetcleo.com")).toBe(true);
    expect(out.has("carol@meetcleo.com")).toBe(false);

    const alice = out.get("alice@meetcleo.com")!;
    expect(alice).toEqual({
      email: "alice@meetcleo.com",
      slug: "alice",
      name: "Alice",
      jobTitle: "Senior Engineer",
      function: "Engineering",
    });
  });

  it("falls back to rp_full_name when preferred_name is missing", async () => {
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          data: [
            {
              email: "dave@meetcleo.com",
              preferred_name: null,
              rp_full_name: "Dave Developer",
              job_title: null,
              hb_function: null,
              termination_date: null,
              manager_email: null,
            },
          ],
        },
      ])
    );

    const { getEmployeeSummariesByEmail } = await freshImport();
    const out = await getEmployeeSummariesByEmail(["dave@meetcleo.com"]);
    const dave = out.get("dave@meetcleo.com")!;
    expect(dave.name).toBe("Dave Developer");
    expect(dave.jobTitle).toBeNull();
    expect(dave.function).toBeNull();
    expect(dave.slug).toBe("dave");
  });
});
