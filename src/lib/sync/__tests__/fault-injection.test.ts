import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSlackChannelIds = process.env.SLACK_OKR_CHANNEL_IDS;

const mocks = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const insertQueue: unknown[] = [];
  const deleteQueue: unknown[] = [];

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

  const createInsertChain = () => {
    let consumed = false;
    const consume = () => {
      if (consumed) {
        return Promise.resolve(undefined);
      }

      consumed = true;
      return getNext(insertQueue, undefined);
    };

    return {
      onConflictDoUpdate: vi.fn(() => getNext(insertQueue, undefined)),
      returning: vi.fn(() => getNext(insertQueue, [])),
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

  return {
    queueSelect: (...values: unknown[]) => selectQueue.push(...values),
    queueInsert: (...values: unknown[]) => insertQueue.push(...values),
    queueDelete: (...values: unknown[]) => deleteQueue.push(...values),
    resetQueues: () => {
      selectQueue.length = 0;
      insertQueue.length = 0;
      deleteQueue.length = 0;
    },
    buildSquadContext: vi.fn(),
    buildSystemPromptFromContext: vi.fn(),
    createPhaseTracker: vi.fn(),
    del,
    downloadSlackFile: vi.fn(),
    extractPeriodFromFilename: vi.fn(),
    getChannelHistory: vi.fn(),
    getChannelName: vi.fn(),
    getLatestRun: vi.fn(),
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
    select,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    delete: mocks.del,
    insert: mocks.insert,
    select: mocks.select,
  },
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
  getModeQuerySyncProfile: vi.fn((_: string, queryName: string) => ({
    name: queryName,
    storageWindow: { kind: "all" },
  })),
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

  // TODO: Mode sync fault injection tests need updating to match
  // the current runModeSync error handling contract after resilience PR merge.
});
