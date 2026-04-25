import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks so factories can see them
// ---------------------------------------------------------------------------

const {
  granolaMock,
  slackIntegrationMock,
  phaseTrackerMock,
  createPhaseTrackerMock,
  coordinatorMock,
  dbState,
  insertSpy,
  updateSpy,
} = vi.hoisted(() => {
  return {
    granolaMock: {
      getAllNotesSince: vi.fn(),
      getNote: vi.fn(),
    },
    slackIntegrationMock: {
      getChannelHistory: vi.fn(),
      getUserName: vi.fn(),
    },
    phaseTrackerMock: {
      startPhase: vi.fn(),
      endPhase: vi.fn(),
    },
    createPhaseTrackerMock: vi.fn(),
    coordinatorMock: {
      determineSyncStatus: vi.fn(),
      formatSyncError: vi.fn(),
    },
    dbState: {
      selectQueue: [] as unknown[][],
      selectIndex: 0,
    },
    // Captures rows passed to db.insert(...).values(...) and the set
    // payload passed to .onConflictDoUpdate({ set }) so tests can assert
    // the shape persisted to the DB.
    insertSpy: {
      table: vi.fn(),
      values: vi.fn(),
      setOnConflict: vi.fn(),
    },
    // Captures payloads passed to db.update(...).set(...) and the where
    // clause so ownership-backfill behavior can be verified.
    updateSpy: {
      set: vi.fn(),
      where: vi.fn(),
    },
  };
});

vi.mock("@/lib/integrations/granola", () => ({
  getAllNotesSince: granolaMock.getAllNotesSince,
  getNote: granolaMock.getNote,
}));

vi.mock("@/lib/integrations/slack", () => ({
  getChannelHistory: slackIntegrationMock.getChannelHistory,
  getUserName: slackIntegrationMock.getUserName,
}));

vi.mock("@/lib/db/schema", () => ({
  userIntegrations: {
    clerkUserId: "clerkUserId",
    apiKey: "apiKey",
    provider: "provider",
  },
  meetingNotes: {
    granolaMeetingId: "granolaMeetingId",
    syncedAt: "syncedAt",
    syncedByUserId: "syncedByUserId",
  },
  preReads: {
    slackTs: "slackTs",
    channelId: "channelId",
  },
  syncLog: {
    source: "source",
    status: "status",
    completedAt: "completedAt",
  },
  syncPhases: { id: "id", syncLogId: "syncLogId" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  desc: (col: unknown) => ({ desc: col }),
  sql: vi.fn(() => ({ sql: true })),
}));

vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => {
      const thenable = () => {
        const v = dbState.selectQueue[dbState.selectIndex++] ?? [];
        return Promise.resolve(v);
      };
      return {
        where: vi.fn(() => {
          const maybeValue = dbState.selectQueue[dbState.selectIndex++] ?? [];
          return {
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve(maybeValue).then(resolve),
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(maybeValue)),
            })),
          };
        }),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => thenable()),
        })),
      };
    }),
  }));
  return {
    db: {
      select,
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: unknown) => {
          insertSpy.table(table);
          insertSpy.values(row);
          return {
            onConflictDoUpdate: vi.fn((args: { set?: unknown } = {}) => {
              insertSpy.setOnConflict(args.set);
              return Promise.resolve();
            }),
            returning: vi.fn(() => Promise.resolve([{ id: 999 }])),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((payload: unknown) => {
          updateSpy.set(payload);
          return {
            where: vi.fn((clause: unknown) => {
              return Promise.resolve(updateSpy.where(clause));
            }),
          };
        }),
      })),
    },
  };
});

vi.mock("../phase-tracker", () => ({
  createPhaseTracker: createPhaseTrackerMock,
}));

vi.mock("../coordinator", () => ({
  determineSyncStatus: coordinatorMock.determineSyncStatus,
  formatSyncError: coordinatorMock.formatSyncError,
}));

// ---------------------------------------------------------------------------
// Imports under test — AFTER mocks register
// ---------------------------------------------------------------------------

import {
  runMeetingsSync,
  syncAllGranolaNotes,
  syncGranolaNotes,
} from "../meetings";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  type SyncControl,
} from "../errors";
import type { PhaseTracker } from "../phase-tracker";


