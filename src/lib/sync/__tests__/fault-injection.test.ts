import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSlackChannelIds = process.env.SLACK_OKR_CHANNEL_IDS;

const mocks = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const insertQueue: unknown[] = [];
  const deleteQueue: unknown[] = [];
  const committedTransactionOperations: Array<{
    type: "insert" | "delete";
    table: unknown;
    values?: unknown;
    where?: unknown;
  }> = [];

  const getNext = (queue: unknown[], fallback: unknown) => {
    const value = queue.length > 0 ? queue.shift() : fallback;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };

  const createWhereChain = () => {
    let consumed = false;
    const consume = () => {
      if (consumed) {
        return Promise.resolve([]);
      }

      consumed = true;
      return getNext(selectQueue, []);
    };

    const limit = vi.fn(() => getNext(selectQueue, []));
    const orderBy = vi.fn(() => ({ limit }));

    return {
      limit,
      orderBy,
      then: (onFulfilled?: ((value: unknown) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
        consume().then(onFulfilled, onRejected),
      catch: (onRejected?: ((reason: unknown) => unknown) | null) => consume().catch(onRejected),
      finally: (onFinally?: () => void) => consume().finally(onFinally),
    };
  };

  const createInsertChain = (onSuccess?: () => void) => {
    let consumed = false;
    const consume = () => {
      if (consumed) {
        return Promise.resolve(undefined);
      }

      consumed = true;
      return getNext(insertQueue, undefined).then((value) => {
        onSuccess?.();
        return value;
      });
    };

    return {
      onConflictDoUpdate: vi.fn(() =>
        getNext(insertQueue, undefined).then((value) => {
          onSuccess?.();
          return value;
        })
      ),
      returning: vi.fn(() =>
        getNext(insertQueue, []).then((value) => {
          onSuccess?.();
          return value;
        })
      ),
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        consume().then(onFulfilled, onRejected),
      catch: (onRejected?: (reason: unknown) => unknown) => consume().catch(onRejected),
      finally: (onFinally?: () => void) => consume().finally(onFinally),
    };
  };

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => createWhereChain()),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => createInsertChain()),
  }));
  const del = vi.fn(() => ({
    where: vi.fn(() => getNext(deleteQueue, undefined)),
  }));
  const transaction = vi.fn(async (callback: (tx: {
    insert: typeof insert;
    delete: typeof del;
  }) => unknown) => {
    const pendingOperations: typeof committedTransactionOperations = [];
    const txInsert = vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) =>
        createInsertChain(() => {
          pendingOperations.push({ type: "insert", table, values });
        })
      ),
    }));
    const txDelete = vi.fn((table: unknown) => ({
      where: vi.fn((where: unknown) =>
        getNext(deleteQueue, undefined).then((value) => {
          pendingOperations.push({ type: "delete", table, where });
          return value;
        })
      ),
    }));

    const result = await callback({
      insert: txInsert as typeof insert,
      delete: txDelete as typeof del,
    });
    committedTransactionOperations.push(...pendingOperations);
    return result;
  });

  return {
    getCommittedTransactionOperations: () => [...committedTransactionOperations],
    queueSelect: (...values: unknown[]) => selectQueue.push(...values),
    queueInsert: (...values: unknown[]) => insertQueue.push(...values),
    queueDelete: (...values: unknown[]) => deleteQueue.push(...values),
    resetQueues: () => {
      selectQueue.length = 0;
      insertQueue.length = 0;
      deleteQueue.length = 0;
      committedTransactionOperations.length = 0;
    },
    buildSquadContext: vi.fn(),
    buildSystemPromptFromContext: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    createPhaseTracker: vi.fn(),
    del,
    debugLog: vi.fn(),
    downloadSlackFile: vi.fn(),
    extractPeriodFromFilename: vi.fn(),
    getChannelHistory: vi.fn(),
    getChannelName: vi.fn(),
    getLatestRun: vi.fn(),
    getModeQuerySyncProfile: vi.fn(),
    getQueryResultContent: vi.fn(),
    getQueryRuns: vi.fn(),
    getReportQueries: vi.fn(),
    getThreadReplies: vi.fn(),
    getUserName: vi.fn(),
    insert,
    listChannelFiles: vi.fn(),
    llmParseOkrUpdate: vi.fn(),
    parseManagementAccounts: vi.fn(),
    prepareModeRowsForStorage: vi.fn(),
    seedSquads: vi.fn(),
    setTag: vi.fn(),
    select,
    transaction,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    delete: mocks.del,
    insert: mocks.insert,
    select: mocks.select,
    transaction: mocks.transaction,
  },
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: mocks.addBreadcrumb,
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
  setTag: mocks.setTag,
}));

vi.mock("@/lib/debug-logger", () => ({
  debugLog: mocks.debugLog,
}));

