import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect, insert: mockInsert },
}));

vi.mock("@/lib/db/schema", () => ({
  enpsResponses: {
    id: "id",
    clerkUserId: "clerk_user_id",
    month: "month",
    score: "score",
    reason: "reason",
    createdAt: "created_at",
  },
  enpsPrompts: {
    id: "id",
    clerkUserId: "clerk_user_id",
    month: "month",
    skipCount: "skip_count",
    lastShownAt: "last_shown_at",
    completedAt: "completed_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
  asc: (v: unknown) => v,
  desc: (v: unknown) => v,
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      template: strings,
      values,
      as: (alias: string) => ({ alias }),
    }),
    { raw: vi.fn() }
  ),
  count: vi.fn(() => ({ as: (alias: string) => ({ alias }) })),
}));

import {
  classify,
  currentMonth,
  ENPS_MAX_SHOWS_PER_MONTH,
  ENPS_PROMPT_COOLDOWN_MS,
  getEnpsMonthlyTrend,
  recordEnpsPromptShown,
  shouldShowEnpsPrompt,
  submitEnpsResponse,
} from "../enps";

function buildSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "where", "groupBy", "orderBy", "limit"];
  for (const m of methods) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (r: unknown) => unknown) => resolve(rows);
  return chain;
}

function buildInsertChain() {
  const spy = vi.fn(() => ({ id: 1 }));
  const chain = {
    values: () => chain,
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    returning: () => [{ id: 1 }],
    then: (resolve: (r: unknown) => unknown) => resolve(spy()),
  };
  return chain;
}

beforeEach(() => {
  mockSelect.mockImplementation(() => buildSelectChain([]));
  mockInsert.mockImplementation(() => buildInsertChain());
});

afterEach(() => {
  mockSelect.mockReset();
  mockInsert.mockReset();
});

describe("currentMonth", () => {
  it("returns YYYY-MM in UTC", () => {
    expect(currentMonth(new Date("2026-04-19T10:00:00Z"))).toBe("2026-04");
    expect(currentMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

describe("classify", () => {
  it("maps score bands to promoter/passive/detractor", () => {
    expect(classify(0)).toBe("detractor");
    expect(classify(6)).toBe("detractor");
    expect(classify(7)).toBe("passive");
    expect(classify(8)).toBe("passive");
    expect(classify(9)).toBe("promoter");
    expect(classify(10)).toBe("promoter");
  });
});

describe("shouldShowEnpsPrompt", () => {
  it("returns true when no prompt row exists for the month", async () => {
    mockSelect.mockImplementation(() => buildSelectChain([]));
    const result = await shouldShowEnpsPrompt("user_1", new Date("2026-04-19T10:00:00Z"));
    expect(result).toBe(true);
  });

  it("returns false when user has already completed this month", async () => {
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          clerkUserId: "user_1",
          month: "2026-04",
          skipCount: 0,
          lastShownAt: new Date("2026-04-01T10:00:00Z"),
          completedAt: new Date("2026-04-02T10:00:00Z"),
        },
      ])
    );
    const result = await shouldShowEnpsPrompt("user_1", new Date("2026-04-19T10:00:00Z"));
    expect(result).toBe(false);
  });

  it("returns false when skipCount >= max", async () => {
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          clerkUserId: "user_1",
          month: "2026-04",
          skipCount: ENPS_MAX_SHOWS_PER_MONTH,
          lastShownAt: new Date("2026-04-01T10:00:00Z"),
          completedAt: null,
        },
      ])
    );
    const result = await shouldShowEnpsPrompt("user_1", new Date("2026-04-19T10:00:00Z"));
    expect(result).toBe(false);
  });

  it("returns false when cooldown has not elapsed", async () => {
    const now = new Date("2026-04-19T10:00:00Z");
    const shownRecently = new Date(now.getTime() - (ENPS_PROMPT_COOLDOWN_MS - 1000));
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          clerkUserId: "user_1",
          month: "2026-04",
          skipCount: 1,
          lastShownAt: shownRecently,
          completedAt: null,
        },
      ])
    );
    const result = await shouldShowEnpsPrompt("user_1", now);
    expect(result).toBe(false);
  });

  it("returns true when cooldown has elapsed and skipCount under cap", async () => {
    const now = new Date("2026-04-19T10:00:00Z");
    const shownLongAgo = new Date(now.getTime() - (ENPS_PROMPT_COOLDOWN_MS + 1000));
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          clerkUserId: "user_1",
          month: "2026-04",
          skipCount: 2,
          lastShownAt: shownLongAgo,
          completedAt: null,
        },
      ])
    );
    const result = await shouldShowEnpsPrompt("user_1", now);
    expect(result).toBe(true);
  });
});

describe("submitEnpsResponse", () => {
  it("rejects scores outside 0–10", async () => {
    await expect(submitEnpsResponse("u", -1, null)).rejects.toThrow();
    await expect(submitEnpsResponse("u", 11, null)).rejects.toThrow();
    await expect(submitEnpsResponse("u", 5.5, null)).rejects.toThrow();
  });

  it("inserts a response row and marks the prompt completed", async () => {
    const insertCalls: string[] = [];
    mockInsert.mockImplementation((table: unknown) => {
      insertCalls.push(String(table));
      return buildInsertChain();
    });
    const ok = await submitEnpsResponse(
      "user_1",
      8,
      "pretty good",
      new Date("2026-04-19T10:00:00Z")
    );
    expect(ok).toBe(true);
    // Two inserts: response, then prompt upsert
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});

describe("recordEnpsPromptShown", () => {
  it("upserts the prompt row (insert + onConflictDoUpdate)", async () => {
    const chain = buildInsertChain();
    const upsertSpy = vi.spyOn(chain, "onConflictDoUpdate");
    mockInsert.mockImplementation(() => chain);
    await recordEnpsPromptShown("user_1");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });
});

describe("getEnpsMonthlyTrend", () => {
  it("aggregates responses into monthly buckets with eNPS score", async () => {
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        { month: "2026-03", score: 10 },
        { month: "2026-03", score: 9 },
        { month: "2026-03", score: 7 },
        { month: "2026-03", score: 3 },
        { month: "2026-04", score: 9 },
        { month: "2026-04", score: 5 },
      ])
    );

    const trend = await getEnpsMonthlyTrend(12, new Date("2026-04-19T10:00:00Z"));
    expect(trend).toHaveLength(2);

    const march = trend[0];
    expect(march.month).toBe("2026-03");
    expect(march.responseCount).toBe(4);
    expect(march.promoters).toBe(2);
    expect(march.passives).toBe(1);
    expect(march.detractors).toBe(1);
    // eNPS = (2/4 - 1/4) * 100 = 25
    expect(march.enps).toBeCloseTo(25, 5);

    const april = trend[1];
    expect(april.responseCount).toBe(2);
    expect(april.promoters).toBe(1);
    expect(april.detractors).toBe(1);
    // eNPS = (1/2 - 1/2) * 100 = 0
    expect(april.enps).toBeCloseTo(0, 5);
  });
});
