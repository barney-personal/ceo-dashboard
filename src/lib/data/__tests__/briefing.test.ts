import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockInsert,
  mockCaptureException,
  mockNormalizeDatabaseError,
  mockGetBriefingContext,
  mockGenerateBriefing,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockCaptureException: vi.fn(),
  mockNormalizeDatabaseError: vi.fn((_: string, error: unknown) => error),
  mockGetBriefingContext: vi.fn(),
  mockGenerateBriefing: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  userBriefings: {
    userEmail: "user_email",
    briefingDate: "briefing_date",
  },
}));

vi.mock("@/lib/db/errors", () => ({
  normalizeDatabaseError: mockNormalizeDatabaseError,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureException,
}));

vi.mock("../briefing-context", () => ({
  getBriefingContext: mockGetBriefingContext,
}));

vi.mock("@/lib/integrations/llm-briefing", () => ({
  BRIEFING_MODEL: "claude-opus-4-7",
  generateBriefing: mockGenerateBriefing,
}));

import { getOrGenerateBriefing } from "../briefing";

function buildSelectChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "limit"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown[]) => void) => resolve(rows);
  return chain;
}

function buildInsertChain({
  error,
}: {
  error?: unknown;
} = {}) {
  const onConflictDoUpdate = vi.fn(() =>
    error ? Promise.reject(error) : Promise.resolve(),
  );
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  mockInsert.mockReturnValue({ values });
  return { values, onConflictDoUpdate };
}

const context = {
  person: {
    firstName: "Alice",
    fullName: "Alice Example",
    email: "alice@meetcleo.com",
    jobTitle: "Engineer",
    squad: "Chat",
    pillar: "Chat Pillar",
    function: "Engineering",
    tenureMonths: 12,
    role: "everyone" as const,
    directReportCount: 0,
  },
  company: {
    ltvPaidCacRatio: 3.2,
    mau: 123_456,
    headcount: 321,
    arrUsd: 12_300_000,
  },
  pillarOkrs: {
    total: 1,
    onTrack: 1,
    atRisk: 0,
    behind: 0,
    notStarted: 0,
    recent: [],
  },
  squadOkrs: {
    total: 1,
    onTrack: 1,
    atRisk: 0,
    behind: 0,
    notStarted: 0,
    recent: [],
  },
  squadShips: null,
  managerFlags: null,
  meetings: null,
  relevantDashboardSections: ["Overview", "Engineering", "OKRs"],
  generatedAtIso: "2026-04-23T09:00:00.000Z",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-23T09:15:00.000Z"));
  mockSelect.mockImplementation(() => buildSelectChain());
  mockInsert.mockReset();
  mockCaptureException.mockReset();
  mockNormalizeDatabaseError.mockClear();
  mockGetBriefingContext.mockReset();
  mockGenerateBriefing.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getOrGenerateBriefing", () => {
  it("returns the cached briefing when today's model matches", async () => {
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          briefingText: "Cached briefing",
          generatedAt: new Date("2026-04-23T08:00:00.000Z"),
          model: "claude-opus-4-7",
        },
      ]),
    );

    const result = await getOrGenerateBriefing({
      emails: ["Alice@MeetCleo.com", "alice.personal@example.com"],
      role: "everyone",
      userId: "user_123",
    });

    expect(result).toEqual({
      text: "Cached briefing",
      generatedAt: new Date("2026-04-23T08:00:00.000Z"),
      cached: true,
      briefingDate: "2026-04-23",
    });
    expect(mockGetBriefingContext).not.toHaveBeenCalled();
    expect(mockGenerateBriefing).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("regenerates on model mismatch and upserts the new briefing", async () => {
    mockSelect.mockImplementation(() =>
      buildSelectChain([
        {
          briefingText: "Old briefing",
          generatedAt: new Date("2026-04-23T07:00:00.000Z"),
          model: "claude-opus-4-6",
        },
      ]),
    );
    const { values, onConflictDoUpdate } = buildInsertChain();
    mockGetBriefingContext.mockResolvedValue(context);
    mockGenerateBriefing.mockResolvedValue({
      text: "Fresh briefing",
      model: "claude-opus-4-7",
      usage: {
        inputTokens: 101,
        outputTokens: 202,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      },
    });

    const result = await getOrGenerateBriefing({
      emails: ["Alice@MeetCleo.com", "alice.personal@example.com"],
      role: "everyone",
      userId: "user_123",
    });

    expect(mockGetBriefingContext).toHaveBeenCalledWith({
      emails: ["Alice@MeetCleo.com", "alice.personal@example.com"],
      role: "everyone",
      userId: "user_123",
    });
    expect(mockGenerateBriefing).toHaveBeenCalledWith(context);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: "alice@meetcleo.com",
        briefingDate: "2026-04-23",
        briefingText: "Fresh briefing",
        contextJson: context,
        model: "claude-opus-4-7",
        inputTokens: 101,
        outputTokens: 202,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: ["user_email", "briefing_date"],
        set: expect.objectContaining({
          briefingText: "Fresh briefing",
          contextJson: context,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        text: "Fresh briefing",
        cached: false,
        briefingDate: "2026-04-23",
      }),
    );
  });

  it("returns null when no matching employee is found in the context", async () => {
    mockGetBriefingContext.mockResolvedValue({
      ...context,
      person: null,
    });

    const result = await getOrGenerateBriefing({
      emails: ["unknown@example.com"],
      role: "everyone",
      userId: "user_123",
    });

    expect(result).toBeNull();
    expect(mockGenerateBriefing).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still returns the generated text when the cache write fails", async () => {
    const writeError = new Error("insert failed");
    const normalized = new Error("normalized insert failed");
    mockNormalizeDatabaseError.mockReturnValue(normalized);
    buildInsertChain({ error: writeError });
    mockGetBriefingContext.mockResolvedValue(context);
    mockGenerateBriefing.mockResolvedValue({
      text: "Fresh briefing",
      model: "claude-opus-4-7",
      usage: {
        inputTokens: 101,
        outputTokens: 202,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      },
    });

    const result = await getOrGenerateBriefing({
      emails: ["Alice@MeetCleo.com"],
      role: "everyone",
      userId: "user_123",
    });

    expect(result).toEqual(
      expect.objectContaining({
        text: "Fresh briefing",
        cached: false,
      }),
    );
    expect(mockNormalizeDatabaseError).toHaveBeenCalledWith(
      "Persist daily briefing",
      writeError,
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      normalized,
      expect.objectContaining({
        extra: expect.objectContaining({
          step: "cache_write",
          email: "alice@meetcleo.com",
        }),
      }),
    );
  });
});