vi.mock("@/lib/data/seed-squads", () => ({
  seedSquads: mocks.seedSquads,
}));

vi.mock("@/lib/integrations/llm-okr-parser", () => ({
  buildSquadContext: mocks.buildSquadContext,
  buildSystemPromptFromContext: mocks.buildSystemPromptFromContext,
  llmParseOkrUpdate: mocks.llmParseOkrUpdate,
}));

vi.mock("@/lib/integrations/slack", () => ({
  getChannelHistory: mocks.getChannelHistory,
  getChannelName: mocks.getChannelName,
  getThreadReplies: mocks.getThreadReplies,
  getUserName: mocks.getUserName,
}));

vi.mock("@/lib/integrations/slack-files", () => ({
  downloadSlackFile: mocks.downloadSlackFile,
  listChannelFiles: mocks.listChannelFiles,
}));

vi.mock("@/lib/integrations/excel-parser", () => ({
  extractPeriodFromFilename: mocks.extractPeriodFromFilename,
  parseManagementAccounts: vi.fn((...args) => mocks.parseManagementAccounts(...args)),
}));

vi.mock("@/lib/integrations/mode-config", () => {
  const MODE_SYNC_PROFILES = [
    {
      reportToken: "report-alpha",
      name: "Alpha Report",
      section: "product",
      syncEnabled: true,
      queries: [{ name: "Timeout Query", storageWindow: { kind: "all" } }],
    },
    {
      reportToken: "report-beta",
      name: "Beta Report",
      section: "product",
      syncEnabled: true,
      queries: [{ name: "Healthy Query", storageWindow: { kind: "all" } }],
    },
  ];

  return {
    MODE_SYNC_PROFILES,
    getModeSyncProfile: vi.fn((reportToken: string) =>
      MODE_SYNC_PROFILES.find((profile) => profile.reportToken === reportToken)
    ),
  };
});

vi.mock("@/lib/integrations/mode", () => ({
  extractQueryToken: vi.fn((queryRun: { queryToken?: string; token?: string }) =>
    queryRun.queryToken ?? queryRun.token ?? "unknown-query"
  ),
  getLatestRun: mocks.getLatestRun,
  getQueryResultContent: mocks.getQueryResultContent,
  getQueryRuns: mocks.getQueryRuns,
  getReportQueries: mocks.getReportQueries,
}));

vi.mock("../phase-tracker", () => ({
  createPhaseTracker: mocks.createPhaseTracker,
}));

