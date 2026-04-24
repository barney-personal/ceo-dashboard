import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const { clerkMock, dbMock, syncMock, fetchMock } = vi.hoisted(() => ({
  clerkMock: {
    auth: vi.fn<() => Promise<{ userId: string | null }>>(),
  },
  dbMock: {
    insertValues: vi.fn<(row: unknown) => void>(),
    onConflictDoUpdate: vi.fn<(opts: unknown) => Promise<void>>(),
  },
  syncMock: {
    syncGranolaNotes: vi.fn<
      (since: Date, opts: { token: string; syncedByUserId: string }) => Promise<{
        count: number;
        errors: string[];
      }>
    >(),
  },
  fetchMock: vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerkMock.auth,
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (row: unknown) => {
        dbMock.insertValues(row);
        return {
          onConflictDoUpdate: (opts: unknown) => {
            dbMock.onConflictDoUpdate(opts);
            return Promise.resolve();
          },
        };
      },
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  userIntegrations: {
    clerkUserId: "clerkUserId",
    provider: "provider",
    apiKey: "apiKey",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

vi.mock("@/lib/sync/meetings", () => ({
  syncGranolaNotes: syncMock.syncGranolaNotes,
}));

const originalFetch = globalThis.fetch;

import { PUT } from "@/app/api/integrations/route";
import { isEncryptedToken } from "@/lib/security/user-integration-tokens.server";

const VALID_KEY = randomBytes(32).toString("base64");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/integrations", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as import("next/server").NextRequest;
}

describe("PUT /api/integrations — token envelope storage", () => {
  beforeEach(() => {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = VALID_KEY;
    clerkMock.auth.mockReset();
    dbMock.insertValues.mockReset();
    dbMock.onConflictDoUpdate.mockReset();
    syncMock.syncGranolaNotes.mockReset();
    syncMock.syncGranolaNotes.mockImplementation(() =>
      Promise.resolve({ count: 0, errors: [] })
    );
    fetchMock.mockReset();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    clerkMock.auth.mockResolvedValue({ userId: "user_123" });
  });

  afterEach(() => {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  it("encrypts the raw apiKey before inserting (never stores plaintext)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const res = await PUT(
      makeRequest({ provider: "granola", apiKey: "grn_secret_from_user" })
    );

    expect(res.status).toBe(200);
    expect(dbMock.insertValues).toHaveBeenCalledTimes(1);
    const row = dbMock.insertValues.mock.calls[0][0] as {
      apiKey: string;
      clerkUserId: string;
      provider: string;
    };
    expect(row.clerkUserId).toBe("user_123");
    expect(row.provider).toBe("granola");
    expect(row.apiKey).not.toBe("grn_secret_from_user");
    expect(row.apiKey).not.toContain("grn_secret_from_user");
    expect(isEncryptedToken(row.apiKey)).toBe(true);

    // onConflictDoUpdate must also persist the encrypted envelope.
    const conflictArgs = dbMock.onConflictDoUpdate.mock.calls[0][0] as {
      set: { apiKey: string };
    };
    expect(isEncryptedToken(conflictArgs.set.apiKey)).toBe(true);
  });

  it("passes the raw (not encrypted) token to the background Granola sync", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await PUT(makeRequest({ provider: "granola", apiKey: "grn_secret_from_user" }));

    expect(syncMock.syncGranolaNotes).toHaveBeenCalledTimes(1);
    const opts = syncMock.syncGranolaNotes.mock.calls[0][1] as {
      token: string;
      syncedByUserId: string;
    };
    expect(opts.token).toBe("grn_secret_from_user");
    expect(opts.syncedByUserId).toBe("user_123");
  });

  it("returns 422 and does not persist or sync when Granola rejects the key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const res = await PUT(
      makeRequest({ provider: "granola", apiKey: "grn_bad_token" })
    );

    expect(res.status).toBe(422);
    expect(dbMock.insertValues).not.toHaveBeenCalled();
    expect(syncMock.syncGranolaNotes).not.toHaveBeenCalled();
  });

  it("returns 500 and does not persist when the encryption key is missing", async () => {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const res = await PUT(
      makeRequest({ provider: "granola", apiKey: "grn_secret_from_user" })
    );

    expect(res.status).toBe(500);
    expect(dbMock.insertValues).not.toHaveBeenCalled();
    expect(syncMock.syncGranolaNotes).not.toHaveBeenCalled();
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    clerkMock.auth.mockResolvedValueOnce({ userId: null });

    const res = await PUT(
      makeRequest({ provider: "granola", apiKey: "grn_secret_from_user" })
    );

    expect(res.status).toBe(401);
    expect(dbMock.insertValues).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported providers with 400", async () => {
    const res = await PUT(makeRequest({ provider: "linear", apiKey: "key" }));
    expect(res.status).toBe(400);
    expect(dbMock.insertValues).not.toHaveBeenCalled();
  });
});