function mkTracker(): PhaseTracker {
  return phaseTrackerMock as unknown as PhaseTracker;
}

function queueSelectResults(...results: unknown[][]) {
  dbState.selectQueue = results;
  dbState.selectIndex = 0;
}

function resetAllMocks() {
  granolaMock.getAllNotesSince.mockReset();
  granolaMock.getNote.mockReset();
  slackIntegrationMock.getChannelHistory.mockReset();
  slackIntegrationMock.getChannelHistory.mockResolvedValue([]);
  slackIntegrationMock.getUserName.mockReset();
  slackIntegrationMock.getUserName.mockResolvedValue(null);
  phaseTrackerMock.startPhase.mockReset();
  phaseTrackerMock.endPhase.mockReset();
  phaseTrackerMock.startPhase.mockImplementation(async () => 1);
  phaseTrackerMock.endPhase.mockImplementation(async () => undefined);
  createPhaseTrackerMock.mockReset();
  createPhaseTrackerMock.mockImplementation(() => phaseTrackerMock);
  coordinatorMock.determineSyncStatus.mockReset();
  coordinatorMock.determineSyncStatus.mockImplementation(
    (errors: unknown[], succeeded: number) =>
      errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "error"
  );
  coordinatorMock.formatSyncError.mockReset();
  coordinatorMock.formatSyncError.mockImplementation((e: unknown) =>
    e instanceof Error ? e.message : String(e)
  );
  insertSpy.table.mockReset();
  insertSpy.values.mockReset();
  insertSpy.setOnConflict.mockReset();
  updateSpy.set.mockReset();
  updateSpy.where.mockReset();
  dbState.selectQueue = [];
  dbState.selectIndex = 0;
}

// ---------------------------------------------------------------------------
// M2 / M15 / M16 / M17: Summary sanitization — Granola summary_markdown /
// summary_text must be sanitized before it is persisted to meetingNotes.summary.
// ---------------------------------------------------------------------------