vi.mock("../coordinator", () => ({
  determineSyncStatus: (errors: readonly unknown[], succeededCount: number) =>
    errors.length === 0 ? "success" : succeededCount > 0 ? "partial" : "error",
  formatSyncError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

vi.mock("../mode-storage", () => ({
  getModeQuerySyncProfile: mocks.getModeQuerySyncProfile,
  prepareModeRowsForStorage: mocks.prepareModeRowsForStorage,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (value: unknown) => value,
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  inArray: (left: unknown, right: unknown[]) => ({ inArray: [left, right] }),
  isNotNull: (value: unknown) => ({ isNotNull: value }),
  notInArray: (left: unknown, right: unknown[]) => ({ notInArray: [left, right] }),
}));

import { runManagementAccountsSync } from "../management-accounts";
import { runModeSync } from "../mode";
import { runSlackSync } from "../slack";

function makeLongSlackText(label: string): string {
  return `${label} ${"Objective update ".repeat(20)}`;
}

describe("sync runner fault injection", () => {
  beforeEach(() => {
    mocks.resetQueues();
    vi.clearAllMocks();

    mocks.createPhaseTracker.mockReturnValue({
      startPhase: vi.fn(async () => 1),
      endPhase: vi.fn(async () => {}),
    });

    mocks.seedSquads.mockResolvedValue(0);
    mocks.buildSquadContext.mockResolvedValue("Growth: Squad Alpha");
    mocks.buildSystemPromptFromContext.mockReturnValue("system prompt");
    mocks.getThreadReplies.mockResolvedValue([]);
    mocks.getUserName.mockResolvedValue("Alice PM");
    mocks.extractPeriodFromFilename.mockReturnValue("2026-03");
    mocks.prepareModeRowsForStorage.mockImplementation((rows: Record<string, unknown>[]) => ({
      rows,
      sourceRowCount: rows.length,
      storedRowCount: rows.length,
      truncated: false,
      storageWindow: { kind: "all" },
    }));
    mocks.getModeQuerySyncProfile.mockImplementation((_: string, queryName: string) => ({
      name: queryName,
      storageWindow: { kind: "all" },
    }));

    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.SLACK_OKR_CHANNEL_IDS = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSlackChannelIds === undefined) {
      delete process.env.SLACK_OKR_CHANNEL_IDS;
    } else {
      process.env.SLACK_OKR_CHANNEL_IDS = originalSlackChannelIds;
    }
  });

  it("returns a structured error when management accounts persistence hits a DB outage", async () => {
    mocks.listChannelFiles.mockResolvedValue([
      {
        id: "file-1",
        name: "Management Accounts March 2026.xlsx",
        filetype: "xlsx",
        timestamp: 1_712_512_345,
        url_private_download: "https://slack.test/file-1",
      },
    ]);
    mocks.downloadSlackFile.mockResolvedValue(Buffer.from("xlsx"));
    mocks.parseManagementAccounts.mockResolvedValue({
      period: "2026-03",
      periodLabel: "March 2026",
      revenue: 12.3,
      rawSheets: { Summary: [] },
    });
    mocks.getChannelHistory.mockResolvedValue([
      { ts: "1712512345.0001", text: "Summary".repeat(30) },
    ]);
    mocks.queueSelect([]);
    mocks.queueInsert(new Error("db offline"));

    await expect(runManagementAccountsSync({ id: 41 })).resolves.toEqual({
      status: "error",
      recordsSynced: 0,
      errors: [
        "Failed to sync Management Accounts March 2026.xlsx: db offline",
      ],
    });
  });

  it("skips management accounts upsert when revenue and gross profit are both missing", async () => {
    const endPhase = vi.fn(async () => {});
    mocks.createPhaseTracker.mockReturnValue({
      startPhase: vi.fn(async () => 1),
      endPhase,
    });

    mocks.listChannelFiles.mockResolvedValue([
      {
        id: "file-2",
        name: "Management Accounts April 2026.xlsx",
        filetype: "xlsx",
        timestamp: 1_712_612_345,
        url_private_download: "https://slack.test/file-2",
      },
    ]);
    mocks.downloadSlackFile.mockResolvedValue(Buffer.from("xlsx"));
    mocks.parseManagementAccounts.mockResolvedValue({
      period: "2026-04",
      periodLabel: "April 2026",
      revenue: null,
      grossProfit: null,
      ebitda: 4.2,
      rawSheets: { Summary: [] },
    });
    mocks.getChannelHistory.mockResolvedValue([
      { ts: "1712612345.0001", text: "Summary".repeat(30) },
    ]);
    mocks.queueSelect([]);

    await expect(runManagementAccountsSync({ id: 43 })).resolves.toEqual({
      status: "success",
      recordsSynced: 0,
      errors: [],
    });

    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "Skipped write because both revenue and gross profit were null",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          sync_source: "management-accounts",
          failure_scope: "validation",
        }),
      }),
    );

    type EndPhaseCall = [number, { status?: string; detail?: string }];
    const filePhaseCall = (endPhase.mock.calls as unknown as EndPhaseCall[]).find(
      ([, opts]) => opts?.detail?.includes("Skipped write because both revenue and gross profit were null"),
    );
    expect(filePhaseCall?.[1].status).toBe("partial");
  });

  it("collects a Slack 429 channel failure and still completes other channels", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "C429,COK";
    mocks.queueSelect([], []);
    mocks.getChannelName
      .mockResolvedValueOnce("growth-rate-limited")
      .mockResolvedValueOnce("growth-healthy");
    mocks.getChannelHistory
      .mockRejectedValueOnce(new Error("Slack API error 429: rate_limited"))
      .mockResolvedValueOnce([]);

    await expect(runSlackSync({ id: 42 })).resolves.toEqual({
      status: "partial",
      recordsSynced: 0,
      errors: [
        "Failed to sync channel C429: Slack API error 429: rate_limited",
      ],
    });
  });

  it("returns a structured Slack sync error when seeding squads hits a DB outage", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CPREFLIGHT";
    mocks.seedSquads.mockRejectedValue(new Error("db unavailable"));

    await expect(runSlackSync({ id: 45 })).resolves.toEqual({
      status: "error",
      recordsSynced: 0,
      errors: ["Failed to seed squads: db unavailable"],
    });
    expect(mocks.getChannelName).not.toHaveBeenCalled();
  });

  it("returns a structured Slack sync error when loading the user fallback map fails", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CFALLBACK";
    mocks.queueSelect(new Error("db unavailable"));

    await expect(runSlackSync({ id: 46 })).resolves.toEqual({
      status: "error",
      recordsSynced: 0,
      errors: ["Failed to load user name fallback map: db unavailable"],
    });
    expect(mocks.getChannelName).not.toHaveBeenCalled();
  });

  it("returns a structured Slack sync error when fetching the last sync timestamp fails", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CLASTSYNC";
    mocks.queueSelect([], new Error("sync log unavailable"));

    await expect(runSlackSync({ id: 47 })).resolves.toEqual({
      status: "error",
      recordsSynced: 0,
      errors: ["Failed to fetch last successful sync time: sync log unavailable"],
    });
    expect(mocks.getChannelName).not.toHaveBeenCalled();
  });

  it("returns a structured Slack sync error when the OKR parser throws on malformed JSON", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CJSON";
    mocks.queueSelect([], []);
    mocks.getChannelName.mockResolvedValue("growth-alpha");
    mocks.getChannelHistory.mockResolvedValue([
      {
        ts: "1712512345.0001",
        text: "Objective update ".repeat(20),
        user: "U123",
      },
    ]);
    mocks.llmParseOkrUpdate.mockRejectedValue(
      new Error("Failed to parse LLM response: unexpected token")
    );

    await expect(runSlackSync({ id: 43 })).resolves.toEqual({
      status: "error",
      recordsSynced: 0,
      errors: [
        "Failed to sync channel CJSON: Failed to parse LLM response: unexpected token",
      ],
    });
  });

  it("fetches Slack thread replies with bounded concurrency and preserves parent-reply ordering", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CBATCH";
    mocks.queueSelect([], []);
    mocks.getChannelName.mockResolvedValue("growth-alpha");

    const topLevelMessages = [
      {
        ts: "1712512345.0001",
        text: makeLongSlackText("parent-1"),
        user: "U1",
        reply_count: 1,
      },
      {
        ts: "1712512345.0002",
        text: makeLongSlackText("parent-2"),
        user: "U2",
        reply_count: 1,
      },
      {
        ts: "1712512345.0003",
        text: makeLongSlackText("parent-3"),
        user: "U3",
      },
      {
        ts: "1712512345.0004",
        text: makeLongSlackText("parent-4"),
        user: "U4",
        reply_count: 1,
      },
      {
        ts: "1712512345.0005",
        text: makeLongSlackText("parent-5"),
        user: "U5",
        reply_count: 1,
      },
      {
        ts: "1712512345.0006",
        text: makeLongSlackText("parent-6"),
        user: "U6",
        reply_count: 1,
      },
      {
        ts: "1712512345.0007",
        text: makeLongSlackText("parent-7"),
        user: "U7",
        reply_count: 1,
      },
    ];

    let activeReplyFetches = 0;
    let maxConcurrentReplyFetches = 0;
    mocks.getChannelHistory.mockResolvedValue(topLevelMessages);
    mocks.getThreadReplies.mockImplementation(async (_channelId, threadTs: string) => {
      activeReplyFetches += 1;
      maxConcurrentReplyFetches = Math.max(
        maxConcurrentReplyFetches,
        activeReplyFetches
      );

      const suffix = Number(threadTs.split(".")[1] ?? "0");
      await new Promise((resolve) => setTimeout(resolve, (suffix % 3) * 10));

      activeReplyFetches -= 1;
      return [
        {
          ts: `${threadTs}-reply`,
          text: makeLongSlackText(`reply-for-${threadTs}`),
          user: `U-${threadTs}`,
          thread_ts: threadTs,
        },
      ];
    });

    const parsedMessages: string[] = [];
    mocks.llmParseOkrUpdate.mockImplementation(async (text: string) => {
      parsedMessages.push(text);
      return null;
    });

    await expect(runSlackSync({ id: 48 })).resolves.toEqual({
      status: "success",
      recordsSynced: 0,
      errors: [],
    });

    expect(maxConcurrentReplyFetches).toBe(5);
    expect(parsedMessages).toEqual([
      makeLongSlackText("parent-1"),
      makeLongSlackText("reply-for-1712512345.0001"),
      makeLongSlackText("parent-2"),
      makeLongSlackText("reply-for-1712512345.0002"),
      makeLongSlackText("parent-3"),
      makeLongSlackText("parent-4"),
      makeLongSlackText("reply-for-1712512345.0004"),
      makeLongSlackText("parent-5"),
      makeLongSlackText("reply-for-1712512345.0005"),
      makeLongSlackText("parent-6"),
      makeLongSlackText("reply-for-1712512345.0006"),
      makeLongSlackText("parent-7"),
      makeLongSlackText("reply-for-1712512345.0007"),
    ]);
  });

  it("surfaces a failed thread reply fetch as a channel sync error", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CTHREAD";
    mocks.queueSelect([], []);
    mocks.getChannelName.mockResolvedValue("growth-alpha");
    mocks.getChannelHistory.mockResolvedValue([
      {
        ts: "1712512345.1001",
        text: makeLongSlackText("parent-1"),
        user: "U1",
        reply_count: 1,
      },
      {
        ts: "1712512345.1002",
        text: makeLongSlackText("parent-2"),
        user: "U2",
        reply_count: 1,
      },
    ]);

    mocks.getThreadReplies.mockImplementation(async (_channelId, threadTs: string) => {
      if (threadTs.endsWith("1002")) {
        throw new Error("reply fetch exploded");
      }

      return [
        {
          ts: `${threadTs}-reply`,
          text: makeLongSlackText(`reply-for-${threadTs}`),
          user: `U-${threadTs}`,
          thread_ts: threadTs,
        },
      ];
    });

    await expect(runSlackSync({ id: 49 })).resolves.toEqual({
      status: "error",
      recordsSynced: 0,
      errors: ["Failed to sync channel CTHREAD: reply fetch exploded"],
    });
    expect(mocks.llmParseOkrUpdate).not.toHaveBeenCalled();
  });

  it("resolves repeated authors from the success path only once per syncChannel run", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CCACHE";
    mocks.queueSelect([], []);
    mocks.getChannelName.mockResolvedValue("growth-cache");

    // Three messages from the same user U123
    mocks.getChannelHistory.mockResolvedValue([
      { ts: "1712512345.0001", text: makeLongSlackText("msg-1"), user: "U123" },
      { ts: "1712512345.0002", text: makeLongSlackText("msg-2"), user: "U123" },
      { ts: "1712512345.0003", text: makeLongSlackText("msg-3"), user: "U123" },
    ]);
    mocks.getUserName.mockResolvedValue("Alice PM");
    mocks.llmParseOkrUpdate.mockResolvedValue(null);

    await runSlackSync({ id: 50 });

    // getUserName should be called at most once for U123 across all three messages
    expect(mocks.getUserName).toHaveBeenCalledTimes(1);
    expect(mocks.getUserName).toHaveBeenCalledWith("U123", expect.anything());
  });

  it("resolves repeated authors from the fallback and raw-id paths only once per syncChannel run", async () => {
    process.env.SLACK_OKR_CHANNEL_IDS = "CCACHEFALLBACK";
    // First select: userNameFallback (squads query) returns U456 -> "Bob PM"
    // Second select: syncLog timestamp query returns []
    mocks.queueSelect([{ pmSlackId: "U456", pmName: "Bob PM" }], []);
    mocks.getChannelName.mockResolvedValue("growth-fallback");

    // Two messages from U456 (fallback path) and two from U789 (raw-id path)
    mocks.getChannelHistory.mockResolvedValue([
      { ts: "1712512345.0001", text: makeLongSlackText("msg-1"), user: "U456" },
      { ts: "1712512345.0002", text: makeLongSlackText("msg-2"), user: "U456" },
      { ts: "1712512345.0003", text: makeLongSlackText("msg-3"), user: "U789" },
      { ts: "1712512345.0004", text: makeLongSlackText("msg-4"), user: "U789" },
    ]);
    // getUserName returns the raw userId (simulates API failure path — no caching at process level)
    mocks.getUserName.mockImplementation(async (userId: string) => userId);
    mocks.llmParseOkrUpdate.mockResolvedValue(null);

    await runSlackSync({ id: 51 });

    // getUserName should be called once per unique userId, not once per message
    expect(mocks.getUserName).toHaveBeenCalledTimes(2);
    expect(mocks.getUserName).toHaveBeenCalledWith("U456", expect.anything());
    expect(mocks.getUserName).toHaveBeenCalledWith("U789", expect.anything());
  });

  it("fetches Mode query results with bounded concurrency", async () => {
    mocks.queueSelect(
      [
        {
          id: 11,
          reportToken: "report-alpha",
          name: "Alpha Report",
          section: "product",
          category: null,
          isActive: true,
        },
      ],
      [],
      [],
      [],
      [],
      [],
    );
    mocks.getLatestRun.mockResolvedValue({ token: "run-alpha" });

    const queryDefinitions = Array.from({ length: 5 }, (_, index) => ({
      token: `query-${index + 1}`,
      name: `Query ${index + 1}`,
    }));
    mocks.getReportQueries.mockResolvedValue(queryDefinitions);
    mocks.getQueryRuns.mockResolvedValue(
      queryDefinitions.map((query, index) => ({
        token: `query-run-${index + 1}`,
        queryToken: query.token,
        state: "succeeded",
        _links: { query: { href: `/queries/${query.token}` } },
      }))
    );

    let activeFetches = 0;
    let maxActiveFetches = 0;
    const releaseFetches: Array<() => void> = [];
    mocks.getQueryResultContent.mockImplementation(async (_reportToken, _runToken, queryRunToken: string) => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);

      await new Promise<void>((resolve) => {
        releaseFetches.push(() => {
          activeFetches -= 1;
          resolve();
        });
      });

      return {
        rows: [{ queryRunToken }],
        responseBytes: 128,
      };
    });

    const runPromise = runModeSync({ id: 71 });

    await vi.waitFor(() => {
      expect(maxActiveFetches).toBe(3);
      expect(mocks.getQueryResultContent).toHaveBeenCalledTimes(3);
    });

    releaseFetches.splice(0).forEach((release) => release());

    await vi.waitFor(() => {
      expect(mocks.getQueryResultContent).toHaveBeenCalledTimes(5);
    });

    releaseFetches.splice(0).forEach((release) => release());

    const result = await runPromise;

    expect(result).toEqual({
      status: "success",
      recordsSynced: 5,
      errors: [],
    });
    expect(maxActiveFetches).toBe(3);
  });

  it("does not commit a Mode report when any query fetch fails", async () => {
    mocks.queueSelect(
      [
        {
          id: 12,
          reportToken: "report-alpha",
          name: "Alpha Report",
          section: "product",
          category: null,
          isActive: true,
        },
      ],
      [],
      [],
    );
    mocks.getLatestRun.mockResolvedValue({ token: "run-alpha" });
    mocks.getReportQueries.mockResolvedValue([
      { token: "query-1", name: "Timeout Query" },
      { token: "query-2", name: "Healthy Query" },
      { token: "query-3", name: "Skipped Query" },
      { token: "query-4", name: "Unconfigured Query" },
    ]);
    mocks.getQueryRuns.mockResolvedValue([
      {
        token: "query-run-1",
        queryToken: "query-1",
        state: "succeeded",
        _links: { query: { href: "/queries/query-1" } },
      },
      {
        token: "query-run-2",
        queryToken: "query-2",
        state: "succeeded",
        _links: { query: { href: "/queries/query-2" } },
      },
      {
        token: "query-run-3",
        queryToken: "query-3",
        state: "running",
        _links: { query: { href: "/queries/query-3" } },
      },
      {
        token: "query-run-4",
        queryToken: "query-4",
        state: "succeeded",
        _links: { query: { href: "/queries/query-4" } },
      },
    ]);
    mocks.getModeQuerySyncProfile.mockImplementation((_: string, queryName: string) => {
      if (queryName === "Unconfigured Query") {
        return null;
      }

      return {
        name: queryName,
        storageWindow: { kind: "all" },
      };
    });
    mocks.getQueryResultContent.mockImplementation(async (_reportToken, _runToken, queryRunToken: string) => {
      if (queryRunToken === "query-run-2") {
        throw new Error("query fetch exploded");
      }

      return {
        rows: [{ queryRunToken }],
        responseBytes: 64,
      };
    });

    const result = await runModeSync({ id: 72 });

    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors).toEqual([
      'Failed to sync query "Healthy Query" in report "Alpha Report": query fetch exploded',
    ]);
    expect(mocks.getQueryResultContent).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.getCommittedTransactionOperations()).toEqual([]);
  });

  it("rolls back prepared Mode query writes when a transactional upsert fails", async () => {
    mocks.queueSelect(
      [
        {
          id: 16,
          reportToken: "report-alpha",
          name: "Alpha Report",
          section: "product",
          category: null,
          isActive: true,
        },
      ],
      [],
      [],
    );
    mocks.queueInsert(undefined, undefined, undefined, new Error("db write exploded"));
    mocks.getLatestRun.mockResolvedValue({ token: "run-alpha" });
    mocks.getReportQueries.mockResolvedValue([
      { token: "query-1", name: "Timeout Query" },
      { token: "query-2", name: "Healthy Query" },
    ]);
    mocks.getQueryRuns.mockResolvedValue([
      {
        token: "run-1",
        queryToken: "query-1",
        state: "succeeded",
        _links: { query: { href: "/queries/query-1" } },
      },
      {
        token: "run-2",
        queryToken: "query-2",
        state: "succeeded",
        _links: { query: { href: "/queries/query-2" } },
      },
    ]);
    mocks.getQueryResultContent.mockResolvedValue({ rows: [{ v: 1 }], responseBytes: 64 });

    await expect(runModeSync({ id: 78 })).resolves.toEqual({
      status: "error",
      recordsSynced: 0,
      errors: [
        'Failed to sync report "Alpha Report" (report-alpha): db write exploded',
      ],
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.getCommittedTransactionOperations()).toEqual([]);
  });

  it("Mode report phase becomes error when any query fails before the transaction starts", async () => {
    const endPhase = vi.fn(async () => {});
    const startPhase = vi.fn(async () => 1);
    mocks.createPhaseTracker.mockReturnValue({ startPhase, endPhase });

    mocks.queueSelect(
      [
        {
          id: 13,
          reportToken: "report-alpha",
          name: "Alpha Report",
          section: "product",
          category: null,
          isActive: true,
        },
      ],
      [],
      [],
    );
    mocks.getLatestRun.mockResolvedValue({ token: "run-alpha" });
    mocks.getReportQueries.mockResolvedValue([
      { token: "query-ok", name: "Timeout Query" },
      { token: "query-bad", name: "Healthy Query" },
    ]);
    mocks.getQueryRuns.mockResolvedValue([
      {
        token: "run-ok",
        queryToken: "query-ok",
        state: "succeeded",
        _links: { query: { href: "/queries/query-ok" } },
      },
      {
        token: "run-bad",
        queryToken: "query-bad",
        state: "succeeded",
        _links: { query: { href: "/queries/query-bad" } },
      },
    ]);
    mocks.getQueryResultContent.mockImplementation(
      async (_r, _run, queryRunToken: string) => {
        if (queryRunToken === "run-bad") throw new Error("timeout");
        return { rows: [{ v: 1 }], responseBytes: 64 };
      }
    );

    const result = await runModeSync({ id: 73 });

    // Run-level: error because the report is not committed unless every query prepares successfully
    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors).toHaveLength(1);

    // Find the endPhase call for the report phase (sync_report:Alpha Report)
    type EndPhaseCall = [number, { status?: string; detail?: string; itemsProcessed?: number; errorMessage?: string }];
    const reportEndPhaseCall = (endPhase.mock.calls as unknown as EndPhaseCall[]).find(
      ([, opts]) => opts?.detail?.includes("queries succeeded")
    );
    expect(reportEndPhaseCall).toBeDefined();
    const phaseOpts = reportEndPhaseCall![1];
    expect(phaseOpts.status).toBe("error");
    expect(phaseOpts.detail).toMatch(/Stored 0 rows/);
    expect(phaseOpts.detail).toMatch(/0 queries succeeded, 1 failed/);
  });

  it("preserves existing Mode rows when a fresh query result is empty", async () => {
    const endPhase = vi.fn(async () => {});
    mocks.createPhaseTracker.mockReturnValue({
      startPhase: vi.fn(async () => 1),
      endPhase,
    });

    mocks.queueSelect(
      [
        {
          id: 15,
          reportToken: "report-alpha",
          name: "Alpha Report",
          section: "product",
          category: null,
          isActive: true,
        },
      ],
      [
        {
          id: 99,
          reportId: 15,
          queryToken: "query-1",
          queryName: "Timeout Query",
          data: [{ v: 1 }],
          columns: [{ name: "v", type: "number" }],
          rowCount: 12,
          sourceRowCount: 12,
          storedRowCount: 12,
          truncated: false,
          storageWindow: { kind: "all" },
          syncedAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      ],
    );
    mocks.getLatestRun.mockResolvedValue({ token: "run-alpha" });
    mocks.getReportQueries.mockResolvedValue([
      { token: "query-1", name: "Timeout Query" },
    ]);
    mocks.getQueryRuns.mockResolvedValue([
      {
        token: "query-run-1",
        queryToken: "query-1",
        state: "succeeded",
        _links: { query: { href: "/queries/query-1" } },
      },
    ]);
    mocks.getQueryResultContent.mockResolvedValue({ rows: [], responseBytes: 32 });

    const result = await runModeSync({ id: 77 });

    expect(result).toEqual({
      status: "success",
      recordsSynced: 0,
      errors: [],
    });
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("Skipped empty overwrite for query"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          sync_source: "mode",
          failure_scope: "validation",
        }),
      }),
    );

    type EndPhaseCall = [number, { status?: string; detail?: string }];
    const reportPhaseCall = (endPhase.mock.calls as unknown as EndPhaseCall[]).find(
      ([, opts]) => opts?.detail?.includes("1 warning"),
    );
    expect(reportPhaseCall?.[1].status).toBe("partial");
    expect(reportPhaseCall?.[1].detail).toMatch(/Stored 0 rows/);
  });

  it("returns run status error when all queries fail for every Mode report", async () => {
    const endPhase = vi.fn(async () => {});
    const startPhase = vi.fn(async () => 1);
    mocks.createPhaseTracker.mockReturnValue({ startPhase, endPhase });

    // Both reports from config are active in DB
    mocks.queueSelect(
      [
        {
          id: 13,
          reportToken: "report-alpha",
          name: "Alpha Report",
          section: "product",
          category: null,
          isActive: true,
        },
        {
          id: 14,
          reportToken: "report-beta",
          name: "Beta Report",
          section: "product",
          category: null,
          isActive: true,
        },
      ],
      [],
      [],
    );
    mocks.getLatestRun.mockResolvedValue({ token: "run-any" });
    mocks.getReportQueries.mockResolvedValue([
      { token: "query-1", name: "Timeout Query" },
    ]);
    mocks.getQueryRuns.mockResolvedValue([
      {
        token: "run-1",
        queryToken: "query-1",
        state: "succeeded",
        _links: { query: { href: "/queries/query-1" } },
      },
    ]);
    // All query fetches fail
    mocks.getQueryResultContent.mockRejectedValue(new Error("network timeout"));

    const result = await runModeSync({ id: 76 });

    // Run-level status must be "error" — no report contributed a succeeded query
    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors).toHaveLength(2);

    // Each report phase must have been ended with status "error"
    type EndPhaseCall = [number, { status?: string; detail?: string; errorMessage?: string }];
    const reportPhaseErrors = (endPhase.mock.calls as unknown as EndPhaseCall[]).filter(
      ([, opts]) => opts?.status === "error" && opts?.errorMessage
    );
    expect(reportPhaseErrors).toHaveLength(2);
  });

  it("Mode report phase gets success status and detail with all-succeed query counts", async () => {
    const endPhase = vi.fn(async () => {});
    const startPhase = vi.fn(async () => 1);
    mocks.createPhaseTracker.mockReturnValue({ startPhase, endPhase });

    mocks.queueSelect(
      [
        {
          id: 14,
          reportToken: "report-alpha",
          name: "Alpha Report",
          section: "product",
          category: null,
          isActive: true,
        },
      ],
      [],
      [],
    );
    mocks.getLatestRun.mockResolvedValue({ token: "run-alpha" });
    mocks.getReportQueries.mockResolvedValue([
      { token: "query-1", name: "Timeout Query" },
      { token: "query-2", name: "Healthy Query" },
    ]);
    mocks.getQueryRuns.mockResolvedValue([
      {
        token: "run-1",
        queryToken: "query-1",
        state: "succeeded",
        _links: { query: { href: "/queries/query-1" } },
      },
      {
        token: "run-2",
        queryToken: "query-2",
        state: "succeeded",
        _links: { query: { href: "/queries/query-2" } },
      },
    ]);
    mocks.getQueryResultContent.mockResolvedValue({ rows: [{ v: 1 }], responseBytes: 64 });

    const result = await runModeSync({ id: 74 });

    expect(result.status).toBe("success");
    expect(result.errors).toHaveLength(0);

    type EndPhaseCall = [number, { status?: string; detail?: string; itemsProcessed?: number; errorMessage?: string }];
    const reportEndPhaseCall = (endPhase.mock.calls as unknown as EndPhaseCall[]).find(
      ([, opts]) => opts?.detail?.includes("queries succeeded")
    );
    expect(reportEndPhaseCall).toBeDefined();
    const phaseOpts = reportEndPhaseCall![1];
    expect(phaseOpts.status).toBe("success");
    expect(phaseOpts.detail).toMatch(/2 queries succeeded, 0 failed/);
  });

  it("Slack channel phase detail includes channel name and message counts", async () => {
    const endPhase = vi.fn(async () => {});
    const startPhase = vi.fn(async () => 1);
    mocks.createPhaseTracker.mockReturnValue({ startPhase, endPhase });

    process.env.SLACK_OKR_CHANNEL_IDS = "CDETAIL";
    mocks.queueSelect([], []);
    mocks.getChannelName.mockResolvedValue("growth-okrs");
    mocks.getChannelHistory.mockResolvedValue([
      { ts: "1712512345.0001", text: "Short msg", user: "U1" },
      { ts: "1712512345.0002", text: makeLongSlackText("okr update"), user: "U2" },
      { ts: "1712512345.0003", text: makeLongSlackText("llm null"), user: "U3" },
      { ts: "1712512345.0004", text: makeLongSlackText("empty validation"), user: "U4" },
      { ts: "1712512345.0005", text: "Brief", user: "U5" },
    ]);
    mocks.llmParseOkrUpdate
      .mockResolvedValueOnce({
        squadName: "Alpha",
        tldr: "on track",
        krs: [{ objective: "O1", name: "KR1", rag: "green", metric: "100%" }],
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        squadName: "Alpha",
        tldr: "dropped",
        krs: [],
      });

    await runSlackSync({ id: 75 });

    type EndPhaseCall = [number, { status?: string; detail?: string; itemsProcessed?: number }];
    const channelEndPhaseCall = (endPhase.mock.calls as unknown as EndPhaseCall[]).find(
      ([, opts]) => opts?.detail?.includes("growth-okrs")
    );
    expect(channelEndPhaseCall).toBeDefined();
    const phaseOpts = channelEndPhaseCall![1];
    expect(phaseOpts.itemsProcessed).toBe(1);
    expect(phaseOpts.detail).toBe(
      "#growth-okrs: Parsed 1 KRs from 3 messages (2 filtered, 1 LLM null, 1 empty after validation)"
    );

    expect(mocks.addBreadcrumb).toHaveBeenCalledWith({
      category: "sync.slack",
      level: "info",
      message: "Completed Slack channel OKR parsing",
      data: {
        channelId: "CDETAIL",
        channelName: "growth-okrs",
        krCount: 1,
        parsedMessageCount: 3,
        skippedByFilterCount: 2,
        llmNullCount: 1,
        emptyAfterValidationCount: 1,
      },
    });
  });
});
