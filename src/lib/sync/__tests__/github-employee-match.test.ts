import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  githubMock,
  anthropicMock,
  sentryMock,
  dbMock,
} = vi.hoisted(() => ({
  githubMock: {
    getUserProfileOrNull: vi.fn(),
  },
  anthropicMock: {
    create: vi.fn(),
  },
  sentryMock: {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  },
  dbMock: {
    selectQueue: [] as unknown[][],
    selectIndex: 0,
    insertedRows: [] as unknown[],
    conflictSets: [] as unknown[],
  },
}));

vi.mock("@/lib/integrations/github", () => ({
  getUserProfileOrNull: githubMock.getUserProfileOrNull,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicMock.create };
  },
}));

vi.mock("@sentry/nextjs", () => sentryMock);

vi.mock("@/lib/db/schema", () => ({
  githubPrs: {
    authorLogin: "authorLogin",
  },
  githubEmployeeMap: {
    githubLogin: "githubLogin",
    matchConfidence: "matchConfidence",
  },
  modeReportData: {
    queryName: "queryName",
    data: "data",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

vi.mock("@/lib/db", () => {
  const onConflictDoUpdate = vi.fn(({ set }: { set: unknown }) => {
    dbMock.conflictSets.push(set);
    return Promise.resolve();
  });
  const insertValues = vi.fn((row: unknown) => {
    dbMock.insertedRows.push(row);
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values: insertValues }));

  // Drizzle query builders are thenables: `await db.select().from()` calls
  // `.then(resolve, reject)` via the thenable protocol. We must call
  // `resolve(value)` — returning a Promise from `then` is ignored. When used
  // as a `vi.fn` implementation (e.g. `.limit(n)` where the first arg is a
  // number), we fall back to returning a Promise.
  const makeFrom = () =>
    vi.fn(() => {
      const thenable = (onResolve?: unknown) => {
        const v = dbMock.selectQueue[dbMock.selectIndex++] ?? [];
        if (typeof onResolve === "function") {
          (onResolve as (v: unknown) => void)(v);
          return;
        }
        return Promise.resolve(v);
      };
      return {
        where: vi.fn(() => ({
          limit: vi.fn(thenable),
          then: thenable,
        })),
        then: thenable,
      };
    });

  const select = vi.fn(() => ({ from: makeFrom() }));
  const selectDistinct = vi.fn(() => ({ from: makeFrom() }));

  return {
    db: { select, selectDistinct, insert },
  };
});

import { runGitHubEmployeeMapping } from "../github-employee-match";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
} from "../errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InsertedRow {
  githubLogin: string;
  employeeName?: string | null;
  employeeEmail?: string | null;
  githubName?: string | null;
  matchMethod: string;
  matchConfidence?: string;
  isBot?: boolean;
}

function makeEmployee(overrides: Partial<{
  preferred_name: string;
  employee_email: string;
  function_name: string;
}> = {}) {
  return {
    preferred_name: "Alice Walker",
    employee_email: "alice.walker@meetcleo.com",
    function_name: "Engineering",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<{
  login: string;
  name: string | null;
  email: string | null;
}> = {}) {
  return {
    login: "alicew",
    name: "Alice Walker",
    email: null,
    ...overrides,
  };
}

function queueDb({
  prLogins,
  existingMappings = [],
  employees = [],
}: {
  prLogins: { login: string }[];
  existingMappings?: { githubLogin: string; matchConfidence: string | null }[];
  employees?: ReturnType<typeof makeEmployee>[];
}) {
  dbMock.selectQueue = [
    prLogins,
    existingMappings,
    employees.length > 0 ? [{ data: employees }] : [],
  ];
  dbMock.selectIndex = 0;
}

function makeAnthropicResponse(
  matches: unknown[],
  opts: { stop_reason?: string; rawText?: string } = {}
) {
  return {
    content: [
      {
        type: "text" as const,
        text: opts.rawText ?? JSON.stringify(matches),
      },
    ],
    stop_reason: opts.stop_reason ?? "end_turn",
  };
}

beforeEach(() => {
  dbMock.selectQueue = [];
  dbMock.selectIndex = 0;
  dbMock.insertedRows = [];
  dbMock.conflictSets = [];
  for (const fn of Object.values(githubMock)) fn.mockReset();
  for (const fn of Object.values(sentryMock)) fn.mockReset();
  anthropicMock.create.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runGitHubEmployeeMapping — bot detection", () => {
  it("detects [bot] suffix and inserts isBot=true without calling GitHub or LLM", async () => {
    queueDb({
      prLogins: [{ login: "dependabot[bot]" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 1, unmatched: 0, skipped: 0 });
    expect(dbMock.insertedRows).toHaveLength(1);
    expect(dbMock.insertedRows[0]).toMatchObject({
      githubLogin: "dependabot[bot]",
      matchMethod: "auto",
      isBot: true,
    });
    expect(dbMock.conflictSets[0]).toEqual({
      isBot: true,
      matchMethod: "auto",
    });
    expect(githubMock.getUserProfileOrNull).not.toHaveBeenCalled();
    expect(anthropicMock.create).not.toHaveBeenCalled();
  });

  it("detects exact bot logins (dependabot, circleci, cursor, github-actions)", async () => {
    queueDb({
      prLogins: [
        { login: "dependabot" },
        { login: "circleci" },
        { login: "cursor" },
        { login: "github-actions" },
      ],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.bots).toBe(4);
    expect(githubMock.getUserProfileOrNull).not.toHaveBeenCalled();
  });

  it("treats bot detection case-insensitively", async () => {
    queueDb({ prLogins: [{ login: "DependaBot[BOT]" }] });

    const result = await runGitHubEmployeeMapping();

    expect(result.bots).toBe(1);
  });
});

describe("runGitHubEmployeeMapping — skip logic", () => {
  it("skips logins with high/medium-confidence mapping rows", async () => {
    queueDb({
      prLogins: [
        { login: "alicew" },
        { login: "bob" },
      ],
      existingMappings: [
        { githubLogin: "alicew", matchConfidence: "high" },
        { githubLogin: "bob", matchConfidence: "medium" },
      ],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 0, skipped: 0 });
    expect(githubMock.getUserProfileOrNull).not.toHaveBeenCalled();
    expect(dbMock.insertedRows).toHaveLength(0);
  });

  it("retries low-confidence mapping rows", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "alicew", name: "Alice Walker", email: null })
    );

    queueDb({
      prLogins: [{ login: "alicew" }],
      existingMappings: [{ githubLogin: "alicew", matchConfidence: "low" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    expect(githubMock.getUserProfileOrNull).toHaveBeenCalledTimes(1);
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row).toMatchObject({
      githubLogin: "alicew",
      employeeName: "Alice Walker",
      matchMethod: "auto",
      matchConfidence: "high",
    });
  });

  it("returns zero counts when there are no unmapped logins", async () => {
    queueDb({
      prLogins: [{ login: "alicew" }],
      existingMappings: [{ githubLogin: "alicew", matchConfidence: "high" }],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 0, skipped: 0 });
    expect(githubMock.getUserProfileOrNull).not.toHaveBeenCalled();
    // Employee data lookup should not run when nothing is unmapped
    expect(dbMock.selectIndex).toBe(2);
  });
});

describe("runGitHubEmployeeMapping — deterministic matching", () => {
  it("matches by GitHub email (highest confidence)", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({
        login: "ali",
        name: "Different Person",
        email: "alice.walker@meetcleo.com",
      })
    );

    queueDb({
      prLogins: [{ login: "ali" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row).toMatchObject({
      employeeEmail: "alice.walker@meetcleo.com",
      matchConfidence: "high",
      matchMethod: "auto",
    });
  });

  it("matches case-insensitive emails", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ email: "ALICE.WALKER@MEETCLEO.COM" })
    );

    queueDb({
      prLogins: [{ login: "alicew" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
  });

  it("matches exact full normalized name (high confidence)", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ name: "alice walker", email: null })
    );

    queueDb({
      prLogins: [{ login: "alicew" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.matchConfidence).toBe("high");
    expect(row.employeeName).toBe("Alice Walker");
    expect(row.githubName).toBe("alice walker");
  });

  it("matches first+last with middle name (high confidence)", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ name: "Alice Marie Walker" })
    );

    queueDb({
      prLogins: [{ login: "amw" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.matchConfidence).toBe("high");
  });

  it("strips accents during name matching", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ name: "José García" })
    );

    queueDb({
      prLogins: [{ login: "jose" }],
      employees: [
        makeEmployee({
          preferred_name: "Jose Garcia",
          employee_email: "jose.garcia@meetcleo.com",
        }),
      ],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.employeeName).toBe("Jose Garcia");
    expect(row.matchConfidence).toBe("high");
  });

  it("normalizes hyphens during name matching", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ name: "Anne-Marie Walker" })
    );

    queueDb({
      prLogins: [{ login: "annem" }],
      employees: [
        makeEmployee({
          preferred_name: "Anne Marie Walker",
          employee_email: "anne.walker@meetcleo.com",
        }),
      ],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.matchConfidence).toBe("high");
  });

  it("matches single-name login to email prefix (medium confidence)", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "rob", name: "rob", email: null })
    );

    queueDb({
      prLogins: [{ login: "rob" }],
      employees: [
        makeEmployee({
          preferred_name: "Robert Smith",
          employee_email: "rob.smith@meetcleo.com",
        }),
      ],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.matchConfidence).toBe("medium");
    expect(row.employeeEmail).toBe("rob.smith@meetcleo.com");
  });
});

