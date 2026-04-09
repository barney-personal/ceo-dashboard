import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import { currentUser } from "@clerk/nextjs/server";
import { CURRENT_USER_TIMEOUT_MS } from "@/lib/auth/current-user.server";
import { getCurrentUserRole } from "@/lib/auth/roles.server";

const mockCurrentUser = vi.mocked(currentUser);

function asCurrentUser(publicMetadata: Record<string, unknown>) {
  return {
    publicMetadata,
  } as unknown as ReturnType<typeof currentUser> extends Promise<infer U>
    ? U
    : never;
}

describe("getCurrentUserRole", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the role from Clerk public metadata", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "ceo" }));

    await expect(getCurrentUserRole()).resolves.toBe("ceo");
  });

  it("falls back to everyone when no Clerk user is available", async () => {
    mockCurrentUser.mockResolvedValue(null);

    await expect(getCurrentUserRole()).resolves.toBe("everyone");
  });

  it("redirects to sign-in when Clerk lookup times out", async () => {
    vi.useFakeTimers();
    mockCurrentUser.mockImplementation(
      () => new Promise<Awaited<ReturnType<typeof currentUser>>>(() => {})
    );

    const resultPromise = getCurrentUserRole();
    const rejection = expect(resultPromise).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in"
    );

    await vi.advanceTimersByTimeAsync(CURRENT_USER_TIMEOUT_MS);

    await rejection;
    expect(mockRedirect).toHaveBeenCalledWith("/sign-in");
  });
});
