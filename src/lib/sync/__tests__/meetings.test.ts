import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted mocks so factories can see them
// ---------------------------------------------------------------------------

const { granolaMock, phaseTrackerMock, dbState, insertSpy } = vi.hoisted(() => {
  return {
    granolaMock: {
      getAllNotesSince: vi.fn(),
      getNote: vi.fn(),
    },
    phaseTrackerMock: {
      startPhase: vi.fn(),
      endPhase: vi.fn(),
    },
    dbState: {
      selectQueue: [] as unknown[][],
      selectIndex: 0,
    },
    // Captures rows passed to db.insert(...).values(...) and the set
    // payload passed to .onConflictDoUpdate({ set }) so tests can assert
    // the shape persisted to the DB (e.g. sanitized summary).
    insertSpy: {
      values: vi.fn(),
      setOnConflict: vi.fn(),
    },
  };
});

vi.mock("@/lib/integrations/granola", () => ({
  getAllNotesSince: granolaMock.getAllNotesSince,
  getNote: granolaMock.getNote,
}));

vi.mock("@/lib/integrations/slack", () => ({
  getChannelHistory: vi.fn(async () => []),
  getUserName: vi.fn(async () => null),
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
      insert: vi.fn(() => ({
        values: vi.fn((row: unknown) => {
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
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports under test — AFTER mocks register
// ---------------------------------------------------------------------------

import { syncAllGranolaNotes } from "../meetings";
import { encryptUserIntegrationToken } from "@/lib/security/user-integration-tokens.server";
import type { PhaseTracker } from "../phase-tracker";

const VALID_KEY = randomBytes(32).toString("base64");

function mkTracker(): PhaseTracker {
  return phaseTrackerMock as unknown as PhaseTracker;
}

function queueSelectResults(...results: unknown[][]) {
  dbState.selectQueue = results;
  dbState.selectIndex = 0;
}

// ---------------------------------------------------------------------------

describe("syncAllGranolaNotes personal-token handling", () => {
  beforeEach(() => {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = VALID_KEY;
    delete process.env.GRANOLA_API_TOKEN;
    granolaMock.getAllNotesSince.mockReset();
    granolaMock.getNote.mockReset();
    phaseTrackerMock.startPhase.mockReset();
    phaseTrackerMock.endPhase.mockReset();
    phaseTrackerMock.startPhase.mockImplementation(async () => 1);
    phaseTrackerMock.endPhase.mockImplementation(async () => undefined);
    insertSpy.values.mockReset();
    insertSpy.setOnConflict.mockReset();
    dbState.selectQueue = [];
    dbState.selectIndex = 0;
  });

  afterEach(() => {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  });

  it("decrypts a v1 envelope and drives Granola sync for that user", async () => {
    const envelope = encryptUserIntegrationToken("grn_real_token");

    // 1st select: userIntegrations rows
    // 2nd select: existing meetingNotes rows for the returned Granola notes
    queueSelectResults([{ clerkUserId: "user_good", apiKey: envelope }], []);

    granolaMock.getAllNotesSince.mockResolvedValueOnce([
      { id: "note_1", title: "t", updated_at: "2026-04-01T00:00:00Z" },
    ]);
    granolaMock.getNote.mockResolvedValueOnce({
      id: "note_1",
      title: "t",
      summary_markdown: "s",
      summary_text: null,
      transcript: null,
      attendees: [],
      created_at: "2026-04-01T00:00:00Z",
      calendar_event: null,
    });

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});

    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(1);
    // The decrypted plaintext — NOT the envelope — is handed to Granola.
    expect(granolaMock.getAllNotesSince.mock.calls[0][1]).toMatchObject({
      token: "grn_real_token",
    });
    expect(result.count).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("skips a user whose row is plaintext (no v1 envelope) without calling Granola", async () => {
    queueSelectResults([{ clerkUserId: "user_plaintext", apiKey: "grn_raw_plaintext" }]);

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});

    expect(granolaMock.getAllNotesSince).not.toHaveBeenCalled();
    expect(result.count).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/token envelope failed decryption/);
    expect(result.errors[0]).toContain("intext"); // last 6 of "user_plaintext"

    // The phase for that user should be ended with status: "error".
    expect(phaseTrackerMock.endPhase).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "error" })
    );
  });

  it("skips a user whose envelope was tampered with and still syncs later users", async () => {
    const good = encryptUserIntegrationToken("grn_real_token");
    const [prefix, iv, ct, tag] = good.split(":");
    const buf = Buffer.from(ct, "base64");
    buf[0] = buf[0] ^ 0x01;
    const tampered = [prefix, iv, buf.toString("base64"), tag].join(":");

    queueSelectResults(
      [
        { clerkUserId: "user_tampered", apiKey: tampered },
        { clerkUserId: "user_valid___", apiKey: good },
      ],
      [] // existing meetingNotes for the good user's notes
    );

    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});

    // Granola should only be called for the good user.
    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(1);
    expect(granolaMock.getAllNotesSince.mock.calls[0][1]).toMatchObject({
      token: "grn_real_token",
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("mpered"); // last 6 of "user_tampered"
    expect(result.errors[0]).toMatch(/token envelope failed decryption/);
  });

  it("classifies a missing-key failure without crashing the whole loop", async () => {
    // Intentionally erase the key to trigger UserIntegrationTokenKeyError
    // when decryptUserIntegrationToken calls getKey().
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;

    const envelopeShape =
      "v1:" +
      Buffer.alloc(12).toString("base64") +
      ":" +
      Buffer.alloc(16).toString("base64") +
      ":" +
      Buffer.alloc(16).toString("base64");

    queueSelectResults([{ clerkUserId: "user_nokey__", apiKey: envelopeShape }]);

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});

    expect(granolaMock.getAllNotesSince).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(
      /encryption key misconfigured|token envelope failed decryption/
    );
  });

  it("skips malformed-envelope rows and keeps syncing later users", async () => {
    const good = encryptUserIntegrationToken("grn_real");
    const malformed = "v1:only-one-part"; // fails isEncryptedToken → classified skip

    queueSelectResults(
      [
        { clerkUserId: "user_broken_", apiKey: malformed },
        { clerkUserId: "user_good___", apiKey: good },
      ],
      []
    );
    granolaMock.getAllNotesSince.mockResolvedValueOnce([]);

    const result = await syncAllGranolaNotes(new Date(0), mkTracker(), {});

    expect(granolaMock.getAllNotesSince).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("roken_"); // last 6 of "user_broken_"
  });
});

// ---------------------------------------------------------------------------
// M2: Summary sanitization — Granola summary_markdown / summary_text must be
// sanitized before it is persisted to meetingNotes.summary.
// ---------------------------------------------------------------------------

describe("syncAllGranolaNotes summary sanitization", () => {
  beforeEach(() => {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = VALID_KEY;
    delete process.env.GRANOLA_API_TOKEN;
    granolaMock.getAllNotesSince.mockReset();
    granolaMock.getNote.mockReset();
    phaseTrackerMock.startPhase.mockReset();
    phaseTrackerMock.endPhase.mockReset();
    phaseTrackerMock.startPhase.mockImplementation(async () => 1);
    phaseTrackerMock.endPhase.mockImplementation(async () => undefined);
    insertSpy.values.mockReset();
    insertSpy.setOnConflict.mockReset();
    dbState.selectQueue = [];
    dbState.selectIndex = 0;
  });

  afterEach(() => {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  });

  async function runWithSummary(summaryMarkdown: string | null, summaryText: string | null) {
    const envelope = encryptUserIntegrationToken("grn_real_token");
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
});
