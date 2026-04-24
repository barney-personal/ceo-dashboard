import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// The script imports `db` from "@/lib/db" at module-eval time, so we stub
// that module before importing the script. The real behaviour is exercised
// by passing a fake `db` client into `reencryptUserIntegrationTokens({ db })`.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  userIntegrations: {
    id: "id",
    clerkUserId: "clerkUserId",
    provider: "provider",
    apiKey: "apiKey",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

import {
  reencryptUserIntegrationTokens,
} from "../reencrypt-user-integration-tokens";
import {
  UserIntegrationTokenKeyError,
  isEncryptedToken,
  encryptUserIntegrationToken,
} from "@/lib/security/user-integration-tokens.server";

const VALID_KEY = randomBytes(32).toString("base64");

type FakeRow = {
  id: number;
  clerkUserId: string;
  provider: string;
  apiKey: string;
};

function makeFakeDb(initialRows: FakeRow[]) {
  const rows = initialRows.map((r) => ({ ...r }));
  const updateWheres: Array<{ id: number; apiKey: string }> = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => Promise.resolve(rows)),
    })),
    update: vi.fn(() => ({
      set: vi.fn((setArgs: { apiKey: string }) => ({
        where: vi.fn((whereArgs: { eq?: [unknown, unknown] }) => {
          const id = (whereArgs.eq?.[1] as number) ?? -1;
          const row = rows.find((r) => r.id === id);
          if (row) row.apiKey = setArgs.apiKey;
          updateWheres.push({ id, apiKey: setArgs.apiKey });
          return Promise.resolve();
        }),
      })),
    })),
  };

  return { db, rows, updateWheres };
}

function makeSilentLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe("reencryptUserIntegrationTokens", () => {
  beforeEach(() => {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  });

  it("dry run writes nothing and reports rows that would be re-encrypted", async () => {
    const { db, rows, updateWheres } = makeFakeDb([
      { id: 1, clerkUserId: "user_a", provider: "granola", apiKey: "plain_a" },
      { id: 2, clerkUserId: "user_b", provider: "granola", apiKey: "plain_b" },
    ]);

    const summary = await reencryptUserIntegrationTokens({
      dryRun: true,
      db: db as never,
      logger: makeSilentLogger(),
    });

    expect(summary).toEqual({
      total: 2,
      alreadyEncrypted: 0,
      reencrypted: 0,
      failed: 0,
      dryRun: true,
    });
    expect(updateWheres).toHaveLength(0);
    // Rows untouched by dry run.
    expect(rows.every((r) => !isEncryptedToken(r.apiKey))).toBe(true);
  });

  it("real run re-encrypts plaintext rows in place and leaves no plaintext behind", async () => {
    const { db, rows, updateWheres } = makeFakeDb([
      { id: 1, clerkUserId: "user_a", provider: "granola", apiKey: "plain_a" },
      { id: 2, clerkUserId: "user_b", provider: "granola", apiKey: "plain_b" },
    ]);

    const summary = await reencryptUserIntegrationTokens({
      db: db as never,
      logger: makeSilentLogger(),
    });

    expect(summary.reencrypted).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.dryRun).toBe(false);
    expect(updateWheres.map((u) => u.id).sort()).toEqual([1, 2]);
    expect(rows.every((r) => isEncryptedToken(r.apiKey))).toBe(true);
  });

  it("is idempotent — a second real run reports no rows needing re-encryption", async () => {
    const { db } = makeFakeDb([
      { id: 1, clerkUserId: "user_a", provider: "granola", apiKey: "plain_a" },
    ]);

    await reencryptUserIntegrationTokens({
      db: db as never,
      logger: makeSilentLogger(),
    });
    const second = await reencryptUserIntegrationTokens({
      db: db as never,
      logger: makeSilentLogger(),
    });

    expect(second.reencrypted).toBe(0);
    expect(second.alreadyEncrypted).toBe(1);
    expect(second.failed).toBe(0);
  });

  it("skips already-encrypted rows on the first run", async () => {
    const alreadyEnvelope = encryptUserIntegrationToken("grn_already");
    const { db, updateWheres, rows } = makeFakeDb([
      {
        id: 1,
        clerkUserId: "user_a",
        provider: "granola",
        apiKey: alreadyEnvelope,
      },
      { id: 2, clerkUserId: "user_b", provider: "granola", apiKey: "plain_b" },
    ]);

    const summary = await reencryptUserIntegrationTokens({
      db: db as never,
      logger: makeSilentLogger(),
    });

    expect(summary.alreadyEncrypted).toBe(1);
    expect(summary.reencrypted).toBe(1);
    expect(updateWheres).toEqual([
      expect.objectContaining({ id: 2 }),
    ]);
    // The already-encrypted envelope must be untouched.
    expect(rows.find((r) => r.id === 1)?.apiKey).toBe(alreadyEnvelope);
  });

  it("refuses to run (throws before any writes) if the encryption key is missing", async () => {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
    const { db, updateWheres } = makeFakeDb([
      { id: 1, clerkUserId: "user_a", provider: "granola", apiKey: "plain_a" },
    ]);

    await expect(
      reencryptUserIntegrationTokens({
        db: db as never,
        logger: makeSilentLogger(),
      })
    ).rejects.toBeInstanceOf(UserIntegrationTokenKeyError);

    expect(updateWheres).toHaveLength(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("refuses to run (throws before any writes) if the encryption key is malformed", async () => {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = "aGVsbG8="; // 5 bytes — wrong length
    const { db, updateWheres } = makeFakeDb([
      { id: 1, clerkUserId: "user_a", provider: "granola", apiKey: "plain_a" },
    ]);

    await expect(
      reencryptUserIntegrationTokens({
        db: db as never,
        logger: makeSilentLogger(),
      })
    ).rejects.toBeInstanceOf(UserIntegrationTokenKeyError);

    expect(updateWheres).toHaveLength(0);
  });

  it("post-run, no plaintext rows remain in the mocked table", async () => {
    const { db, rows } = makeFakeDb([
      { id: 1, clerkUserId: "user_a", provider: "granola", apiKey: "plain_a" },
      { id: 2, clerkUserId: "user_b", provider: "granola", apiKey: "plain_b" },
      { id: 3, clerkUserId: "user_c", provider: "granola", apiKey: "plain_c" },
    ]);

    await reencryptUserIntegrationTokens({
      db: db as never,
      logger: makeSilentLogger(),
    });

    expect(rows.filter((r) => !isEncryptedToken(r.apiKey))).toEqual([]);
  });
});