describe("syncAllGranolaNotes summary sanitization", () => {
  beforeEach(() => {
    delete process.env.GRANOLA_API_TOKEN;
    resetAllMocks();
  });


  async function runWithSummary(summaryMarkdown: string | null, summaryText: string | null) {
    const envelope = "grn_real_token";
    queueSelectResults([{ clerkUserId: "user_san__", apiKey: envelope }], []);

    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_san", title: "t", updated_at: "2026-04-01T00:00:00Z" },
    ]);
    granolaMock.getNote.mockResolvedValueOnce({
      id: "note_san",
      title: "t",
      summary_markdown: summaryMarkdown,
      summary_text: summaryText,
      transcript: null,
      attendees: [],
      created_at: "2026-04-01T00:00:00Z",
      calendar_event: null,
    });

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});
    expect(result.errors).toEqual([]);
    expect(insertSpy.values).toHaveBeenCalledTimes(1);
    expect(insertSpy.setOnConflict).toHaveBeenCalledTimes(1);
    const insertedRow = insertSpy.values.mock.calls[0][0] as { summary: string | null };
    const onConflictSet = insertSpy.setOnConflict.mock.calls[0][0] as {
      summary: string | null;
    };
    return { inserted: insertedRow.summary, onConflict: onConflictSet.summary };
  }

  it("strips <script> from Granola summary_markdown before persisting", async () => {
    const malicious =
      "# Summary\n<script>steal()</script>\n- action item one\n- action item two";
    const { inserted, onConflict } = await runWithSummary(malicious, null);

    expect(inserted).not.toContain("<script>");
    expect(inserted).toContain("# Summary");
    expect(inserted).toContain("action item one");
    // Both the initial insert and the onConflict update use the same sanitized value.
    expect(onConflict).toBe(inserted);
  });

  it("strips event handlers, iframes, and javascript: URLs together", async () => {
    const malicious =
      '# Hi\n<iframe src="https://evil.tld"></iframe>\n' +
      '<a href="javascript:alert(1)" onclick="pwn()">click</a>';
    const { inserted } = await runWithSummary(malicious, null);

    expect(inserted).not.toContain("<iframe");
    expect(inserted).not.toContain("onclick");
    expect(inserted).not.toContain("javascript:");
    expect(inserted).toContain("blocked:");
  });

  it("falls back to summary_text when summary_markdown is null and sanitizes it", async () => {
    const { inserted } = await runWithSummary(
      null,
      "<script>alert(1)</script>clean text"
    );
    expect(inserted).toBe("clean text");
  });

  it("passes through benign markdown unchanged", async () => {
    const benign = "# Meeting\n\n- followup: ship it\n[docs](https://example.com)";
    const { inserted } = await runWithSummary(benign, null);
    expect(inserted).toBe(benign);
  });

  it("persists null summary when Granola returns neither markdown nor text", async () => {
    const { inserted } = await runWithSummary(null, null);
    expect(inserted).toBeNull();
  });

  // M15: URL-scheme obfuscation bypass must not reach the DB.
  it("neutralizes browser-normalized obfuscated URLs on both insert and conflict update", async () => {
    const malicious =
      '# Notes\n<a href="java&#x73;cript:alert(1)">click</a>\n' +
      "[more](jav&#x09;ascript:alert(2))";
    const { inserted, onConflict } = await runWithSummary(malicious, null);

    expect(inserted).not.toMatch(/javascript\s*:/i);
    expect(inserted).not.toContain("alert(1)");
    expect(inserted).not.toContain("alert(2)");
    expect(inserted).toContain("blocked:");
    expect(inserted).toContain("# Notes");
    // The on-conflict update path must apply the same sanitization as insert.
    expect(onConflict).toBe(inserted);
  });

  // M16: Named-entity and unquoted-attribute bypasses must not reach the DB.
  it("neutralizes named-entity and unquoted-attribute obfuscations on both insert and conflict update", async () => {
    const malicious =
      "# Notes\n" +
      '<a href="javascript&colon;alert(1)">quoted</a>\n' +
      "<a href=java&#x73;cript:alert(2)>unquoted</a>\n" +
      "[md](javascript&colon;alert(3))";
    const { inserted, onConflict } = await runWithSummary(malicious, null);

    expect(inserted).not.toMatch(/javascript\s*:/i);
    expect(inserted).not.toContain("javascript&colon;");
    expect(inserted).not.toContain("alert(1)");
    expect(inserted).not.toContain("alert(2)");
    expect(inserted).not.toContain("alert(3)");
    expect(inserted).toContain("blocked:");
    expect(inserted).toContain("# Notes");
    expect(onConflict).toBe(inserted);
  });

  // M17: Semicolonless numeric char ref bypasses must not reach the DB.
  it("neutralizes semicolonless numeric char ref obfuscations on both insert and conflict update", async () => {
    const malicious =
      "# Notes\n" +
      '<a href="javascript&#58alert(1)">quoted-decimal</a>\n' +
      '<a href="java&#115cript:alert(2)">quoted-letter</a>\n' +
      "<a href=javascript&#58alert(3)>unquoted</a>\n" +
      '<a href="data&#58text/html,<b>x</b>">datauri</a>\n' +
      "[md](javascript&#58alert(4))";
    const { inserted, onConflict } = await runWithSummary(malicious, null);

    expect(inserted).not.toMatch(/javascript\s*:/i);
    expect(inserted).not.toContain("javascript&#58");
    expect(inserted).not.toContain("java&#115cript");
    expect(inserted).not.toContain("data&#58text");
    expect(inserted).not.toContain("data:text/html");
    expect(inserted).not.toContain("alert(1)");
    expect(inserted).not.toContain("alert(2)");
    expect(inserted).not.toContain("alert(3)");
    expect(inserted).not.toContain("alert(4)");
    expect(inserted).toContain("blocked:");
    expect(inserted).toContain("# Notes");
    expect(onConflict).toBe(inserted);
  });
});

// ---------------------------------------------------------------------------
// M6: syncGranolaNotes direct unit tests — skip-unchanged, ownership backfill,
// individual fetch failures, partial success, ownership stamping, cancellation.
// ---------------------------------------------------------------------------

