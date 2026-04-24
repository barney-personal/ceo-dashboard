import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => mockSentry);

vi.mock("@/lib/db", () => ({ db: {} }));

interface FakeWhereFilter {
  date?: string;
}

const filterCarrier: { last: FakeWhereFilter | null } = { last: null };

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (column: { name?: string } | unknown, value: unknown) => {
      // Capture date filters used by readDailyTotalsMicroUsd so the fake DB can
      // narrow rows by UTC date.
      if (
        column &&
        typeof column === "object" &&
        "name" in (column as Record<string, unknown>) &&
        (column as { name: string }).name === "date"
      ) {
        filterCarrier.last = { date: String(value) };
      }
      return actual.eq(
        column as Parameters<typeof actual.eq>[0],
        value as Parameters<typeof actual.eq>[1],
      );
    },
  };
});

import {
  DEFAULT_LLM_DAILY_BUDGET_USD,
  LlmBudgetExceededError,
  assertWithinDailyBudget,
  estimateLlmCostMicroUsd,
  getLlmDailyBudgetUsd,
  getUtcDateKey,
  isLlmBudgetExceededError,
  recordLlmUsage,
} from "../llm-budget";

interface FakeRow {
  date: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicroUsd: number;
  calls: number;
}

function createFakeDb() {
  const rows = new Map<string, FakeRow>();

  function key(date: string, source: string) {
    return `${date}::${source}`;
  }

  const select = vi.fn(() => ({
    from: () => ({
      where: () => {
        const filter = filterCarrier.last;
        filterCarrier.last = null;
        const total = [...rows.values()]
          .filter((r) => (filter?.date ? r.date === filter.date : true))
          .reduce((sum, r) => sum + r.costMicroUsd, 0);
        return Promise.resolve([{ totalMicroUsd: total }]);
      },
    }),
  }));

  const insert = vi.fn(() => ({
    values: (vals: FakeRow) => ({
      onConflictDoUpdate: ({ set: _set }: { set: unknown }) => {
        void _set;
        const k = key(vals.date, vals.source);
        const existing = rows.get(k);
        if (existing) {
          existing.inputTokens += vals.inputTokens;
          existing.outputTokens += vals.outputTokens;
          existing.cachedInputTokens += vals.cachedInputTokens;
          existing.costMicroUsd += vals.costMicroUsd;
          existing.calls += vals.calls;
        } else {
          rows.set(k, { ...vals });
        }
        return Promise.resolve();
      },
    }),
  }));

  return {
    db: { select, insert } as unknown as NonNullable<
      Parameters<typeof assertWithinDailyBudget>[1]
    >["db"],
    rows,
    select,
    insert,
  };
}

describe("getUtcDateKey", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    const date = new Date("2026-04-24T03:14:15.000Z");
    expect(getUtcDateKey(date)).toBe("2026-04-24");
  });

  it("rolls over at UTC midnight regardless of local time", () => {
    expect(getUtcDateKey(new Date("2026-04-24T23:59:59.000Z"))).toBe(
      "2026-04-24",
    );
    expect(getUtcDateKey(new Date("2026-04-25T00:00:00.000Z"))).toBe(
      "2026-04-25",
    );
  });
});

