import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  slackMock,
  slackFilesMock,
  excelMock,
  sentryMock,
  phaseTrackerMock,
  dbMock,
} = vi.hoisted(() => ({
  slackMock: {
    checkSlackHealth: vi.fn(),
    getChannelHistory: vi.fn(),
  },
  slackFilesMock: {
    listChannelFiles: vi.fn(),
    downloadSlackFile: vi.fn(),
  },
  excelMock: {
    extractPeriodFromFilename: vi.fn(),
    parseManagementAccounts: vi.fn(),
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
  },
}));

vi.mock("@/lib/integrations/slack", () => ({
  checkSlackHealth: slackMock.checkSlackHealth,
  getChannelHistory: slackMock.getChannelHistory,
}));

vi.mock("@/lib/integrations/slack-files", () => ({
  listChannelFiles: slackFilesMock.listChannelFiles,
  downloadSlackFile: slackFilesMock.downloadSlackFile,
}));

vi.mock("@/lib/integrations/excel-parser", () => ({
  extractPeriodFromFilename: excelMock.extractPeriodFromFilename,
  parseManagementAccounts: excelMock.parseManagementAccounts,
}));

vi.mock("@sentry/nextjs", () => sentryMock);

vi.mock("@/lib/db/schema", () => ({
  financialPeriods: {
    period: "period",
    slackFileId: "slackFileId",
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

  // Mirror slack.test.ts: drizzle query builders are thenables and must call
  // `resolve(value)` rather than returning a Promise (which is ignored).
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
          limit: vi.fn(thenable),
          then: thenable,
        })),
        then: thenable,
      };
    }),
  }));

  return {
    db: { select, insert },
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

import { runManagementAccountsSync } from "../management-accounts";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
} from "../errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN = { id: 99 };
const MGMT_CHANNEL = "C036J68MTJ5";

interface SlackFileLike {
  id: string;
  name: string;
  filetype: string;
  size?: number;
  url_private_download: string;
  permalink?: string;
  timestamp: number;
  user?: string;
  channels?: string[];
}

function makeFile(overrides: Partial<SlackFileLike> = {}): SlackFileLike {
  return {
    id: "F_FEB",
    name: "0226 - Cleo AI Management Accounts.xlsx",
    filetype: "xlsx",
    size: 12345,
    url_private_download: "https://files.slack.com/F_FEB/download",
    permalink: "https://slack.com/files/F_FEB",
    timestamp: 1740787200, // ~2025-02-28 (epoch seconds)
    user: "U_AUTHOR",
    channels: [MGMT_CHANNEL],
    ...overrides,
  };
}

function makeFinancialData(overrides: Record<string, unknown> = {}) {
  return {
    period: "2026-02",
    periodLabel: "February 2026",
    revenue: 1500000,
    grossProfit: 900000,
    grossMargin: 0.6,
    contributionProfit: 600000,
    contributionMargin: 0.4,
    ebitda: 200000,
    ebitdaMargin: 0.13,
    netIncome: 150000,
    cashPosition: 5000000,
    cashBurn: 100000,
    opex: 750000,
    headcountCost: 500000,
    marketingCost: 200000,
    rawSheets: { "P&L": [["Revenue", 1500000]] },
    ...overrides,
  };
}