describe("runGitHubEmployeeMapping — GitHub profile lookup failures", () => {
  it("transient failure increments skipped without inserting", async () => {
    githubMock.getUserProfileOrNull.mockRejectedValue(
      new Error("network error")
    );

    queueDb({
      prLogins: [{ login: "alicew" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 0, skipped: 1 });
    expect(dbMock.insertedRows).toHaveLength(0);
    expect(anthropicMock.create).not.toHaveBeenCalled();
  });

  it("rethrows SyncCancelledError from GitHub profile lookup", async () => {
    githubMock.getUserProfileOrNull.mockRejectedValue(
      new SyncCancelledError("cancelled")
    );

    queueDb({
      prLogins: [{ login: "alicew" }],
      employees: [makeEmployee()],
    });

    await expect(runGitHubEmployeeMapping()).rejects.toBeInstanceOf(
      SyncCancelledError
    );
  });

  it("rethrows SyncDeadlineExceededError from GitHub profile lookup", async () => {
    githubMock.getUserProfileOrNull.mockRejectedValue(
      new SyncDeadlineExceededError("deadline")
    );

    queueDb({
      prLogins: [{ login: "alicew" }],
      employees: [makeEmployee()],
    });

    await expect(runGitHubEmployeeMapping()).rejects.toBeInstanceOf(
      SyncDeadlineExceededError
    );
  });

  it("treats null profile (404) as deterministic failure for LLM fallback", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(null);
    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([
        {
          login: "ghost",
          employeeName: "Alice Walker",
          employeeEmail: "alice.walker@meetcleo.com",
        },
      ])
    );

    queueDb({
      prLogins: [{ login: "ghost" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
    expect(anthropicMock.create).toHaveBeenCalledTimes(1);
  });
});

describe("runGitHubEmployeeMapping — LLM fallback", () => {
  it("inserts LLM matches with medium confidence and remaining as low", async () => {
    githubMock.getUserProfileOrNull
      .mockResolvedValueOnce(makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null }))
      .mockResolvedValueOnce(makeProfile({ login: "another-one", name: "Mystery Dev", email: null }));

    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([
        {
          login: "weird-handle",
          employeeName: "Alice Walker",
          employeeEmail: "alice.walker@meetcleo.com",
        },
      ])
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }, { login: "another-one" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 1, bots: 0, unmatched: 1, skipped: 0 });
    expect(dbMock.insertedRows).toHaveLength(2);

    const llmRow = dbMock.insertedRows.find(
      (r) => (r as InsertedRow).githubLogin === "weird-handle"
    ) as InsertedRow;
    expect(llmRow).toMatchObject({
      employeeName: "Alice Walker",
      employeeEmail: "alice.walker@meetcleo.com",
      githubName: "Cryptic Person",
      matchMethod: "llm",
      matchConfidence: "medium",
    });

    const lowRow = dbMock.insertedRows.find(
      (r) => (r as InsertedRow).githubLogin === "another-one"
    ) as InsertedRow;
    expect(lowRow).toMatchObject({
      githubName: "Mystery Dev",
      matchMethod: "auto",
      matchConfidence: "low",
    });
  });

  it("strips ```json fences before parsing", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([], {
        rawText:
          "```json\n[{\"login\":\"weird-handle\",\"employeeName\":\"Alice Walker\",\"employeeEmail\":\"alice.walker@meetcleo.com\"}]\n```",
      })
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result.mapped).toBe(1);
  });

  it("warns when stop_reason is max_tokens", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([], {
        stop_reason: "max_tokens",
        rawText: "[",
      })
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 1, skipped: 0 });
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "LLM employee match hit max_tokens",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ llm_truncated: "true" }),
      })
    );
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "Failed to parse LLM employee match response",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({ reason: "truncated_by_max_tokens" }),
      })
    );
  });

  it("warns and stores low-confidence on invalid JSON", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([], { rawText: "not json at all" })
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 1, skipped: 0 });
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "Failed to parse LLM employee match response",
      expect.objectContaining({ level: "warning" })
    );
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.matchConfidence).toBe("low");
  });

  it("warns and stores low-confidence on validation failure", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([
        {
          login: "weird-handle",
          // Missing employeeEmail entirely — schema requires it
          employeeName: "Alice Walker",
        },
      ])
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 1, skipped: 0 });
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "GitHub employee match LLM output failed validation",
      expect.objectContaining({ level: "warning" })
    );
  });

  it("filters out LLM matches whose email is not in the directory", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([
        {
          login: "weird-handle",
          employeeName: "Hallucinated Person",
          employeeEmail: "not.in.directory@meetcleo.com",
        },
      ])
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 1, skipped: 0 });
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.matchConfidence).toBe("low");
  });

  it("filters out LLM matches for logins not in the unmatched set", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockResolvedValue(
      makeAnthropicResponse([
        {
          login: "different-login",
          employeeName: "Alice Walker",
          employeeEmail: "alice.walker@meetcleo.com",
        },
      ])
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 1, skipped: 0 });
    expect(dbMock.insertedRows).toHaveLength(1);
    expect((dbMock.insertedRows[0] as InsertedRow).githubLogin).toBe(
      "weird-handle"
    );
  });

  it("captures non-cancellation LLM errors and stores all as low-confidence", async () => {
    githubMock.getUserProfileOrNull
      .mockResolvedValueOnce(makeProfile({ login: "first", name: "First Dev", email: null }))
      .mockResolvedValueOnce(makeProfile({ login: "second", name: "Second Dev", email: null }));

    anthropicMock.create.mockRejectedValue(new Error("upstream 500"));

    queueDb({
      prLogins: [{ login: "first" }, { login: "second" }],
      employees: [makeEmployee()],
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 2, skipped: 0 });
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { integration: "github" },
        extra: expect.objectContaining({ phase: "llm-employee-matching" }),
      })
    );
    expect(dbMock.insertedRows).toHaveLength(2);
    for (const row of dbMock.insertedRows) {
      expect((row as InsertedRow).matchConfidence).toBe("low");
    }
  });

  it("rethrows SyncCancelledError raised inside the LLM block", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockRejectedValue(new SyncCancelledError("cancelled"));

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    await expect(runGitHubEmployeeMapping()).rejects.toBeInstanceOf(
      SyncCancelledError
    );
  });

  it("rethrows SyncDeadlineExceededError raised inside the LLM block", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    anthropicMock.create.mockRejectedValue(
      new SyncDeadlineExceededError("deadline")
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [makeEmployee()],
    });

    await expect(runGitHubEmployeeMapping()).rejects.toBeInstanceOf(
      SyncDeadlineExceededError
    );
  });

  it("does not call LLM when employee directory is empty", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "weird-handle", name: "Cryptic Person", email: null })
    );

    queueDb({
      prLogins: [{ login: "weird-handle" }],
      employees: [], // no directory
    });

    const result = await runGitHubEmployeeMapping();

    expect(result).toEqual({ mapped: 0, bots: 0, unmatched: 1, skipped: 0 });
    expect(anthropicMock.create).not.toHaveBeenCalled();
    const row = dbMock.insertedRows[0] as InsertedRow;
    expect(row.matchConfidence).toBe("low");
    expect(row.matchMethod).toBe("auto");
  });
});