describe("getLlmDailyBudgetUsd", () => {
  const original = process.env.LLM_DAILY_BUDGET_USD;

  beforeEach(() => {
    mockSentry.captureMessage.mockReset();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LLM_DAILY_BUDGET_USD;
    } else {
      process.env.LLM_DAILY_BUDGET_USD = original;
    }
  });

  it("falls back to default when unset", () => {
    delete process.env.LLM_DAILY_BUDGET_USD;
    expect(getLlmDailyBudgetUsd()).toBe(DEFAULT_LLM_DAILY_BUDGET_USD);
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();
  });

  it("falls back to default when empty string", () => {
    process.env.LLM_DAILY_BUDGET_USD = "";
    expect(getLlmDailyBudgetUsd()).toBe(DEFAULT_LLM_DAILY_BUDGET_USD);
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();
  });

  it("parses positive numeric values", () => {
    process.env.LLM_DAILY_BUDGET_USD = "12.5";
    expect(getLlmDailyBudgetUsd()).toBe(12.5);
  });

  it("falls back to default and warns on non-numeric values", () => {
    process.env.LLM_DAILY_BUDGET_USD = "abc";
    expect(getLlmDailyBudgetUsd()).toBe(DEFAULT_LLM_DAILY_BUDGET_USD);
    expect(mockSentry.captureMessage).toHaveBeenCalledWith(
      "Invalid LLM_DAILY_BUDGET_USD; using default",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ integration: "llm-budget" }),
        extra: expect.objectContaining({ rawValue: "abc" }),
      }),
    );
  });

  it("falls back to default and warns on zero", () => {
    process.env.LLM_DAILY_BUDGET_USD = "0";
    expect(getLlmDailyBudgetUsd()).toBe(DEFAULT_LLM_DAILY_BUDGET_USD);
    expect(mockSentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("falls back to default and warns on negative values", () => {
    process.env.LLM_DAILY_BUDGET_USD = "-10";
    expect(getLlmDailyBudgetUsd()).toBe(DEFAULT_LLM_DAILY_BUDGET_USD);
    expect(mockSentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("falls back to default and warns on Infinity", () => {
    process.env.LLM_DAILY_BUDGET_USD = "Infinity";
    expect(getLlmDailyBudgetUsd()).toBe(DEFAULT_LLM_DAILY_BUDGET_USD);
    expect(mockSentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});

describe("estimateLlmCostMicroUsd", () => {
  it("returns zero when usage is null/undefined/empty", () => {
    expect(estimateLlmCostMicroUsd(null)).toBe(0);
    expect(estimateLlmCostMicroUsd(undefined)).toBe(0);
    expect(estimateLlmCostMicroUsd({})).toBe(0);
  });

  it("computes input + output cost from token counts", () => {
    // 1M input @ $3/MTok = $3, 1M output @ $15/MTok = $15 → total $18 = 18_000_000 µUSD
    expect(
      estimateLlmCostMicroUsd({
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBe(18_000_000);
  });

  it("treats cache reads at the discounted rate", () => {
    // 1M cached input @ $0.30/MTok = $0.30 = 300_000 µUSD
    expect(
      estimateLlmCostMicroUsd({
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBe(300_000);
  });

  it("treats cache_creation_input_tokens as regular input", () => {
    // 500k creation + 500k input = 1M input @ $3/MTok = $3 → 3_000_000 µUSD
    expect(
      estimateLlmCostMicroUsd({
        input_tokens: 500_000,
        cache_creation_input_tokens: 500_000,
      }),
    ).toBe(3_000_000);
  });

  it("clamps negative or missing fields to zero", () => {
    expect(
      estimateLlmCostMicroUsd({
        input_tokens: -50,
        output_tokens: null,
      }),
    ).toBe(0);
  });
});

describe("assertWithinDailyBudget", () => {
  const now = new Date("2026-04-24T12:00:00.000Z");
  const original = process.env.LLM_DAILY_BUDGET_USD;

  beforeEach(() => {
    mockSentry.captureMessage.mockReset();
    delete process.env.LLM_DAILY_BUDGET_USD;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LLM_DAILY_BUDGET_USD;
    } else {
      process.env.LLM_DAILY_BUDGET_USD = original;
    }
  });

  it("allows the call when below cap", async () => {
    const { db } = createFakeDb();
    process.env.LLM_DAILY_BUDGET_USD = "10";
    await expect(
      assertWithinDailyBudget("okr-parser", { db, now }),
    ).resolves.toBeUndefined();
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();
  });

  it("throws once spend equals the cap (at-cap is over)", async () => {
    const { db } = createFakeDb();
    process.env.LLM_DAILY_BUDGET_USD = "1";
    // Pre-record exactly $1 at the cap.
    await recordLlmUsage(
      "excel-parser",
      { usage: { input_tokens: 1_000_000 / 3, output_tokens: 0 } },
      { db, now },
    );
    await expect(
      assertWithinDailyBudget("okr-parser", { db, now }),
    ).rejects.toBeInstanceOf(LlmBudgetExceededError);

    expect(mockSentry.captureMessage).toHaveBeenCalledWith(
      "LLM daily budget exceeded",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          integration: "llm-budget",
          source: "okr-parser",
        }),
        extra: expect.objectContaining({
          source: "okr-parser",
          date: "2026-04-24",
          capUsd: 1,
        }),
      }),
    );
  });

  it("throws once spend exceeds the cap", async () => {
    const { db } = createFakeDb();
    process.env.LLM_DAILY_BUDGET_USD = "1";
    // Spend $5 across two sources.
    await recordLlmUsage(
      "excel-parser",
      {
        usage: { input_tokens: 1_000_000, output_tokens: 0 }, // $3
      },
      { db, now },
    );
    await recordLlmUsage(
      "okr-parser",
      {
        usage: { input_tokens: 0, output_tokens: 200_000 }, // $3
      },
      { db, now },
    );

    let caught: unknown;
    try {
      await assertWithinDailyBudget("github-employee-match", { db, now });
    } catch (error) {
      caught = error;
    }
    expect(isLlmBudgetExceededError(caught)).toBe(true);
    if (caught instanceof LlmBudgetExceededError) {
      expect(caught.capUsd).toBe(1);
      expect(caught.source).toBe("github-employee-match");
      expect(caught.date).toBe("2026-04-24");
      expect(caught.spentUsd).toBeGreaterThan(1);
    }
  });

  it("only counts spend on the same UTC day", async () => {
    const { db } = createFakeDb();
    process.env.LLM_DAILY_BUDGET_USD = "1";
    const yesterday = new Date("2026-04-23T12:00:00.000Z");
    await recordLlmUsage(
      "okr-parser",
      { usage: { input_tokens: 5_000_000, output_tokens: 0 } }, // $15
      { db, now: yesterday },
    );

    // Today's call should still pass because the cap is per-day.
    await expect(
      assertWithinDailyBudget("okr-parser", { db, now }),
    ).resolves.toBeUndefined();
  });

  it("uses the malformed-env default cap of $50", async () => {
    const { db } = createFakeDb();
    process.env.LLM_DAILY_BUDGET_USD = "abc";
    // Spend $40 — below default $50, should pass.
    await recordLlmUsage(
      "okr-parser",
      { usage: { input_tokens: 0, output_tokens: 40 / 15 * 1_000_000 } },
      { db, now },
    );
    await expect(
      assertWithinDailyBudget("okr-parser", { db, now }),
    ).resolves.toBeUndefined();
  });
});

describe("recordLlmUsage", () => {
  const now = new Date("2026-04-24T12:00:00.000Z");

  beforeEach(() => {
    mockSentry.captureException.mockReset();
  });

  it("inserts a new row when no prior usage exists", async () => {
    const { db, rows } = createFakeDb();
    await recordLlmUsage(
      "okr-parser",
      { usage: { input_tokens: 1000, output_tokens: 500 } },
      { db, now },
    );
    const row = rows.get("2026-04-24::okr-parser");
    expect(row).toBeDefined();
    expect(row!.inputTokens).toBe(1000);
    expect(row!.outputTokens).toBe(500);
    expect(row!.calls).toBe(1);
    // 1000 input @ $3/MTok = $0.003, 500 output @ $15/MTok = $0.0075 → $0.0105 = 10500 µUSD
    expect(row!.costMicroUsd).toBe(10_500);
  });

  it("accumulates row state under concurrent reservations on the same key", async () => {
    const { db, rows } = createFakeDb();
    await Promise.all([
      recordLlmUsage(
        "okr-parser",
        { usage: { input_tokens: 1000, output_tokens: 500 } },
        { db, now },
      ),
      recordLlmUsage(
        "okr-parser",
        { usage: { input_tokens: 2000, output_tokens: 1000 } },
        { db, now },
      ),
      recordLlmUsage(
        "okr-parser",
        { usage: { input_tokens: 3000, output_tokens: 1500 } },
        { db, now },
      ),
    ]);
    const row = rows.get("2026-04-24::okr-parser")!;
    expect(row.inputTokens).toBe(6000);
    expect(row.outputTokens).toBe(3000);
    expect(row.calls).toBe(3);
  });

  it("keeps separate rows per source on the same date", async () => {
    const { db, rows } = createFakeDb();
    await recordLlmUsage(
      "okr-parser",
      { usage: { input_tokens: 100, output_tokens: 50 } },
      { db, now },
    );
    await recordLlmUsage(
      "excel-parser",
      { usage: { input_tokens: 200, output_tokens: 100 } },
      { db, now },
    );
    expect(rows.size).toBe(2);
    expect(rows.get("2026-04-24::okr-parser")!.calls).toBe(1);
    expect(rows.get("2026-04-24::excel-parser")!.calls).toBe(1);
  });

  it("is a no-op when the message has no usage block", async () => {
    const { db, rows } = createFakeDb();
    await recordLlmUsage("okr-parser", { usage: null }, { db, now });
    await recordLlmUsage("okr-parser", null, { db, now });
    await recordLlmUsage("okr-parser", undefined, { db, now });
    expect(rows.size).toBe(0);
  });

  it("captures Sentry on a write error and does not throw", async () => {
    const failingDb = {
      insert: vi.fn(() => ({
        values: () => ({
          onConflictDoUpdate: () =>
            Promise.reject(new Error("connection refused")),
        }),
      })),
      select: vi.fn(),
    } as unknown as NonNullable<Parameters<typeof recordLlmUsage>[2]>["db"];

    await expect(
      recordLlmUsage(
        "okr-parser",
        { usage: { input_tokens: 100, output_tokens: 50 } },
        { db: failingDb, now },
      ),
    ).resolves.toBeUndefined();

    expect(mockSentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "llm-budget",
          source: "okr-parser",
        }),
        extra: expect.objectContaining({
          operation: "recordLlmUsage",
          date: "2026-04-24",
        }),
      }),
    );
  });
});
