import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real Clerk SDK method relies on `this.requireId(userId)` internally.
// The mock mirrors that: if called without the `users` object as `this`
// (e.g. via a detached `const fn = users.getUserOauthAccessToken`), it
// throws the same shape Clerk throws — so any regression that strips the
// `this` binding fails every test in this file.
const { mockGetUserOauthAccessToken, usersObject } = vi.hoisted(() => {
  const mock = vi.fn();
  const users = {
    requireId(id: unknown) {
      if (!id) throw new Error("requireId: id is required");
    },
    getUserOauthAccessToken(this: { requireId: (id: unknown) => void }, userId: string, provider: string) {
      // Same internal call Clerk makes — verifies `this` is bound.
      this.requireId(userId);
      return mock(userId, provider);
    },
  };
  return { mockGetUserOauthAccessToken: mock, usersObject: users };
});

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({ users: usersObject })),
}));

import { getUserGoogleAccessToken, GOOGLE_CALENDAR_READONLY_SCOPE } from "@/lib/auth/google-token.server";

describe("getUserGoogleAccessToken", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    // Silence structured diagnostic warns emitted on null returns so they
    // don't clutter test output. Individual tests re-spy if they want to
    // assert call shape.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("uses the current Clerk google provider id", async () => {
    mockGetUserOauthAccessToken.mockResolvedValue({
      data: [{ token: "google-token", expiresAt: 200 }],
    });

    await expect(getUserGoogleAccessToken("user_123")).resolves.toBe(
      "google-token"
    );
    expect(mockGetUserOauthAccessToken).toHaveBeenCalledWith(
      "user_123",
      "google"
    );
  });

  it("falls back to oauth_google for legacy provider ids", async () => {
    mockGetUserOauthAccessToken
      .mockRejectedValueOnce(new Error("provider not found"))
      .mockResolvedValueOnce({
        data: [{ token: "legacy-token", expiresAt: 200 }],
      });

    await expect(getUserGoogleAccessToken("user_123")).resolves.toBe(
      "legacy-token"
    );
    expect(mockGetUserOauthAccessToken).toHaveBeenNthCalledWith(
      1,
      "user_123",
      "google"
    );
    expect(mockGetUserOauthAccessToken).toHaveBeenNthCalledWith(
      2,
      "user_123",
      "oauth_google"
    );
  });

  it("falls back to oauth_google when google returns no usable tokens", async () => {
    mockGetUserOauthAccessToken
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{ token: "legacy-token", expiresAt: 200 }],
      });

    await expect(getUserGoogleAccessToken("user_123")).resolves.toBe(
      "legacy-token"
    );
    expect(mockGetUserOauthAccessToken).toHaveBeenNthCalledWith(
      1,
      "user_123",
      "google"
    );
    expect(mockGetUserOauthAccessToken).toHaveBeenNthCalledWith(
      2,
      "user_123",
      "oauth_google"
    );
  });

  it("prefers a calendar-scoped token when multiple tokens exist", async () => {
    mockGetUserOauthAccessToken.mockResolvedValue({
      data: [
        {
          token: "plain-token",
          expiresAt: 500,
          scopes: ["openid", "email"],
        },
        {
          token: "calendar-token",
          expiresAt: 100,
          scopes: [GOOGLE_CALENDAR_READONLY_SCOPE],
        },
      ],
    });

    await expect(getUserGoogleAccessToken("user_123")).resolves.toBe(
      "calendar-token"
    );
  });

  it("returns null when Clerk has no usable Google token", async () => {
    mockGetUserOauthAccessToken
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ token: null }] });

    await expect(getUserGoogleAccessToken("user_123")).resolves.toBeNull();
  });

  it("logs diagnostic context when a probe throws so prod failures are debuggable", async () => {
    mockGetUserOauthAccessToken
      .mockRejectedValueOnce(new Error("provider not found"))
      .mockResolvedValueOnce({ data: [] });

    await expect(getUserGoogleAccessToken("user_123")).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[google-token] returning null for user",
      expect.objectContaining({
        userId: "user_123",
        sawAnyToken: false,
        sawAnyScoped: false,
        probeErrors: expect.objectContaining({
          google: "provider not found",
        }),
      }),
    );
  });

  it("stays quiet when the user simply hasn't connected Google", async () => {
    // Both providers return empty, no errors — this is the boring "no
    // Google account" case and shouldn't spam logs on every overview load.
    mockGetUserOauthAccessToken.mockResolvedValue({ data: [] });

    await expect(getUserGoogleAccessToken("user_123")).resolves.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