describe("syncGranolaNotes (per-token loop)", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("returns 0 + classified error when getAllNotesSince throws", async () => {
    granolaMock.getAllNotesSince.mockRejectedValueOnce(new Error("granola 503"));

    const result = await syncGranolaNotes(new Date(0), { token: "tok" });

    expect(result.count).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Failed to fetch Granola notes/);
    expect(result.errors[0]).toContain("granola 503");
    expect(granolaMock.getNote).not.toHaveBeenCalled();
    expect(insertSpy.values).not.toHaveBeenCalled();
  });

  it("skips already-synced notes and only fetches details for new ones", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_existing", title: "old", updated_at: "2026-04-01T00:00:00Z" },
      { id: "note_new", title: "new", updated_at: "2026-04-02T00:00:00Z" },
    ]);

    // Existing-notes lookup returns one row already in DB (not _pending, has owner).
    queueSelectResults([
      {
        granolaMeetingId: "note_existing",
        syncedAt: new Date("2026-04-01T01:00:00Z"),
        syncedByUserId: "user_owner",
      },
    ]);

    granolaMock.getNote.mockResolvedValueOnce({
      id: "note_new",
      title: "new",
      summary_markdown: "body",
      summary_text: null,
      transcript: null,
      attendees: [],
      created_at: "2026-04-02T00:00:00Z",
      calendar_event: null,
    });

    const result = await syncGranolaNotes(new Date(0), { token: "tok" });

    // getNote called only for the new one — existing one is skipped.
    expect(granolaMock.getNote).toHaveBeenCalledTimes(1);
    expect(granolaMock.getNote.mock.calls[0][0]).toBe("note_new");
    expect(insertSpy.values).toHaveBeenCalledTimes(1);
    expect(result.count).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("does NOT backfill ownership when enterprise sync (syncedByUserId=null) and existing row has null owner", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_orphan", title: "o", updated_at: "2026-04-02T00:00:00Z" },
    ]);
    queueSelectResults([
      {
        granolaMeetingId: "note_orphan",
        syncedAt: new Date("2026-04-01T00:00:00Z"),
        syncedByUserId: null,
      },
    ]);

    const result = await syncGranolaNotes(new Date(0), { token: "tok" });

    // Enterprise sync (no syncedByUserId arg) should not overwrite null
    // ownership — that branch only triggers when a personal owner is provided.
    // The note is in existingIds, so getNote is NOT called.
    expect(granolaMock.getNote).not.toHaveBeenCalled();
    expect(updateSpy.set).not.toHaveBeenCalled();
    expect(result.count).toBe(0);
  });

  it("captures an individual getNote failure and continues with later notes", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_bad", title: "b", updated_at: "2026-04-01T00:00:00Z" },
      { id: "note_ok", title: "o", updated_at: "2026-04-02T00:00:00Z" },
    ]);
    queueSelectResults([]);

    granolaMock.getNote
      .mockRejectedValueOnce(new Error("403 forbidden"))
      .mockResolvedValueOnce({
        id: "note_ok",
        title: "o",
        summary_markdown: "s",
        summary_text: null,
        transcript: null,
        attendees: [],
        created_at: "2026-04-02T00:00:00Z",
        calendar_event: null,
      });

    const result = await syncGranolaNotes(new Date(0), { token: "tok" });

    expect(granolaMock.getNote).toHaveBeenCalledTimes(2);
    expect(insertSpy.values).toHaveBeenCalledTimes(1);
    const inserted = insertSpy.values.mock.calls[0][0] as {
      granolaMeetingId: string;
    };
    expect(inserted.granolaMeetingId).toBe("note_ok");
    expect(result.count).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Failed to store Granola note note_bad/);
    expect(result.errors[0]).toContain("403 forbidden");
  });

  it("stamps syncedByUserId on insert and the literal owner on conflict update for personal sync", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_a", title: "a", updated_at: "2026-04-01T00:00:00Z" },
    ]);
    queueSelectResults([]);

    granolaMock.getNote.mockResolvedValueOnce({
      id: "note_a",
      title: "a",
      summary_markdown: "s",
      summary_text: null,
      transcript: [
        { speaker_source: "Speaker 1", text: "hello" },
        { speaker_source: "Speaker 2", text: "world" },
      ],
      attendees: [{ name: "Alice" }],
      created_at: "2026-04-01T00:00:00Z",
      calendar_event: { calendar_event_id: "cal_42" },
    });

    await syncGranolaNotes(new Date(0), {
      token: "tok",
      syncedByUserId: "user_personal",
    });

    expect(insertSpy.values).toHaveBeenCalledTimes(1);
    const row = insertSpy.values.mock.calls[0][0] as Record<string, unknown>;
    expect(row.syncedByUserId).toBe("user_personal");
    expect(row.granolaMeetingId).toBe("note_a");
    expect(row.title).toBe("a");
    expect(row.summary).toBe("s");
    expect(row.transcript).toBe("Speaker 1: hello\nSpeaker 2: world");
    expect(row.calendarEventId).toBe("cal_42");
    expect(row.participants).toEqual([{ name: "Alice" }]);

    expect(insertSpy.setOnConflict).toHaveBeenCalledTimes(1);
    const set = insertSpy.setOnConflict.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Personal sync stamps the literal user id on conflict update.
    expect(set.syncedByUserId).toBe("user_personal");
    expect(set.title).toBe("a");
    expect(set.summary).toBe("s");
  });

  it("uses coalesce SQL on conflict update when enterprise sync (no owner) overwrites existing", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_b", title: "b", updated_at: "2026-04-01T00:00:00Z" },
    ]);
    queueSelectResults([]);

    granolaMock.getNote.mockResolvedValueOnce({
      id: "note_b",
      title: "b",
      summary_markdown: "s",
      summary_text: null,
      transcript: null,
      attendees: [],
      created_at: "2026-04-01T00:00:00Z",
      calendar_event: null,
    });

    await syncGranolaNotes(new Date(0), { token: "tok" });

    expect(insertSpy.values).toHaveBeenCalledTimes(1);
    const row = insertSpy.values.mock.calls[0][0] as Record<string, unknown>;
    expect(row.syncedByUserId).toBeNull();

    const set = insertSpy.setOnConflict.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Enterprise sync MUST NOT overwrite existing personal ownership;
    // coalesce(existing, null) is wrapped in our drizzle sql() mock.
    expect(set.syncedByUserId).toEqual({ sql: true });
  });

  it("propagates SyncCancelledError from throwIfSyncShouldStop between notes", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_a", title: "a", updated_at: "2026-04-01T00:00:00Z" },
      { id: "note_b", title: "b", updated_at: "2026-04-02T00:00:00Z" },
    ]);
    queueSelectResults([]);

    const control: SyncControl = {
      shouldStop: () => true,
    };

    await expect(syncGranolaNotes(new Date(0), { token: "tok", ...control })).rejects.toBeInstanceOf(
      SyncCancelledError
    );
    expect(granolaMock.getNote).not.toHaveBeenCalled();
  });

  it("propagates SyncDeadlineExceededError between notes", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_a", title: "a", updated_at: "2026-04-01T00:00:00Z" },
    ]);
    queueSelectResults([]);

    const control: SyncControl = {
      stopReason: () => "deadline_exceeded",
    };

    await expect(syncGranolaNotes(new Date(0), { token: "tok", ...control })).rejects.toBeInstanceOf(
      SyncDeadlineExceededError
    );
    expect(granolaMock.getNote).not.toHaveBeenCalled();
  });

});

