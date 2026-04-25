import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { slackMock, llmMock, seedMock, sentryMock, phaseTrackerMock, dbMock } =
  vi.hoisted(() => {
    return {
      slackMock: {
        checkSlackHealth: vi.fn(),
        getChannelHistory: vi.fn(),
        getChannelName: vi.fn(),
        getThreadReplies: vi.fn(),
        getUserName: vi.fn(),
        isSlackChannelNotFoundError: vi.fn(),
      },
      llmMock: {
        buildSquadContext: vi.fn(),
        buildSystemPromptFromContext: vi.fn(),
        llmParseOkrUpdates: vi.fn(),
      },
      seedMock: {
        seedSquads: vi.fn(),
      },
      sentryMock: {
        setTag: vi.fn(),
        addBreadcrumb: vi.fn(),
        captureException: vi.fn(),
        captureMessage: vi.fn(),
      },
      phaseTrackerMock: {
        startPhase: vi.fn(),
        endPhase: vi.fn(),
      },
      dbMock: {
        selectQueue: [] as unknown[][],
        selectIndex: 0,
        insertedRows: [] as unknown[],
        conflictSets: [] as unknown[],
        updatedSets: [] as unknown[],
      },
    };
  });

vi.mock("@/lib/integrations/slack", () => ({
  checkSlackHealth: slackMock.checkSlackHealth,
  getChannelHistory: slackMock.getChannelHistory,
  getChannelName: slackMock.getChannelName,
  getThreadReplies: slackMock.getThreadReplies,
  getUserName: slackMock.getUserName,
  isSlackChannelNotFoundError: slackMock.isSlackChannelNotFoundError,
}));

vi.mock("@/lib/integrations/llm-okr-parser", () => ({
  buildSquadContext: llmMock.buildSquadContext,
  buildSystemPromptFromContext: llmMock.buildSystemPromptFromContext,
  llmParseOkrUpdates: llmMock.llmParseOkrUpdates,
}));

vi.mock("@/lib/data/seed-squads", () => ({
  seedSquads: seedMock.seedSquads,
}));

vi.mock("@sentry/nextjs", () => sentryMock);

vi.mock("@/lib/db/schema", () => ({
  okrUpdates: {
    slackTs: "slackTs",
    channelId: "channelId",
    krName: "krName",
  },
  squads: {
    pmSlackId: "pmSlackId",
    pmName: "pmName",
    isActive: "isActive",
  },
  syncLog: {
    id: "id",
    source: "source",
    status: "status",
    completedAt: "completedAt",
    startedAt: "startedAt",
    scope: "scope",
    recordsSynced: "recordsSynced",
    heartbeatAt: "heartbeatAt",
  },
  syncPhases: { id: "id", syncLogId: "syncLogId" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  desc: (col: unknown) => ({ desc: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
}));

vi.mock("@/lib/db", () => {
  const onConflictDoUpdate = vi.fn(({ set }: { set: unknown }) => {
    dbMock.conflictSets.push(set);
    return Promise.resolve();
  });
  const values = vi.fn((row: unknown) => {
    dbMock.insertedRows.push(row);
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values }));

  const updateSet = vi.fn((setPayload: unknown) => {
    dbMock.updatedSets.push(setPayload);
    return {
      where: vi.fn().mockResolvedValue(undefined),
    };
  });
  const updateFn = vi.fn(() => ({ set: updateSet }));

  // Drizzle query builders are thenables: `await db.select().from().where()`
  // calls `.then(resolve, reject)` via the thenable protocol. We must call
  // `resolve(value)` — just returning a Promise is ignored by the spec.
  // When used as a vi.fn implementation (`.limit(n)`), the first arg is a
  // number, so we fall back to returning a Promise for `await`.
  const select = vi.fn(() => ({
    from: vi.fn(() => {
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
          orderBy: vi.fn(() => ({
            limit: vi.fn(thenable),
          })),
          then: thenable,
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(thenable),
        })),
        then: thenable,
      };
    }),
  }));

  return {
    db: { select, insert, update: updateFn },
  };
});