describe("runGitHubEmployeeMapping — cancellation between logins", () => {
  it("throws SyncCancelledError when shouldStop signals between logins", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "alicew", name: "Alice Walker", email: null })
    );

    queueDb({
      prLogins: [{ login: "alicew" }, { login: "secondlogin" }],
      employees: [makeEmployee()],
    });

    let calls = 0;
    const opts = {
      shouldStop: () => {
        calls++;
        return calls > 1;
      },
    };

    await expect(runGitHubEmployeeMapping(opts)).rejects.toBeInstanceOf(
      SyncCancelledError
    );
    // First login was processed before cancellation triggered
    expect(githubMock.getUserProfileOrNull).toHaveBeenCalledTimes(1);
  });

  it("throws SyncDeadlineExceededError when stopReason returns deadline_exceeded", async () => {
    githubMock.getUserProfileOrNull.mockResolvedValue(
      makeProfile({ login: "alicew", name: "Alice Walker", email: null })
    );

    queueDb({
      prLogins: [{ login: "alicew" }],
      employees: [makeEmployee()],
    });

    const opts = {
      stopReason: () => "deadline_exceeded" as const,
    };

    await expect(runGitHubEmployeeMapping(opts)).rejects.toBeInstanceOf(
      SyncDeadlineExceededError
    );
    // Deadline check fires before any login is processed
    expect(githubMock.getUserProfileOrNull).not.toHaveBeenCalled();
  });
});
