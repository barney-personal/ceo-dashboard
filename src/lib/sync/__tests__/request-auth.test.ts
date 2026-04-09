import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn(),
}));

import { currentUser } from "@clerk/nextjs/server";
import { CURRENT_USER_TIMEOUT_MS } from "@/lib/auth/current-user.server";
import {
  authorizeSyncRequest,
  isCronRequest,
  requireRole,
} from "@/lib/sync/request-auth";

const mockCurrentUser = vi.mocked(currentUser);

function asCurrentUser(publicMetadata: Record<string, unknown>) {
  return {
    publicMetadata,
  } as unknown as ReturnType<typeof currentUser> extends Promise<infer U>
    ? U
    : never;
}

function makeRequest(authHeader?: string) {
  return new Request("http://localhost/api/test", {
    headers: authHeader ? { authorization: authHeader } : {},
  }) as unknown as import("next/server").NextRequest;
}

describe("requireRole", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when not authenticated", async () => {
    mockCurrentUser.mockResolvedValue(null);
    const result = await requireRole("ceo");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("Unauthorized");
    }
  });

  it("returns 403 when user has insufficient role", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "leadership" }));
    const result = await requireRole("ceo");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("Forbidden");
    }
  });

  it("returns 403 for everyone role trying to access ceo route", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({}));
    const result = await requireRole("ceo");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it("returns ok when user has the required role", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "ceo" }));
    const result = await requireRole("ceo");
    expect(result.ok).toBe(true);
  });

  it("allows higher roles to access lower-requirement routes", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "ceo" }));
    const result = await requireRole("leadership");
    expect(result.ok).toBe(true);
  });

  it("returns ok for leadership role on a leadership route", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "leadership" }));
    const result = await requireRole("leadership");
    expect(result.ok).toBe(true);
  });

  it("returns 401 when Clerk lookup times out", async () => {
    vi.useFakeTimers();
    mockCurrentUser.mockImplementation(
      () => new Promise<Awaited<ReturnType<typeof currentUser>>>(() => {})
    );

    const resultPromise = requireRole("ceo");

    await vi.advanceTimersByTimeAsync(CURRENT_USER_TIMEOUT_MS);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
  });
});

describe("authorizeSyncRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'cron' when bearer token matches CRON_SECRET", async () => {
    process.env.CRON_SECRET = "test-secret";
    const req = makeRequest("Bearer test-secret");
    const result = await authorizeSyncRequest(req);
    expect(result).toBe("cron");
  });

  it("returns 'unauthenticated' when no user and no cron token", async () => {
    mockCurrentUser.mockResolvedValue(null);
    const req = makeRequest();
    const result = await authorizeSyncRequest(req);
    expect(result).toBe("unauthenticated");
  });

  it("returns 'forbidden' when user lacks CEO role", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "leadership" }));
    const req = makeRequest();
    const result = await authorizeSyncRequest(req);
    expect(result).toBe("forbidden");
  });

  it("returns 'manual' when user has CEO role", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "ceo" }));
    const req = makeRequest();
    const result = await authorizeSyncRequest(req);
    expect(result).toBe("manual");
  });

  it("does not treat wrong bearer token as cron", async () => {
    process.env.CRON_SECRET = "test-secret";
    mockCurrentUser.mockResolvedValue(null);
    const req = makeRequest("Bearer wrong-secret");
    const result = await authorizeSyncRequest(req);
    expect(result).toBe("unauthenticated");
  });

  it("returns 'unauthenticated' when Clerk lookup times out", async () => {
    vi.useFakeTimers();
    mockCurrentUser.mockImplementation(
      () => new Promise<Awaited<ReturnType<typeof currentUser>>>(() => {})
    );

    const resultPromise = authorizeSyncRequest(makeRequest());

    await vi.advanceTimersByTimeAsync(CURRENT_USER_TIMEOUT_MS);

    await expect(resultPromise).resolves.toBe("unauthenticated");
  });
});

describe("isCronRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("returns true when the bearer token matches", async () => {
    process.env.CRON_SECRET = "test-secret";
    await expect(isCronRequest(makeRequest("Bearer test-secret"))).resolves.toBe(
      true
    );
  });

  it("returns false when the bearer token is missing or wrong", async () => {
    process.env.CRON_SECRET = "test-secret";

    await expect(isCronRequest(makeRequest())).resolves.toBe(false);
    await expect(isCronRequest(makeRequest("Bearer wrong-secret"))).resolves.toBe(
      false
    );
  });
});
