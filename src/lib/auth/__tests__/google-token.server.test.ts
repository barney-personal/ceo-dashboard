import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUserOauthAccessToken } = vi.hoisted(() => ({
  mockGetUserOauthAccessToken: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: {
      getUserOauthAccessToken: mockGetUserOauthAccessToken,
    },
  })),
}));

import { getUserGoogleAccessToken, GOOGLE_CALENDAR_READONLY_SCOPE } from "@/lib/auth/google-token.server";

describe("getUserGoogleAccessToken", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
});