function setupDefaultMocks() {
  for (const fn of Object.values(slackMock)) fn.mockReset();
  for (const fn of Object.values(slackFilesMock)) fn.mockReset();
  for (const fn of Object.values(excelMock)) fn.mockReset();

  slackMock.checkSlackHealth.mockResolvedValue(undefined);
  slackMock.getChannelHistory.mockResolvedValue([]);

  slackFilesMock.listChannelFiles.mockResolvedValue([makeFile()]);
  slackFilesMock.downloadSlackFile.mockResolvedValue(Buffer.from("xlsx-bytes"));

  excelMock.extractPeriodFromFilename.mockReturnValue("2026-02");
  excelMock.parseManagementAccounts.mockResolvedValue(makeFinancialData());

  phaseTrackerMock.startPhase.mockResolvedValue(1);
  phaseTrackerMock.endPhase.mockResolvedValue(undefined);

  // Default: no existing financialPeriods row for the file.
  dbMock.selectQueue = [[]];
  dbMock.selectIndex = 0;
  dbMock.insertedRows = [];
  dbMock.conflictSets = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runManagementAccountsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    // Nothing to restore — the runner does not depend on env vars.
  });

  // -----------------------------------------------------------------------
  // Golden path
  // -----------------------------------------------------------------------

  it("golden path: list → filter → download → parse → upsert", async () => {
    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(slackMock.checkSlackHealth).toHaveBeenCalledOnce();
    expect(slackFilesMock.listChannelFiles).toHaveBeenCalledWith(
      MGMT_CHANNEL,
      { types: "all", count: 20 },
      expect.any(Object)
    );
    expect(slackFilesMock.downloadSlackFile).toHaveBeenCalledOnce();
    expect(excelMock.parseManagementAccounts).toHaveBeenCalledOnce();

    expect(dbMock.insertedRows).toHaveLength(1);
    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.period).toBe("2026-02");
    expect(row.periodLabel).toBe("February 2026");
    expect(row.slackFileId).toBe("F_FEB");
    expect(row.filename).toBe("0226 - Cleo AI Management Accounts.xlsx");
    expect(row.revenue).toBe("1500000");
    expect(row.cashPosition).toBe("5000000");
    expect(row.rawData).toEqual({ "P&L": [["Revenue", 1500000]] });

    // onConflictDoUpdate should mirror the insert payload's mutable fields
    // and stamp a fresh syncedAt.
    const conflictSet = dbMock.conflictSets[0] as Record<string, unknown>;
    expect(conflictSet.slackFileId).toBe("F_FEB");
    expect(conflictSet.revenue).toBe("1500000");
    expect(conflictSet.syncedAt).toBeInstanceOf(Date);
    // Period is the conflict target — never written into the SET clause.
    expect(conflictSet).not.toHaveProperty("period");
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  it("returns error and skips processing when Slack health check fails", async () => {
    slackMock.checkSlackHealth.mockRejectedValue(new Error("Slack down"));

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors[0]).toContain("Slack API unreachable");

    expect(slackFilesMock.listChannelFiles).not.toHaveBeenCalled();
    expect(slackFilesMock.downloadSlackFile).not.toHaveBeenCalled();
    expect(excelMock.parseManagementAccounts).not.toHaveBeenCalled();
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "Slack API unreachable, skipping sync",
      expect.objectContaining({ level: "warning" })
    );
  });

  // -----------------------------------------------------------------------
  // Filtering
  // -----------------------------------------------------------------------

  it("filters out non-xlsx files and unrelated names", async () => {
    slackFilesMock.listChannelFiles.mockResolvedValue([
      // wrong filetype
      makeFile({
        id: "F_PDF",
        name: "Management Accounts Feb.pdf",
        filetype: "pdf",
      }),
      // wrong name
      makeFile({
        id: "F_OTHER",
        name: "Investor deck.xlsx",
        filetype: "xlsx",
      }),
      // matches name + xlsx → kept
      makeFile({
        id: "F_KEEP",
        name: "0226 - Cleo AI Management Accounts.xlsx",
        filetype: "xlsx",
      }),
    ]);

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(1);
    expect(slackFilesMock.downloadSlackFile).toHaveBeenCalledOnce();
    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.slackFileId).toBe("F_KEEP");
  });

  it("returns success with 0 records when no files match the filter", async () => {
    slackFilesMock.listChannelFiles.mockResolvedValue([
      makeFile({ id: "F_PDF", name: "Some file.pdf", filetype: "pdf" }),
    ]);

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(slackFilesMock.downloadSlackFile).not.toHaveBeenCalled();
  });

  it("returns success with 0 records when listChannelFiles returns empty", async () => {
    slackFilesMock.listChannelFiles.mockResolvedValue([]);

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(slackFilesMock.downloadSlackFile).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Duplicate detection
  // -----------------------------------------------------------------------

  it("skips files already synced by slackFileId", async () => {
    dbMock.selectQueue = [[{ id: 7, slackFileId: "F_FEB" }]];

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(slackFilesMock.downloadSlackFile).not.toHaveBeenCalled();
    expect(excelMock.parseManagementAccounts).not.toHaveBeenCalled();
    expect(dbMock.insertedRows).toHaveLength(0);

    // Phase tracker should have closed the per-file phase as skipped.
    const skippedCalls = phaseTrackerMock.endPhase.mock.calls.filter(
      ([, opts]) =>
        (opts as { status?: string } | undefined)?.status === "skipped"
    );
    expect(skippedCalls.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Period extraction
  // -----------------------------------------------------------------------

  it("falls back to extractPeriodFromFilename when LLM omits period", async () => {
    excelMock.parseManagementAccounts.mockResolvedValue(
      makeFinancialData({ period: "", periodLabel: "" })
    );
    excelMock.extractPeriodFromFilename.mockReturnValue("2026-02");

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(1);
    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.period).toBe("2026-02");
    // periodLabel should be derived from the resolved period when the LLM
    // returns an empty string.
    expect(typeof row.periodLabel).toBe("string");
    expect(row.periodLabel).toMatch(/2026/);
  });

  it("skips file when neither LLM nor filename provide a period", async () => {
    excelMock.parseManagementAccounts.mockResolvedValue(
      makeFinancialData({ period: "" })
    );
    excelMock.extractPeriodFromFilename.mockReturnValue(null);

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors[0]).toContain("Could not determine period");
    expect(dbMock.insertedRows).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // LLM envelope failures
  // -----------------------------------------------------------------------

  it("skips file when LLM returns null (validation failure)", async () => {
    excelMock.parseManagementAccounts.mockResolvedValue(null);

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors[0]).toContain("LLM extraction returned invalid data");
    expect(dbMock.insertedRows).toHaveLength(0);
  });

  it("emits a Sentry warning and skips when all numeric fields are null", async () => {
    excelMock.parseManagementAccounts.mockResolvedValue(
      makeFinancialData({
        revenue: null,
        grossProfit: null,
        grossMargin: null,
        contributionProfit: null,
        contributionMargin: null,
        ebitda: null,
        ebitdaMargin: null,
        netIncome: null,
        cashPosition: null,
        cashBurn: null,
        opex: null,
        headcountCost: null,
        marketingCost: null,
      })
    );

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(dbMock.insertedRows).toHaveLength(0);
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("all extracted numeric fields were null"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ failure_scope: "validation" }),
      })
    );
  });

  it("emits a Sentry warning and skips when revenue and gross profit are null", async () => {
    excelMock.parseManagementAccounts.mockResolvedValue(
      makeFinancialData({ revenue: null, grossProfit: null })
    );

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(dbMock.insertedRows).toHaveLength(0);
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("revenue and gross profit were null"),
      expect.objectContaining({ level: "warning" })
    );
  });

  // -----------------------------------------------------------------------
  // Slack message context lookup
  // -----------------------------------------------------------------------

  it("attaches slackSummary from a nearby long channel message", async () => {
    const file = makeFile({ timestamp: 1740787200 });
    slackFilesMock.listChannelFiles.mockResolvedValue([file]);
    const longText = "Management commentary follows. " + "x".repeat(150);
    slackMock.getChannelHistory.mockResolvedValue([
      { ts: "1740787210.000100", text: longText },
    ]);

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("success");
    expect(slackMock.getChannelHistory).toHaveBeenCalledWith(
      MGMT_CHANNEL,
      String(file.timestamp - 3600),
      String(file.timestamp + 7200),
      expect.any(Object)
    );
    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.slackSummary).toBe(longText);
  });

  it("leaves slackSummary null when no nearby long message is present", async () => {
    slackMock.getChannelHistory.mockResolvedValue([
      { ts: "1740787210.000100", text: "too short" },
    ]);

    await runManagementAccountsSync(RUN);

    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.slackSummary).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Partial batch
  // -----------------------------------------------------------------------

  it("continues processing later files when one file fails", async () => {
    slackFilesMock.listChannelFiles.mockResolvedValue([
      makeFile({ id: "F_FAIL", name: "0126 - Cleo AI Management Accounts.xlsx" }),
      makeFile({ id: "F_OK", name: "0226 - Cleo AI Management Accounts.xlsx" }),
    ]);

    // No existing rows for either file.
    dbMock.selectQueue = [[], []];

    excelMock.parseManagementAccounts
      .mockRejectedValueOnce(new Error("LLM blew up"))
      .mockResolvedValueOnce(makeFinancialData({ period: "2026-02" }));

    excelMock.extractPeriodFromFilename
      .mockReturnValueOnce("2026-01")
      .mockReturnValueOnce("2026-02");

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("partial");
    expect(result.recordsSynced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to sync");
    expect(result.errors[0]).toContain("LLM blew up");

    expect(dbMock.insertedRows).toHaveLength(1);
    const row = dbMock.insertedRows[0] as Record<string, unknown>;
    expect(row.slackFileId).toBe("F_OK");
  });

  // -----------------------------------------------------------------------
  // Cancellation / deadline propagation
  // -----------------------------------------------------------------------

  it("returns cancelled when a SyncCancelledError is thrown during a file", async () => {
    excelMock.parseManagementAccounts.mockRejectedValue(
      new SyncCancelledError("Cancelled mid-file")
    );

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("cancelled");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors[result.errors.length - 1]).toContain("Cancelled mid-file");
    expect(dbMock.insertedRows).toHaveLength(0);
  });

  it("propagates cancellation between files via throwIfSyncShouldStop", async () => {
    slackFilesMock.listChannelFiles.mockResolvedValue([
      makeFile({ id: "F_A", name: "0126 - Cleo AI Management Accounts.xlsx" }),
      makeFile({ id: "F_B", name: "0226 - Cleo AI Management Accounts.xlsx" }),
    ]);
    // No existing rows.
    dbMock.selectQueue = [[], []];

    let cancelAfterFirst = false;
    excelMock.parseManagementAccounts.mockImplementationOnce(async () => {
      cancelAfterFirst = true;
      return makeFinancialData({ period: "2026-01" });
    });

    const result = await runManagementAccountsSync(RUN, {
      shouldStop: () => cancelAfterFirst,
      stopReason: () => (cancelAfterFirst ? "cancelled" : undefined),
    });

    expect(result.status).toBe("cancelled");
    expect(result.recordsSynced).toBe(1);
    // Second file never reached parse.
    expect(excelMock.parseManagementAccounts).toHaveBeenCalledTimes(1);
  });

  it("returns partial when SyncDeadlineExceededError is thrown after a successful file", async () => {
    slackFilesMock.listChannelFiles.mockResolvedValue([
      makeFile({ id: "F_A", name: "0126 - Cleo AI Management Accounts.xlsx" }),
      makeFile({ id: "F_B", name: "0226 - Cleo AI Management Accounts.xlsx" }),
    ]);
    dbMock.selectQueue = [[], []];

    excelMock.parseManagementAccounts
      .mockResolvedValueOnce(makeFinancialData({ period: "2026-01" }))
      .mockRejectedValueOnce(
        new SyncDeadlineExceededError("Budget exceeded mid-file")
      );

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("partial");
    expect(result.recordsSynced).toBe(1);
    expect(result.errors[result.errors.length - 1]).toContain(
      "Budget exceeded"
    );
  });

  it("returns error when deadline is exceeded before any file completes", async () => {
    excelMock.parseManagementAccounts.mockRejectedValue(
      new SyncDeadlineExceededError("No time at all")
    );

    const result = await runManagementAccountsSync(RUN);

    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors[result.errors.length - 1]).toContain("No time at all");
  });

  // -----------------------------------------------------------------------
  // Unexpected top-level error
  // -----------------------------------------------------------------------

  it("captures and rethrows unexpected non-sync errors", async () => {
    slackFilesMock.listChannelFiles.mockRejectedValue(
      new Error("Slack list endpoint exploded")
    );

    await expect(runManagementAccountsSync(RUN)).rejects.toThrow(
      "Slack list endpoint exploded"
    );
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          sync_source: "management-accounts",
          failure_scope: "run",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // Phase tracker lifecycle
  // -----------------------------------------------------------------------

  it("opens and closes the expected sync phases for a golden-path run", async () => {
    await runManagementAccountsSync(RUN);

    const startedPhases = phaseTrackerMock.startPhase.mock.calls.map(
      ([phase]) => phase as string
    );

    expect(startedPhases).toContain("health_check");
    expect(startedPhases).toContain("list_files");
    expect(startedPhases).toContain("filter_files");
    expect(
      startedPhases.some((p) => p.startsWith("sync_file:"))
    ).toBe(true);

    // Every started phase must be matched by a corresponding endPhase call.
    expect(phaseTrackerMock.endPhase).toHaveBeenCalledTimes(
      phaseTrackerMock.startPhase.mock.calls.length
    );
  });
});