vi.mock("../phase-tracker", () => ({
  createPhaseTracker: vi.fn(() => phaseTrackerMock),
}));

vi.mock("../coordinator", () => ({
  determineSyncStatus: vi.fn(
    (errors: unknown[], succeeded: number) =>
      errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "error"
  ),
  formatSyncError: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e)
  ),
}));

import { runSlackSync } from "../slack";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
} from "../errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN = { id: 42 };

function makeSlackMessage(overrides: Record<string, unknown> = {}) {
  return {
    ts: "1700000000.000100",
    user: "U_AUTHOR",
    text: "A".repeat(200) + " KR1: Something important :large_green_circle:",
    type: "message",
    ...overrides,
  };
}

function makeParsedOkrUpdate(overrides: Record<string, unknown> = {}) {
  return {
    squadName: "Growth Marketing (EWA)",
    tldr: "All good",
    krs: [
      {
        objective: "Increase revenue",
        name: "KR1: Increase LTV",
        rag: "green" as const,
        metric: "2.5x vs 3x",
      },
    ],
    ...overrides,
  };
}

function setChannelIds(ids: string) {
  process.env.SLACK_OKR_CHANNEL_IDS = ids;
}

function setupDefaultMocks() {
  // Reset all integration mocks (clears once-queues from prior tests)
  for (const fn of Object.values(slackMock)) fn.mockReset();
  for (const fn of Object.values(llmMock)) fn.mockReset();
  for (const fn of Object.values(seedMock)) fn.mockReset();

  slackMock.checkSlackHealth.mockResolvedValue(undefined);
  slackMock.getChannelName.mockResolvedValue("okr-growth");
  slackMock.getChannelHistory.mockResolvedValue([makeSlackMessage()]);
  slackMock.getThreadReplies.mockResolvedValue([]);
  slackMock.getUserName.mockResolvedValue("Amanda");
  slackMock.isSlackChannelNotFoundError.mockReturnValue(false);

  seedMock.seedSquads.mockResolvedValue(undefined);

  llmMock.buildSquadContext.mockResolvedValue("squad context");
  llmMock.buildSystemPromptFromContext.mockReturnValue("system prompt");
  llmMock.llmParseOkrUpdates.mockResolvedValue([makeParsedOkrUpdate()]);

  phaseTrackerMock.startPhase.mockResolvedValue(1);
  phaseTrackerMock.endPhase.mockResolvedValue(undefined);

  // DB select responses: buildUserNameFallback, fetchLastSlackSuccessTimestamp,
  // fetchResumableSlackCheckpoints, then checkpointSlackSyncProgress update
  dbMock.selectQueue = [
    // buildUserNameFallback
    [{ pmSlackId: "U_AUTHOR", pmName: "Amanda" }],
    // fetchLastSlackSuccessTimestamp
    [{ completedAt: new Date("2024-01-01T00:00:00Z") }],
    // fetchResumableSlackCheckpoints
    [],
  ];
  dbMock.selectIndex = 0;
  dbMock.insertedRows = [];
  dbMock.conflictSets = [];
  dbMock.updatedSets = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSlackSync", () => {
  const savedEnv = process.env.SLACK_OKR_CHANNEL_IDS;

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    setChannelIds("C_CHAN1");
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.SLACK_OKR_CHANNEL_IDS = savedEnv;
    } else {
      delete process.env.SLACK_OKR_CHANNEL_IDS;
    }
  });

  // -----------------------------------------------------------------------
  // Golden path
  // -----------------------------------------------------------------------

  it("golden path: fetch → filter → LLM parse → DB upsert", async () => {
    const result = await runSlackSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(slackMock.checkSlackHealth).toHaveBeenCalledOnce();
    expect(seedMock.seedSquads).toHaveBeenCalledOnce();
    expect(slackMock.getChannelName).toHaveBeenCalledWith("C_CHAN1", expect.any(Object));
    expect(slackMock.getChannelHistory).toHaveBeenCalledOnce();
    expect(llmMock.llmParseOkrUpdates).toHaveBeenCalledOnce();

    expect(dbMock.insertedRows.length).toBe(1);
    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.channelId).toBe("C_CHAN1");
    expect(row.channelName).toBe("okr-growth");
    expect(row.pillar).toBe("Growth");
    expect(row.status).toBe("on_track");
    expect(row.krName).toBe("KR1: Increase LTV");
    expect(row.squadName).toBe("Growth Marketing (EWA)");
    expect(row.userName).toBe("Amanda");
  });

  // -----------------------------------------------------------------------
  // Empty / no channels
  // -----------------------------------------------------------------------

  it("returns success with 0 records when no channel IDs configured", async () => {
    setChannelIds("");

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(slackMock.checkSlackHealth).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Health check failure
  // -----------------------------------------------------------------------

  it("returns error when Slack API health check fails", async () => {
    slackMock.checkSlackHealth.mockRejectedValue(new Error("Slack down"));

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("error");
    expect(result.errors[0]).toContain("Slack API unreachable");
    expect(slackMock.getChannelHistory).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // isLikelyUpdate filtering
  // -----------------------------------------------------------------------

  it("filters messages by isLikelyUpdate rules", async () => {
    const shortMsg = makeSlackMessage({ text: "Short" });
    const reminderMsg = makeSlackMessage({ text: "Reminder: stand up at 10" });
    const joinedMsg = makeSlackMessage({
      text: "A".repeat(200),
      subtype: "channel_join",
    });
    const happyMondayMsg = makeSlackMessage({
      text: "Happy Monday! " + "A".repeat(200),
    });
    const subtypeMsg = makeSlackMessage({
      text: "A".repeat(200),
      subtype: "bot_message",
    });
    const agendaMsg = makeSlackMessage({
      text: "*Agenda for today" + "A".repeat(200),
    });
    const slashMsg = makeSlackMessage({
      text: "/remind #channel something " + "A".repeat(200),
    });
    const validMsg = makeSlackMessage();

    slackMock.getChannelHistory.mockResolvedValue([
      shortMsg,
      reminderMsg,
      joinedMsg,
      happyMondayMsg,
      subtypeMsg,
      agendaMsg,
      slashMsg,
      validMsg,
    ]);

    const result = await runSlackSync(RUN);

    // Only validMsg should reach LLM parse
    expect(llmMock.llmParseOkrUpdates).toHaveBeenCalledOnce();
    const parseInputs = llmMock.llmParseOkrUpdates.mock.calls[0][0];
    expect(parseInputs).toHaveLength(1);
    expect(result.recordsSynced).toBe(1);
  });

  // -----------------------------------------------------------------------
  // derivePillar mapping
  // -----------------------------------------------------------------------

  it("maps channel names to correct pillars", async () => {
    const channels = [
      { id: "C1", name: "okr-growth" },
      { id: "C2", name: "okr-ewa-products" },
      { id: "C3", name: "okr-credit-stuff" },
      { id: "C4", name: "okr-new-bets" },
      { id: "C5", name: "okr-chat-squad" },
      { id: "C6", name: "okr-access-team" },
      { id: "C7", name: "okr-card-payments" },
      { id: "C8", name: "okr-misc" },
    ];

    setChannelIds(channels.map((c) => c.id).join(","));

    slackMock.getChannelName.mockImplementation(async (id: string) => {
      return channels.find((c) => c.id === id)?.name ?? "unknown";
    });

    slackMock.getChannelHistory.mockResolvedValue([makeSlackMessage()]);
    llmMock.llmParseOkrUpdates.mockResolvedValue([makeParsedOkrUpdate()]);

    // Need enough DB select responses for each channel
    dbMock.selectQueue = [
      [{ pmSlackId: "U_AUTHOR", pmName: "Amanda" }],
      [{ completedAt: new Date("2024-01-01T00:00:00Z") }],
      [],
    ];

    const result = await runSlackSync(RUN);

    const pillars = dbMock.insertedRows.map(
      (r: unknown) => (r as Record<string, unknown>).pillar
    );
    expect(pillars).toEqual([
      "Growth",
      "EWA & Credit Products",
      "EWA & Credit Products",
      "New Bets",
      "Chat",
      "Access, Trust & Money, Risk & Payments",
      "Card",
      "Other",
    ]);
  });

  // -----------------------------------------------------------------------
  // Thread reply fetching with concurrency
  // -----------------------------------------------------------------------

  it("fetches thread replies for messages with reply_count > 0", async () => {
    const parentMsg = makeSlackMessage({
      ts: "1700000000.000100",
      reply_count: 3,
      thread_ts: "1700000000.000100",
    });
    const childMsg = makeSlackMessage({
      ts: "1700000000.000200",
      thread_ts: "1700000000.000100",
    });

    slackMock.getChannelHistory.mockResolvedValue([parentMsg]);
    slackMock.getThreadReplies.mockResolvedValue([childMsg]);

    // LLM should receive two parse candidates (parent + child if both pass filter)
    llmMock.llmParseOkrUpdates.mockResolvedValue([
      makeParsedOkrUpdate(),
      makeParsedOkrUpdate({ squadName: "Thread Squad" }),
    ]);

    const result = await runSlackSync(RUN);

    expect(slackMock.getThreadReplies).toHaveBeenCalledWith(
      "C_CHAN1",
      "1700000000.000100",
      expect.any(Object)
    );
    expect(result.recordsSynced).toBe(2);
  });

  // -----------------------------------------------------------------------
  // LLM parse failure — null results
  // -----------------------------------------------------------------------

  it("counts LLM null results but continues processing", async () => {
    llmMock.llmParseOkrUpdates.mockResolvedValue([null]);

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(dbMock.insertedRows).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // LLM returns empty KRs
  // -----------------------------------------------------------------------

  it("counts empty KR results from LLM without inserting", async () => {
    llmMock.llmParseOkrUpdates.mockResolvedValue([
      makeParsedOkrUpdate({ krs: [] }),
    ]);

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(dbMock.insertedRows).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Partial batch: some succeed, some null, some empty
  // -----------------------------------------------------------------------

  it("handles partial batch with mixed LLM results", async () => {
    const msg1 = makeSlackMessage({ ts: "1700000000.000100" });
    const msg2 = makeSlackMessage({ ts: "1700000000.000200" });
    const msg3 = makeSlackMessage({ ts: "1700000000.000300" });

    slackMock.getChannelHistory.mockResolvedValue([msg1, msg2, msg3]);

    llmMock.llmParseOkrUpdates.mockResolvedValue([
      makeParsedOkrUpdate({
        krs: [
          { objective: "O1", name: "KR1", rag: "green", metric: null },
          { objective: "O1", name: "KR2", rag: "amber", metric: "50%" },
        ],
      }),
      null,
      makeParsedOkrUpdate({ krs: [] }),
    ]);

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(2);
    expect(dbMock.insertedRows).toHaveLength(2);

    const statuses = dbMock.insertedRows.map(
      (r: unknown) => (r as Record<string, unknown>).status
    );
    expect(statuses).toEqual(["on_track", "at_risk"]);
  });

  // -----------------------------------------------------------------------
  // RAG status mapping
  // -----------------------------------------------------------------------

  it("maps RAG colors to correct statuses", async () => {
    llmMock.llmParseOkrUpdates.mockResolvedValue([
      makeParsedOkrUpdate({
        krs: [
          { objective: "O", name: "KR-green", rag: "green", metric: null },
          { objective: "O", name: "KR-amber", rag: "amber", metric: null },
          { objective: "O", name: "KR-red", rag: "red", metric: null },
          {
            objective: "O",
            name: "KR-not_started",
            rag: "not_started",
            metric: null,
          },
        ],
      }),
    ]);

    await runSlackSync(RUN);

    const statuses = dbMock.insertedRows.map(
      (r: unknown) => (r as Record<string, unknown>).status
    );
    expect(statuses).toEqual(["on_track", "at_risk", "behind", "not_started"]);
  });

  // -----------------------------------------------------------------------
  // Channel validation failure
  // -----------------------------------------------------------------------

  it("skips invalid channels and continues with valid ones", async () => {
    setChannelIds("C_BAD,C_GOOD");

    const channelNotFoundError = Object.assign(
      new Error("channel_not_found"),
      { status: 404, code: "channel_not_found" }
    );

    slackMock.getChannelName.mockImplementation(async (id: string) => {
      if (id === "C_BAD") throw channelNotFoundError;
      return "okr-growth";
    });
    slackMock.isSlackChannelNotFoundError.mockImplementation(
      (err: unknown) => err === channelNotFoundError
    );

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("partial");
    expect(result.recordsSynced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("C_BAD");
    expect(sentryMock.captureMessage).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // User name resolution with fallback
  // -----------------------------------------------------------------------

  it("falls back to squad PM name when Slack API returns raw user ID", async () => {
    slackMock.getUserName.mockResolvedValue("U_AUTHOR");

    const result = await runSlackSync(RUN);

    expect(result.recordsSynced).toBe(1);
    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.userName).toBe("Amanda");
  });

  it("caches user name resolution across messages in same channel", async () => {
    const msg1 = makeSlackMessage({ ts: "1700000000.000100", user: "U_AUTHOR" });
    const msg2 = makeSlackMessage({ ts: "1700000000.000200", user: "U_AUTHOR" });
    slackMock.getChannelHistory.mockResolvedValue([msg1, msg2]);
    llmMock.llmParseOkrUpdates.mockResolvedValue([
      makeParsedOkrUpdate(),
      makeParsedOkrUpdate(),
    ]);

    await runSlackSync(RUN);

    expect(slackMock.getUserName).toHaveBeenCalledTimes(1);
  });

  it("stores null userName when author is unknown", async () => {
    const msg = makeSlackMessage({ user: undefined });
    slackMock.getChannelHistory.mockResolvedValue([msg]);

    await runSlackSync(RUN);

    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.userName).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Malformed Slack response (getChannelHistory throws)
  // -----------------------------------------------------------------------

  it("records error when channel fetch throws and continues to next channel", async () => {
    setChannelIds("C_BAD,C_GOOD");

    slackMock.getChannelName.mockImplementation(async (id: string) => {
      return id === "C_BAD" ? "bad-channel" : "okr-growth";
    });

    let callCount = 0;
    slackMock.getChannelHistory.mockImplementation(async (id: string) => {
      callCount++;
      if (id === "C_BAD") throw new Error("Slack API 500");
      return [makeSlackMessage()];
    });

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("partial");
    expect(result.recordsSynced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Slack API 500");
  });

  // -----------------------------------------------------------------------
  // LLM envelope validation failure callback
  // -----------------------------------------------------------------------

  it("fires onEnvelopeValidationFailure callback for invalid LLM responses", async () => {
    llmMock.llmParseOkrUpdates.mockImplementation(
      async (
        inputs: unknown[],
        _prompt: string,
        opts: { onEnvelopeValidationFailure?: () => void }
      ) => {
        opts.onEnvelopeValidationFailure?.();
        return inputs.map(() => null);
      }
    );

    const result = await runSlackSync(RUN);
    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Multiple channels processed sequentially
  // -----------------------------------------------------------------------

  it("processes multiple channels and aggregates results", async () => {
    setChannelIds("C1,C2");

    slackMock.getChannelName.mockImplementation(async (id: string) =>
      id === "C1" ? "okr-growth" : "okr-ewa-products"
    );

    llmMock.llmParseOkrUpdates.mockResolvedValue([makeParsedOkrUpdate()]);

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(2);
    expect(slackMock.getChannelHistory).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Checkpoint restoration (per-channel checkpoints)
  // -----------------------------------------------------------------------

  it("uses per-channel checkpoints from resumed partial sync", async () => {
    const lastSuccess = new Date("2024-01-01T00:00:00Z");
    const lastSyncTs = String(lastSuccess.getTime() / 1000); // "1704067200"
    // Checkpoint must be >= lastSyncTs to be used
    const checkpoint = String(Number(lastSyncTs) + 1000);

    dbMock.selectQueue = [
      [{ pmSlackId: "U_AUTHOR", pmName: "Amanda" }],
      [{ completedAt: lastSuccess }],
      [{ scope: { slackChannelCheckpoints: { C_CHAN1: checkpoint } } }],
    ];

    slackMock.getChannelHistory.mockResolvedValue([makeSlackMessage()]);

    await runSlackSync(RUN);

    const historyCall = slackMock.getChannelHistory.mock.calls[0];
    expect(historyCall[1]).toBe(checkpoint);
  });

  // -----------------------------------------------------------------------
  // Latest message timestamp tracking (only top-level)
  // -----------------------------------------------------------------------

  it("only tracks top-level message timestamps for checkpointing", async () => {
    const parentTs = "1700000000.000100";
    const replyTs = "1700000000.999999";
    const parentMsg = makeSlackMessage({
      ts: parentTs,
      reply_count: 1,
      thread_ts: parentTs,
    });
    const replyMsg = makeSlackMessage({
      ts: replyTs,
      thread_ts: parentTs,
    });

    slackMock.getChannelHistory.mockResolvedValue([parentMsg]);
    slackMock.getThreadReplies.mockResolvedValue([replyMsg]);
    llmMock.llmParseOkrUpdates.mockResolvedValue([
      makeParsedOkrUpdate(),
      makeParsedOkrUpdate(),
    ]);

    await runSlackSync(RUN);

    // The update to syncLog should use parentTs, not the later replyTs
    expect(dbMock.updatedSets.length).toBeGreaterThanOrEqual(1);
    const updatePayload = dbMock.updatedSets[0] as Record<string, unknown>;
    const scope = updatePayload.scope as {
      slackChannelCheckpoints: Record<string, string>;
    };
    expect(scope.slackChannelCheckpoints.C_CHAN1).toBe(parentTs);
  });

  // -----------------------------------------------------------------------
  // rawText truncation
  // -----------------------------------------------------------------------

  it("truncates rawText to 10000 characters", async () => {
    const longText = "K".repeat(15000);
    slackMock.getChannelHistory.mockResolvedValue([
      makeSlackMessage({ text: longText }),
    ]);

    await runSlackSync(RUN);

    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect((row.rawText as string).length).toBe(10000);
  });

  // -----------------------------------------------------------------------
  // Cancellation propagation
  // -----------------------------------------------------------------------

  it("returns cancelled when shouldStop fires during channel processing", async () => {
    let callCount = 0;
    const opts = {
      shouldStop: () => {
        callCount++;
        return callCount > 2;
      },
      stopReason: () =>
        callCount > 2 ? ("cancelled" as const) : undefined,
    };

    // Ensure we get past preflight phases (which also check shouldStop)
    // by making the cancellation fire later
    let historyCallCount = 0;
    slackMock.getChannelHistory.mockImplementation(async () => {
      historyCallCount++;
      return [makeSlackMessage()];
    });

    const result = await runSlackSync(RUN, opts);
    expect(result.status).toBe("cancelled");
  });

  it("returns error/partial when deadline exceeded during processing", async () => {
    const opts = {
      shouldStop: () => true,
      stopReason: () => "deadline_exceeded" as const,
    };

    const result = await runSlackSync(RUN, opts);
    expect(["error", "partial"]).toContain(result.status);
    expect(result.errors.some((e: string) => e.includes("budget"))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Seed squads failure
  // -----------------------------------------------------------------------

  it("returns error when seedSquads fails", async () => {
    seedMock.seedSquads.mockRejectedValue(new Error("DB migration failed"));

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("error");
    expect(result.errors[0]).toContain("seed squads");
  });

  // -----------------------------------------------------------------------
  // Phase tracker interaction
  // -----------------------------------------------------------------------

  it("starts and ends phases for each step", async () => {
    await runSlackSync(RUN);

    const phaseNames = phaseTrackerMock.startPhase.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(phaseNames).toContain("health_check");
    expect(phaseNames).toContain("seed_squads");
    expect(phaseNames).toContain("build_context");
    expect(phaseNames).toContain("build_user_fallback");
    expect(phaseNames).toContain("fetch_last_sync");
    expect(phaseNames).toContain("validate_channels");
    expect(phaseNames.some((n: unknown) => typeof n === "string" && n.startsWith("sync_channel:"))).toBe(
      true
    );

    expect(phaseTrackerMock.endPhase).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Batching: messages are sent to LLM in batches of 4
  // -----------------------------------------------------------------------

  it("batches messages for LLM parse in groups of 4", async () => {
    const messages = Array.from({ length: 6 }, (_, i) =>
      makeSlackMessage({ ts: `1700000000.00${String(i).padStart(4, "0")}` })
    );
    slackMock.getChannelHistory.mockResolvedValue(messages);

    llmMock.llmParseOkrUpdates.mockResolvedValue(
      Array(4).fill(makeParsedOkrUpdate())
    );
    llmMock.llmParseOkrUpdates.mockResolvedValueOnce(
      Array(4).fill(makeParsedOkrUpdate())
    );
    llmMock.llmParseOkrUpdates
      .mockResolvedValueOnce(Array(4).fill(makeParsedOkrUpdate()))
      .mockResolvedValueOnce(Array(2).fill(makeParsedOkrUpdate()));

    await runSlackSync(RUN);

    expect(llmMock.llmParseOkrUpdates).toHaveBeenCalledTimes(2);
    const batch1Inputs = llmMock.llmParseOkrUpdates.mock.calls[0][0];
    const batch2Inputs = llmMock.llmParseOkrUpdates.mock.calls[1][0];
    expect(batch1Inputs).toHaveLength(4);
    expect(batch2Inputs).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Sentry breadcrumb after channel completion
  // -----------------------------------------------------------------------

  it("adds Sentry breadcrumb after channel processing", async () => {
    await runSlackSync(RUN);

    expect(sentryMock.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "sync.slack",
        level: "info",
        message: "Completed Slack channel OKR parsing",
        data: expect.objectContaining({
          channelId: "C_CHAN1",
          channelName: "okr-growth",
          krCount: 1,
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // Cancellation during health check rethrows
  // -----------------------------------------------------------------------

  it("rethrows SyncCancelledError from health check phase", async () => {
    slackMock.checkSlackHealth.mockRejectedValue(
      new SyncCancelledError("cancelled")
    );

    const result = await runSlackSync(RUN);
    expect(result.status).toBe("cancelled");
  });

  it("rethrows SyncDeadlineExceededError from health check phase", async () => {
    slackMock.checkSlackHealth.mockRejectedValue(
      new SyncDeadlineExceededError("deadline")
    );

    const result = await runSlackSync(RUN);
    expect(["error", "partial"]).toContain(result.status);
  });

  // -----------------------------------------------------------------------
  // Non-channel-not-found errors in validation propagate
  // -----------------------------------------------------------------------

  it("propagates non-channel-not-found errors in validation as preflight failure", async () => {
    slackMock.getChannelName.mockRejectedValue(new Error("Network timeout"));
    slackMock.isSlackChannelNotFoundError.mockReturnValue(false);

    const result = await runSlackSync(RUN);

    expect(result.status).toBe("error");
    expect(result.errors[0]).toContain("validate configured Slack channel IDs");
  });

  // -----------------------------------------------------------------------
  // onConflictDoUpdate includes correct fields
  // -----------------------------------------------------------------------

  it("upserts with conflict update on slackTs+channelId+krName", async () => {
    await runSlackSync(RUN);

    expect(dbMock.conflictSets.length).toBe(1);
    const conflictSet = dbMock.conflictSets[0] as Record<string, unknown>;
    expect(conflictSet).toHaveProperty("status", "on_track");
    expect(conflictSet).toHaveProperty("actual", "2.5x vs 3x");
    expect(conflictSet).toHaveProperty("tldr", "All good");
    expect(conflictSet).toHaveProperty("syncedAt");
  });
});