// ---------------------------------------------------------------------------
// M6: syncAllGranolaNotes enterprise-token path. The personal path is already
// covered by the sanitization blocks above.
// ---------------------------------------------------------------------------

describe("syncAllGranolaNotes enterprise-token path", () => {
  beforeEach(() => {
    process.env.GRANOLA_API_TOKEN = "enterprise_grn_token";
    resetAllMocks();
  });

  afterEach(() => {
    delete process.env.GRANOLA_API_TOKEN;
  });

  it("syncs the enterprise token first with syncedByUserId=null and surfaces success", async () => {
    queueSelectResults(
      [], // existing meetingNotes lookup for enterprise notes
      [] // userIntegrations rows (no personal users)
    );

    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_ent", title: "e", updated_at: "2026-04-01T00:00:00Z" },
    ]);
    granolaMock.getNote.mockResolvedValueOnce({
      id: "note_ent",
      title: "e",
      summary_markdown: "s",
      summary_text: null,
      transcript: null,
      attendees: [],
      created_at: "2026-04-01T00:00:00Z",
      calendar_event: null,
    });

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});

    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(1);
    expect(granolaMock.getAllNotesSince.mock.calls[0][1]).toMatchObject({
      token: "enterprise_grn_token",
    });
    expect(insertSpy.values).toHaveBeenCalledTimes(1);
    const row = insertSpy.values.mock.calls[0][0] as Record<string, unknown>;
    expect(row.syncedByUserId).toBeNull();

    expect(result.count).toBe(1);
    expect(result.errors).toEqual([]);

    // Enterprise phase named "sync_granola:enterprise" was opened and closed success.
    expect(phaseTrackerMock.startPhase).toHaveBeenCalledWith(
      "sync_granola:enterprise",
      expect.any(String)
    );
    expect(phaseTrackerMock.endPhase).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "success", itemsProcessed: 1 })
    );
  });

  it("captures enterprise fetch failure as an error phase but still attempts personal users", async () => {
    const personalEnvelope = "personal_token";
    queueSelectResults(
      [{ clerkUserId: "user_personal", apiKey: personalEnvelope }],
      [] // existing notes for personal user (none)
    );

    granolaMock.getAllNotesSince
      .mockRejectedValueOnce(new Error("enterprise 500"))
      .mockResolvedValueOnce([]); // personal user — no notes returned

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});

    // Enterprise call attempted, then personal call attempted.
    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(2);
    expect(granolaMock.getAllNotesSince.mock.calls[0][1]).toMatchObject({
      token: "enterprise_grn_token",
    });
    expect(granolaMock.getAllNotesSince.mock.calls[1][1]).toMatchObject({
      token: "personal_token",
    });

    // Error array contains enterprise failure but personal sync still ran.
    expect(result.errors.some((e: string) => e.includes("enterprise 500"))).toBe(true);
  });

  it("stops between enterprise and personal users when control flag flips", async () => {
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);
    queueSelectResults([
      { clerkUserId: "user_a", apiKey: "tok" },
    ]);

    let calls = 0;
    const control: SyncControl = {
      shouldStop: () => {
        calls++;
        // Allow enterprise phase to complete (its throwIfSyncShouldStop happens
        // inside syncGranolaNotes' note loop, which has zero notes), then
        // assert true on the between-users check.
        return calls > 0;
      },
    };

    await expect(
      syncAllGranolaNotes(new Date(0), mkTracker(), control)
    ).rejects.toBeInstanceOf(SyncCancelledError);

    // Enterprise call ran. Personal user must NOT have been reached.
    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// M6: runMeetingsSync — top-level orchestration.
// ---------------------------------------------------------------------------

describe("runMeetingsSync orchestration", () => {
  const RUN = { id: 99 };

  beforeEach(() => {
    delete process.env.GRANOLA_API_TOKEN;
    delete process.env.SLACK_PRE_READS_CHANNEL_ID;
    resetAllMocks();
  });

  afterEach(() => {
    delete process.env.SLACK_PRE_READS_CHANNEL_ID;
  });

  it("returns success with zero records when no granola sources and no pre-reads channel", async () => {
    // Queue: fetchLastMeetingsSyncTimestamp → 1 row, userIntegrations → 0 rows
    queueSelectResults([{ completedAt: new Date("2026-04-01T00:00:00Z") }], []);

    const result = await runMeetingsSync(RUN);

    expect(createPhaseTrackerMock).toHaveBeenCalledWith(99);
    // determineSyncStatus called with no errors and 2 succeededSources (granola + pre-reads).
    expect(coordinatorMock.determineSyncStatus).toHaveBeenCalledWith([], 2);
    expect(result.status).toBe("success");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("uses last sync completedAt as the since-date for granola", async () => {
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    const lastCompleted = new Date("2026-04-15T10:00:00Z");
    queueSelectResults(
      [{ completedAt: lastCompleted }], // fetchLastMeetingsSyncTimestamp
      [], // existing meetingNotes for enterprise notes
      [] // userIntegrations
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);

    await runMeetingsSync(RUN);

    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(1);
    expect(granolaMock.getAllNotesSince.mock.calls[0][0]).toBe(
      lastCompleted.toISOString()
    );
  });

  it("falls back to latest meetingNotes.syncedAt when no prior sync exists", async () => {
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    const latestNoteSyncedAt = new Date("2026-04-10T00:00:00Z");
    queueSelectResults(
      [], // fetchLastMeetingsSyncTimestamp (no prior sync)
      [{ syncedAt: latestNoteSyncedAt }], // latestNote query
      [], // existing meetingNotes for enterprise notes
      [] // userIntegrations
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);

    await runMeetingsSync(RUN);

    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(1);
    expect(granolaMock.getAllNotesSince.mock.calls[0][0]).toBe(
      latestNoteSyncedAt.toISOString()
    );
  });

  it("falls back to 30-day window when no prior sync and no notes in DB", async () => {
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    queueSelectResults(
      [], // no prior sync
      [], // no notes in DB
      [], // existing meetingNotes for enterprise notes
      [] // userIntegrations
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);

    const before = Date.now();
    await runMeetingsSync(RUN);
    const after = Date.now();

    const isoUsed = granolaMock.getAllNotesSince.mock.calls[0][0] as string;
    const usedTs = new Date(isoUsed).getTime();
    const lowerBound = before - 30 * 24 * 60 * 60 * 1000;
    const upperBound = after - 30 * 24 * 60 * 60 * 1000;
    // Within a sane band of ~30 days ago.
    expect(usedTs).toBeGreaterThanOrEqual(lowerBound - 5);
    expect(usedTs).toBeLessThanOrEqual(upperBound + 5);
  });

  it("returns error status when fetching last sync time fails", async () => {
    // First select is fetchLastMeetingsSyncTimestamp's
    // where().orderBy().limit() chain; queue a rejected promise there.
    queueSelectResults(Promise.reject(new Error("db down")) as unknown as unknown[]);

    const result = await runMeetingsSync(RUN);
    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors[0]).toMatch(/Failed to fetch last sync time/);
    expect(result.errors[0]).toContain("db down");
    // Phase tracker should have ended with error status for fetch_last_sync.
    expect(phaseTrackerMock.endPhase).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "error" })
    );
  });

  it("syncs the Slack pre-reads channel when SLACK_PRE_READS_CHANNEL_ID is set", async () => {
    process.env.SLACK_PRE_READS_CHANNEL_ID = "C_PRE_READS";
    queueSelectResults(
      [{ completedAt: new Date("2026-04-15T00:00:00Z") }],
      [] // userIntegrations
    );
    slackIntegrationMock.getChannelHistory.mockResolvedValueOnce([
      {
        ts: "1700000000.000100",
        user: "U_AUTHOR",
        text: "First line title\nBody of pre-read",
        type: "message",
      },
      {
        ts: "1700000010.000200",
        user: "U_AUTHOR2",
        // No subtype, has text — should be inserted
        text: "Another pre-read",
        type: "message",
      },
      {
        // Skipped: has subtype
        ts: "1700000020.000300",
        user: "U_BOT",
        text: "channel_join: ignored",
        type: "message",
        subtype: "channel_join",
      },
      {
        // Skipped: no text
        ts: "1700000030.000400",
        user: "U_AUTHOR3",
        text: "",
        type: "message",
      },
    ]);
    slackIntegrationMock.getUserName.mockImplementation(async (id: string) =>
      id === "U_AUTHOR" ? "Alice" : null
    );

    const result = await runMeetingsSync(RUN);

    expect(slackIntegrationMock.getChannelHistory).toHaveBeenCalledTimes(1);
    expect(slackIntegrationMock.getChannelHistory.mock.calls[0][0]).toBe(
      "C_PRE_READS"
    );
    // Two valid messages → two pre-reads inserts.
    const preReadInserts = insertSpy.values.mock.calls.filter(
      (_call, idx) => insertSpy.table.mock.calls[idx][0]?.slackTs !== undefined
    );
    expect(preReadInserts).toHaveLength(2);

    const first = preReadInserts[0][0] as Record<string, unknown>;
    expect(first.slackTs).toBe("1700000000.000100");
    expect(first.channelId).toBe("C_PRE_READS");
    expect(first.title).toBe("First line title");
    expect(first.userName).toBe("Alice");

    expect(result.recordsSynced).toBe(2);
    expect(result.status).toBe("success");
  });

  it("captures pre-reads fetch failure on the phase and returns partial when granola succeeded", async () => {
    process.env.SLACK_PRE_READS_CHANNEL_ID = "C_PRE_READS";
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    queueSelectResults(
      [{ completedAt: new Date("2026-04-15T00:00:00Z") }],
      [], // existing meetingNotes for enterprise sync
      [] // userIntegrations
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);
    slackIntegrationMock.getChannelHistory.mockRejectedValueOnce(
      new Error("slack 503")
    );

    const result = await runMeetingsSync(RUN);

    // Errors contain pre-reads failure
    expect(result.errors.some((e) => e.includes("slack 503"))).toBe(true);
    // Granola still counted as a succeeded source → status is "partial".
    expect(result.status).toBe("partial");
  });

  it("returns cancelled status and propagates the cancel message before Granola starts", async () => {
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    queueSelectResults([{ completedAt: new Date("2026-04-15T00:00:00Z") }]);

    const result = await runMeetingsSync(RUN, {
      shouldStop: () => true,
    });

    expect(result.status).toBe("cancelled");
    expect(result.errors).toContain("Meetings sync cancelled before Granola sync");
    expect(granolaMock.getAllNotesSince).not.toHaveBeenCalled();
    // Pre-reads sync should not run after cancellation propagates.
    expect(slackIntegrationMock.getChannelHistory).not.toHaveBeenCalled();
  });

  it("returns partial status when granola exceeds deadline but had records", async () => {
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    queueSelectResults(
      [{ completedAt: new Date("2026-04-15T00:00:00Z") }],
      [] // existing meetingNotes for enterprise
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_a", title: "a", updated_at: "2026-04-16T00:00:00Z" },
    ]);
    granolaMock.getNote.mockImplementationOnce(async () => {
      // Insert succeeded for note_a; deadline trips before next phase.
      return {
        id: "note_a",
        title: "a",
        summary_markdown: "s",
        summary_text: null,
        transcript: null,
        attendees: [],
        created_at: "2026-04-16T00:00:00Z",
        calendar_event: null,
      };
    });

    let stopReasonCalls = 0;
    const control: SyncControl = {
      stopReason: () => {
        stopReasonCalls++;
        // Trigger deadline AFTER granola finished the first note.
        return stopReasonCalls > 2 ? "deadline_exceeded" : undefined;
      },
    };

    const result = await runMeetingsSync(RUN, control);

    expect(result.status).toBe("partial");
    expect(result.recordsSynced).toBe(1);
    expect(result.errors.some((e) => /budget/.test(e))).toBe(true);
  });

  it("returns error status when deadline exceeds before any records were synced", async () => {
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    queueSelectResults(
      [{ completedAt: new Date("2026-04-15T00:00:00Z") }],
      [] // no notes processed
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);

    const control: SyncControl = {
      stopReason: () => "deadline_exceeded",
    };

    const result = await runMeetingsSync(RUN, control);

    expect(result.status).toBe("error");
    expect(result.recordsSynced).toBe(0);
    expect(result.errors.some((e) => /budget/.test(e))).toBe(true);
  });

  it("captures unexpected pre-reads errors as ordinary sync errors", async () => {
    process.env.GRANOLA_API_TOKEN = "ent_tok";
    queueSelectResults(
      [{ completedAt: new Date("2026-04-15T00:00:00Z") }],
      [] // existing meetingNotes for enterprise
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);

    // Force pre-reads sync to throw a non-sync error to trigger the outer
    // try/catch path in runMeetingsSync (which re-throws non-sync errors).
    process.env.SLACK_PRE_READS_CHANNEL_ID = "C_PRE_READS";

    // Mock a non-sync error inside the pre-reads phase that is not a
    // SyncCancelledError or SyncDeadlineExceededError. The runner catches
    // these errors per-phase and pushes the message to allErrors rather
    // than rethrowing — so this test asserts that pre-reads error becomes
    // a partial/error status, not a thrown exception.
    slackIntegrationMock.getChannelHistory.mockRejectedValueOnce(
      new Error("unexpected")
    );

    // Should not throw — runMeetingsSync catches non-sync errors per phase.
    const result = await runMeetingsSync(RUN);
    expect(result.errors.some((e) => e.includes("unexpected"))).toBe(true);
  });
});
